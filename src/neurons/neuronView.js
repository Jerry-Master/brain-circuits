import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildNeuron, mulberry32, fluorMaterial } from './morphology.js';
import { IzhNeuron, PRESETS } from './izhikevich.js';
import { Scope } from './scope.js';

// simulated milliseconds per real second: slow motion so individual APs are visible
const SIM_MS_PER_S = 140;
const SIM_DT = 0.1; // ms
const MAX_APS = 8; // per axon (shader uniform array size)

const NT_COLOR = { glu: new THREE.Color('#ffb347'), gaba: new THREE.Color('#5cc8ff') };
const EPSP_COLOR = new THREE.Color('#ffe08a');
const IPSP_COLOR = new THREE.Color('#5cc8ff');

// Full loop as a ring of example cells, laid out clockwise like the HUD diagram.
const CHAIN = [
  { key: 'pyr', type: 'pyr', label: 'L5 pyramidal · M1/PMC', short: 'Ctx L5', pos: [0, 40, 0], labelY: 24 },
  { key: 'd1', type: 'msn', label: 'D1 MSN · putamen', short: 'D1 MSN', pos: [46, 22, 6], labelY: 10 },
  { key: 'd2', type: 'msn', label: 'D2 MSN · putamen', short: 'D2 MSN', pos: [64, -6, -4], labelY: 10, color: '#81d4fa' },
  { key: 'gpe', type: 'gpi', label: 'GPe neuron', short: 'GPe', pos: [40, -36, 0], labelY: 10, color: '#7e8cff' },
  { key: 'stn', type: 'stn', label: 'STN neuron', short: 'STN', pos: [0, -48, 4], labelY: 9 },
  { key: 'gpi', type: 'gpi', label: 'GPi neuron', short: 'GPi', pos: [-42, -30, 0], labelY: 10 },
  { key: 'vl', type: 'vl', label: 'VL relay neuron · thalamus', short: 'VA/VL', pos: [-58, 8, 0], labelY: 10 },
];
// synapses (indices into SYNAPSES) and cells highlighted in each loop stage, mirroring the brain tracts
const STAGE_FOCUS = {
  cortex: { syn: [], cells: ['pyr'] },
  striatum: { syn: [0, 1], cells: ['pyr', 'd1', 'd2'] },
  direct: { syn: [2], cells: ['d1', 'gpi'] },
  indirect: { syn: [3, 4, 5], cells: ['d2', 'gpe', 'stn', 'gpi'] },
  thalamus: { syn: [6], cells: ['gpi', 'vl'] },
  return: { syn: [7], cells: ['vl', 'pyr'] },
};
const DIM = 0.15;
const IDX = Object.fromEntries(CHAIN.map((c, i) => [c.key, i]));
// bulge: >0 bows the axon outward from the ring centre, <0 inward
const SYNAPSES = [
  { from: 'pyr', to: 'd1', nt: 'glu', weight: 6, myelin: true, travel: 0.55, bulge: 10 },
  { from: 'pyr', to: 'd2', nt: 'glu', weight: 6, myelin: true, travel: 0.65, bulge: 18 },
  { from: 'd1', to: 'gpi', nt: 'gaba', weight: -16, myelin: false, travel: 1.0, bulge: -6 },
  { from: 'd2', to: 'gpe', nt: 'gaba', weight: -16, myelin: false, travel: 0.8, bulge: 8 },
  { from: 'gpe', to: 'stn', nt: 'gaba', weight: -8, myelin: true, travel: 0.5, bulge: 8 },
  { from: 'stn', to: 'gpi', nt: 'glu', weight: 8, myelin: true, travel: 0.5, bulge: 8 },
  { from: 'gpi', to: 'vl', nt: 'gaba', weight: -6, myelin: true, travel: 0.55, bulge: 8 },
  { from: 'vl', to: 'pyr', nt: 'glu', weight: 10, myelin: true, travel: 0.7, bulge: 10 },
];

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeAxonMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone().multiplyScalar(0.7) },
      uGlow: { value: new THREE.Color('#fff2b0') },
      uSpikes: { value: new Array(MAX_APS).fill(-1) },
      uWidth: { value: 0.012 },
      uFocus: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aU;
      varying float vU;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vU = aU;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uGlow;
      uniform float uSpikes[${MAX_APS}];
      uniform float uWidth;
      uniform float uFocus;
      varying float vU;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float lit = 0.35 + 0.65 * max(dot(normalize(vN), normalize(vV)), 0.0);
        float g = 0.0;
        for (int i = 0; i < ${MAX_APS}; i++) {
          float s = uSpikes[i];
          if (s < 0.0) continue;
          float d = vU - s;
          g += exp(-d * d / (uWidth * uWidth));
          // fading refractory tail behind the front
          if (d < 0.0) g += 0.25 * exp(d / (uWidth * 5.0));
        }
        gl_FragColor = vec4((uColor * lit * (0.35 + 0.65 * uFocus) + uGlow * g * 3.0 * uFocus), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function addArcParam(geo, tubularSegments, radialSegments) {
  const n = geo.attributes.position.count;
  const aU = new Float32Array(n);
  for (let i = 0; i <= tubularSegments; i++) {
    for (let j = 0; j <= radialSegments; j++) aU[i * (radialSegments + 1) + j] = i / tubularSegments;
  }
  geo.setAttribute('aU', new THREE.BufferAttribute(aU, 1));
}

function subCurve(curve, u0, u1, n = 6) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(curve.getPointAt(u0 + ((u1 - u0) * i) / n));
  return new THREE.CatmullRomCurve3(pts);
}

