import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { loadAtlas } from './brain/loadAtlas.js';
import { applyActivation, setStructureColor } from './brain/materials.js';
import { Exploder } from './brain/explode.js';
import { Pathways } from './brain/pathways.js';
import { Sequence } from './brain/sequence.js';
import { DT } from './model/engine.js';
import { NeuronView } from './neurons/neuronView.js';
import { buildGui, groupOpacity } from './ui/panel.js';
import { Hud } from './ui/hud.js';
import { motor } from './windows/motor.js';
import { attention } from './windows/attention.js';
import { executive } from './windows/executive.js';
import { NT_NAME } from './windows/common.js';

const WINDOWS = { motor, attention, executive };
const WINDOW_IDS = Object.keys(WINDOWS);

const container = document.getElementById('brain-view');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
const coarse = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
container.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#05070d');

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 1, 5000);
const BASE_DIST = 330;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enableZoom = false; // wheel is reserved for the exploded view
controls.autoRotateSpeed = 0.6;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.PAN }; // pinch handled below

scene.add(new THREE.HemisphereLight('#c6d4ff', '#1a1208', 1.3));
const key = new THREE.DirectionalLight('#ffffff', 2.2);
key.position.set(-150, 220, 160);
scene.add(key);
const rim = new THREE.DirectionalLight('#7aa7ff', 1.2);
rim.position.set(180, -60, -200);
scene.add(rim);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.45, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- content ----------
const atlas = await loadAtlas(scene);
const exploder = new Exploder(atlas.structures);
const hud = new Hud();
const panel = document.getElementById('neuron-panel');

// one model / narration / tract set per window, created on first visit; only the active one runs
const built = {};
function build(id) {
  if (built[id]) return built[id];
  const def = WINDOWS[id];
  const model = def.create();
  const sequence = new Sequence(model, def.phases, def.opts);
  const pathways = new Pathways(scene, atlas, def.tracts);
  sequence.onStage((stage, index) => {
    if (app.def !== def) return;
    if (def.neurons) neuronView?.setStage(stage.key);
    hud.showStage(stage, index);
  });
  return (built[id] = { def, model, sequence, pathways });
}
let neuronView = null;

const level = {}; // structure id -> smoothed activation level
const dim = {}; // structure id -> smoothed focus factor (1 = in focus)
for (const s of atlas.structures) {
  level[s.meta.id] = 0;
  dim[s.meta.id] = 1;
}

const state = {
  labels: true,
  tracts: true,
  focus: false,
  autoRotate: false,
  zoom: 1,
  hemispheres: 'both',
  visible: {},
};

const app = {
  atlas, exploder, bloom, state,
  def: null, model: null, sequence: null, pathways: null, solo: null,
  inWindow: (s) => s.meta.base === 'brain' || !!app.def.structures[s.meta.base],
  groupOf: (base) => atlas.structures.find((s) => s.meta.base === base)?.meta.group,
  onStagesRebuilt() {
    const on = app.def.pathwayOn(app.model);
    hud.setStages(app.sequence.stages, on);
    for (const [p, v] of Object.entries(on)) app.pathways.setPathwayVisible(p, v);
    hud.showStage(app.sequence.stage, app.sequence.index); // captions depend on the settings: refresh them
    if (app.def.neurons) neuronView?.setStage(app.sequence.stage.key);
  },
  setLabels(on) {
    state.labels = on;
  },
  setZoom(z) {
    state.zoom = THREE.MathUtils.clamp(z, 0.3, 3);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, BASE_DIST / state.zoom);
  },
  setGroupOpacity(group, v) {
    groupOpacity[group] = v;
    for (const s of atlas.structures) {
      if (s.meta.group !== group) continue;
      const m = s.mesh.material;
      if (m.uniforms) m.uniforms.uOpacity.value = v;
      else m.userData.op = app.def.structures[s.meta.base]?.opacity ?? v;
    }
  },
  applyVisibility() {
    for (const s of atlas.structures) {
      const hemOk = state.hemispheres === 'both' || (state.hemispheres === 'left') === (s.meta.hemisphere === 'L');
      s.pivot.visible = app.inWindow(s) && (state.visible[s.meta.base] ?? true) && hemOk;
    }
    for (const tr of app.pathways.tracts) {
      tr.hidden = !(tr.from.pivot.visible && tr.to.pivot.visible);
    }
  },
};

