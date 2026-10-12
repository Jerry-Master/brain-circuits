// Spiking model of Posner's three attentional networks (Petersen & Posner
// 2012) performing a lateralised Attention Network Test (Fan et al. 2002).
//
// Channels: for location-coded populations, channel 0 = left visual hemifield,
// 1 = right; for response populations, 0 = left hand (arrow points left),
// 1 = right hand. Only stimulus timing is scripted (what appears on the
// screen and when); alerting, orienting and conflict effects on reaction time
// emerge from the network:
//
// - Alerting: a warning cue drives a phasic locus coeruleus burst (Aston-Jones
//   & Cohen 2005). Noradrenaline, a slow low-pass of LC spiking, multiplies the
//   gain of the target evidence reaching motor cortex.
// - Orienting: a spatial cue reaches superior colliculus and pulvinar, which
//   ignite a persistent "priority" state in parietal cortex (IPS/SPL) held with
//   FEF (Corbetta & Shulman 2002). SPL feeds back to visual cortex, so a target
//   at the attended location drives stronger, faster evidence. A target at an
//   unattended location excites TPJ (ventral "circuit breaker") which
//   reorients SPL.
// - Executive: flankers drive the competing response. ACC receives the
//   product of the two response populations' rates (Hopfield energy;
//   Botvinick et al. 2001) and drives lateral PFC, which raises the gain on
//   the attended (centre) target.

import { Network, DT, mulberry32 } from './engine.js';

export { DT };
export const CHANNELS = ['L', 'R'];
const NC = 2;

const RS = { a: 0.02, b: 0.2, c: -65, d: 8 }; // regular spiking
const RS4 = { a: 0.02, b: 0.2, c: -65, d: 4 }; // less adapting
const TC = { a: 0.02, b: 0.25, c: -65, d: 0.05 }; // thalamocortical relay
const FS = { a: 0.1, b: 0.2, c: -65, d: 2 }; // fast spiking

export const POPS = {
  vis: { label: 'Visual ctx', n: 24, form: 'q03', p: RS4, bias: 2, noise: 2.2 },
  sc: { label: 'Sup. colliculus', n: 16, form: 'q03', p: RS4, bias: 0.5, noise: 2 },
  pul: { label: 'Pulvinar', n: 16, form: 'q03', p: TC, bias: -2.5, noise: 1.6 },
  // parietal priority map: I_CAN + NMDA make the attended location bistable
  spl: { label: 'IPS / SPL', n: 30, form: 'q03', p: RS4, bias: 1.2, noise: 2, can: { g: 5, theta: 3, k: 0.3, tau: 150 } },
  fef: { label: 'FEF', n: 20, form: 'q03', p: RS4, bias: 0.5, noise: 2 },
  tpj: { label: 'TPJ', n: 16, form: 'q03', p: RS, bias: 1, noise: 2 },
  lc: { label: 'Locus coeruleus', n: 10, form: 'q03', p: RS, bias: 2.3, noise: 1.5 },
  // response populations integrate evidence to an attractor (Wang 2002): RT = time to ignite
  resp: { label: 'M1 response', n: 30, form: 'q03', p: RS4, bias: 1.5, noise: 2, can: { g: 5, theta: 3, k: 0.3, tau: 150 } },
  acc: { label: 'ACC', n: 16, form: 'q03', p: RS, bias: 1.5, noise: 2 },
  lpfc: { label: 'Lateral PFC', n: 16, form: 'q03', p: RS4, bias: 1.5, noise: 2 },
};
export const POP_KEYS = Object.keys(POPS);

