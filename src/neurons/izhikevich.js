// Izhikevich (2003) simple spiking model:
//   v' = 0.04 v^2 + 5 v + 140 - u + I
//   u' = a (b v - u)
//   if v >= 30 mV: v <- c, u <- u + d
// Cheap enough to integrate at 0.1 ms in the browser, yet reproduces regular
// spiking, fast/tonic spiking and thalamocortical rebound bursts.

export const PRESETS = {
  // cortical layer-5 pyramidal: regular spiking (RS)
  pyr: { a: 0.02, b: 0.2, c: -65, d: 8 },
  // striatal MSN: RS-like but strongly hyperpolarised "down state" unless driven
  d1: { a: 0.02, b: 0.2, c: -65, d: 8 },
  d2: { a: 0.02, b: 0.2, c: -65, d: 8 },
  // GPe: tonically active, fast-spiking-like pacemaker
  gpe: { a: 0.1, b: 0.2, c: -65, d: 2 },
  // STN: regular spiking, silenced by tonic GPe inhibition at rest
  stn: { a: 0.02, b: 0.2, c: -65, d: 6 },
  // GPi projection neuron: fast, tonically active pacemaker
  gpi: { a: 0.1, b: 0.2, c: -65, d: 2 },
  // thalamocortical relay: low-threshold spike -> rebound burst after inhibition
  vl: { a: 0.02, b: 0.25, c: -65, d: 0.05 },
};

export class IzhNeuron {
  constructor(params) {
    Object.assign(this, params);
    this.v = -70;
    this.u = this.b * this.v;
    this.iSyn = 0; // synaptic current, decays with tauSyn
    this.tauSyn = 12; // ms
    this.iExt = 0;
  }

  /** advance by dt ms; returns true if a spike occurred */
  step(dt, iBias) {
    const I = this.iExt + iBias + this.iSyn;
    this.v += dt * (0.04 * this.v * this.v + 5 * this.v + 140 - this.u + I);
    this.u += dt * this.a * (this.b * this.v - this.u);
    this.iSyn *= Math.exp(-dt / this.tauSyn);
    if (this.v >= 30) {
      this.v = this.c;
      this.u += this.d;
      return true;
    }
    if (this.v < -95) this.v = -95;
    return false;
  }
}
