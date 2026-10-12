// Executive window: dorsolateral prefrontal loop gating working memory, with
// ACC conflict monitoring (src/model/executive.js).
import { Executive, TRIAL, CHANNELS } from '../model/executive.js';
import { GLU, GABA, DA } from './common.js';

export const PHASES = [
  {
    key: 'baseline',
    from: 0,
    to: TRIAL.cueOn,
    msPerSec: 100,
    title: 'Gate closed',
    desc: () =>
      'Working memory is empty: both DLPFC stripes idle (~3 Hz). GPi/SNr fires tonically (~60 Hz) and holds MD thalamus down, so the gate into prefrontal cortex is shut.',
  },
  {
    key: 'gate',
    from: TRIAL.cueOn,
    to: TRIAL.cueOff + 50,
    msPerSec: 25,
    title: 'Item + dopamine · gate opens',
    desc: (o) =>
      o.burst
        ? `An item arrives at stripe ${o.A} together with an SNc dopamine burst: phasic dopamine boosts D1 corticostriatal gain, caudate D1 cells silence GPi-${o.A}, MD-${o.A} is released and its kick ignites DLPFC-${o.A}.`
        : `Item for stripe ${o.A} without a dopamine burst. In this model the item alone still drives caudate D1 hard enough to pause GPi-${o.A}, so the gate opens anyway: the burst is not strictly needed here.`,
  },
  {
    key: 'delay',
    from: TRIAL.cueOff + 50,
    to: TRIAL.distOn,
    msPerSec: 150,
    title: 'Maintenance',
    desc: (o) =>
      o.burst
        ? `Item gone from the screen, yet DLPFC-${o.A} keeps firing: NMDA recurrence and Ca²⁺-activated currents make it bistable, and it reverberates with MD-${o.A}.${o.lesion.md ? ' MD → DLPFC is lesioned, so only the cortical recurrence holds it.' : ''}`
        : `DLPFC-${o.A} holds the item through its loop with MD-${o.A}.`,
  },
  {
    key: 'distractor',
    from: TRIAL.distOn,
    to: TRIAL.distOff + 50,
    msPerSec: 40,
    title: 'Item without dopamine',
    desc: (o) =>
      `An item arrives at stripe ${o.B} with no dopamine burst. DLPFC-${o.B} follows it only while it is shown; GPi-${o.B} keeps the gate shut, so it is not stored. ACC watches for co-activation of the stripes and, through STN, raises the GPi brake in all of them.`,
  },
  {
    key: 'hold',
    from: TRIAL.distOff + 50,
    to: TRIAL.clearOn,
    msPerSec: 150,
    title: 'Memory protected',
    desc: (o) =>
      o.burst
        ? `The stored item survived: DLPFC-${o.A} is still active, DLPFC-${o.B} is back to baseline.`
        : `DLPFC-${o.A} still holds the item; DLPFC-${o.B} is back to baseline.`,
  },
  {
    key: 'clear',
    from: TRIAL.clearOn,
    to: TRIAL.length,
    msPerSec: 80,
    title: 'Clear',
    desc: () => 'End of the trial: the task resets working memory and the tonic GPi brake returns. Next trial, the item with the dopamine burst goes to the other stripe.',
  },
];

function drawInset(g, W, H, m) {
  g.clearRect(0, 0, W, H);
  const t = m.t;
  const A = m.cueStripe;
  const B = m.distStripe;
  const item = t >= TRIAL.cueOn && t < TRIAL.cueOff ? ['item + DA', A] : t >= TRIAL.distOn && t < TRIAL.distOff ? ['item', B] : null;
  g.textBaseline = 'middle';
  for (let c = 0; c < 2; c++) {
    const x = 8 + c * (W / 2);
    const w = W / 2 - 16;
    // screen item
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x, 4, w, 30);
    g.font = '11px ui-monospace, monospace';
    g.textAlign = 'center';
    if (item && item[1] === c) {
      g.fillStyle = '#cfd8ea'; // both items drawn alike: only the dopamine burst tells them apart
      g.font = '600 16px system-ui';
      g.fillText('◆', x + w / 2 - 30, 19);
      g.font = '11px ui-monospace, monospace';
      g.fillText(item[0], x + w / 2 + 14, 19);
    }
    // memory bar = DLPFC stripe rate
    const r = m.rate('dlpfc', c);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fillRect(x, 42, w, 10);
    g.fillStyle = '#9575cd';
    g.fillRect(x, 42, Math.min(1, r / 70) * w, 10);
    // gate: GPi pause
    const open = m.rate('gpi', c) < 25;
    g.textAlign = 'left';
    g.fillStyle = '#cfd8ea';
    g.fillText(`stripe ${CHANNELS[c]}`, x, 66);
    g.textAlign = 'right';
    g.fillStyle = open ? '#7dffb0' : '#7f8aa3';
    g.fillText(open ? 'gate open' : 'gate shut', x + w, 66);
  }
  g.textAlign = 'left';
  g.fillStyle = '#7f8aa3';
  g.font = '10.5px ui-monospace, monospace';
  g.fillText(`DLPFC rate = memory · λ ${m.lambda.toFixed(2)}`, 8, 84);
}

