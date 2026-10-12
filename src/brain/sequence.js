// Trial narration. A window's model runs continuously; each phase (defined in
// src/windows/*.js) is only a window of model time with its own slow-motion
// factor and a caption describing what the simulation produces in that window.
// Captions are checked against the simulation by scripts/verify_model.mjs.
import { DT } from '../model/engine.js';

export class Sequence {
  /** circuit: the running model; phases: [{key, from, to, msPerSec, title, desc(opts)}]; opts(circuit) feeds captions */
  constructor(circuit, phases, opts) {
    this.circuit = circuit;
    this.optsFn = opts;
    this.speed = 1;
    this.playing = true;
    this.listeners = [];
    this.stages = phases;
    this.index = this.phaseAt(circuit.t);
  }

  get opts() {
    return this.optsFn(this.circuit);
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
