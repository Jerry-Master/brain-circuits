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

import { Network, DT } from './engine.js';

export { DT };
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

export class Circuit extends Network {
  constructor({ seed = 1, dopamine = 0.2, lesion = {} } = {}) {
    super({ pops: POPS, projections: PROJECTIONS, channels: NC, trialLength: TRIAL.length, seed, rateTau: RATE_TAU });
    this.dopamine = dopamine; // lambda, 0 = depleted (parkinsonian), 0.2 = normal
    this.lesion = { direct: false, indirect: false, hyperdirect: false, ...lesion };
    this.setDopamine(dopamine);
  }

  setDopamine(lambda) {
    this.dopamine = lambda;
    const p = this.pops.snc;
    for (let i = 0; i < p.N; i++) p.bias[i] = SNC_BIAS(lambda);
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

  inputs() {
    this.pops.ctx.iExt[0] = this.cue(0);
    this.pops.ctx.iExt[1] = this.cue(1);
  }
}
