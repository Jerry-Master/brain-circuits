import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Stylised, procedurally grown neuron morphologies (arbitrary units ~ 10 µm).

export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randUnit(rng) {
  const u = rng() * 2 - 1;
  const th = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return new THREE.Vector3(r * Math.cos(th), r * Math.sin(th), u);
}

/** TubeGeometry whose radius shrinks linearly from r0 to r1 along the curve. */
export function taperedTube(curve, segs, r0, r1, radial = 8) {
  const g = new THREE.TubeGeometry(curve, segs, r0, radial, false);
  const pos = g.attributes.position;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, c);
    const k = (r0 + (r1 - r0) * (i / segs)) / r0;
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(k).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  return g;
}

/**
 * Fluorescence-microscopy look: standard PBR material plus an additive
 * fresnel rim, so cells glow at their silhouettes like confocal stacks.
 * Keeps MeshStandardMaterial's emissive / emissiveIntensity API.
 */
export function fluorMaterial(params, rim = 1.1) {
  const { rimColor: rc, ...rest } = params;
  const m = new THREE.MeshStandardMaterial(rest);
  const rimColor = new THREE.Color(rc ?? params.color);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: rimColor };
    sh.uniforms.uRimK = { value: rim };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform float uRimK;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float fr = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.2);
        totalEmissiveRadiance += uRim * fr * uRimK;`,
      );
  };
  return m;
}

/** Recursive dendrite growth. Pushes tube geometries (and spine sites) into out. */
function grow(out, start, dir, len, radius, depth, rng, o) {
  const pts = [start.clone()];
  const d = dir.clone();
  let p = start.clone();
  for (let i = 0; i < 3; i++) {
    d.addScaledVector(randUnit(rng), o.wiggle).normalize();
    if (o.flatten) d.z *= o.flatten;
    d.normalize();
    p = p.clone().addScaledVector(d, len / 3);
    pts.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  out.tubes.push(taperedTube(curve, 10, radius, radius * 0.6));
  if (o.spines) {
    const n = Math.floor(len * o.spines);
    for (let i = 0; i < n; i++) {
      const t = (i + rng()) / n;
      const q = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const side = randUnit(rng).cross(tan).normalize();
      out.spines.push(q.addScaledVector(side, radius + 0.25));
    }
  }
  if (depth <= 0) return;
  for (let k = 0; k < o.branches; k++) {
    const nd = d.clone().addScaledVector(randUnit(rng), o.spread).normalize();
    grow(out, p, nd, len * o.decay, Math.max(0.12, radius * 0.7), depth - 1, rng, o);
  }
}

const TYPES = {
  pyr: {
    color: '#ff8a65',
    soma: { r: 2.1, scale: [1, 1.45, 1] },
    hillock: [0, -2.9, 0],
    build(out, rng) {
      // apical dendrite with oblique branches and a terminal tuft
      const apical = { wiggle: 0.08, spread: 0.7, branches: 2, decay: 0.6, spines: 0.6 };
      grow(out, new THREE.Vector3(0, 2.6, 0), new THREE.Vector3(0, 1, 0), 15, 0.55, 2, rng, apical);
      for (const y of [6, 10]) {
        const side = rng() > 0.5 ? 1 : -1;
        grow(out, new THREE.Vector3(0, y, 0), new THREE.Vector3(side, 0.6, rng() - 0.5).normalize(), 5, 0.3, 1, rng, apical);
      }
      // basal skirt
      const basal = { wiggle: 0.25, spread: 0.8, branches: 2, decay: 0.65, spines: 0.6 };
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + rng();
        grow(out, new THREE.Vector3(0, -1.5, 0), new THREE.Vector3(Math.cos(a), -0.7, Math.sin(a)).normalize(), 6, 0.38, 2, rng, basal);
      }
    },
  },
  msn: {
    color: '#4fc3f7',
    soma: { r: 1.8, scale: [1, 1, 1] },
    hillock: [0, -2.2, 0],
    build(out, rng) {
      // radially symmetric, densely spiny dendrites
      const o = { wiggle: 0.3, spread: 0.7, branches: 2, decay: 0.7, spines: 2.2 };
      for (let i = 0; i < 6; i++) {
        const d = randUnit(rng);
        if (d.y < -0.6) d.y = 0.2; // keep the axon hillock clear
        grow(out, new THREE.Vector3(), d.normalize(), 6, 0.35, 2, rng, o);
      }
    },
  },
  gpi: {
    color: '#b388ff',
    soma: { r: 2.4, scale: [1.35, 0.95, 1] },
    hillock: [0, -2.4, 0],
    build(out, rng) {
      // few, long, sparsely branched smooth dendrites in a flattened disc
      const o = { wiggle: 0.12, spread: 0.5, branches: 2, decay: 0.75, flatten: 0.35 };
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.6 + rng() * 0.4;
        grow(out, new THREE.Vector3(), new THREE.Vector3(Math.cos(a), Math.sin(a), 0.2 * (rng() - 0.5)), 11, 0.42, 1, rng, o);
      }
    },
  },
  vl: {
    color: '#2ecc71',
    soma: { r: 2.1, scale: [1, 1.05, 1] },
    hillock: [0, -2.4, 0],
    build(out, rng) {
      // bushy "tufted" relay-cell dendrites
      const o = { wiggle: 0.35, spread: 0.9, branches: 2, decay: 0.7, spines: 0.4 };
      for (let i = 0; i < 7; i++) {
        const d = randUnit(rng);
        if (d.y < -0.5) d.y = 0.3;
        grow(out, new THREE.Vector3(), d.normalize(), 4, 0.36, 3, rng, o);
      }
    },
  },
  stn: {
    color: '#ffd54f',
    soma: { r: 1.7, scale: [1.25, 0.9, 1] },
    hillock: [0, -2, 0],
    build(out, rng) {
      // small, compact, ellipsoidal dendritic field
      const o = { wiggle: 0.2, spread: 0.6, branches: 2, decay: 0.7, spines: 0.2 };
      for (let i = 0; i < 5; i++) {
        const d = randUnit(rng);
        if (d.y < -0.5) d.y = 0.3;
        grow(out, new THREE.Vector3(), d.normalize(), 5, 0.34, 2, rng, o);
      }
    },
  },
};

/**
 * Builds a neuron at `origin`. `receives` are local offsets of postsynaptic
 * spine heads (one per incoming synapse), each reached by its own dendrite.
 * Returns meshes plus world anchors: hillock (axon initial segment) and receives.
 */
export function buildNeuron(type, origin, seed, { color, receives = [] } = {}) {
  const spec = TYPES[type];
  color = color ?? spec.color;
  const rng = mulberry32(seed);
  const out = { tubes: [], spines: [] };
  spec.build(out, rng);

  for (const r of receives) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      r.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 0.8, 0.5)),
      r.clone().multiplyScalar(0.92),
    ]);
    out.tubes.push(taperedTube(curve, 16, 0.45, 0.3));
  }

  const group = new THREE.Group();
  group.position.copy(origin);

  const dendMat = fluorMaterial({
    color,
    roughness: 0.55,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.05,
  });
  group.add(new THREE.Mesh(mergeGeometries(out.tubes), dendMat));

  if (out.spines.length) {
    const spines = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 6, 4), dendMat, out.spines.length);
    const m = new THREE.Matrix4();
    out.spines.forEach((p, i) => spines.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    group.add(spines);
  }

  const somaMat = fluorMaterial({
    color,
    roughness: 0.4,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.1,
  });
  const soma = new THREE.Mesh(new THREE.SphereGeometry(spec.soma.r, 32, 24), somaMat);
  soma.scale.set(...spec.soma.scale);
  group.add(soma);

  const hill = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 12), somaMat);
  hill.position.set(spec.hillock[0], spec.hillock[1] + 0.6, spec.hillock[2]);
  hill.rotation.x = Math.PI;
  group.add(hill);

  // postsynaptic spine heads (receptor side of each synapse)
  const recv = receives.map((r) => {
    const psdMat = fluorMaterial({ color, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 14), psdMat);
    head.position.copy(r);
    group.add(head);
    return { pos: r.clone().add(origin), psdMat };
  });

  return {
    type,
    color: new THREE.Color(color),
    group,
    soma,
    somaMat,
    dendMat,
    hillock: new THREE.Vector3(...spec.hillock).add(origin),
    receives: recv,
  };
}
