// Spiking model of the dorsolateral prefrontal loop (Alexander, DeLong & Strick
// 1986) gating working memory (Frank, Loughry & O'Reilly 2001; Braver & Cohen
// 2000).
//
// Channels are two working-memory "stripes", A and B, each able to hold one
// item. DLPFC populations are bistable (NMDA recurrence + I_CAN): once ignited
// they keep firing without input. Whether an item gets in is decided by the
// caudate-GPi/SNr-MD thalamus loop: the item drives DLPFC and caudate, and only
// when a phasic dopamine burst (SNc, signalling a task-relevant item) boosts
// the D1 corticostriatal gain does GPi pause, MD fire and its kick ignite
// DLPFC. An irrelevant distractor arrives without a burst: DLPFC responds
// transiently but the gate stays shut. ACC registers co-activation of the
// stripes (conflict) and drives STN, raising the GPi brake in every stripe
// (Frank 2006 "hold your horses").

import { Network, DT } from './engine.js';

export { DT };
export const CHANNELS = ['A', 'B'];
const NC = 2;

const RS4 = { a: 0.02, b: 0.2, c: -65, d: 4 };
const RS = { a: 0.02, b: 0.2, c: -65, d: 8 };
const FS = { a: 0.1, b: 0.2, c: -65, d: 2 };
const MSN = { C: 50, k: 1, vr: -80, vt: -25, vpeak: 40, a: 0.01, b: -20, c: -55, d: 150 };

export const POPS = {
  dlpfc: { label: 'DLPFC', n: 30, form: 'q03', p: RS4, bias: 0.6, noise: 2, can: { g: 5, theta: 3, k: 0.3, tau: 150 } },
  cd1: { label: 'Caudate D1', n: 24, form: 'msn', p: MSN, bias: 0, noise: 2.5 },
  cd2: { label: 'Caudate D2', n: 24, form: 'msn', p: MSN, bias: 0, noise: 2.5 },
  gpe: { label: 'GPe', n: 16, form: 'q03', p: FS, bias: 4.5, noise: 2.0 },
  stn: { label: 'STN', n: 16, form: 'q03', p: { a: 0.02, b: 0.2, c: -65, d: 6 }, bias: 6.2, noise: 2.0 },
  gpi: { label: 'GPi / SNr', n: 16, form: 'q03', p: FS, bias: 5.5, noise: 2.0 },
  md: { label: 'MD thalamus', n: 16, form: 'q03', p: { a: 0.02, b: 0.25, c: -65, d: 0.05 }, bias: 1.5, noise: 1.6 },
  snc: { label: 'SNc / VTA', n: 6, form: 'q03', p: RS, bias: 2.6, noise: 1.5 },
  acc: { label: 'ACC', n: 16, form: 'q03', p: RS, bias: 1.5, noise: 2 },
};
export const POP_KEYS = Object.keys(POPS);

export const PROJECTIONS = [
  { id: 'dlpfc-dlpfc', from: 'dlpfc', to: 'dlpfc', nt: 'nmda', w: 0.4, delay: 2, topo: 'focal' },
  { id: 'dlpfc-i', from: 'dlpfc', to: 'dlpfc', nt: 'gaba', w: 0.5, delay: 2, topo: 'focal' },
  { id: 'dlpfc-x', from: 'dlpfc', to: 'dlpfc', nt: 'gaba', w: 0.6, delay: 2, topo: 'cross' },
  { id: 'dlpfc-cd1', from: 'dlpfc', to: 'cd1', nt: 'glu', w: 32, delay: 4, topo: 'focal', pathway: 'direct', da: +1 },
  { id: 'dlpfc-cd2', from: 'dlpfc', to: 'cd2', nt: 'glu', w: 32, delay: 4, topo: 'focal', pathway: 'indirect', da: -1 },
  { id: 'cd1-gpi', from: 'cd1', to: 'gpi', nt: 'gaba', w: 12, delay: 7, topo: 'focal', pathway: 'direct' },
  { id: 'cd2-gpe', from: 'cd2', to: 'gpe', nt: 'gaba', w: 15, delay: 7, topo: 'focal', pathway: 'indirect' },
  { id: 'gpe-stn', from: 'gpe', to: 'stn', nt: 'gaba', w: 0.097, delay: 4, topo: 'focal', pathway: 'indirect' },
  { id: 'gpe-gpi', from: 'gpe', to: 'gpi', nt: 'gaba', w: 0.075, delay: 3, topo: 'focal', pathway: 'indirect' },
  { id: 'stn-gpe', from: 'stn', to: 'gpe', nt: 'glu', w: 0.22, delay: 2, topo: 'diffuse' },
  { id: 'stn-gpi', from: 'stn', to: 'gpi', nt: 'glu', w: 0.29, delay: 2, topo: 'diffuse' },
  { id: 'gpi-md', from: 'gpi', to: 'md', nt: 'gaba', w: 0.5, delay: 3, topo: 'focal' },
  { id: 'md-dlpfc', from: 'md', to: 'dlpfc', nt: 'glu', w: 0.3, delay: 3, topo: 'focal', pathway: 'md' },
  { id: 'acc-stn', from: 'acc', to: 'stn', nt: 'glu', w: 0.6, delay: 4, topo: 'diffuse', pathway: 'acc' },
];