// ---------- windows ----------
const tabs = document.getElementById('tabs');
for (const [i, id] of WINDOW_IDS.entries()) {
  const b = document.createElement('button');
  b.dataset.window = id;
  b.innerHTML = `<kbd>${i + 1}</kbd>${WINDOWS[id].tab}`;
  b.addEventListener('click', () => (location.hash = id));
  tabs.appendChild(b);
}
const chips = document.getElementById('chips');
const inset = document.getElementById('inset');
const insetCtx = inset.getContext('2d');

function setWindow(id) {
  if (!WINDOWS[id] || app.def?.id === id) return;
  const w = build(id);
  const def = w.def;
  Object.assign(app, w, { solo: null });
  for (const b of Object.values(built)) b.pathways.group.visible = b === w && state.tracts;

  // structures: colour, opacity, labels for this window
  for (const s of atlas.structures) {
    const sd = def.structures[s.meta.base];
    const mat = s.mesh.material;
    s.label.element.textContent = sd?.short ?? s.meta.base;
    if (mat.uniforms || !sd) continue;
    setStructureColor(mat, sd.color ?? s.meta.color);
    s.label.element.style.setProperty('--c', sd.color ?? s.meta.color);
    mat.userData.op = sd.opacity ?? groupOpacity[s.meta.group] ?? 1;
    level[s.meta.id] = 0;
  }
  exploder.setVectors(def.explode);
  controls.target.set(...def.view.target);
  camera.position.copy(controls.target).addScaledVector(new THREE.Vector3(...def.view.dir).normalize(), BASE_DIST / state.zoom);
  state.focus = def.focusDefault;

  // header
  document.getElementById('hud-eyebrow').textContent = def.eyebrow;
  document.getElementById('hud-title').innerHTML = def.titleHtml;
  document.title = `${def.tab} · Brain Loops 3D`;
  document.getElementById('key').innerHTML =
    def.key.map(([nt, name]) => `<span><i class="sw ${nt}"></i>${name ?? NT_NAME[nt]}</span>`).join('') +
    '<span class="src">Allen Human Ref. Atlas</span>' +
    (def.keyNote ? `<span class="note">${def.keyNote}</span>` : '');
  chips.replaceChildren();
  if (def.chips) {
    const all = [{ label: 'All' }, ...def.chips];
    for (const chip of all) {
      const b = document.createElement('button');
      b.textContent = chip.label;
      if (chip.color) b.style.setProperty('--c', chip.color);
      b.classList.toggle('on', !chip.structs);
      b.addEventListener('click', () => {
        app.solo = chip.structs ? chip : null;
        hud.setSolo(app.solo);
        [...chips.children].forEach((o) => o.classList.toggle('on', o === b));
      });
      chips.appendChild(b);
    }
  }
  inset.hidden = !def.inset;
  if (def.inset) {
    const W = inset.parentElement.clientWidth - 48;
    inset.width = W * devicePixelRatio;
    inset.height = def.inset.height * devicePixelRatio;
    inset.style.height = `${def.inset.height}px`;
  }

  // cellular panel: example cells of this window's network
  panel.hidden = !def.neurons;
  neuronView?.dispose();
  neuronView = null;
  if (def.neurons) {
    neuronView = new NeuronView(document.getElementById('neuron-view'), document.getElementById('scope'), w.model, def.neurons);
    document.getElementById('neuron-title').innerHTML = def.neurons.title;
    const cams = document.getElementById('cam-focus');
    cams.replaceChildren();
    const targets = [['overview', 'All'], ...def.neurons.chain.map((c, i) => [String(i), c.short.split(' ')[0]])];
    for (const [focus, text] of targets) {
      const b = Object.assign(document.createElement('button'), { textContent: text });
      b.dataset.focus = focus;
      b.classList.toggle('on', focus === 'overview');
      b.addEventListener('click', () => {
        for (const o of cams.children) o.classList.toggle('on', o === b);
        neuronView?.focus(focus);
      });
      cams.appendChild(b);
    }
  }

  hud.load(w.sequence, def.hud, def.focus);
  app.onStagesRebuilt();
  buildGui(app);
  app.applyVisibility();
  for (const b of tabs.children) b.classList.toggle('on', b.dataset.window === id);
}

