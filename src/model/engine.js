// Generic spiking-network engine shared by every window's model.
//
// Populations are split into C channels (competing actions, hemifields or
// working-memory stripes) of `n` neurons each. Neurons: Izhikevich (2003)
// quadratic integrate-and-fire ('q03') or the Izhikevich (2007, ch. 8) MSN
// model ('msn'). Synapses: conductance based, exponential decay, AMPA
// (E = 0 mV), GABA_A (E = -80 mV) and NMDA (E = 0 mV, slow, Mg2+ block;
// Jahr & Stevens 1990) for recurrent persistent activity (Wang 1999).
// Delays are per projection, in ms. Optional per-population Ca2+-activated
// non-specific cation current (I_CAN; Egorov et al. 2002) gives cellular
// bistability for persistent activity: def.can = {g, theta, k, tau}.
//
// Projection topology: 'focal' (same channel), 'diffuse' (all channels) or
// 'cross' (the other channel(s) only; used for lumped lateral inhibition).
// Subclasses provide inputs() (task stimulus currents) and gain(proj)
// (neuromodulation / lesions), and may hook newTrial() and afterStep().

export const DT = 0.1; // ms
const TAU = { glu: 5, gaba: 8, nmda: 100 }; // ms, AMPA / GABA_A / NMDA decay
const EREV = { glu: 0, gaba: -80 };
const MG = 1; // mM

