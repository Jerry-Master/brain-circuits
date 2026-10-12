import * as THREE from 'three';

// Fibre tracts of a window (see src/windows/*.js). Each tract's spike density
// follows the firing rate of its source population.
import { NT_HEX } from '../windows/common.js';

export const NT_COLOR = Object.fromEntries(Object.entries(NT_HEX).map(([k, v]) => [k, new THREE.Color(v)]));

const MAX_SPIKES = 600;
const SPIKE_TRAVEL = 0.75; // seconds to traverse a tract

function spikeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Tract material: chevron-like stripes flow from origin to target so the
 * direction of every projection (and the closed loop) is always readable.
 * TubeGeometry's uv.x runs 0 -> 1 along the curve.
 */
function makeTractMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uActivity: { value: 0 },
      uTime: { value: Math.random() * 10 },
      uLength: { value: 50 },
      uDim: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vRim;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vRim = 1.0 - abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uActivity;
      uniform float uTime;
      uniform float uLength;
      uniform float uDim;
      varying vec2 vUv;
      varying float vRim;
      void main() {
        // dashes every ~7 mm, sharp leading edge + soft tail => reads as motion direction
        float ph = fract(vUv.x * uLength / 7.0 - uTime);
        float dash = smoothstep(0.0, 0.75, ph) * (1.0 - smoothstep(0.75, 0.82, ph));
        float ends = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
        float core = 1.0 - vRim * 0.6;
        float a = (0.10 + 0.22 * dash + uActivity * (0.25 + 0.55 * dash)) * ends * core;
        vec3 c = uColor * (0.8 + 1.4 * uActivity * dash);
        gl_FragColor = vec4(c, a * uDim);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
}

export class Pathways {
  constructor(scene, atlas, tracts) {
    this.atlas = atlas;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.tracts = [];
    this.pathwayVisible = {};

    for (const def of tracts) {
      for (const h of ['L', 'R']) {
        const from = atlas.byId.get(`${def.from}_${h}`);
        const to = atlas.byId.get(`${def.to}_${h}`);
        if (!from || !to) continue;
        const material = makeTractMaterial(NT_COLOR[def.nt]);
        material.userData.dim = 1; // phase focus fades tracts outside the focus
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
        mesh.renderOrder = 2;
        this.group.add(mesh);
        this.tracts.push({ def, h, from, to, mesh, curve: null, rate: 0, activity: 0, acc: Math.random() });
      }
    }

    // travelling spikes: one Points cloud shared by all tracts
    const geo = new THREE.BufferGeometry();
    this.spikePos = new Float32Array(MAX_SPIKES * 3);
    this.spikeCol = new Float32Array(MAX_SPIKES * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.spikePos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.spikeCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 4.2,
        map: spikeTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.renderOrder = 5;
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.spikes = []; // {tract, t}
    this.rebuildCurves();
  }

  rebuildCurves() {
    for (const tr of this.tracts) {
      const a = tr.from.pivot.position;
      const b = tr.to.pivot.position;
      const sx = tr.h === 'L' ? -1 : 1;
      const bulge = new THREE.Vector3(tr.def.bulge[0] * sx, tr.def.bulge[1], tr.def.bulge[2]);
      const p1 = a.clone().lerp(b, 0.33).add(bulge);
      const p2 = a.clone().lerp(b, 0.66).add(bulge);
      tr.curve = new THREE.CatmullRomCurve3([a.clone(), p1, p2, b.clone()], false, 'centripetal');
      tr.mesh.geometry.dispose();
      tr.mesh.geometry = new THREE.TubeGeometry(tr.curve, 64, 0.55, 8, false);
      tr.mesh.material.uniforms.uLength.value = tr.curve.getLength();
    }
  }

  /** rateOf(pop, hemisphere) -> Hz from the circuit; dot density is proportional to the presynaptic rate */
  setRates(rateOf) {
    for (const tr of this.tracts) tr.rate = rateOf(tr.def.src, tr.h) / 12;
  }

  setPathwayVisible(name, on) {
    this.pathwayVisible[name] = on;
  }

  /** inFocus(tract) -> bool; tracts outside the current focus fade out */
  setFocus(inFocus) {
    for (const tr of this.tracts) tr.focus = inFocus(tr);
  }

  update(dt, geometryChanged) {
    if (geometryChanged) this.rebuildCurves();

    for (const tr of this.tracts) {
      const visible = this.group.visible && !tr.hidden && (!tr.def.pathway || this.pathwayVisible[tr.def.pathway] !== false);
      tr.mesh.visible = visible;
      const targetActivity = Math.min(1, tr.rate / 4);
      tr.activity += (targetActivity - tr.activity) * (1 - Math.exp(-dt * 5));
      const u = tr.mesh.material.uniforms;
      const dimTarget = tr.focus === false ? 0.15 : 1;
      tr.dim = (tr.dim ?? 1) + (dimTarget - (tr.dim ?? 1)) * (1 - Math.exp(-dt * 4 - 0.02));
      u.uActivity.value = tr.activity * tr.dim;
      u.uDim.value = tr.dim;
      u.uTime.value += dt * (0.6 + 2.4 * tr.activity);
      if (!visible || tr.rate <= 0 || tr.focus === false) continue;
      tr.acc += dt * tr.rate;
      while (tr.acc >= 1) {
        tr.acc -= 1;
        if (this.spikes.length < MAX_SPIKES) this.spikes.push({ tract: tr, t: 0 });
      }
    }

    let n = 0;
    const p = new THREE.Vector3();
    this.spikes = this.spikes.filter((s) => (s.t += dt / SPIKE_TRAVEL) < 1 && s.tract.mesh.visible);
    for (const s of this.spikes) {
      s.tract.curve.getPointAt(s.t, p);
      this.spikePos.set([p.x, p.y, p.z], n * 3);
      const c = NT_COLOR[s.tract.def.nt];
      const fade = Math.sin(Math.PI * Math.min(1, s.t * 1.2)) * 0.6 + 0.6;
      this.spikeCol.set([c.r * fade * 1.6, c.g * fade * 1.6, c.b * fade * 1.6], n * 3);
      n++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
}