export const executive = {
  id: 'executive',
  tab: 'Executive',
  eyebrow: 'Prefrontal cortex · basal ganglia · MD thalamus',
  titleHtml: 'The <em>executive</em> loop',
  key: [['glu', 'glutamate'], ['gaba', 'GABA'], ['da', 'dopamine']],
  keyNote: 'Left hemisphere = stripe A, right = stripe B',
  create: () => new Executive(),
  phases: PHASES,
  opts: (m) => ({
    A: CHANNELS[m.cueStripe],
    B: CHANNELS[m.distStripe],
    burst: m.P.burstOn && m.P.burst > 0.3,
    lesion: m.lesion,
  }),
  neurons: {
    title: 'Working-memory <em>gating loop</em>',
    roots: ['dlpfc', 'snc', 'acc'],
    chain: [
      { key: 'dlpfc', type: 'pyr', label: 'L3 pyramidal · DLPFC stripe A', short: 'DLPFC', pos: [0, 40, 0], labelY: 24 },
      { key: 'cd1', type: 'msn', label: 'D1 MSN · caudate', short: 'D1 MSN', pos: [46, 22, 6], labelY: 10 },
      { key: 'cd2', type: 'msn', label: 'D2 MSN · caudate', short: 'D2 MSN', pos: [64, -6, -4], labelY: 10, color: '#81d4fa' },
      { key: 'gpe', type: 'gpi', label: 'GPe neuron', short: 'GPe', pos: [40, -36, 0], labelY: 10, color: '#7e8cff' },
      { key: 'stn', type: 'stn', label: 'STN neuron', short: 'STN', pos: [0, -50, 4], labelY: 9 },
      { key: 'gpi', type: 'gpi', label: 'GPi / SNr neuron', short: 'GPi', pos: [-42, -30, 0], labelY: 10 },
      { key: 'md', type: 'vl', label: 'MD relay neuron · thalamus', short: 'MD', pos: [-58, 8, 0], labelY: 10 },
      { key: 'snc', type: 'stn', label: 'SNc / VTA dopamine neuron', short: 'SNc', pos: [24, -10, -18], labelY: 8, color: '#e17bd6' },
      { key: 'acc', type: 'pyr', label: 'ACC pyramidal · conflict', short: 'ACC', pos: [-24, -12, 18], labelY: 22, color: '#b388ff' },
    ],
    synapses: [
      { proj: 'dlpfc-cd1', myelin: true, travel: 0.55, bulge: 10 },
      { proj: 'dlpfc-cd2', myelin: true, travel: 0.65, bulge: 18 },
      { proj: 'acc-stn', myelin: true, travel: 0.5, bulge: -6, label: 'hyperdirect hold' },
      { proj: 'cd1-gpi', myelin: false, travel: 1.0, bulge: -6, tag: 'unmyelinated' },
      { proj: 'cd2-gpe', myelin: false, travel: 0.8, bulge: 8 },
      { proj: 'gpe-stn', myelin: true, travel: 0.5, bulge: 8 },
      { proj: 'stn-gpi', myelin: true, travel: 0.5, bulge: 8 },
      { proj: 'gpe-gpi', myelin: true, travel: 0.6, bulge: -4 },
      { proj: 'stn-gpe', myelin: true, travel: 0.5, bulge: -5 },
      { proj: 'gpi-md', myelin: true, travel: 0.55, bulge: 8 },
      { proj: 'md-dlpfc', myelin: true, travel: 0.7, bulge: 10, tag: 'myelin' },
      { from: 'snc', to: 'cd1', nt: 'da', myelin: false, travel: 1.1, bulge: -3, note: 'D1 gain ×(1+λ)' },
      { from: 'snc', to: 'cd2', nt: 'da', myelin: false, travel: 1.1, bulge: -3, note: 'D2 gain ×(1−λ)' },
      { from: 'dlpfc', to: 'acc', nt: 'glu', myelin: true, travel: 0.6, bulge: -10, note: 'conflict ∝ A×B' },
    ],
    stageFocus: {
      baseline: { syn: [7, 9, 5, 8], cells: ['gpi', 'md', 'gpe', 'stn'] },
      gate: { syn: [0, 3, 11, 9, 10], cells: ['dlpfc', 'cd1', 'gpi', 'md', 'snc'] },
      delay: { syn: [9, 10], cells: ['dlpfc', 'md', 'gpi'] },
      distractor: { syn: [0, 1, 13, 2, 6], cells: ['dlpfc', 'acc', 'stn', 'gpi', 'cd2'] },
      hold: { syn: [9, 10], cells: ['dlpfc', 'md'] },
      clear: { syn: [], cells: ['dlpfc', 'gpi'] },
    },
  },
  view: { target: [0, 6, 25], dir: [-0.6, 0.45, 0.66] },
  focusDefault: true,
  inset: { height: 92, draw: drawInset },

  structures: {
    dlpfc: { short: 'DLPFC', name: 'DLPFC', pop: 'dlpfc', role: 'Dorsolateral prefrontal cortex (BA 9/46): holds gated items in persistently active stripes.' },
    acc: { short: 'ACC', name: 'ACC', pop: 'acc', role: 'Anterior cingulate: registers conflict (co-activation of stripes) and drives STN to raise the gating threshold.' },
    caudate: { short: 'Caudate', name: 'Caudate', pop: ['cd1', 'cd2'], color: '#4fc3f7', opacity: 0.9, role: 'Associative striatum (caudate head). Receives DLPFC; its D1 cells open the gate, D2 cells keep it shut.' },
    gpe: { short: 'GPe', name: 'GPe', pop: 'gpe', tonic: true, role: 'Tonically active; inhibits STN. Indirect pathway.' },
    stn: { short: 'STN', name: 'STN', pop: 'stn', tonic: true, role: 'Excites GPi/SNr diffusely; receives ACC (“hold your horses”).' },
    gpi: { short: 'GPi/SNr', name: 'GPi / SNr', pop: 'gpi', tonic: true, role: 'Basal-ganglia output (GPi and SNr reticulata). Tonic inhibition of MD thalamus: the gate.' },
    md: { short: 'MD', name: 'MD thalamus', pop: 'md', role: 'Mediodorsal thalamus: reverberates with DLPFC; when disinhibited it ignites the stripe.' },
    sn: { short: 'SNc/VTA', name: 'SNc / VTA', pop: 'snc', role: 'Dopamine neurons; here they burst with the first item of each trial (a task input): phasic dopamine opens the gate (D1 ×(1+λ), D2 ×(1−λ)).' },
    thalamus: { short: 'Thalamus', name: 'Thalamus', role: 'Remainder of the thalamus.' },
  },
  channel: (h) => (h === 'L' ? 0 : 1),
  rest: { dlpfc: 3, cd1: 1, cd2: 1, gpe: 55, stn: 14, gpi: 60, md: 5, snc: 2, acc: 1 },

  tracts: [
    { id: 'dlpfc-caudate', from: 'dlpfc', to: 'caudate', src: 'dlpfc', nt: 'glu', bulge: [6, 6, 0], name: 'Corticostriatal (DLPFC → caudate)' },
    { id: 'caudate-gpi', from: 'caudate', to: 'gpi', src: 'cd1', nt: 'gaba', bulge: [4, -4, 0], pathway: 'direct', name: 'Direct (caudate D1 → GPi/SNr)' },
    { id: 'caudate-gpe', from: 'caudate', to: 'gpe', src: 'cd2', nt: 'gaba', bulge: [6, 2, 0], pathway: 'indirect', name: 'Indirect (caudate D2 → GPe)' },
    { id: 'gpe-stn', from: 'gpe', to: 'stn', src: 'gpe', nt: 'gaba', bulge: [2, 3, 3], pathway: 'indirect', name: 'Pallidosubthalamic (GPe → STN)' },
    { id: 'stn-gpi', from: 'stn', to: 'gpi', src: 'stn', nt: 'glu', bulge: [3, -4, -3], name: 'Subthalamopallidal (STN → GPi)' },
    { id: 'gpi-md', from: 'gpi', to: 'md', src: 'gpi', nt: 'gaba', bulge: [-2, 4, 0], name: 'Pallido/nigrothalamic (GPi/SNr → MD)' },
    { id: 'md-dlpfc', from: 'md', to: 'dlpfc', src: 'md', nt: 'glu', bulge: [-4, 10, 0], pathway: 'md', name: 'Thalamocortical (MD → DLPFC)' },
    { id: 'acc-stn', from: 'acc', to: 'stn', src: 'acc', nt: 'glu', bulge: [-2, -2, 0], pathway: 'acc', name: 'Hyperdirect (ACC → STN)' },
    { id: 'sn-caudate', from: 'sn', to: 'caudate', src: 'snc', nt: 'da', bulge: [4, -6, 4], name: 'Mesostriatal (SNc/VTA → caudate, dopamine)' },
  ],
  pathwayOn: (m) => ({ direct: !m.lesion.direct, indirect: !m.lesion.indirect, md: !m.lesion.md, acc: !m.lesion.acc }),

  explode: {
    brain: [95, 25, 0], dlpfc: [50, 30, 40], acc: [10, 45, 30], caudate: [20, 25, 25], gpe: [20, -10, 0],
    gpi: [12, -24, -2], stn: [6, -30, -14], sn: [4, -40, -22], md: [4, 20, -10], thalamus: [8, 14, -30],
  },

  hud: {
    nodes: [
      { id: 'dlpfc', label: 'DLPFC', angle: -90, color: '#9575cd' },
      { id: 'caudate', label: 'CAUD', angle: -30, color: '#4fc3f7' },
      { id: 'gpe', label: 'GPe', angle: 30, color: '#7e8cff' },
      { id: 'stn', label: 'STN', angle: 90, color: '#ffd54f' },
      { id: 'gpi', label: 'GPi', angle: 150, color: '#b388ff' },
      { id: 'md', label: 'MD', angle: 210, color: '#7986cb' },
      { id: 'snc', label: 'SNc', xy: [132, 116], color: DA },
      { id: 'acc', label: 'ACC', xy: [84, 86], color: '#ba68c8' },
    ],
    arcs: [
      { id: 'c-p', from: 'dlpfc', to: 'caudate', color: GLU },
      { id: 'p-gpe', from: 'caudate', to: 'gpe', color: GABA, pathway: 'indirect' },
      { id: 'gpe-stn', from: 'gpe', to: 'stn', color: GABA, pathway: 'indirect' },
      { id: 'stn-gpi', from: 'stn', to: 'gpi', color: GLU },
      { id: 'gpi-t', from: 'gpi', to: 'md', color: GABA },
      { id: 't-c', from: 'md', to: 'dlpfc', color: GLU, pathway: 'md' },
      { id: 'p-gpi', from: 'caudate', to: 'gpi', color: GABA, pathway: 'direct', chord: 30 },
      { id: 'acc-stn', from: 'acc', to: 'stn', color: GLU, pathway: 'acc', chord: 12 },
      { id: 'snc-p', from: 'snc', to: 'caudate', color: DA, chord: -10, dashed: true },
    ],
  },
  focus: {
    baseline: { nodes: ['gpi', 'md'], arcs: ['gpi-t'], structs: ['gpi', 'md'] },
    gate: { nodes: ['dlpfc', 'caudate', 'snc', 'gpi', 'md'], arcs: ['c-p', 'snc-p', 'p-gpi', 'gpi-t', 't-c'], structs: ['dlpfc', 'caudate', 'sn', 'gpi', 'md'] },
    delay: { nodes: ['dlpfc', 'md'], arcs: ['t-c'], structs: ['dlpfc', 'md'] },
    distractor: { nodes: ['dlpfc', 'caudate', 'acc', 'stn', 'gpi'], arcs: ['c-p', 'acc-stn', 'stn-gpi'], structs: ['dlpfc', 'caudate', 'acc', 'stn', 'gpi'] },
    hold: { nodes: ['dlpfc', 'md'], arcs: ['t-c'], structs: ['dlpfc', 'md'] },
    clear: { nodes: ['dlpfc', 'gpi'], arcs: [], structs: ['dlpfc', 'gpi', 'md'] },
  },

  gui(folder, app) {
    const m = app.model;
    folder.add(m, 'dopamine', 0, 0.4, 0.01).name('tonic dopamine λ');
    folder.add(m.P, 'burstOn').name('phasic DA burst').onChange(() => app.onStagesRebuilt());
    folder.add(m.P, 'burst', 0, 1.5, 0.05).name('burst size').onChange(() => app.onStagesRebuilt());
    folder.add(m.P, 'distractor', 0, 10, 0.1).name('2nd item strength');
    const names = { direct: 'direct pathway', indirect: 'indirect pathway', md: 'MD → DLPFC', acc: 'ACC → STN' };
    const intact = {};
    for (const [p, n] of Object.entries(names)) {
      intact[p] = !m.lesion[p];
      folder.add(intact, p).name(n).onChange((v) => {
        m.lesion[p] = !v;
        app.onStagesRebuilt();
      });
    }
  },
};
