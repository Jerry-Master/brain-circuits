import * as THREE from 'three';

// Outward translation per structure at explode = 1, in mm, for the RIGHT hemisphere
// (x is mirrored for the left). Every structure moves away from the brain centre;
// shells travel furthest so the deep loop ends up exposed but still readable.
const EXPLODE_VECTORS = {
  brain: [95, 25, 0],
  m1: [55, 55, -10],
  pmc: [45, 55, 35],
  caudate: [12, 22, 32],
  putamen: [34, 0, 8],
  gpe: [20, -10, 0],
  gpi: [12, -24, -2],
  stn: [6, -30, -14],
  sn: [4, -40, -22],
  thalamus: [8, 14, -30],
  va: [4, 16, 10],
  vl: [10, 18, -12],
};
// every non-shell structure also slides laterally so the two loops separate
const BILATERAL_SPLIT = 18;

export class Exploder {
  constructor(structures) {
    this.structures = structures;
    this.target = 0;
    this.value = 0;
    this.changed = true;
    for (const s of structures) {
      const v = EXPLODE_VECTORS[s.meta.base] ?? [0, 0, 0];
      const sx = s.meta.hemisphere === 'L' ? -1 : 1;
      const split = s.meta.group === 'shell' ? 0 : BILATERAL_SPLIT;
      s.explodeVector = new THREE.Vector3((v[0] + split) * sx, v[1], v[2]);
    }
  }

  nudge(wheelDelta) {
    // wheel down (positive) collapses, wheel up explodes — like pulling parts toward you
    this.target = THREE.MathUtils.clamp(this.target - wheelDelta * 0.0011, 0, 1);
  }

  reset() {
    this.target = 0;
  }

  update(dt) {
    const prev = this.value;
    this.value += (this.target - this.value) * (1 - Math.exp(-dt * 7));
    if (Math.abs(this.target - this.value) < 1e-4) this.value = this.target;
    this.changed = Math.abs(this.value - prev) > 1e-5;
    // ease so the first part of the wheel range already gives visible separation
    const e = 1 - Math.pow(1 - this.value, 2);
    for (const s of this.structures) {
      s.offset.copy(s.explodeVector).multiplyScalar(e);
      s.pivot.position.copy(s.centroid).add(s.offset);
    }
  }
}