export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Network {
  /**
   * pops: {key: {label, n, form, p, bias, noise}}; projections: [{id, from, to, nt, w, delay, topo, p?}]
   * trialLength: ms after which model time wraps to 0 and newTrial() runs.
   */
  constructor({ pops, projections, channels = 2, trialLength, seed = 1, rateTau = 15 }) {
    this.POPS = pops;
    this.popKeys = Object.keys(pops);
    this.NC = channels;
    this.trialLength = trialLength;
    this.rateTau = rateTau;
    this.rng = mulberry32(seed);
    this.k = 0; // step within trial
    this.t = 0; // ms within trial
    this.trialCount = 0;
    this.listeners = [];
    this.lesion = {};
    const NC = channels;

    this.pops = {};
    for (const key of this.popKeys) {
      const def = pops[key];
      const N = def.n * NC;
      const pop = {
        key, def, N,
        v: new Float32Array(N), u: new Float32Array(N),
        gE: new Float32Array(N), gI: new Float32Array(N), gN: new Float32Array(N),
        iExt: new Float32Array(NC),
        spiked: new Uint8Array(N),
        ca: def.can ? new Float32Array(N) : null, // spike-driven Ca2+ for the CAN current
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
    const maxDelay = Math.max(...projections.map((p) => p.delay));
    this.histLen = Math.ceil(maxDelay / DT) + 2;
    for (const pop of Object.values(this.pops)) pop.hist = Array.from({ length: this.histLen }, () => []);
    this.step_ = 0;
    this.usesNmda = projections.some((p) => p.nt === 'nmda');

    this.projections = projections.map((def) => this.connect(def));
  }

  connect(def) {
    const NC = this.NC;
    const src = this.pops[def.from];
    const dst = this.pops[def.to];
    const nSrc = src.def.n;
    const p = def.p ?? 0.5; // connection probability
    const nCh = def.topo === 'focal' ? 1 : def.topo === 'cross' ? NC - 1 : NC;
    const inputs = nSrc * nCh * p;
    const targets = [];
    for (let i = 0; i < src.N; i++) {
      const ci = Math.floor(i / nSrc);
      const list = [];
      for (let j = 0; j < dst.N; j++) {
        const cj = Math.floor(j / dst.def.n);
        if (def.topo === 'focal' && ci !== cj) continue;
        if (def.topo === 'cross' && ci === cj) continue;
        if (this.rng() < p) list.push(j);
      }
      targets.push(Int32Array.from(list));
    }
    return { def, src, dst, targets, w: def.w / inputs, lag: Math.round(def.delay / DT) };
  }

  /** efficacy multiplier of a projection this step (lesions, neuromodulators); 0 disables it */
  gain(proj) {
    const d = proj.def;
    if (d.pathway && this.lesion[d.pathway]) return 0;
    return 1;
  }

  /** set pop.iExt[c] (task stimulus currents) for this step */
  inputs() {}

  /** called once per trial, before its first step */
  newTrial() {}

  /** called after every step, before time advances */
  afterStep() {}

  /** advance one DT */
  step() {
    const rng = this.rng;
    const now = this.step_ % this.histLen;
    const NC = this.NC;

    if (this.k === 0 && !this.started) {
      this.started = true;
      this.newTrial();
    }

    // deliver delayed spikes
    for (const pr of this.projections) {
      const g = this.gain(pr);
      if (!g) continue;
      const w = pr.w * g;
      const slot = (this.step_ - pr.lag + this.histLen * 4) % this.histLen;
      const spikes = pr.src.hist[slot];
      const nt = pr.def.nt;
      const G = nt === 'glu' ? pr.dst.gE : nt === 'gaba' ? pr.dst.gI : pr.dst.gN;
      for (let s = 0; s < spikes.length; s++) {
        const tg = pr.targets[spikes[s]];
        for (let k = 0; k < tg.length; k++) G[tg[k]] += w;
      }
    }

    this.inputs();

    const dE = Math.exp(-DT / TAU.glu);
    const dI = Math.exp(-DT / TAU.gaba);
    const dN = Math.exp(-DT / TAU.nmda);
    const sq = Math.sqrt(DT);
    const nmda = this.usesNmda;
    for (const key of this.popKeys) {
      const pop = this.pops[key];
      const { def, v, u, gE, gI, gN, spiked } = pop;
      const P = def.p;
      const nmdaMax = def.nmdaMax ?? Infinity;
      const can = def.can;
      const dCa = can ? Math.exp(-DT / can.tau) : 0;
      const hist = pop.hist[now];
      hist.length = 0;
      const counts = new Uint16Array(NC);
      for (let i = 0; i < pop.N; i++) {
        const c = Math.floor(i / def.n);
        const vi = v[i];
        let iSyn = gE[i] * (EREV.glu - vi) + gI[i] * (EREV.gaba - vi);
        if (nmda) {
          if (gN[i] > nmdaMax) gN[i] = nmdaMax; // receptor saturation bounds the persistent state
          iSyn += (gN[i] * -vi) / (1 + (MG / 3.57) * Math.exp(-0.062 * vi));
        }
        let I = pop.bias[i] + pop.iExt[c] + iSyn;
        if (can) I += can.g / (1 + Math.exp(-(pop.ca[i] - can.theta) / can.k));
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
          if (can) pop.ca[i] += 1;
        }
        if (can) pop.ca[i] *= dCa;
        v[i] = vn < -100 ? -100 : vn;
        gE[i] *= dE;
        gI[i] *= dI;
        if (nmda) gN[i] *= dN;
      }
      pop.count = counts;
      for (let c = 0; c < NC; c++) {
        const inst = (counts[c] / def.n) * (1000 / DT); // Hz
        pop.rate[c] += ((inst - pop.rate[c]) * DT) / this.rateTau;
      }
    }

    this.afterStep();

    this.step_++;
    this.k++;
    this.t = this.k * DT;
    if (this.t >= this.trialLength - DT / 2) {
      this.k = 0;
      this.t = 0;
      this.trialCount++;
      this.newTrial();
      for (const fn of this.listeners) fn(this.trialCount);
    }
  }

  /** run for ms of model time; onStep(net) is called after every step */
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

  /** mean rate over channels */
  meanRate(key) {
    const r = this.pops[key].rate;
    let s = 0;
    for (let c = 0; c < r.length; c++) s += r[c];
    return s / r.length;
  }
}

let spare = null;
export function gauss(rng) {
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