const fromHash = () => setWindow(location.hash.slice(1) || 'motor');
addEventListener('hashchange', fromHash);
if (!WINDOWS[location.hash.slice(1)]) history.replaceState(null, '', '#motor');
fromHash();

const popRate = (k, h) => app.model.rate(k, app.def.channel(h));
const structRate = (src, h) => (Array.isArray(src) ? src.reduce((s, k) => s + popRate(k, h), 0) / src.length : popRate(src, h));
const restRate = (src) => (Array.isArray(src) ? src.reduce((s, k) => s + app.def.rest[k], 0) / src.length : app.def.rest[src]);

// ---------- input ----------
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    // shift+wheel on macOS arrives as horizontal scroll
    const delta = e.deltaY || e.deltaX;
    if (e.shiftKey || e.ctrlKey || e.metaKey) app.setZoom(state.zoom * Math.exp(-delta * 0.0015));
    else exploder.nudge(delta);
  },
  { passive: false },
);

// touch: pinch zooms (OrbitControls still pans with two fingers), tap shows the tooltip
const touches = new Map();
let pinchDist = 0;
let tapStart = null;
const spread = () => {
  const [a, b] = [...touches.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  tapStart = touches.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  if (touches.size === 2) pinchDist = spread();
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    const d = spread();
    if (pinchDist > 0) app.setZoom(state.zoom * (d / pinchDist));
    pinchDist = d;
  }
});
const endTouch = (e) => {
  if (!touches.delete(e.pointerId)) return;
  if (touches.size < 2) pinchDist = 0;
  if (e.type === 'pointerup' && tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 8 && performance.now() - tapStart.t < 400) {
    pointerEvent = e;
  }
  tapStart = null;
};
renderer.domElement.addEventListener('pointerup', endTouch);
renderer.domElement.addEventListener('pointercancel', endTouch);

const sequence = { get playing() { return app.sequence.playing; }, set playing(v) { for (const b of Object.values(built)) b.sequence.playing = v; } };
const playBtn = document.getElementById('btn-play');
const playIcon = document.getElementById('play-icon');
const syncPlay = () => playIcon.setAttribute('d', sequence.playing ? 'M4 3h3v10H4zM9 3h3v10H9z' : 'M4 2l10 6-10 6z');
playBtn.addEventListener('click', () => {
  sequence.playing = !sequence.playing;
  syncPlay();
});
document.getElementById('btn-step').addEventListener('click', () => app.sequence.next());

const hudEl = document.getElementById('hud');
const hudBtn = document.getElementById('btn-hud');
hudBtn.addEventListener('click', () => {
  hudEl.classList.toggle('min');
  hudBtn.textContent = hudEl.classList.contains('min') ? '+' : '–';
});
if (matchMedia('(max-width: 760px), (max-height: 500px)').matches) hudBtn.click();

const togglePanel = () => {
  panel.classList.toggle('collapsed');
  document.getElementById('btn-collapse').textContent = panel.classList.contains('collapsed') ? '+' : '–';
};
document.getElementById('btn-collapse').addEventListener('click', togglePanel);

document.getElementById('tt-explode').addEventListener('click', () => exploder.nudge(-250));
document.getElementById('tt-collapse').addEventListener('click', () => exploder.nudge(250));
document.getElementById('tt-reset').addEventListener('click', () => exploder.reset());
document.getElementById('tt-labels').addEventListener('click', () => (state.labels = !state.labels));

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    sequence.playing = !sequence.playing;
    syncPlay();
  } else if (e.key === 'l' || e.key === 'L') state.labels = !state.labels;
  else if (e.key === 'e' || e.key === 'E') exploder.reset();
  else if ((e.key === 'n' || e.key === 'N') && !panel.hidden) togglePanel();
  else if (e.key >= '1' && e.key <= String(WINDOW_IDS.length)) location.hash = WINDOW_IDS[+e.key - 1];
});

// hover tooltip
const tooltip = document.getElementById('tooltip');
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerEvent = null;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch') pointerEvent = e;
});
renderer.domElement.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'touch') return;
  pointerEvent = null;
  tooltip.hidden = true;
});
const pickable = atlas.structures.filter((s) => s.meta.group !== 'shell').map((s) => s.mesh);