/** large inside-out sphere with a vertical vignette gradient */
function backdrop() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP;
      void main(){
        vec3 top = vec3(0.045,0.05,0.10), mid = vec3(0.02,0.022,0.04), low = vec3(0.035,0.018,0.03);
        float y = vP.y;
        vec3 c = mix(mid, top, smoothstep(0.0, 0.9, y));
        c = mix(c, low, smoothstep(0.0, -0.9, y));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), m);
  s.renderOrder = -10;
  return s;
}

/** drifting extracellular particles, twinkling slowly */
function dust(tex) {
  const N = 600;
  const pos = new Float32Array(N * 3);
  const ph = new Float32Array(N);
  const rng = mulberry32(7);
  for (let i = 0; i < N; i++) {
    pos.set([(rng() - 0.5) * 220, (rng() - 0.5) * 120, (rng() - 0.5) * 120 - 20], i * 3);
    ph[i] = rng() * 6.28;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: tex } },
    vertexShader: `attribute float aPh; uniform float uTime; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vA = 0.35 + 0.35 * sin(uTime * 0.7 + aPh);
        gl_PointSize = 90.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D uMap; varying float vA;
      void main(){ gl_FragColor = vec4(vec3(0.6,0.7,1.0), texture2D(uMap, gl_PointCoord).a * vA * 0.5); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

function label(text, cls, color) {
  const el = document.createElement('div');
  el.className = `label3d ${cls ?? ''}`;
  if (color) el.style.setProperty('--c', color);
  const [main, sub] = text.split(' · ');
  el.textContent = main;
  if (sub) el.appendChild(Object.assign(document.createElement('small'), { textContent: sub }));
  return new CSS2DObject(el);
}

export class NeuronView {
  constructor(container, scopeCanvas) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#04060c');
    this.scene.fog = new THREE.FogExp2('#04060c', 0.0045);
    this.scene.add(backdrop());
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
    this.camera.position.set(0, 0, 175);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.appendChild(this.labels.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, -2, 0);
    this.controls.addEventListener('start', () => (this.camAnim = null));

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1.25, 0.6, 0.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.scene.add(new THREE.HemisphereLight('#9fb4ff', '#1a0f18', 0.9));
    const key = new THREE.DirectionalLight('#fff4e6', 1.6);
    key.position.set(30, 60, 80);
    this.scene.add(key);

    this.glowTex = glowTexture();
    this.drive = {};
    this.bias = {};
    this.buildNeurons();
    this.buildSynapses();
    this.buildApSprites();
    this.dust = dust(this.glowTex);
    this.scene.add(this.dust);

    this.scope = new Scope(scopeCanvas, this.neurons.map((n, i) => ({ label: CHAIN[i].short, color: `#${n.color.getHexString()}` })));
    this.simAcc = 0;

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  buildNeurons() {
    // one receiving dendrite per incoming synapse, pointing toward the presynaptic cell
    const recvDirs = CHAIN.map(() => []);
    this.recvSlot = SYNAPSES.map((def) => {
      const pre = new THREE.Vector3(...CHAIN[IDX[def.from]].pos);
      const post = new THREE.Vector3(...CHAIN[IDX[def.to]].pos);
      const dir = pre.sub(post);
      dir.z = 0;
      const list = recvDirs[IDX[def.to]];
      list.push(dir.normalize().multiplyScalar(8).add(new THREE.Vector3(0, 0, 1.5)));
      return list.length - 1;
    });
    this.neurons = CHAIN.map((c, i) => {
      const n = buildNeuron(c.type, new THREE.Vector3(...c.pos), 1000 + i * 77, { color: c.color, receives: recvDirs[i] });
      this.scene.add(n.group);
      const l = label(c.label, 'cell', `#${n.color.getHexString()}`);
      l.position.set(0, c.labelY, 0);
      n.group.add(l);
      n.model = new IzhNeuron(PRESETS[c.key]);
      n.key = c.key;
      n.flash = 0;
      n.psp = 0;
      n.out = [];
      n.focusK = 1;
      return n;
    });
  }

  buildSynapses() {
    const centre = new THREE.Vector3(0, -2, 0);
    this.synapses = SYNAPSES.map((def, i) => {
      const pre = this.neurons[IDX[def.from]];
      const post = this.neurons[IDX[def.to]];
      const rc = post.receives[this.recvSlot[i]];
      const toPre = pre.group.position.clone().sub(post.group.position).setZ(0).normalize();
      const B = rc.pos.clone().addScaledVector(toPre, 2.05); // bouton centre
      const H = pre.hillock;
      const H2 = H.clone().add(new THREE.Vector3(0, -5, 0));
      const mid = H2.clone().lerp(B, 0.5);
      const out = mid.clone().sub(centre).setZ(0).normalize();
      mid.addScaledVector(out, def.bulge).add(new THREE.Vector3(0, 0, def.bulge < 0 ? 8 : 0));
      const pts = [H, H2, mid, B.clone().addScaledVector(toPre, 4), B];
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => p.clone()), false, 'centripetal');
      const TS = 260;
      const RS = 8;
      const axonGeo = new THREE.TubeGeometry(curve, TS, 0.28, RS, false);
      addArcParam(axonGeo, TS, RS);
      const axonMat = makeAxonMaterial(pre.color);
      const axon = new THREE.Mesh(axonGeo, axonMat);
      this.scene.add(axon);

      // myelin sheaths separated by nodes of Ranvier
      const nodes = [];
      if (def.myelin) {
        const sheaths = [];
        const start = 0.05;
        const end = 0.93;
        const count = Math.round((end - start) / 0.085);
        const step = (end - start) / count;
        const gap = 0.016;
        nodes.push(start - gap / 2);
        for (let k = 0; k < count; k++) {
          const u0 = start + k * step;
          sheaths.push(new THREE.TubeGeometry(subCurve(curve, u0, u0 + step - gap), 10, 0.62, 12, false));
          nodes.push(u0 + step - gap / 2);
        }
        const myelinMat = fluorMaterial({
          color: '#efe9da',
          rimColor: '#c9d8ff',
          roughness: 0.2,
          metalness: 0.1,
          transparent: true,
          opacity: 0.38,
          depthWrite: false,
        });
        for (const g of sheaths) {
          const m = new THREE.Mesh(g, myelinMat);
          m.renderOrder = 2;
          this.scene.add(m);
        }
      }

      // presynaptic bouton with vesicles
      const boutonMat = fluorMaterial({
        color: pre.color,
        transparent: true,
        opacity: 0.45,
        roughness: 0.3,
        depthWrite: false,
        emissive: pre.color.clone(),
        emissiveIntensity: 0.1,
      });
      const bouton = new THREE.Mesh(new THREE.SphereGeometry(1.05, 24, 18), boutonMat);
      bouton.position.copy(B);
      bouton.renderOrder = 3;
      this.scene.add(bouton);

      const toPost = rc.pos.clone().sub(B).normalize();
      const dock = B.clone().addScaledVector(toPost, 0.8);
      const rng = mulberry32(55 + i);
      const vesGeo = new THREE.SphereGeometry(0.16, 10, 8);
      const vesMat = new THREE.MeshStandardMaterial({ color: NT_COLOR[def.nt], emissive: NT_COLOR[def.nt], emissiveIntensity: 0.6 });
      const vesicles = new THREE.InstancedMesh(vesGeo, vesMat, 14);
      const ves = [];
      for (let k = 0; k < 14; k++) {
        const home = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize().multiplyScalar(0.25 + rng() * 0.5).add(B);
        ves.push({ home, p: 0, fusing: false });
      }
      vesicles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(vesicles);

      // neurotransmitter cloud in the cleft
      const NTN = 40;
      const ntPos = new Float32Array(NTN * 3);
      const ntGeo = new THREE.BufferGeometry();
      ntGeo.setAttribute('position', new THREE.BufferAttribute(ntPos, 3).setUsage(THREE.DynamicDrawUsage));
      const ntMat = new THREE.PointsMaterial({
        color: NT_COLOR[def.nt],
        size: 0.45,
        map: this.glowTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const nt = new THREE.Points(ntGeo, ntMat);
      nt.frustumCulled = false;
      this.scene.add(nt);
      const ntParticles = Array.from({ length: NTN }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3() }));

      const l = label(def.nt === 'glu' ? 'Glu  +' : 'GABA  −', 'syn', `#${NT_COLOR[def.nt].getHexString()}`);
      l.position.copy(B).add(new THREE.Vector3(0, 2.6, 0));
      this.scene.add(l);
      if (i === 7) {
        const ml = label('myelin · nodes of Ranvier · saltatory', 'note', '#efe9da');
        ml.position.copy(curve.getPointAt(0.45)).add(new THREE.Vector3(0, -2.5, 0));
        this.scene.add(ml);
      }
      if (i === 2) {
        const ml = label('unmyelinated · continuous', 'note', '#9ccfe8');
        ml.position.copy(curve.getPointAt(0.5)).add(new THREE.Vector3(0, -2.5, 0));
        this.scene.add(ml);
      }

      return {
        def, pre, post, psd: rc.psdMat, curve, axonMat, nodes, bouton, boutonMat, B, dock, toPost,
        vesicles, ves, nt, ntMat, ntParticles, aps: [], release: 0, focusK: 1,
      };
    });
    for (const syn of this.synapses) syn.pre.out.push(syn);
  }

  buildApSprites() {
    this.apPos = new Float32Array(128 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.apPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.apPoints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: new THREE.Color(2.2, 2.0, 1.2),
        size: 2.6,
        map: this.glowTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.apPoints.frustumCulled = false;
    this.scene.add(this.apPoints);
  }

  /** highlight only the synapses/cells of the current stage; the rest keep running, dimmed */
  setStage(key) {
    const f = STAGE_FOCUS[key] ?? { syn: [], cells: [] };
    this.synapses.forEach((syn, i) => (syn.focusT = f.syn.includes(i) ? 1 : DIM));
    for (const n of this.neurons) n.focusT = f.cells.includes(n.key) ? 1 : DIM;
  }

  /** external (stage) drive, per neuron key */
  setDrive(drive, bias) {
    this.drive = drive;
    this.bias = bias;
  }

  /** 'overview' or a neuron index: frames that cell and its incoming synapses */
  focus(target) {
    const t = target === 'overview' ? new THREE.Vector3(0, -2, 0) : this.neurons[+target].group.position.clone();
    const pos = target === 'overview' ? new THREE.Vector3(0, 0, 175) : t.clone().add(new THREE.Vector3(4, 6, 46));
    this.camAnim = { t, pos, k: 0 };
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
    this.scope.resize();
  }

  /** dt: real seconds (camera); simDt: real seconds × speed, 0 when paused */
  update(dt, simDt) {
    this.dust.rotation.y += dt * 0.012;
    this.dust.material.uniforms.uTime.value += dt;
    this.simulate(simDt);
    this.animate(simDt);

    if (this.camAnim) {
      const a = this.camAnim;
      const k = 1 - Math.exp(-dt * 4);
      this.controls.target.lerp(a.t, k);
      this.camera.position.lerp(a.pos, k);
      if (this.camera.position.distanceTo(a.pos) < 0.05) this.camAnim = null;
    }
    this.controls.update();
  }

  simulate(simDt) {
    this.simAcc += simDt * SIM_MS_PER_S;
    const steps = Math.min(4000, Math.floor(this.simAcc / SIM_DT));
    this.simAcc -= steps * SIM_DT;
    const vm = new Array(this.neurons.length);
    for (let s = 0; s < steps; s++) {
      this.neurons.forEach((n, i) => {
        n.model.iExt = this.drive[n.key] ?? 0;
        const spiked = n.model.step(SIM_DT, this.bias[n.key] ?? 0);
        if (spiked) {
          n.flash = 1;
          for (const syn of n.out) if (syn.aps.length < MAX_APS) syn.aps.push({ t: 0 });
        }
        vm[i] = spiked ? 30 : n.model.v;
      });
      this.scope.sample(vm);
    }
  }

  animate(dt) {
    let nAp = 0;
    const p = new THREE.Vector3();
    const kf = 1 - Math.exp(-dt * 5);
    for (const n of this.neurons) n.focusK += ((n.focusT ?? 1) - n.focusK) * kf;
    for (const syn of this.synapses) {
      syn.focusK += ((syn.focusT ?? 1) - syn.focusK) * kf;
      syn.axonMat.uniforms.uFocus.value = syn.focusK;
      // AP propagation along the axon
      const u = syn.axonMat.uniforms.uSpikes.value;
      u.fill(-1);
      syn.aps = syn.aps.filter((ap) => {
        ap.t += dt / syn.def.travel;
        if (ap.t >= 1) {
          this.transmit(syn);
          return false;
        }
        return true;
      });
      syn.aps.forEach((ap, k) => {
        let pos = ap.t;
        if (syn.nodes.length && ap.t > syn.nodes[0]) {
          // saltatory: the regenerating current appears node to node
          let j = 0;
          while (j + 1 < syn.nodes.length && syn.nodes[j + 1] <= ap.t) j++;
          pos = ap.t > syn.nodes[syn.nodes.length - 1] + 0.02 ? ap.t : syn.nodes[j];
        }
        u[k] = pos;
        if (nAp < 128 && syn.focusK > 0.5) {
          syn.curve.getPointAt(Math.min(pos, 1), p);
          this.apPos.set([p.x, p.y, p.z], nAp * 3);
          nAp++;
        }
      });

      // vesicle fusion
      const m = new THREE.Matrix4();
      const q = new THREE.Vector3();
      syn.ves.forEach((v, k) => {
        let scale = 1;
        if (v.fusing) {
          v.p += dt / 0.35;
          if (v.p >= 1) {
            v.fusing = false;
            v.p = -1; // refill
          }
          q.copy(v.home).lerp(syn.dock, Math.min(1, v.p * 1.6));
          scale = v.p > 0.6 ? Math.max(0, 1 - (v.p - 0.6) / 0.4) : 1;
        } else if (v.p < 0) {
          v.p = Math.min(0, v.p + dt / 0.6);
          q.copy(v.home);
          scale = 1 + v.p;
        } else {
          q.copy(v.home);
        }
        m.makeScale(scale, scale, scale).setPosition(q);
        syn.vesicles.setMatrixAt(k, m);
      });
      syn.vesicles.instanceMatrix.needsUpdate = true;

      // neurotransmitter diffusion across the cleft
      syn.release = Math.max(0, syn.release - dt / 0.6);
      syn.ntMat.opacity = Math.min(1, syn.release * 1.8) * syn.focusK;
      if (syn.release > 0) {
        const arr = syn.nt.geometry.attributes.position.array;
        syn.ntParticles.forEach((np, k) => {
          np.p.addScaledVector(np.v, dt);
          np.v.multiplyScalar(Math.exp(-dt * 3));
          arr[k * 3] = np.p.x;
          arr[k * 3 + 1] = np.p.y;
          arr[k * 3 + 2] = np.p.z;
        });
        syn.nt.geometry.attributes.position.needsUpdate = true;
      }
      syn.boutonMat.emissiveIntensity = 0.1 + syn.release * 1.2 * syn.focusK;
      syn.psd.emissiveIntensity *= Math.exp(-dt * 6);
      syn.psd.emissive.copy(NT_COLOR[syn.def.nt]);
    }
    this.apPoints.geometry.setDrawRange(0, nAp);
    this.apPoints.geometry.attributes.position.needsUpdate = true;

    for (const n of this.neurons) {
      n.flash *= Math.exp(-dt * 10);
      n.psp *= Math.exp(-dt * 3);
      const depol = THREE.MathUtils.clamp((n.model.v + 70) / 45, 0, 1);
      n.somaMat.emissiveIntensity = (0.08 + depol * 0.5 + n.flash * 3.5) * n.focusK;
      n.dendMat.emissive.copy(n.psp >= 0 ? EPSP_COLOR : IPSP_COLOR);
      n.dendMat.emissiveIntensity = (0.05 + Math.min(1.4, Math.abs(n.psp) * 0.9)) * n.focusK;
    }
  }

  transmit(syn) {
    syn.post.model.iSyn += syn.def.weight;
    syn.post.psp += Math.sign(syn.def.weight);
    syn.psd.emissiveIntensity = 2.2 * syn.focusK;
    syn.release = 1;
    // fuse three docked-nearest idle vesicles
    const idle = syn.ves.filter((v) => !v.fusing && v.p === 0);
    idle.sort((a, b) => a.home.distanceTo(syn.dock) - b.home.distanceTo(syn.dock));
    idle.slice(0, 3).forEach((v) => {
      v.fusing = true;
      v.p = 0;
    });
    for (const np of syn.ntParticles) {
      np.p.copy(syn.dock).add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9));
      np.v.copy(syn.toPost).multiplyScalar(1.2 + Math.random() * 1.6).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5));
    }
  }

  render() {
    this.composer.render();
    this.labels.render(this.scene, this.camera);
    this.scope.draw();
  }
}
