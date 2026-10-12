// Spiking model of the cortico-basal ganglia-thalamo-cortical motor loop.
//
// Everything the app shows (structure glow, tract spikes, example cells, rate
// read-outs) is read from this simulation; nothing downstream of the cortical
// cue is scripted.
//
// Organisation follows the "parallel channels" view of action selection
// (Mink 1996; Gurney, Prescott & Redgrave 2001): two competing motor channels
// A and B. Striatum, GPe, GPi, thalamus and cortex are channel-specific
// (focal); STN projects diffusely to all channels (centre-surround).
//
// Neurons: Izhikevich (2003) quadratic integrate-and-fire for cortex, GPe,
// STN, GPi and thalamus; the Izhikevich (2007, ch. 8) MSN model, with its
// hyperpolarised down state, for D1/D2 striatal cells.
// Synapses: conductance based, exponential decay, AMPA (E = 0 mV) and GABA_A
// (E = -80 mV). Delays are per projection, in ms.
// Dopamine (SNc) is a tonic level lambda that scales corticostriatal efficacy:
// x(1 + lambda) onto D1 MSNs and x(1 - lambda) onto D2 MSNs (Gurney et al. 2001).

export const DT = 0.1; // ms
export const CHANNELS = ['A', 'B'];
const NC = CHANNELS.length;

// v' = 0.04v^2 + 5v + 140 - u + I  (2003 form);  C v' = k(v-vr)(v-vt) - u + I (2007 form)
export const POPS = {
  ctx: { label: 'Cortex L5', n: 24, form: 'q03', p: { a: 0.02, b: 0.2, c: -65, d: 8 }, bias: 1.7, noise: 2.6 },
  d1: { label: 'D1 MSN', n: 24, form: 'msn', p: { C: 50, k: 1, vr: -80, vt: -25, vpeak: 40, a: 0.01, b: -20, c: -55, d: 150 }, bias: 0, noise: 2.5 },
  d2: { label: 'D2 MSN', n: 24, form: 'msn', p: { C: 50, k: 1, vr: -80, vt: -25, vpeak: 40, a: 0.01, b: -20, c: -55, d: 150 }, bias: 0, noise: 2.5 },
  gpe: { label: 'GPe', n: 16, form: 'q03', p: { a: 0.1, b: 0.2, c: -65, d: 2 }, bias: 4.5, noise: 2.0 },
  stn: { label: 'STN', n: 16, form: 'q03', p: { a: 0.02, b: 0.2, c: -65, d: 6 }, bias: 6.2, noise: 2.0 },
  gpi: { label: 'GPi', n: 16, form: 'q03', p: { a: 0.1, b: 0.2, c: -65, d: 2 }, bias: 5.5, noise: 2.0 },
  // SNc dopamine cells: slow pacemakers (~2-6 Hz). They make no fast synapses here;
  // their transmitter acts as the tonic gain lambda, and their bias tracks lambda.
  snc: { label: 'SNc', n: 6, form: 'q03', p: { a: 0.02, b: 0.2, c: -65, d: 8 }, bias: 4, noise: 1.5 },
  vl: { label: 'VLo', n: 16, form: 'q03', p: { a: 0.02, b: 0.25, c: -65, d: 0.05 }, bias: 3.2, noise: 1.6 },
};
export const POP_KEYS = Object.keys(POPS);

const TAU = { glu: 5, gaba: 8 }; // ms, AMPA / GABA_A decay
const EREV = { glu: 0, gaba: -80 };

