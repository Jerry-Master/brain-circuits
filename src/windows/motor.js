// Motor window: cortico-basal ganglia-thalamo-cortical motor loop (src/model/circuit.js).
import { Circuit, TRIAL } from '../model/circuit.js';
import { GLU, GABA, DA } from './common.js';

// ms of model time shown per real second in each phase. Captions are checked
// against the simulation by scripts/verify_model.mjs.
export const PHASES = [
  {
    key: 'baseline',
    from: 0,
    to: TRIAL.cueOn,
    msPerSec: 50,
    title: 'Tonic brake',
    desc: () =>
      'At rest GPi fires ~70 Hz and its GABA holds VLo thalamus down. GPe (~60 Hz) restrains STN (~20 Hz). Striatal MSNs sit in their down state, silent.',
  },
  {
    key: 'hyperdirect',
    from: TRIAL.cueOn,
    to: TRIAL.cueOn + 15,
    msPerSec: 5,
    title: 'Hyperdirect pathway',
    desc: (o) =>
      o.lesion.hyperdirect
        ? 'Hyperdirect pathway lesioned: no fast cortico-subthalamic volley, so the early GPi excitation is much smaller.'
        : 'The cortical command reaches STN first (≈ 2.5 ms). STN excites GPi in both channels: a fast, global "hold everything" before striatum has even responded.',
  },
  {
    key: 'direct',
    from: TRIAL.cueOn + 15,
    to: TRIAL.cueOn + 75,
    msPerSec: 15,
    title: 'Direct pathway',
    desc: (o) =>
      o.lesion.direct
        ? 'Direct pathway lesioned: D1 MSNs cannot inhibit GPi, so GPi-A keeps firing and nothing is released.'
        : 'Cortex lifts D1 MSNs of channel A out of the down state. Their GABA silences GPi-A. The weaker channel-B command does not recruit MSNs.',
  },
  {
    key: 'indirect',
    from: TRIAL.cueOn + 75,
    to: TRIAL.cueOn + 200,
    msPerSec: 40,
    title: 'Indirect pathway · surround',
    desc: (o) =>
      o.lesion.indirect
        ? 'Indirect pathway lesioned: no D2 → GPe → STN route, so the surround inhibition of competing channel B weakens.'
        : 'D2 MSNs inhibit GPe-A, disinhibiting STN. STN projects diffusely, so it drives GPi in every channel; only channel A, where D1 input cancels it, stays open. Channel B is held shut.',
  },
  {
    key: 'release',
    from: TRIAL.cueOn + 200,
    to: TRIAL.cueOff,
    msPerSec: 50,
    title: 'Thalamic release · return',
    desc: (o) =>
      o.dopamine < 0.05
        ? 'Dopamine depleted: D2 drive outweighs D1, the GPi-A pause is shallow (≈ 50 vs 28 Hz) and VLo-A release weakens — the bradykinetic, parkinsonian direction.'
        : 'With GPi-A silent, VLo-A relay neurons fire and their glutamate re-excites cortex A: the loop closes and the selected command is reinforced.',
  },
  {
    key: 'offset',
    from: TRIAL.cueOff,
    to: TRIAL.length,
    msPerSec: 80,
    title: 'Command ends',
    desc: () => 'Cortical drive stops, MSNs fall silent and the tonic GPi brake returns. The next trial starts from rest.',
  },
];

