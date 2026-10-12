import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { makeShellMaterial, makeStructureMaterial, renderOrderFor } from './materials.js';

/**
 * Loads manifest + GLBs. Each structure becomes a pivot Group placed at its
 * centroid (so it can be translated for the exploded view and pulsed in scale
 * around its own centre) holding a mesh offset by -centroid.
 */
export async function loadAtlas(scene) {
  const base = import.meta.env.BASE_URL;
  const manifest = await fetch(`${base}meshes/manifest.json`).then((r) => r.json());
  const loader = new GLTFLoader();
  const materials = new Map(); // structure id -> material (per hemisphere: they can show different channels)
  const structures = [];

  await Promise.all(
    manifest.structures.map(async (meta) => {
      const gltf = await loader.loadAsync(`${base}meshes/${meta.id}.glb`);
      let geometry;
      gltf.scene.traverse((o) => {
        if (o.isMesh && !geometry) geometry = o.geometry;
      });
      geometry.computeVertexNormals();

      const material = meta.group === 'shell' ? makeShellMaterial(meta.color) : makeStructureMaterial(meta);
      materials.set(meta.id, material);
      const centroid = new THREE.Vector3(...meta.centroid);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(centroid).negate();
      mesh.renderOrder = renderOrderFor(meta.group);

      const pivot = new THREE.Group();
      pivot.position.copy(centroid);
      pivot.add(mesh);
      scene.add(pivot);

      const labelEl = document.createElement('div');
      labelEl.className = 'label3d';
      labelEl.style.setProperty('--c', meta.color);
      labelEl.textContent = meta.base; // the active window sets the short name
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
