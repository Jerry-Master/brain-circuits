// Loop timeline. Each stage sets target activation levels per structure
// (+ excited, - inhibited), spike rates per tract (spikes / s, visual) and
// external drive currents for the example neurons (Izhikevich units).

// Tonically active nuclei glow slightly at baseline.
export const TONIC = { gpe: 0.6, gpi: 0.8 };

// Tonic tract firing (GPe -> STN and GPi -> thalamus inhibit continuously at rest).
export const BASE_RATES = { 'gpi-va': 2.5, 'gpi-vl': 2.5, 'gpe-stn': 2.5 };

export const NEURON_BIAS = { pyr: 0, d1: 0, d2: 0, gpe: 6, stn: 6, gpi: 7, vl: 0 };

export function buildStages({ direct, indirect }) {
  const thalOn = direct; // VA/VL released only if the direct pathway pauses GPi
  const stages = [
    {
      key: 'cortex',
      title: '1 · Cortical command',
      desc: 'M1 and premotor cortex fire: layer-5 glutamatergic pyramidal neurons initiate the motor plan.',
      dur: 1.8,
      levels: { m1: 1, pmc: 1 },
      rates: {},
      drive: { pyr: 13 },
    },
    {
      key: 'striatum',
      title: '2 · Corticostriatal drive',
      desc: 'Glutamatergic corticostriatal axons excite medium spiny neurons (MSNs) of the putamen.',
      dur: 1.8,
      levels: { m1: 0.6, pmc: 0.6, putamen: 1 },
      rates: { 'm1-putamen': 7, 'pmc-putamen': 7 },
      drive: { pyr: 9, d1: direct ? 3 : 0, d2: indirect ? 3 : -4 },
    },
  ];
  if (direct) {
    stages.push({
      key: 'direct',
      title: '3 · Direct pathway (D1)',
      desc: 'D1 MSNs inhibit GPi (GABA). GPi’s tonic firing pauses, so its inhibitory output to VA/VL drops.',
      dur: 2.0,
      levels: { putamen: 0.7, gpi: -0.9 },
      rates: { 'putamen-gpi': 7, 'gpi-va': 0, 'gpi-vl': 0 },
      drive: { d1: 8, d2: -4, gpi: -6 },
    });
  }
  if (indirect) {
    stages.push({
      key: 'indirect',
      title: `${direct ? 4 : 3} · Indirect pathway (D2)`,
      desc: 'D2 MSNs inhibit GPe → STN is disinhibited → glutamatergic STN excites GPi. Acts as a brake that sharpens selection.',
      dur: 2.4,
      levels: { putamen: 0.5, gpe: -0.9, stn: 1, gpi: direct ? -0.35 : 0.8 },
      rates: { 'putamen-gpe': 6, 'gpe-stn': 0, 'stn-gpi': 6, 'gpi-va': direct ? 0.6 : 5, 'gpi-vl': direct ? 0.6 : 5 },
      drive: { d1: direct ? 3 : 0, d2: 8, gpe: -4, gpi: direct ? -3 : 4 },
    });
  }
  stages.push(
    {
      key: 'thalamus',
      title: `${stages.length + 1} · Pallido-thalamic output`,
      desc: thalOn
        ? 'Reduced GABA from GPi disinhibits VA/VL (ansa lenticularis / lenticular fasciculus): thalamic relay neurons fire.'
        : 'Without the direct pathway, GPi output stays high: VA/VL remain suppressed (movement inhibited).',
      dur: 2.0,
      levels: thalOn ? { gpi: -0.7, va: 1, vl: 1 } : { gpi: 0.9, va: -0.8, vl: -0.8 },
      rates: thalOn ? { 'gpi-va': 0, 'gpi-vl': 0 } : { 'gpi-va': 6, 'gpi-vl': 6 },
      drive: thalOn ? { d1: 4, gpi: -6, vl: 2.2 } : { gpi: 4 },
    },
    {
      key: 'return',
      title: `${stages.length + 2} · Thalamocortical return`,
      desc: thalOn
        ? 'Glutamatergic VA → premotor and VL → M1 projections re-excite the cortical targets, closing the loop.'
        : 'Little thalamocortical drive: the cortical motor plan is not reinforced.',
      dur: 2.0,
      levels: thalOn ? { va: 0.6, vl: 0.6, m1: 0.9, pmc: 0.9 } : { va: -0.5, vl: -0.5, m1: 0.15, pmc: 0.15 },
      rates: thalOn ? { 'va-pmc': 7, 'vl-m1': 7, 'vl-pmc': 3 } : { 'va-pmc': 0.5, 'vl-m1': 0.5 },
      drive: thalOn ? { gpi: -6, vl: 2, pyr: 3 } : {},
    },
  );
  return stages;
}

export class Sequence {
  constructor(opts) {
    this.opts = { direct: true, indirect: true, ...opts };
    this.speed = 1;
    this.playing = true;
    this.listeners = [];
    this.rebuild();
  }

  rebuild() {
    this.stages = buildStages(this.opts);
    this.index = 0;
    this.t = 0;
    this.emit();
  }

  get stage() {
    return this.stages[this.index];
  }

  onStage(fn) {
    this.listeners.push(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.stage, this.index, this.stages);
  }

  goto(i) {
    this.index = ((i % this.stages.length) + this.stages.length) % this.stages.length;
    this.t = 0;
    this.emit();
  }

  next() {
    this.goto(this.index + 1);
  }

  /** returns progress 0..1 within current stage */
  update(dt) {
    if (this.playing) {
      this.t += dt * this.speed;
      if (this.t >= this.stage.dur) this.next();
    }
    return this.t / this.stage.dur;
  }
}