export const PROJECTIONS = [
  { id: 'vis-sc', from: 'vis', to: 'sc', nt: 'glu', w: 0.25, delay: 3, topo: 'focal', pathway: 'sc' },
  { id: 'sc-pul', from: 'sc', to: 'pul', nt: 'glu', w: 0.25, delay: 3, topo: 'focal', pathway: 'sc' },
  { id: 'vis-pul', from: 'vis', to: 'pul', nt: 'glu', w: 0.08, delay: 3, topo: 'focal', pathway: 'pul' },
  { id: 'pul-spl', from: 'pul', to: 'spl', nt: 'glu', w: 0.5, delay: 3, topo: 'focal', pathway: 'pul' },
  { id: 'spl-spl', from: 'spl', to: 'spl', nt: 'nmda', w: 0.4, delay: 2, topo: 'focal' },
  { id: 'spl-i', from: 'spl', to: 'spl', nt: 'gaba', w: 0.5, delay: 2, topo: 'focal' }, // lumped local feedback inhibition
  { id: 'spl-x', from: 'spl', to: 'spl', nt: 'gaba', w: 3, delay: 2, topo: 'cross' }, // lumped inter-hemifield inhibition
  { id: 'spl-fef', from: 'spl', to: 'fef', nt: 'glu', w: 0.2, delay: 4, topo: 'focal' },
  { id: 'fef-spl', from: 'fef', to: 'spl', nt: 'nmda', w: 0.1, delay: 4, topo: 'focal' },
  { id: 'spl-vis', from: 'spl', to: 'vis', nt: 'glu', w: 0.02, delay: 4, topo: 'focal' }, // top-down attentional gain
  { id: 'vis-tpj', from: 'vis', to: 'tpj', nt: 'glu', w: 0.1, delay: 4, topo: 'focal' },
  { id: 'spl-tpj', from: 'spl', to: 'tpj', nt: 'gaba', w: 1.2, delay: 3, topo: 'focal' },
  { id: 'tpj-spl', from: 'tpj', to: 'spl', nt: 'glu', w: 0.6, delay: 4, topo: 'focal', pathway: 'tpj' },
  { id: 'resp-resp', from: 'resp', to: 'resp', nt: 'nmda', w: 0.4, delay: 2, topo: 'focal' },
  { id: 'resp-i', from: 'resp', to: 'resp', nt: 'gaba', w: 0.5, delay: 2, topo: 'focal' },
  { id: 'resp-x', from: 'resp', to: 'resp', nt: 'gaba', w: 0.8, delay: 2, topo: 'cross' }, // response competition
  { id: 'acc-lpfc', from: 'acc', to: 'lpfc', nt: 'glu', w: 0.3, delay: 5, topo: 'diffuse', pathway: 'acc' },
];

export const TRIAL = {
  length: 2000,
  cueOn: 400,
  cueOff: 500,
  targetOn: 900,
  maxRT: 900, // target stays up until response or this long
  latency: 60, // ms, retina to visual cortex
  threshold: 25, // Hz, decision variable (slow response rate) that counts as a response
  release: 1750, // parietal priority state released (task disengagement) until 1900
};
export const CUES = ['none', 'double', 'valid', 'invalid'];
export const FLANKERS = ['congruent', 'incongruent'];

export const PARAMS = {
  cueAmp: 7, // pA-equivalent stimulus current into visual cortex at a cued location
  targetAmp: 6,
  evTarget: 0.045, // evidence current into the response population per Hz of visual-cortex rate (centre arrow)
  evFlank: 0.03, // same for the four flankers together
  tpjMatch: 2.5, // target-match input to TPJ at the target location
  lcDrive: 9, // LC current at a saturating visual onset
  attK: 10, // Hz of SPL rate at which half the evidence passes
  neGain: 0.1, // sensory gain per Hz of noradrenaline level above baseline
  accGain: 0.012, // ACC input per Hz^2 of response co-activation
  ctlGain: 0.04, // target gain per Hz of lateral PFC rate
  neTau: 600, // ms, NE level = low-pass of LC firing
};

export class Attention extends Network {
  constructor({ seed = 1, ne = 1, lesion = {}, pin = {} } = {}) {
    super({ pops: POPS, projections: PROJECTIONS, channels: NC, trialLength: TRIAL.length, seed, rateTau: 15 });
    this.P = { ...PARAMS };
    this.neScale = ne; // 1 = normal, < 1 ~ clonidine (alpha-2 agonist lowers LC output)
    this.lesion = { sc: false, pul: false, tpj: false, acc: false, ...lesion };
    this.pin = pin; // {cue, flank} fixes the condition instead of cycling
    this.condRng = mulberry32(seed * 7919 + 17);
    this.queue = [];
    this.history = []; // completed trials {cue, flank, valid, rt, correct}
    this.ne = 0; // phasic noradrenaline level, Hz of LC firing above tonic
    this.lcTonic = 5;
    this.dv = [0, 0]; // decision variables: response rates low-passed over 30 ms
  }

  /** next condition from a shuffled block of the 8 cue x flanker cells */
  drawCondition() {
    if (!this.queue.length) {
      const block = [];
      for (const cue of CUES) for (const flank of FLANKERS) block.push({ cue, flank });
      for (let i = block.length - 1; i > 0; i--) {
        const j = Math.floor(this.condRng() * (i + 1));
        [block[i], block[j]] = [block[j], block[i]];
      }
      this.queue = block;
    }
    const c = this.queue.pop();
    return {
      cue: this.pin.cue ?? c.cue,
      flank: this.pin.flank ?? c.flank,
      loc: this.condRng() < 0.5 ? 0 : 1, // target hemifield
      dir: this.condRng() < 0.5 ? 0 : 1, // centre arrow direction
    };
  }

  newTrial() {
    if (this.trial && this.trial.rt !== null) {
      const { cue, flank, rt, correct } = this.trial;
      this.history.push({ cue, flank, rt, correct });
      if (this.history.length > 400) this.history.shift();
    }
    this.trial = { ...this.drawCondition(), rt: null, choice: null, correct: null };
  }

  gain(proj) {
    const d = proj.def;
    if (d.pathway && this.lesion[d.pathway]) return 0;
    return 1;
  }

