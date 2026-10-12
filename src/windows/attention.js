// Attention window: Posner's three attentional networks performing a
// lateralised Attention Network Test (src/model/attention.js).
import { Attention, TRIAL, CUES, FLANKERS } from '../model/attention.js';
import { GLU, GABA, NE } from './common.js';

const ALERT = '#ff6f91';
const ORIENT = '#2ec4b6';
const EXEC = '#a78bfa';

const SIDE = ['left', 'right'];
const cuedSide = (tr) => (tr.cue === 'valid' ? tr.loc : 1 - tr.loc);

export const PHASES = [
  {
    key: 'fixation',
    from: 0,
    to: TRIAL.cueOn,
    msPerSec: 200,
    title: 'Fixation',
    desc: (o) =>
      `Eyes on the cross. Visual cortex idles at ~3 Hz, the locus coeruleus fires tonically (~6 Hz) and the parietal priority map is empty in both hemispheres. This trial: ${o.cue === 'none' ? 'no cue' : `${o.cue} cue`}, ${o.flank} flankers.`,
  },
  {
    key: 'alert',
    from: TRIAL.cueOn,
    to: TRIAL.cueOn + 200,
    msPerSec: 50,
    title: 'Warning cue · alerting',
    desc: (o) =>
      o.cue === 'none'
        ? 'No cue on this trial: no visual onset, so the LC stays tonic and nothing warns that the target is coming.'
        : `The cue flash reaches visual cortex after ~60 ms and drives a phasic LC burst. Noradrenaline builds up slowly and will raise the sensory gain of the target: the alerting effect.${o.ne < 0.6 ? ' LC output is scaled down (clonidine-like), so the boost is smaller.' : ''}`,
  },
  {
    key: 'orient',
    from: TRIAL.cueOn + 200,
    to: TRIAL.targetOn,
    msPerSec: 100,
    title: 'Orienting',
    desc: (o) =>
      o.cue === 'valid' || o.cue === 'invalid'
        ? `SC → pulvinar → IPS/SPL: the cued ${SIDE[o.cued]} hemifield ignites a persistent priority state in the opposite parietal lobe, held with FEF after the cue is gone. It inhibits the other hemifield.${o.lesion.pul ? ' Pulvinar lesioned: the cue cannot reach parietal cortex, so nothing is held.' : ''}`
        : o.cue === 'double'
          ? 'A cue on both sides warns but says nothing about where: no single location is favoured.'
          : 'No cue: the priority map stays empty. Attention will have to be captured by the target itself.',
  },
  {
    key: 'target',
    from: TRIAL.targetOn,
    to: TRIAL.targetOn + 250,
    msPerSec: 40,
    title: 'Target',
    desc: (o) =>
      o.cue === 'valid'
        ? `The arrows appear on the attended (${SIDE[o.loc]}) side. Parietal gain lets their visual evidence through to motor cortex at once.`
        : o.cue === 'invalid'
          ? `The arrows appear on the unattended (${SIDE[o.loc]}) side. Evidence is gated until parietal cortex reorients; TPJ fires to the unexpected target and helps the switch: the validity cost.${o.lesion.tpj ? ' TPJ → SPL is lesioned here.' : ''}`
          : `Arrows on the ${SIDE[o.loc]}. With no location prepared, the target must first capture the parietal map before its evidence passes.`,
  },
  {
    key: 'conflict',
    from: TRIAL.targetOn + 250,
    to: TRIAL.targetOn + 550,
    msPerSec: 75,
    title: 'Response · conflict',
    desc: (o) =>
      (o.flank === 'incongruent'
        ? o.lesion.acc
          ? 'Flankers point the other way and drive the competing hand. ACC is lesioned: no conflict signal, no extra control.'
          : 'Flankers point the other way and drive the competing hand. ACC detects co-activation of the two responses and recruits lateral PFC, which raises the gain of the centre arrow.'
        : 'Flankers agree with the centre arrow: one hand wins with little co-activation and ACC stays quiet.') +
      (o.rt != null ? ` Response at ${Math.round(o.rt)} ms${o.correct ? '' : ' (error)'}.` : ''),
  },
  {
    key: 'iti',
    from: TRIAL.targetOn + 550,
    to: TRIAL.length,
    msPerSec: 200,
    title: 'Inter-trial',
    desc: (o) =>
      `${o.rt != null ? `RT ${Math.round(o.rt)} ms. ` : 'No response in time. '}The response attractor is reset and the parietal state released before the next trial. The inset keeps running ANT scores over simulated trials.`,
  },
];

