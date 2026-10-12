import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { loadAtlas, ROLES } from './brain/loadAtlas.js';
import { applyActivation } from './brain/materials.js';
import { Exploder } from './brain/explode.js';
import { Pathways } from './brain/pathways.js';
import { Sequence, TONIC, BASE_RATES, NEURON_BIAS } from './brain/sequence.js';
import { NeuronView } from './neurons/neuronView.js';
import { buildGui } from './ui/panel.js';
import { Hud } from './ui/hud.js';

const container = document.getElementById('brain-view');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
const TARGET = new THREE.Vector3(0, 6, 10);
const VIEW_DIR = new THREE.Vector3(-0.62, 0.38, 0.68).normalize();
const BASE_DIST = 330;
camera.position.copy(TARGET).addScaledVector(VIEW_DIR, BASE_DIST);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(TARGET);
controls.enableDamping = true;
controls.enableZoom = false; // wheel is reserved for the exploded view
controls.autoRotateSpeed = 0.6;

scene.add(new THREE.HemisphereLight('#c6d4ff', '#1a1208', 1.3));
const key = new THREE.DirectionalLight('#ffffff', 2.2);
key.position.set(-150, 220, 160);
scene.add(key);
const rim = new THREE.DirectionalLight('#7aa7ff', 1.2);
rim.position.set(180, -60, -200);
scene.add(rim);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.45, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- content ----------
const atlas = await loadAtlas(scene);
const exploder = new Exploder(atlas.structures);
const pathways = new Pathways(scene, atlas);
const sequence = new Sequence();
const neuronView = new NeuronView(document.getElementById('neuron-view'), document.getElementById('scope'));

const bases = [...new Set(atlas.structures.map((s) => s.meta.base))];
const levelTarget = Object.fromEntries(bases.map((b) => [b, 0]));
const level = { ...levelTarget };

const state = {
  labels: true,
  tracts: true,
  autoRotate: false,
  zoom: 1,
  hemispheres: 'both',
  visible: {},
};

const hud = new Hud(sequence);
function onStage(stage, index) {
  for (const b of bases) levelTarget[b] = stage.levels[b] ?? 0;
  pathways.setRates(stage.rates, BASE_RATES);
  neuronView.setDrive(stage.drive, NEURON_BIAS);
  neuronView.setStage(stage.key);
  hud.showStage(stage, index);
}
sequence.onStage(onStage);

const app = {
  atlas, sequence, exploder, pathways, bloom, state,
  onStagesRebuilt() {
    hud.setStages(sequence.stages, sequence.opts);
    onStage(sequence.stage, sequence.index);
  },
  setLabels(on) {
    state.labels = on;
  },
  setZoom(z) {
    state.zoom = THREE.MathUtils.clamp(z, 0.3, 3);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, BASE_DIST / state.zoom);
  },
  applyVisibility() {
    for (const s of atlas.structures) {
      const hemOk = state.hemispheres === 'both' || (state.hemispheres === 'left') === (s.meta.hemisphere === 'L');
      s.pivot.visible = (state.visible[s.meta.base] ?? true) && hemOk;
    }
    for (const tr of pathways.tracts) {
      tr.hidden = !(tr.from.pivot.visible && tr.to.pivot.visible);
    }
  },
};
app.onStagesRebuilt();
buildGui(app);

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

const playBtn = document.getElementById('btn-play');
const playIcon = document.getElementById('play-icon');
const syncPlay = () => playIcon.setAttribute('d', sequence.playing ? 'M4 3h3v10H4zM9 3h3v10H9z' : 'M4 2l10 6-10 6z');
playBtn.addEventListener('click', () => {
  sequence.playing = !sequence.playing;
  syncPlay();
});
document.getElementById('btn-step').addEventListener('click', () => sequence.next());

const panel = document.getElementById('neuron-panel');
const togglePanel = () => {
  panel.classList.toggle('collapsed');
  document.getElementById('btn-collapse').textContent = panel.classList.contains('collapsed') ? '+' : '–';
};
document.getElementById('btn-collapse').addEventListener('click', togglePanel);
const focusButtons = panel.querySelectorAll('[data-focus]');
focusButtons.forEach((b) =>
  b.addEventListener('click', () => {
    focusButtons.forEach((o) => o.classList.toggle('on', o === b));
    neuronView.focus(b.dataset.focus);
  }),
);

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    sequence.playing = !sequence.playing;
    syncPlay();
  } else if (e.key === 'l' || e.key === 'L') state.labels = !state.labels;
  else if (e.key === 'e' || e.key === 'E') exploder.reset();
  else if (e.key === 'n' || e.key === 'N') togglePanel();
});

// hover tooltip
const tooltip = document.getElementById('tooltip');
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerEvent = null;
renderer.domElement.addEventListener('pointermove', (e) => (pointerEvent = e));
renderer.domElement.addEventListener('pointerleave', () => {
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
  const hit = raycaster.intersectObjects(pickable.filter((m) => m.parent.visible), false)[0];
  if (!hit) {
    tooltip.hidden = true;
    return;
  }
  const { meta } = hit.object.userData.structure;
  tooltip.innerHTML = `<b style="color:${meta.color}">${meta.label}</b><span class="eyebrow">${meta.hemisphere === 'L' ? 'left' : 'right'} hemisphere</span><br>${ROLES[meta.base] ?? ''}`;
  tooltip.style.left = `${Math.min(e.clientX + 14, innerWidth - 320)}px`;
  tooltip.style.top = `${e.clientY + 14}px`;
  tooltip.hidden = false;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

// ---------- loop ----------
const timer = new THREE.Timer();
timer.connect(document);
let time = 0;
const camPos = new THREE.Vector3();

function frame(timestamp) {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  const simDt = sequence.playing ? dt * sequence.speed : 0;
  time += simDt;

  const progress = sequence.update(dt);
  hud.update(progress, sequence.index);

  exploder.update(dt);
  pathways.update(simDt, exploder.changed);

  // activation levels -> materials
  const pulse = 0.5 + 0.5 * Math.sin(time * 9);
  const k = 1 - Math.exp(-simDt * 4);
  for (const b of bases) {
    level[b] += (levelTarget[b] - level[b]) * k;
    const mat = atlas.materials.get(b);
    if (!mat.uniforms) applyActivation(mat, level[b], TONIC[b] ?? 0, pulse);
  }

  // scale pulse + labels on the hemisphere facing the camera
  camPos.copy(camera.position);
  for (const s of atlas.structures) {
    const a = Math.max(0, level[s.meta.base]);
    s.pivot.scale.setScalar(1 + a * 0.035 * pulse);
    const other = atlas.byId.get(`${s.meta.base}_${s.meta.hemisphere === 'L' ? 'R' : 'L'}`);
    const nearer = !other || !other.pivot.visible || s.pivot.position.distanceToSquared(camPos) <= other.pivot.position.distanceToSquared(camPos);
    s.label.visible = state.labels && s.meta.group !== 'shell' && s.pivot.visible && nearer;
  }

  controls.autoRotate = state.autoRotate;
  controls.update();
  updateTooltip();

  composer.render();
  labelRenderer.render(scene, camera);

  if (!panel.classList.contains('collapsed')) {
    neuronView.update(dt, simDt);
    neuronView.render();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
