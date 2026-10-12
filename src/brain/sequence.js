// Trial narration. The circuit (src/model/circuit.js) runs continuously; each
// phase is only a window of model time with its own slow-motion factor and a
// caption describing what the simulation produces in that window. Captions
// are checked against the simulation by scripts/verify_model.mjs.
import { TRIAL, DT } from '../model/circuit.js';

// ms of model time shown per real second in each phase
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

export class Sequence {
  /** circuit: the running model. opts mirrors the circuit's lesion / dopamine state for captions. */
  constructor(circuit) {
    this.circuit = circuit;
    this.speed = 1;
    this.playing = true;
    this.listeners = [];
    this.stages = PHASES;
    this.index = this.phaseAt(circuit.t);
  }

  get opts() {
    return { lesion: this.circuit.lesion, dopamine: this.circuit.dopamine };
  }

  get stage() {
    return this.stages[this.index];
  }

  phaseAt(t) {
    return Math.max(0, this.stages.findIndex((p) => t >= p.from && t < p.to));
  }

  onStage(fn) {
    this.listeners.push(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.stage, this.index, this.stages);
  }

  /** fast-forward the simulation to the start of phase i (always forward in time) */
  goto(i) {
    i = ((i % this.stages.length) + this.stages.length) % this.stages.length;
    const c = this.circuit;
    const target = this.stages[i].from;
    do c.step();
    while (Math.abs(c.t - target) > DT / 2);
    this.index = i;
    this.emit();
  }

  next() {
    this.goto(this.index + 1);
  }

  /** model ms to simulate for this frame */
  msFor(dt) {
    return this.playing ? dt * this.speed * this.stage.msPerSec : 0;
  }

  /** call after stepping the circuit; returns progress 0..1 within the phase */
  sync() {
    const i = this.phaseAt(this.circuit.t);
    if (i !== this.index) {
      this.index = i;
      this.emit();
    }
    const p = this.stage;
    return (this.circuit.t - p.from) / (p.to - p.from);
  }
}