function updateTooltip() {
  if (!pointerEvent) return;
  const e = pointerEvent;
  pointerEvent = null;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pickable.filter((m) => m.parent.visible && dim[m.userData.structure.meta.id] > 0.5), false)[0];
  if (!hit) {
    tooltip.hidden = true;
    return;
  }
  const { meta } = hit.object.userData.structure;
  tooltip.innerHTML = `<b style="color:${meta.color}">${meta.label}</b><span class="eyebrow">${meta.hemisphere === 'L' ? 'left' : 'right'} hemisphere</span><br>${app.def.structures[meta.base]?.role ?? 'Whole-brain surface. Wheel to split the hemispheres.'}`;
  tooltip.hidden = false;
  tooltip.style.left = `${Math.max(8, Math.min(e.clientX + 14, innerWidth - tooltip.offsetWidth - 8))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(e.clientY + 14, innerHeight - tooltip.offsetHeight - 8))}px`;
}

const onResize = () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
};
addEventListener('resize', onResize);
addEventListener('orientationchange', onResize);
visualViewport?.addEventListener('resize', onResize);

// ---------- loop ----------
const timer = new THREE.Timer();
timer.connect(document);
let time = 0;
const camPos = new THREE.Vector3();

function frame(timestamp) {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  const { def, model, sequence, pathways } = app;
  const simDt = sequence.playing ? dt * sequence.speed : 0;
  time += simDt;

  // advance the active window's spiking network by this frame's share of model time
  const panelOpen = def.neurons && !panel.classList.contains('collapsed');
  const steps = Math.round(sequence.msFor(dt) / DT);
  for (let i = 0; i < steps; i++) {
    model.step();
    if (panelOpen) neuronView.sample();
  }
  const progress = sequence.sync();
  hud.update(progress, sequence.index);
  if (def.inset) {
    insetCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    def.inset.draw(insetCtx, inset.width / devicePixelRatio, def.inset.height, model);
  }

  // phase focus (or a soloed network): other structures and tracts fade
  const focusSet = app.solo?.structs ?? (state.focus ? def.focus[sequence.stage.key]?.structs : null);
  const inFocus = (base) => !focusSet || focusSet.includes(base);
  pathways.setFocus((tr) => inFocus(tr.def.from) && inFocus(tr.def.to));

  exploder.update(dt);
  pathways.setRates(popRate);
  pathways.update(simDt, exploder.changed);

  // activation levels -> materials, from simulated rates (per hemisphere: it may show another channel)
  const pulse = 0.5 + 0.5 * Math.sin(time * 9);
  const k = 1 - Math.exp(-dt * 8);
  const kd = 1 - Math.exp(-dt * 4);
  camPos.copy(camera.position);
  for (const s of atlas.structures) {
    const { id, base, hemisphere: h } = s.meta;
    const mat = s.mesh.material;
    if (!s.pivot.visible) continue;
    const sd = def.structures[base];
    let target = 0;
    let tonic = 0;
    if (sd?.pop) {
      const r = structRate(sd.pop, h);
      const r0 = restRate(sd.pop);
      target = THREE.MathUtils.clamp((r - r0) / (r0 + 6), -1, 1);
      if (sd.tonic) tonic = Math.min(1, r / 90);
    }
    level[id] += (target - level[id]) * k;
    dim[id] += ((base === 'brain' || inFocus(base) ? 1 : 0.18) - dim[id]) * kd;
    if (!mat.uniforms) {
      applyActivation(mat, level[id] * dim[id], tonic * dim[id], pulse);
      mat.opacity = mat.userData.op * dim[id];
    }

    // scale pulse + labels on the hemisphere facing the camera
    const a = Math.max(0, level[id]);
    s.pivot.scale.setScalar(1 + a * 0.035 * pulse * dim[id]);
    const other = atlas.byId.get(`${base}_${h === 'L' ? 'R' : 'L'}`);
    const nearer = !other || !other.pivot.visible || s.pivot.position.distanceToSquared(camPos) <= other.pivot.position.distanceToSquared(camPos);
    s.label.visible = state.labels && s.meta.group !== 'shell' && nearer && dim[id] > 0.5;
  }
  for (const s of atlas.structures) if (!s.pivot.visible) s.label.visible = false;

  controls.autoRotate = state.autoRotate;
  controls.update();
  updateTooltip();

  composer.render();
  labelRenderer.render(scene, camera);

  if (panelOpen) {
    neuronView.update(dt, simDt);
    neuronView.render();
  }
requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