export const motor = {
  id: 'motor',
  tab: 'Motor',
  eyebrow: 'Basal ganglia · thalamus · cortex',
  titleHtml: 'The <em>motor</em> loop',
  key: [['glu', 'glutamate'], ['gaba', 'GABA'], ['da', 'dopamine']],
  create: () => new Circuit(),
  phases: PHASES,
  opts: (c) => ({ lesion: c.lesion, dopamine: c.dopamine }),
  // cellular panel: one example cell per population (channel A); synapses with
  // `proj` are real network connections (delay from the model)
  neurons: {
    title: 'Basal-ganglia <em>neuron loop</em>',
    roots: ['ctx', 'snc'],
    chain: [
      { key: 'ctx', type: 'pyr', label: 'L5 pyramidal · M1/PMC', short: 'Ctx L5', pos: [0, 40, 0], labelY: 24 },
      { key: 'd1', type: 'msn', label: 'D1 MSN · putamen', short: 'D1 MSN', pos: [46, 22, 6], labelY: 10 },
      { key: 'd2', type: 'msn', label: 'D2 MSN · putamen', short: 'D2 MSN', pos: [64, -6, -4], labelY: 10, color: '#81d4fa' },
      { key: 'gpe', type: 'gpi', label: 'GPe neuron', short: 'GPe', pos: [40, -36, 0], labelY: 10, color: '#7e8cff' },
      { key: 'stn', type: 'stn', label: 'STN neuron', short: 'STN', pos: [0, -50, 4], labelY: 9 },
      { key: 'gpi', type: 'gpi', label: 'GPi neuron', short: 'GPi', pos: [-42, -30, 0], labelY: 10 },
      { key: 'vl', type: 'vl', label: 'VLo relay neuron · thalamus', short: 'VLo', pos: [-58, 8, 0], labelY: 10 },
      { key: 'snc', type: 'stn', label: 'SNc dopamine neuron', short: 'SNc', pos: [24, -10, -18], labelY: 8, color: '#e17bd6' },
    ],
    // bulge: >0 bows the axon outward from the ring centre, <0 inward; travel: visual seconds
    synapses: [
      { proj: 'ctx-d1', myelin: true, travel: 0.55, bulge: 10 },
      { proj: 'ctx-d2', myelin: true, travel: 0.65, bulge: 18 },
      { proj: 'ctx-stn', myelin: true, travel: 0.5, bulge: -14, label: 'hyperdirect' },
      { proj: 'd1-gpi', myelin: false, travel: 1.0, bulge: -6, tag: 'unmyelinated' },
      { proj: 'd2-gpe', myelin: false, travel: 0.8, bulge: 8 },
      { proj: 'gpe-stn', myelin: true, travel: 0.5, bulge: 8 },
      { proj: 'stn-gpi', myelin: true, travel: 0.5, bulge: 8 },
      { proj: 'gpe-gpi', myelin: true, travel: 0.6, bulge: -4 },
      { proj: 'stn-gpe', myelin: true, travel: 0.5, bulge: -5 },
      { proj: 'gpi-vl', myelin: true, travel: 0.55, bulge: 8 },
      { proj: 'vl-ctx', myelin: true, travel: 0.7, bulge: 10, tag: 'myelin' },
      { from: 'snc', to: 'd1', nt: 'da', myelin: false, travel: 1.1, bulge: -3, note: 'D1 gain ×(1+λ)' },
      { from: 'snc', to: 'd2', nt: 'da', myelin: false, travel: 1.1, bulge: -3, note: 'D2 gain ×(1−λ)' },
    ],
    // synapse indices and cells highlighted per phase, mirroring the brain tracts
    stageFocus: {
      baseline: { syn: [7, 9, 4], cells: ['gpi', 'vl', 'gpe', 'stn'] },
      hyperdirect: { syn: [2, 6], cells: ['ctx', 'stn', 'gpi'] },
      direct: { syn: [0, 3, 11], cells: ['ctx', 'd1', 'gpi', 'snc'] },
      indirect: { syn: [1, 4, 5, 6, 8, 12], cells: ['d2', 'gpe', 'stn', 'gpi', 'snc'] },
      release: { syn: [9, 10], cells: ['gpi', 'vl', 'ctx'] },
      offset: { syn: [], cells: ['ctx', 'gpi'] },
    },
  },
  view: { target: [0, 6, 10], dir: [-0.62, 0.38, 0.68] },
  focusDefault: false,

  structures: {
    m1: { short: 'M1', name: 'M1', pop: 'ctx', role: 'Executes movement. Layer-5 pyramidal neurons send glutamatergic corticostriatal axons to the putamen and corticospinal axons to the cord.' },
    pmc: { short: 'Premotor', name: 'Premotor', pop: 'ctx', role: 'Plans and selects movements (PMd, PMv, SMA).' },
    caudate: { short: 'Caudate', name: 'Caudate', role: 'Associative striatum.' },
    putamen: { short: 'Putamen', name: 'Putamen', pop: ['d1', 'd2'], role: 'Motor striatum. GABAergic medium spiny neurons: D1 (direct → GPi) and D2 (indirect → GPe).' },
    gpe: { short: 'GPe', name: 'GPe', pop: 'gpe', tonic: true, role: 'GABAergic and tonically active. Inhibits the STN; inhibited itself by D2 MSNs (indirect pathway).' },
    gpi: { short: 'GPi', name: 'GPi', pop: 'gpi', tonic: true, role: 'Main basal-ganglia output. Tonic GABAergic inhibition of VA/VL; when it pauses, the thalamus is disinhibited.' },
    stn: { short: 'STN', name: 'STN', pop: 'stn', tonic: true, role: 'Glutamatergic, ~20 Hz at rest. Receives the fast hyperdirect cortical input and GPe inhibition; projects diffusely to GPi and GPe.' },
    sn: { short: 'SN', name: 'S. nigra', pop: 'snc', role: 'Dopaminergic SNc neurons set striatal gain: D1 ×(1+λ), D2 ×(1−λ).' },
    thalamus: { short: 'Thalamus', name: 'Thalamus', role: 'Remainder of the thalamus.' },
    va: { short: 'VA', name: 'VA', pop: 'vl', role: 'Motor thalamus. Relays pallidal output to premotor / prefrontal cortex.' },
    vl: { short: 'VLo', name: 'VLo', pop: 'vl', role: 'Motor thalamus. VLo relays pallidal output to M1, SMA and premotor cortex.' },
  },
  // the whole loop shows channel A in both hemispheres
  channel: () => 0,
  rest: { ctx: 5, d1: 1, d2: 1, gpe: 60, stn: 20, gpi: 70, vl: 12, snc: 4 },

  // src: population whose rate drives spike density. bulge (mm, right hemisphere; x mirrored on the left)
  tracts: [
    { id: 'm1-putamen', from: 'm1', to: 'putamen', src: 'ctx', nt: 'glu', bulge: [9, -2, 6], name: 'Corticostriatal (M1 → putamen)' },
    { id: 'pmc-putamen', from: 'pmc', to: 'putamen', src: 'ctx', nt: 'glu', bulge: [9, 0, 6], name: 'Corticostriatal (premotor → putamen)' },
    { id: 'm1-stn', from: 'm1', to: 'stn', src: 'ctx', nt: 'glu', bulge: [-6, 0, 4], pathway: 'hyperdirect', name: 'Hyperdirect (M1 → STN)' },
    { id: 'pmc-stn', from: 'pmc', to: 'stn', src: 'ctx', nt: 'glu', bulge: [-8, 2, -2], pathway: 'hyperdirect', name: 'Hyperdirect (premotor → STN)' },
    { id: 'putamen-gpi', from: 'putamen', to: 'gpi', src: 'd1', nt: 'gaba', bulge: [0, -4, -2], pathway: 'direct', name: 'Striatopallidal, direct (D1 → GPi)' },
    { id: 'putamen-gpe', from: 'putamen', to: 'gpe', src: 'd2', nt: 'gaba', bulge: [0, 4, 2], pathway: 'indirect', name: 'Striatopallidal, indirect (D2 → GPe)' },
    { id: 'gpe-stn', from: 'gpe', to: 'stn', src: 'gpe', nt: 'gaba', bulge: [2, 3, 3], pathway: 'indirect', name: 'Pallidosubthalamic (GPe → STN)' },
    { id: 'stn-gpe', from: 'stn', to: 'gpe', src: 'stn', nt: 'glu', bulge: [5, -3, -3], name: 'Subthalamopallidal (STN → GPe)' },
    { id: 'gpe-gpi', from: 'gpe', to: 'gpi', src: 'gpe', nt: 'gaba', bulge: [-2, -2, 2], pathway: 'indirect', name: 'Pallidopallidal (GPe → GPi)' },
    { id: 'stn-gpi', from: 'stn', to: 'gpi', src: 'stn', nt: 'glu', bulge: [3, -4, -3], name: 'Subthalamopallidal (STN → GPi)' },
    { id: 'gpi-va', from: 'gpi', to: 'va', src: 'gpi', nt: 'gaba', bulge: [-2, -7, 0], name: 'Pallidothalamic (GPi → VA)' },
    { id: 'gpi-vl', from: 'gpi', to: 'vl', src: 'gpi', nt: 'gaba', bulge: [-1, 5, -3], name: 'Pallidothalamic (GPi → VLo)' },
    { id: 'va-pmc', from: 'va', to: 'pmc', src: 'vl', nt: 'glu', bulge: [-5, 8, -5], name: 'Thalamocortical (VA → premotor)' },
    { id: 'vl-m1', from: 'vl', to: 'm1', src: 'vl', nt: 'glu', bulge: [-4, 8, -10], name: 'Thalamocortical (VLo → M1)' },
    { id: 'vl-pmc', from: 'vl', to: 'pmc', src: 'vl', nt: 'glu', bulge: [-6, 10, -7], name: 'Thalamocortical (VLo → premotor / SMA)' },
    { id: 'sn-putamen', from: 'sn', to: 'putamen', src: 'snc', nt: 'da', bulge: [4, -6, 4], pathway: 'dopamine', name: 'Nigrostriatal (SNc → putamen, dopamine)' },
  ],
  pathwayOn: (c) => ({ direct: !c.lesion.direct, indirect: !c.lesion.indirect, hyperdirect: !c.lesion.hyperdirect, dopamine: c.dopamine >= 0.05 }),

  // outward translation at explode = 1, mm, right hemisphere
  explode: {
    brain: [95, 25, 0], m1: [55, 55, -10], pmc: [45, 55, 35], caudate: [12, 22, 32], putamen: [34, 0, 8],
    gpe: [20, -10, 0], gpi: [12, -24, -2], stn: [6, -30, -14], sn: [4, -40, -22], thalamus: [8, 14, -30],
    va: [4, 16, 10], vl: [10, 18, -12],
  },

  hud: {
    nodes: [
      { id: 'cortex', label: 'M1·PMC', angle: -90, color: '#ff8a65' },
      { id: 'putamen', label: 'PUT', angle: -30, color: '#4fc3f7' },
      { id: 'gpe', label: 'GPe', angle: 30, color: '#7e8cff' },
      { id: 'stn', label: 'STN', angle: 90, color: '#ffd54f' },
      { id: 'gpi', label: 'GPi', angle: 150, color: '#b388ff' },
      { id: 'thal', label: 'VLo', angle: 210, color: '#2ecc71' },
      { id: 'snc', label: 'SNc', xy: [132, 116], color: DA },
    ],
    arcs: [
      { id: 'c-p', from: 'cortex', to: 'putamen', color: GLU },
      { id: 'p-gpe', from: 'putamen', to: 'gpe', color: GABA, pathway: 'indirect' },
      { id: 'gpe-stn', from: 'gpe', to: 'stn', color: GABA, pathway: 'indirect' },
      { id: 'stn-gpi', from: 'stn', to: 'gpi', color: GLU },
      { id: 'gpi-t', from: 'gpi', to: 'thal', color: GABA },
      { id: 't-c', from: 'thal', to: 'cortex', color: GLU },
      { id: 'p-gpi', from: 'putamen', to: 'gpi', color: GABA, pathway: 'direct', chord: 30 },
      { id: 'c-stn', from: 'cortex', to: 'stn', color: GLU, pathway: 'hyperdirect', chord: 34 },
      { id: 'snc-p', from: 'snc', to: 'putamen', color: DA, pathway: 'dopamine', chord: -10, dashed: true },
    ],
  },
  // per phase: HUD nodes / arcs, and brain structures in focus
  focus: {
    baseline: { nodes: ['gpi', 'thal'], arcs: ['gpi-t'], structs: ['gpi', 'va', 'vl'] },
    hyperdirect: { nodes: ['cortex', 'stn', 'gpi'], arcs: ['c-stn', 'stn-gpi'], structs: ['m1', 'pmc', 'stn', 'gpi'] },
    direct: { nodes: ['cortex', 'putamen', 'gpi', 'snc'], arcs: ['c-p', 'p-gpi', 'snc-p'], structs: ['m1', 'pmc', 'putamen', 'gpi', 'sn'] },
    indirect: { nodes: ['putamen', 'gpe', 'stn', 'gpi'], arcs: ['p-gpe', 'gpe-stn', 'stn-gpi'], structs: ['putamen', 'gpe', 'stn', 'gpi'] },
    release: { nodes: ['gpi', 'thal', 'cortex'], arcs: ['gpi-t', 't-c'], structs: ['gpi', 'va', 'vl', 'm1', 'pmc'] },
    offset: { nodes: ['cortex'], arcs: [], structs: ['m1', 'pmc'] },
  },

  gui(folder, app) {
    const c = app.model;
    // pathways are intact when ticked; unticking lesions the projections in the network
    const intact = { direct: true, indirect: true, hyperdirect: true };
    for (const p of Object.keys(intact)) {
      intact[p] = !c.lesion[p];
      folder.add(intact, p).name(`${p} pathway`).onChange((v) => {
        c.lesion[p] = !v;
        app.onStagesRebuilt();
      });
    }
    folder.add(c, 'dopamine', 0, 0.4, 0.01).name('dopamine λ').onChange(() => {
      c.setDopamine(c.dopamine);
      app.onStagesRebuilt();
    });
  },
};