function antScores(history) {
  const mean = (f) => {
    const r = history.filter((h) => h.correct && f(h)).map((h) => h.rt);
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : NaN;
  };
  const cue = Object.fromEntries(CUES.map((c) => [c, mean((h) => h.cue === c)]));
  const fl = Object.fromEntries(FLANKERS.map((f) => [f, mean((h) => h.flank === f)]));
  return {
    alerting: cue.none - cue.double,
    orienting: cue.double - cue.valid,
    validity: cue.invalid - cue.valid,
    conflict: fl.incongruent - fl.congruent,
    n: history.length,
  };
}

const ARROW = ['←', '→'];

/** task screen + running scores, drawn into the HUD inset canvas */
function drawInset(g, W, H, m) {
  const tr = m.trial;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, W, 64);
  const cx = W / 2;
  const cy = 32;
  const dx = W * 0.27;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#cfd8ea';
  g.font = '16px system-ui';
  g.fillText('+', cx, cy);
  if (!tr) return;
  const t = m.t;
  // cue
  if (t >= TRIAL.cueOn && t < TRIAL.cueOff && tr.cue !== 'none') {
    g.fillStyle = '#ffffff';
    g.font = '18px system-ui';
    const at = tr.cue === 'double' ? [0, 1] : [cuedSide(tr)];
    for (const c of at) g.fillText('✱', cx + (c ? dx : -dx), cy);
  }
  // target array
  if (m.targetShown(t)) {
    const centre = ARROW[tr.dir];
    const flank = ARROW[m.flankDir];
    g.font = '15px system-ui';
    g.fillStyle = '#ffffff';
    g.fillText(`${flank}${flank}${centre}${flank}${flank}`, cx + (tr.loc ? dx : -dx), cy);
  }
  // response
  if (tr.rt != null && t >= TRIAL.targetOn + tr.rt) {
    g.font = '11px ui-monospace, monospace';
    g.fillStyle = tr.correct ? '#7dffb0' : '#ff6b6b';
    g.fillText(`${tr.choice ? 'right' : 'left'} hand · ${Math.round(tr.rt)} ms`, cx, 56);
  }
  // decision variables
  const bar = (c, x) => {
    const v = Math.min(1, m.dv[c] / TRIAL.threshold);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(x, 6, 4, 40);
    g.fillStyle = c === tr.dir ? EXEC : '#ff9f6b';
    g.fillRect(x, 46 - 40 * v, 4, 40 * v);
  };
  bar(0, 6);
  bar(1, W - 10);

  // ANT scores
  const s = antScores(m.history);
  g.font = '10.5px ui-monospace, monospace';
  g.textAlign = 'left';
  const f = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${Math.round(v)}` : '—');
  const rows = [
    ['alerting', s.alerting, ALERT],
    ['orienting', s.orienting, ORIENT],
    ['validity', s.validity, ORIENT],
    ['conflict', s.conflict, EXEC],
  ];
  rows.forEach(([k, v, col], i) => {
    const x = 4 + (i % 2) * (W / 2);
    const y = 78 + Math.floor(i / 2) * 15;
    g.fillStyle = col;
    g.fillText(k, x, y);
    g.fillStyle = '#e8eefc';
    g.fillText(`${f(v)} ms`, x + 70, y);
  });
  g.fillStyle = '#7f8aa3';
  g.fillText(`${s.n} trials`, 4, 108);
}

export const attention = {
  id: 'attention',
  tab: 'Attention',
  eyebrow: 'Posner · alerting · orienting · executive',
  titleHtml: 'The <em>attention</em> networks',
  key: [['glu', 'glutamate'], ['gaba', 'GABA'], ['ne', 'noradrenaline']],
  keyNote: 'Each hemisphere shows the opposite hemifield / hand',
  create: () => new Attention(),
  phases: PHASES,
  opts: (m) => ({
    ...m.trial,
    cued: m.trial ? cuedSide(m.trial) : 0,
    lesion: m.lesion,
    ne: m.neScale,
  }),
  neurons: {
    title: 'Attention <em>neuron network</em>',
    roots: ['vis', 'lc', 'resp', 'acc'],
    chain: [
      { key: 'vis', type: 'pyr', label: 'Pyramidal · visual cortex', short: 'Vis', pos: [-66, 8, 0], labelY: 22 },
      { key: 'sc', type: 'stn', label: 'Sup. colliculus neuron', short: 'SC', pos: [-58, -26, 0], labelY: 9 },
      { key: 'pul', type: 'vl', label: 'Pulvinar relay neuron', short: 'Pul', pos: [-28, -46, 0], labelY: 10 },
      { key: 'lc', type: 'stn', label: 'LC noradrenergic neuron', short: 'LC', pos: [6, -30, -18], labelY: 8, color: '#9cff6e' },
      { key: 'resp', type: 'pyr', label: 'L5 pyramidal · M1 hand', short: 'M1', pos: [34, -44, 0], labelY: 22 },
      { key: 'acc', type: 'pyr', label: 'ACC pyramidal · conflict', short: 'ACC', pos: [62, -12, 0], labelY: 22, color: '#b388ff' },
      { key: 'lpfc', type: 'pyr', label: 'Lateral PFC pyramidal', short: 'lPFC', pos: [56, 22, 0], labelY: 22, color: '#ce93d8' },
      { key: 'fef', type: 'pyr', label: 'FEF pyramidal', short: 'FEF', pos: [26, 44, 0], labelY: 22 },
      { key: 'spl', type: 'pyr', label: 'IPS / SPL priority cell', short: 'IPS', pos: [-12, 46, 0], labelY: 22 },
      { key: 'tpj', type: 'pyr', label: 'TPJ pyramidal · reorienting', short: 'TPJ', pos: [-44, 36, -6], labelY: 22 },
    ],
    // synapses without `proj` are rate-read influences in the model (gain, evidence), drawn as connections
    synapses: [
      { proj: 'vis-sc', myelin: true, travel: 0.5, bulge: -6 },
      { proj: 'sc-pul', myelin: true, travel: 0.5, bulge: -6 },
      { proj: 'vis-pul', myelin: true, travel: 0.6, bulge: 6 },
      { proj: 'pul-spl', myelin: true, travel: 0.7, bulge: -14, tag: 'myelin' },
      { proj: 'spl-fef', myelin: true, travel: 0.55, bulge: 6 },
      { proj: 'fef-spl', myelin: true, travel: 0.55, bulge: -6 },
      { proj: 'vis-tpj', myelin: true, travel: 0.5, bulge: 6 },
      { proj: 'spl-tpj', myelin: true, travel: 0.5, bulge: -4, note: 'via interneurons' },
      { proj: 'tpj-spl', myelin: true, travel: 0.5, bulge: 8, label: 'circuit breaker' },
      { from: 'vis', to: 'resp', nt: 'glu', myelin: true, travel: 0.9, bulge: -16, note: 'evidence × attention' },
      { from: 'lc', to: 'vis', nt: 'ne', myelin: false, travel: 1.1, bulge: -6, note: 'gain ×(1+g·NE)', tag: 'unmyelinated' },
      { from: 'resp', to: 'acc', nt: 'glu', myelin: true, travel: 0.5, bulge: 6, note: 'conflict ∝ L×R' },
      { proj: 'acc-lpfc', myelin: true, travel: 0.5, bulge: 6 },
      { from: 'lpfc', to: 'resp', nt: 'glu', myelin: true, travel: 0.7, bulge: -10, note: 'boosts target arrow' },
      { from: 'vis', to: 'lc', nt: 'glu', myelin: true, travel: 0.8, bulge: -8, note: 'salient onset' },
    ],
    stageFocus: {
      fixation: { syn: [], cells: ['vis', 'lc'] },
      alert: { syn: [14, 10], cells: ['vis', 'lc'] },
      orient: { syn: [0, 1, 2, 3, 4, 5], cells: ['vis', 'sc', 'pul', 'spl', 'fef'] },
      target: { syn: [6, 7, 8, 9], cells: ['vis', 'tpj', 'spl', 'resp'] },
      conflict: { syn: [11, 12, 13], cells: ['resp', 'acc', 'lpfc'] },
      iti: { syn: [], cells: ['resp', 'spl'] },
    },
  },
  view: { target: [0, 10, -10], dir: [-0.75, 0.42, -0.5] },
  focusDefault: true,
  inset: { height: 112, draw: drawInset },

  structures: {
    vis: { short: 'V1–V4', name: 'Visual cortex', pop: 'vis', color: '#7fd8cf', role: 'Occipital visual cortex. Each hemisphere sees the opposite hemifield; parietal feedback raises its gain at the attended location.' },
    sc: { short: 'SC', name: 'Sup. colliculus', pop: 'sc', color: ORIENT, role: 'Midbrain map of visual space. Fast exogenous capture by sudden onsets; drives pulvinar.' },
    pul: { short: 'Pulvinar', name: 'Pulvinar', pop: 'pul', color: ORIENT, role: 'Thalamic hub that relays collicular / visual signals to parietal cortex and gates cortical communication.' },
    spl: { short: 'IPS/SPL', name: 'IPS / SPL', pop: 'spl', color: ORIENT, role: 'Dorsal attention network: a priority map that holds the attended location (persistent activity) and biases visual cortex.' },
    fef: { short: 'FEF', name: 'FEF', pop: 'fef', color: ORIENT, role: 'Frontal eye field: top-down orienting, reverberates with IPS to hold attention.' },
    tpj: { short: 'TPJ', name: 'TPJ', pop: 'tpj', color: '#6fe3b3', role: 'Ventral attention network: fires to behaviourally relevant targets at unattended locations and resets the dorsal network (circuit breaker). Right-lateralised in humans.' },
    lc: { short: 'LC', name: 'Locus coeruleus', pop: 'lc', color: ALERT, role: 'Noradrenergic brainstem nucleus (approximate location: not in the atlas). Phasic bursts to warning signals raise cortical gain.' },
    m1: { short: 'M1', name: 'M1 (hand)', pop: 'resp', color: '#c9b6ff', role: 'Hand area of motor cortex: left and right response populations compete; reaching threshold = the response.' },
    acc: { short: 'ACC', name: 'ACC', pop: 'acc', color: EXEC, role: 'Anterior cingulate: detects conflict (co-activation of competing responses) and recruits control.' },
    dlpfc: { short: 'lPFC', name: 'Lateral PFC', pop: 'lpfc', color: EXEC, role: 'Lateral prefrontal cortex: raises the gain of task-relevant input (the centre arrow) when conflict is detected.' },
  },
  // lateralised: right hemisphere shows the left hemifield / left hand (channel 0)
  channel: (h) => (h === 'R' ? 0 : 1),
  rest: { vis: 3, sc: 1, pul: 1, spl: 1, fef: 1, tpj: 1, lc: 6, resp: 1, acc: 1, lpfc: 1 },

  tracts: [
    { id: 'vis-sc', from: 'vis', to: 'sc', src: 'vis', nt: 'glu', bulge: [-4, 6, 0], pathway: 'sc', name: 'Retino/corticotectal (visual → SC)' },
    { id: 'sc-pul', from: 'sc', to: 'pul', src: 'sc', nt: 'glu', bulge: [2, 2, 0], pathway: 'sc', name: 'Tectopulvinar (SC → pulvinar)' },
    { id: 'pul-spl', from: 'pul', to: 'spl', src: 'pul', nt: 'glu', bulge: [-6, 4, 6], pathway: 'pul', name: 'Pulvino-parietal (pulvinar → IPS/SPL)' },
    { id: 'spl-fef', from: 'spl', to: 'fef', src: 'spl', nt: 'glu', bulge: [4, 8, 0], name: 'Superior longitudinal fasciculus I (IPS → FEF)' },
    { id: 'fef-spl', from: 'fef', to: 'spl', src: 'fef', nt: 'glu', bulge: [-4, 4, 0], name: 'SLF I (FEF → IPS)' },
    { id: 'spl-vis', from: 'spl', to: 'vis', src: 'spl', nt: 'glu', bulge: [-2, 6, 0], name: 'Top-down attentional feedback (IPS → visual cortex)' },
    { id: 'vis-tpj', from: 'vis', to: 'tpj', src: 'vis', nt: 'glu', bulge: [6, -2, 0], name: 'Ventral stream (visual → TPJ)' },
    { id: 'tpj-spl', from: 'tpj', to: 'spl', src: 'tpj', nt: 'glu', bulge: [2, 4, 0], pathway: 'tpj', name: 'Reorienting (TPJ → IPS)' },
    { id: 'spl-tpj', from: 'spl', to: 'tpj', src: 'spl', nt: 'gaba', bulge: [-2, -4, 0], name: 'Dorsal suppression of TPJ (IPS ⊣ TPJ)' },
    { id: 'lc-vis', from: 'lc', to: 'vis', src: 'lc', nt: 'ne', bulge: [-4, -6, 0], pathway: 'ne', name: 'Noradrenergic (LC → cortex)' },
    { id: 'vis-m1', from: 'vis', to: 'm1', src: 'vis', nt: 'glu', bulge: [8, 14, 0], name: 'Visuomotor evidence (visual → M1, via parietal gating)' },
    { id: 'm1-acc', from: 'm1', to: 'acc', src: 'resp', nt: 'glu', bulge: [-6, 4, 0], name: 'Response read-out (M1 → ACC)' },
    { id: 'acc-dlpfc', from: 'acc', to: 'dlpfc', src: 'acc', nt: 'glu', bulge: [6, 6, 0], pathway: 'acc', name: 'Conflict signal (ACC → lateral PFC)' },
    { id: 'dlpfc-vis', from: 'dlpfc', to: 'vis', src: 'lpfc', nt: 'glu', bulge: [10, 18, 0], name: 'Control: target gain (lateral PFC → visual stream)' },
  ],
  pathwayOn: (m) => ({ sc: !m.lesion.sc, pul: !m.lesion.pul, tpj: !m.lesion.tpj, acc: !m.lesion.acc, ne: m.neScale > 0.05 }),

  explode: {
    brain: [95, 25, 0], vis: [40, 0, -45], spl: [35, 45, -25], tpj: [55, 20, -15], fef: [45, 40, 25],
    dlpfc: [40, 25, 50], acc: [8, 30, 35], m1: [50, 50, 0], pul: [10, 0, -15], sc: [4, -20, -25], lc: [4, -45, -20],
  },

  hud: {
    clusters: [
      { label: 'Alerting', x: 4, y: 4, w: 60, h: 52, color: ALERT },
      { label: 'Orienting', x: 4, y: 62, w: 140, h: 154, color: ORIENT },
      { label: 'Executive', x: 150, y: 4, w: 66, h: 212, color: EXEC },
    ],
    nodes: [
      { id: 'lc', label: 'LC', xy: [34, 34], color: ALERT },
      { id: 'vis', label: 'V', xy: [28, 128], color: '#7fd8cf' },
      { id: 'sc', label: 'SC', xy: [44, 192], color: ORIENT },
      { id: 'pul', label: 'Pul', xy: [104, 186], color: ORIENT },
      { id: 'spl', label: 'IPS', xy: [112, 128], color: ORIENT },
      { id: 'fef', label: 'FEF', xy: [112, 84], color: ORIENT },
      { id: 'tpj', label: 'TPJ', xy: [70, 98], color: '#6fe3b3' },
      { id: 'acc', label: 'ACC', xy: [184, 110], color: EXEC },
      { id: 'pfc', label: 'lPFC', xy: [184, 36], color: EXEC },
      { id: 'm1', label: 'M1', xy: [184, 186], color: '#c9b6ff' },
    ],
    arcs: [
      { id: 'lc-v', from: 'lc', to: 'vis', color: NE, chord: 10, dashed: true, pathway: 'ne' },
      { id: 'v-sc', from: 'vis', to: 'sc', color: GLU, chord: 8, pathway: 'sc' },
      { id: 'sc-pul', from: 'sc', to: 'pul', color: GLU, chord: 8, pathway: 'sc' },
      { id: 'pul-spl', from: 'pul', to: 'spl', color: GLU, chord: 8, pathway: 'pul' },
      { id: 'spl-fef', from: 'spl', to: 'fef', color: GLU, chord: 8 },
      { id: 'fef-spl', from: 'fef', to: 'spl', color: GLU, chord: 8 },
      { id: 'v-tpj', from: 'vis', to: 'tpj', color: GLU, chord: 8 },
      { id: 'tpj-spl', from: 'tpj', to: 'spl', color: GLU, chord: 8, pathway: 'tpj' },
      { id: 'v-m1', from: 'vis', to: 'm1', color: GLU, chord: -26 },
      { id: 'm1-acc', from: 'm1', to: 'acc', color: GLU, chord: 8 },
      { id: 'acc-pfc', from: 'acc', to: 'pfc', color: GLU, chord: 8, pathway: 'acc' },
      { id: 'pfc-v', from: 'pfc', to: 'vis', color: GLU, chord: 24 },
    ],
  },
  focus: {
    fixation: { nodes: ['lc'], arcs: [], structs: ['vis', 'lc'] },
    alert: { nodes: ['vis', 'lc'], arcs: ['lc-v'], structs: ['vis', 'lc'] },
    orient: { nodes: ['vis', 'sc', 'pul', 'spl', 'fef'], arcs: ['v-sc', 'sc-pul', 'pul-spl', 'spl-fef', 'fef-spl'], structs: ['vis', 'sc', 'pul', 'spl', 'fef'] },
    target: { nodes: ['vis', 'spl', 'tpj', 'm1'], arcs: ['v-tpj', 'tpj-spl', 'v-m1'], structs: ['vis', 'spl', 'tpj', 'm1'] },
    conflict: { nodes: ['m1', 'acc', 'pfc', 'vis'], arcs: ['m1-acc', 'acc-pfc', 'pfc-v'], structs: ['m1', 'acc', 'dlpfc', 'vis'] },
    iti: { nodes: [], arcs: [], structs: ['vis', 'lc', 'spl', 'm1'] },
  },
  // solo one of Posner's networks (brain + HUD)
  chips: [
    { label: 'Alerting', color: ALERT, structs: ['lc', 'vis'], nodes: ['lc', 'vis'], arcs: ['lc-v'] },
    { label: 'Orienting', color: ORIENT, structs: ['vis', 'sc', 'pul', 'spl', 'fef', 'tpj'], nodes: ['vis', 'sc', 'pul', 'spl', 'fef', 'tpj'], arcs: ['v-sc', 'sc-pul', 'pul-spl', 'spl-fef', 'fef-spl', 'v-tpj', 'tpj-spl'] },
    { label: 'Executive', color: EXEC, structs: ['acc', 'dlpfc', 'm1'], nodes: ['acc', 'pfc', 'm1'], arcs: ['m1-acc', 'acc-pfc', 'pfc-v', 'v-m1'] },
  ],

  gui(folder, app) {
    const m = app.model;
    const pin = { cue: m.pin.cue ?? 'cycle', flank: m.pin.flank ?? 'cycle' };
    const setPin = (k, v) => (m.pin[k] = v === 'cycle' ? undefined : v);
    folder.add(pin, 'cue', ['cycle', ...CUES]).name('cue').onChange((v) => setPin('cue', v));
    folder.add(pin, 'flank', ['cycle', ...FLANKERS]).name('flankers').onChange((v) => setPin('flank', v));
    folder.add(m, 'neScale', 0, 1.5, 0.05).name('LC output (NE)').onChange(() => app.onStagesRebuilt());
    const names = { sc: 'superior colliculus', pul: 'pulvinar', tpj: 'TPJ → IPS', acc: 'ACC' };
    const intact = {};
    for (const [p, n] of Object.entries(names)) {
      intact[p] = !m.lesion[p];
      folder.add(intact, p).name(n).onChange((v) => {
        m.lesion[p] = !v;
        app.onStagesRebuilt();
      });
    }
    folder.add({ reset: () => (m.history.length = 0) }, 'reset').name('reset ANT scores');
  },
};
