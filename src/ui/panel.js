import GUI from 'lil-gui';
import { GROUP_OPACITY } from '../brain/materials.js';

const SHORT_NAMES = {
  brain: 'Whole brain', m1: 'M1', pmc: 'Premotor', caudate: 'Caudate', putamen: 'Putamen',
  gpe: 'GPe', gpi: 'GPi', stn: 'STN', sn: 'S. nigra', thalamus: 'Thalamus', va: 'VA', vl: 'VLo',
};

/**
 * lil-gui control panel. `app` exposes: atlas, sequence, exploder, pathways,
 * bloom, setLabels(on), state {labels, tracts, autoRotate, zoom}.
 */
export function buildGui(app) {
  const gui = new GUI({ title: 'Controls', width: 250 });
  const { atlas, sequence, circuit, exploder, pathways } = app;

  const loop = gui.addFolder('Model').close();
  loop.add(sequence, 'speed', 0.25, 3, 0.05).name('playback speed');
  // pathways are intact when ticked; unticking lesions the projections in the network
  const intact = { direct: true, indirect: true, hyperdirect: true };
  for (const p of Object.keys(intact)) {
    loop.add(intact, p).name(`${p} pathway`).onChange((v) => {
      circuit.lesion[p] = !v;
      app.onStagesRebuilt();
    });
  }
  loop.add(circuit, 'dopamine', 0, 0.4, 0.01).name('dopamine λ').onChange(() => {
    circuit.setDopamine(circuit.dopamine);
    app.onStagesRebuilt();
  });
  loop.add(app.state, 'tracts').name('show tracts').onChange((v) => (pathways.group.visible = v));

  const view = gui.addFolder('View').close();
  view.add(exploder, 'target', 0, 1, 0.01).name('explode').listen();
  view.add(app.state, 'zoom', 0.3, 3, 0.01).name('zoom').listen().onChange((v) => app.setZoom(v));
  view.add(app.state, 'labels').name('labels').listen().onChange((v) => app.setLabels(v));
  view.add(app.state, 'autoRotate').name('rotate');
  view.add(app.bloom, 'strength', 0, 2.5, 0.05).name('glow');
  view.add(app.state, 'hemispheres', ['both', 'left', 'right']).name('hemisphere').onChange(() => app.applyVisibility());

  const op = gui.addFolder('Opacity').close();
  const opacity = { ...GROUP_OPACITY };
  const setGroupOpacity = (group, v) => {
    for (const s of atlas.structures) {
      if (s.meta.group !== group) continue;
      const m = s.mesh.material;
      if (m.uniforms) m.uniforms.uOpacity.value = v;
      else m.opacity = v;
    }
  };
  const OP_LABELS = {
    shell: 'brain', cortex: 'cortex', context: 'context',
    striatum: 'putamen', pallidum: 'pallidum', stn: 'STN', nigra: 'S. nigra', thalamus: 'VA·VLo',
  };
  for (const g of Object.keys(OP_LABELS)) {
    op.add(opacity, g, 0, 1, 0.01).name(OP_LABELS[g]).onChange((v) => setGroupOpacity(g, v));
  }

  const vis = gui.addFolder('Structures').close();
  for (const [base, name] of Object.entries(SHORT_NAMES)) {
    app.state.visible[base] = true;
    vis.add(app.state.visible, base).name(name).onChange(() => app.applyVisibility());
  }

  gui.close();
  return gui;
}