// w: total conductance a fully active presynaptic channel population would deliver;
// divided by the expected number of inputs so it does not depend on population size.
// delay: conduction + synaptic delay, ms, order of magnitude from cortical-stimulation
// latency studies in primates (Nambu et al. 2000, 2002): hyperdirect excitation of GPi
// at ~8 ms, direct-pathway inhibition at ~20 ms, indirect late excitation at ~30 ms.
export const PROJECTIONS = [
  { id: 'ctx-d1', from: 'ctx', to: 'd1', nt: 'glu', w: 54, delay: 4, topo: 'focal', pathway: 'direct', da: +1 },
  { id: 'ctx-d2', from: 'ctx', to: 'd2', nt: 'glu', w: 72, delay: 4, topo: 'focal', pathway: 'indirect', da: -1 },
  { id: 'ctx-stn', from: 'ctx', to: 'stn', nt: 'glu', w: 1.1, delay: 2.5, topo: 'focal', pathway: 'hyperdirect' },
  { id: 'd1-gpi', from: 'd1', to: 'gpi', nt: 'gaba', w: 12, delay: 7, topo: 'focal', pathway: 'direct' },
  { id: 'd2-gpe', from: 'd2', to: 'gpe', nt: 'gaba', w: 15, delay: 7, topo: 'focal', pathway: 'indirect' },
  { id: 'gpe-stn', from: 'gpe', to: 'stn', nt: 'gaba', w: 0.097, delay: 4, topo: 'focal', pathway: 'indirect' },
  { id: 'gpe-gpi', from: 'gpe', to: 'gpi', nt: 'gaba', w: 0.075, delay: 3, topo: 'focal', pathway: 'indirect' },
  { id: 'stn-gpe', from: 'stn', to: 'gpe', nt: 'glu', w: 0.22, delay: 2, topo: 'diffuse' },
  { id: 'stn-gpi', from: 'stn', to: 'gpi', nt: 'glu', w: 0.29, delay: 2, topo: 'diffuse', pathway: 'indirect' },
  { id: 'gpi-vl', from: 'gpi', to: 'vl', nt: 'gaba', w: 0.5, delay: 3, topo: 'focal' },
  { id: 'vl-ctx', from: 'vl', to: 'ctx', nt: 'glu', w: 0.06, delay: 3, topo: 'focal' },
];

