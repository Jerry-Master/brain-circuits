import * as THREE from 'three';

// Outward translation per structure at explode = 1 comes from the active
// window (mm, RIGHT hemisphere; x mirrored for the left).
// every non-shell structure also slides laterally so the two loops separate
const BILATERAL_SPLIT = 18;

export class Exploder {
  constructor(structures, vectors = {}) {
    this.structures = structures;
    this.target = 0;
    this.value = 0;
    this.changed = true;
    this.setVectors(vectors);
  }

  setVectors(vectors) {
    this.dirty = true;
    for (const s of this.structures) {
      const v = vectors[s.meta.base] ?? [0, 0, 0];
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
    const forced = this.dirty;
    this.dirty = false;
    this.value += (this.target - this.value) * (1 - Math.exp(-dt * 7));
    if (Math.abs(this.target - this.value) < 1e-4) this.value = this.target;
    this.changed = forced || Math.abs(this.value - prev) > 1e-5;
    // ease so the first part of the wheel range already gives visible separation
    const e = 1 - Math.pow(1 - this.value, 2);
    for (const s of this.structures) {
      s.offset.copy(s.explodeVector).multiplyScalar(e);
      s.pivot.position.copy(s.centroid).add(s.offset);
    }
  }
}
