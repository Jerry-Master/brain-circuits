import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { makeShellMaterial, makeStructureMaterial, renderOrderFor } from './materials.js';

export const ROLES = {
  brain: 'Whole-brain surface. Wheel to split the hemispheres.',
  m1: 'Executes movement. Layer-5 pyramidal neurons send glutamatergic corticostriatal axons to the putamen and corticospinal axons to the cord.',
  pmc: 'Plans and selects movements (PMd, PMv, SMA).',
  caudate: 'Associative striatum.',
  putamen: 'Motor striatum. GABAergic medium spiny neurons: D1 (direct → GPi) and D2 (indirect → GPe).',
  gpe: 'GABAergic and tonically active. Inhibits the STN; inhibited itself by D2 MSNs (indirect pathway).',
  gpi: 'Main basal-ganglia output. Tonic GABAergic inhibition of VA/VL; when it pauses, the thalamus is disinhibited.',
  stn: 'Glutamatergic, ~20 Hz at rest. Receives the fast hyperdirect cortical input and GPe inhibition; projects diffusely to GPi and GPe.',
  sn: 'Dopaminergic SNc neurons set striatal gain: D1 ×(1+λ), D2 ×(1−λ).',
  thalamus: 'Remainder of the thalamus.',
  va: 'Motor thalamus. Relays pallidal output to premotor / prefrontal cortex.',
  vl: 'Motor thalamus. VLo relays pallidal output to M1, SMA and premotor cortex.',
};

const SHORT = { brain: 'Brain', m1: 'M1', pmc: 'Premotor', caudate: 'Caudate', putamen: 'Putamen',
  gpe: 'GPe', gpi: 'GPi', stn: 'STN', sn: 'SN', thalamus: 'Thalamus', va: 'VA', vl: 'VLo',
};

/**
 * Loads manifest + GLBs. Each structure becomes a pivot Group placed at its
 * centroid (so it can be translated for the exploded view and pulsed in scale
 * around its own centre) holding a mesh offset by -centroid.
 */
export async function loadAtlas(scene) {
  const base = import.meta.env.BASE_URL;
  const manifest = await fetch(`${base}meshes/manifest.json`).then((r) => r.json());
  const loader = new GLTFLoader();
  const materials = new Map(); // base id -> material (shared by L/R)
  const structures = [];

  await Promise.all(
    manifest.structures.map(async (meta) => {
      const gltf = await loader.loadAsync(`${base}meshes/${meta.id}.glb`);
      let geometry;
      gltf.scene.traverse((o) => {
        if (o.isMesh && !geometry) geometry = o.geometry;
      });
      geometry.computeVertexNormals();

      if (!materials.has(meta.base)) {
        materials.set(meta.base, meta.group === 'shell' ? makeShellMaterial(meta.color) : makeStructureMaterial(meta));
      }
      const centroid = new THREE.Vector3(...meta.centroid);
      const mesh = new THREE.Mesh(geometry, materials.get(meta.base));
      mesh.position.copy(centroid).negate();
      mesh.renderOrder = renderOrderFor(meta.group);

      const pivot = new THREE.Group();
      pivot.position.copy(centroid);
      pivot.add(mesh);
      scene.add(pivot);

      const labelEl = document.createElement('div');
      labelEl.className = 'label3d';
      labelEl.style.setProperty('--c', meta.color);
      labelEl.textContent = SHORT[meta.base] ?? meta.base;
      const label = new CSS2DObject(labelEl);
      // put cortical labels on the outer surface rather than inside the gyrus
      if (meta.group === 'cortex') label.position.set(meta.hemisphere === 'R' ? 8 : -8, 10, 0);
      if (meta.group === 'shell') label.visible = false;
      pivot.add(label);

      mesh.userData.structure = { meta, pivot };
      structures.push({ meta, mesh, pivot, label, centroid, offset: new THREE.Vector3() });
    }),
  );

  structures.sort((a, b) => a.meta.id.localeCompare(b.meta.id));
  const byId = new Map(structures.map((s) => [s.meta.id, s]));
  return { manifest, structures, byId, materials };
}