// Trial: a cortical command arrives for channel A (strong) and channel B (weaker, competing).
export const TRIAL = { length: 700, cueOn: 100, cueOff: 450, cueA: 9.3, cueB: 2.3 };
const RATE_TAU = 15; // ms, smoothing for displayed population rates
const SNC_BIAS = (lambda) => (lambda < 0.02 ? 0 : 2.2 + 1.8 * lambda); // ~4 Hz at lambda = 0.2, ~7 Hz at 0.4

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Circuit {
  constructor({ seed = 1, dopamine = 0.2, lesion = {} } = {}) {
    this.rng = mulberry32(seed);
    this.dopamine = dopamine; // lambda, 0 = depleted (parkinsonian), 0.2 = normal
    this.lesion = { direct: false, indirect: false, hyperdirect: false, ...lesion };
    this.k = 0; // step within trial
    this.t = 0; // ms within trial
    this.trialCount = 0;
    this.listeners = [];

    this.pops = {};
    for (const key of POP_KEYS) {
      const def = POPS[key];
      const N = def.n * NC;
      const pop = {
        key, def, N,
        v: new Float32Array(N), u: new Float32Array(N),
        gE: new Float32Array(N), gI: new Float32Array(N),
        iExt: new Float32Array(NC),
        spiked: new Uint8Array(N),
        rate: new Float32Array(NC), // Hz, smoothed
        bias: new Float32Array(N), // per-neuron tonic current, +/-25 % heterogeneity
      };
      for (let i = 0; i < N; i++) {
        pop.bias[i] = def.bias * (0.75 + 0.5 * this.rng());
        if (def.form === 'msn') {
          pop.v[i] = def.p.vr;
          pop.u[i] = 0;
        } else {
          pop.v[i] = -65 + this.rng() * 10;
          pop.u[i] = def.p.b * pop.v[i];
        }
      }
      this.pops[key] = pop;
    }

    // ring buffers of spike indices, one per source population, long enough for the longest delay
    const maxDelay = Math.max(...PROJECTIONS.map((p) => p.delay));
    this.histLen = Math.ceil(maxDelay / DT) + 2;
    for (const pop of Object.values(this.pops)) pop.hist = Array.from({ length: this.histLen }, () => []);
    this.step_ = 0;

    this.projections = PROJECTIONS.map((def) => this.connect(def));
    this.setDopamine(dopamine);
  }

  setDopamine(lambda) {
    this.dopamine = lambda;
    const p = this.pops.snc;
    for (let i = 0; i < p.N; i++) p.bias[i] = SNC_BIAS(lambda);
  }

  connect(def) {
    const src = this.pops[def.from];
    const dst = this.pops[def.to];
    const nSrc = src.def.n;
    const p = 0.5; // connection probability
    const inputs = (def.topo === 'focal' ? nSrc : nSrc * NC) * p;
    const targets = [];
    for (let i = 0; i < src.N; i++) {
      const ci = Math.floor(i / nSrc);
      const list = [];
      for (let j = 0; j < dst.N; j++) {
        const cj = Math.floor(j / dst.def.n);
        if (def.topo === 'focal' && ci !== cj) continue;
        if (this.rng() < p) list.push(j);
      }
      targets.push(Int32Array.from(list));
    }
    return { def, src, dst, targets, w: def.w / inputs, lag: Math.round(def.delay / DT) };
  }

  gain(proj) {
    const d = proj.def;
    if (d.pathway && this.lesion[d.pathway]) return 0;
    if (d.da) return 1 + d.da * this.dopamine;
    return 1;
  }

  cue(c) {
    const { t } = this;
    if (t < TRIAL.cueOn || t >= TRIAL.cueOff) return 0;
    // 5 ms onset ramp so the command is not a step artefact
    const ramp = Math.min(1, (t - TRIAL.cueOn) / 5);
    return ramp * (c === 0 ? TRIAL.cueA : TRIAL.cueB);
  }

  /** advance one DT */
  step() {
    const rng = this.rng;
    const now = this.step_ % this.histLen;

    // deliver delayed spikes
    for (const pr of this.projections) {
      const g = this.gain(pr);
      if (!g) continue;
      const w = pr.w * g;
      const slot = (this.step_ - pr.lag + this.histLen * 4) % this.histLen;
      const spikes = pr.src.hist[slot];
      const G = pr.def.nt === 'glu' ? pr.dst.gE : pr.dst.gI;
      for (let s = 0; s < spikes.length; s++) {
        const tg = pr.targets[spikes[s]];
        for (let k = 0; k < tg.length; k++) G[tg[k]] += w;
      }
    }

    this.pops.ctx.iExt[0] = this.cue(0);
    this.pops.ctx.iExt[1] = this.cue(1);

    const dE = Math.exp(-DT / TAU.glu);
    const dI = Math.exp(-DT / TAU.gaba);
    const sq = Math.sqrt(DT);
    for (const key of POP_KEYS) {
      const pop = this.pops[key];
      const { def, v, u, gE, gI, spiked } = pop;
      const P = def.p;
      const hist = pop.hist[now];
      hist.length = 0;
      const counts = new Uint16Array(NC);
      for (let i = 0; i < pop.N; i++) {
        const c = Math.floor(i / def.n);
        const vi = v[i];
        const iSyn = gE[i] * (EREV.glu - vi) + gI[i] * (EREV.gaba - vi);
        const I = pop.bias[i] + pop.iExt[c] + iSyn;
        let vn;
        if (def.form === 'msn') {
          vn = vi + (DT * (P.k * (vi - P.vr) * (vi - P.vt) - u[i] + I)) / P.C; // pA, nS
          u[i] += DT * P.a * (P.b * (vi - P.vr) - u[i]);
        } else {
          vn = vi + DT * (0.04 * vi * vi + 5 * vi + 140 - u[i] + I);
          u[i] += DT * P.a * (P.b * vi - u[i]);
        }
        vn += def.noise * sq * gauss(rng); // mV / sqrt(ms)
        const peak = def.form === 'msn' ? P.vpeak : 30;
        spiked[i] = 0;
        if (vn >= peak) {
          vn = P.c;
          u[i] += P.d;
          spiked[i] = 1;
          hist.push(i);
          counts[c]++;
        }
        v[i] = vn < -100 ? -100 : vn;
        gE[i] *= dE;
        gI[i] *= dI;
      }
      for (let c = 0; c < NC; c++) {
        const inst = (counts[c] / def.n) * (1000 / DT); // Hz
        pop.rate[c] += ((inst - pop.rate[c]) * DT) / RATE_TAU;
      }
    }

    this.step_++;
    this.k++;
    this.t = this.k * DT;
    if (this.t >= TRIAL.length - DT / 2) {
      this.k = 0;
      this.t = 0;
      this.trialCount++;
      for (const fn of this.listeners) fn(this.trialCount);
    }
  }

  /** run for ms of model time; onStep(circuit) is called after every step */
  run(ms, onStep) {
    const n = Math.round(ms / DT);
    for (let i = 0; i < n; i++) {
      this.step();
      onStep?.(this);
    }
  }

  onTrial(fn) {
    this.listeners.push(fn);
  }

  rate(key, c = 0) {
    return this.pops[key].rate[c];
  }
}

let spare = null;
function gauss(rng) {
  if (spare !== null) {
    const s = spare;
    spare = null;
    return s;
  }
  let u, v, s;
  do {
    u = rng() * 2 - 1;
    v = rng() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const m = Math.sqrt((-2 * Math.log(s)) / s);
  spare = v * m;
  return u * m;
}