  /** cue current at location c, or 0 */
  cueAt(c) {
    const { trial: tr } = this;
    const t = this.t - TRIAL.latency;
    if (t < TRIAL.cueOn || t >= TRIAL.cueOff || tr.cue === 'none') return 0;
    const at = tr.cue === 'double' || (tr.cue === 'valid' ? c === tr.loc : c !== tr.loc);
    return at ? this.P.cueAmp : 0;
  }

  /** is the target array on the screen at model time t */
  targetShown(t) {
    const tr = this.trial;
    if (t < TRIAL.targetOn || t >= TRIAL.targetOn + TRIAL.maxRT) return false;
    return tr.rt === null || t < TRIAL.targetOn + tr.rt;
  }

  /** what visual cortex currently receives (screen delayed by afferent latency) */
  get targetUp() {
    return this.targetShown(this.t - TRIAL.latency);
  }

  get flankDir() {
    return this.trial.flank === 'congruent' ? this.trial.dir : 1 - this.trial.dir;
  }

  /** multiplicative sensory gain from noradrenaline */
  get neFactor() {
    return 1 + this.P.neGain * Math.max(0, this.ne);
  }

  get control() {
    return 1 + this.P.ctlGain * this.meanRate('lpfc');
  }

  inputs() {
    const { P, trial: tr, pops } = this;
    const up = this.targetUp;
    // phasic NE raises sensory gain (Aston-Jones & Cohen 2005)
    const g = this.neFactor;
    for (let c = 0; c < NC; c++) pops.vis.iExt[c] = this.cueAt(c) + (up && c === tr.loc ? g * P.targetAmp : 0);

    // evidence: visual-cortex activity at the target location, carried by the
    // centre arrow (control-weighted) and the flankers
    // read out through the parietal priority map: only attended locations pass
    // evidence on to response selection (attentional gating)
    const r = up ? Math.max(0, this.rate('vis', tr.loc) - 3) : 0;
    const s = this.rate('spl', tr.loc);
    const att = s / (s + P.attK);
    pops.resp.iExt[0] = pops.resp.iExt[1] = 0;
    pops.resp.iExt[tr.dir] += att * P.evTarget * r * this.control;
    pops.resp.iExt[this.flankDir] += att * P.evFlank * r;

    // TPJ responds to behaviourally relevant targets, not to cues (Corbetta et al.
    // 2008): a target-match signal from the ventral stream, delayed like vision
    pops.tpj.iExt[0] = pops.tpj.iExt[1] = 0;
    if (up) pops.tpj.iExt[tr.loc] = P.tpjMatch;

    // LC: phasic burst to any salient visual onset. The afferent saturates
    // (Aston-Jones & Cohen 2005: the phasic response is near all-or-none), so
    // one or two cue locations give the same burst
    let onset = 0;
    for (let c = 0; c < NC; c++) onset += Math.max(0, this.rate('vis', c) - 5);
    pops.lc.iExt[0] = pops.lc.iExt[1] = P.lcDrive * (1 - Math.exp(-onset / 10));

    // ACC: conflict = co-activation of the two responses
    const conflict = this.lesion.acc ? 0 : P.accGain * this.rate('resp', 0) * this.rate('resp', 1);
    pops.acc.iExt[0] = pops.acc.iExt[1] = conflict;

    // task disengagement at the end of the trial releases the parietal state
    const rel = this.t >= TRIAL.release && this.t < TRIAL.release + 150 ? -8 : 0;
    pops.spl.iExt[0] = pops.spl.iExt[1] = rel;
    // once the movement is made (100 ms after the response) the response attractor is reset
    if (tr.rt !== null) {
      const since = this.t - TRIAL.targetOn - tr.rt;
      if (since > 100 && since < 250) pops.resp.iExt[0] = pops.resp.iExt[1] = -8;
    }
  }

  afterStep() {
    // NE level: low-pass of LC rate, relative to its tonic level, scaled by drug condition
    const lc = this.meanRate('lc');
    if (this.t < TRIAL.cueOn) this.lcTonic += ((lc - this.lcTonic) * DT) / 4000; // tonic LC rate, estimated during fixation
    this.ne += ((this.neScale * (lc - this.lcTonic) - this.ne) * DT) / this.P.neTau;

    const tr = this.trial;
    for (let c = 0; c < NC; c++) this.dv[c] += ((this.rate('resp', c) - this.dv[c]) * DT) / 30;
    if (tr.rt === null && this.t >= TRIAL.targetOn && this.t < TRIAL.targetOn + TRIAL.maxRT) {
      for (let c = 0; c < NC; c++) {
        if (this.dv[c] >= TRIAL.threshold) {
          tr.rt = this.t - TRIAL.targetOn;
          tr.choice = c;
          tr.correct = c === tr.dir;
          break;
        }
      }
    }
  }
}