export const TRIAL = {
  length: 1800,
  cueOn: 200,
  cueOff: 350,
  distOn: 900,
  distOff: 1050,
  clearOn: 1600,
  clearOff: 1790,
};

export const PARAMS = {
  item: 4, // stimulus current of a shown item into its DLPFC stripe
  distractor: 4,
  burst: 0.8, // phasic DA added to lambda during a relevant item
  burstOn: true,
  accGain: 0.01, // ACC input per Hz^2 of DLPFC stripe co-activation
};

export class Executive extends Network {
  constructor({ seed = 1, dopamine = 0.2, lesion = {} } = {}) {
    super({ pops: POPS, projections: PROJECTIONS, channels: NC, trialLength: TRIAL.length, seed, rateTau: 15 });
    this.P = { ...PARAMS };
    this.dopamine = dopamine; // tonic lambda
    this.lesion = { direct: false, indirect: false, md: false, acc: false, ...lesion };
    this.cueStripe = 1; // flips to 0 on the first trial
  }

  newTrial() {
    this.cueStripe = 1 - this.cueStripe; // relevant item alternates A / B between trials
    // end-of-trial wipe: working memory starts empty (avoids rebound re-ignition)
    for (const key of ['dlpfc', 'md', 'cd1', 'cd2']) {
      const p = this.pops[key];
      p.gE.fill(0);
      p.gN.fill(0);
      p.ca?.fill(0);
      for (let i = 0; i < p.N; i++) {
        p.v[i] = key.startsWith('cd') ? p.def.p.vr : -65;
        p.u[i] = key.startsWith('cd') ? 0 : p.def.p.b * -65;
      }
    }
  }

  get distStripe() {
    return 1 - this.cueStripe;
  }

  /** phasic dopamine burst while a relevant item is on screen (+ 30 ms latency) */
  get phasic() {
    const t = this.t;
    return this.P.burstOn && t >= TRIAL.cueOn + 30 && t < TRIAL.cueOff + 30 ? this.P.burst : 0;
  }

  get lambda() {
    return this.dopamine + this.phasic;
  }

  gain(proj) {
    const d = proj.def;
    if (d.pathway && this.lesion[d.pathway]) return 0;
    if (d.da) return Math.max(0, 1 + d.da * this.lambda);
    return 1;
  }

  inputs() {
    const { t, P, pops } = this;
    const cue = t >= TRIAL.cueOn && t < TRIAL.cueOff;
    const dist = t >= TRIAL.distOn && t < TRIAL.distOff;
    const clear = t >= TRIAL.clearOn && t < TRIAL.clearOff;
    for (let c = 0; c < NC; c++) {
      let I = 0;
      if (cue && c === this.cueStripe) I += P.item;
      if (dist && c === this.distStripe) I += P.distractor;
      if (clear && this.rate('dlpfc', c) > 8) I -= 3; // end of trial: memory (and its thalamic loop) is cleared
      pops.dlpfc.iExt[c] = I;
    }
    pops.md.iExt[0] = pops.md.iExt[1] = clear ? -3 : 0;
    const conflict = this.lesion.acc ? 0 : P.accGain * this.rate('dlpfc', 0) * this.rate('dlpfc', 1);
    pops.acc.iExt[0] = pops.acc.iExt[1] = conflict;
    // SNc cells burst with the phasic signal
    pops.snc.iExt[0] = pops.snc.iExt[1] = this.phasic ? 8 : 0;
  }
}
