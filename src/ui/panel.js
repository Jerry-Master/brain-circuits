import GUI from 'lil-gui';
import { GROUP_OPACITY } from '../brain/materials.js';

const SHORT_NAMES = {
  brain: 'Whole brain', m1: 'M1', pmc: 'Premotor', caudate: 'Caudate', putamen: 'Putamen',
  gpe: 'GPe', gpi: 'GPi', stn: 'STN', thalamus: 'Thalamus', va: 'VA', vl: 'VL',
};

/**
 * lil-gui control panel. `app` exposes: atlas, sequence, exploder, pathways,
 * bloom, setLabels(on), state {labels, tracts, autoRotate, zoom}.
 */
export function buildGui(app) {
  const gui = new GUI({ title: 'Controls', width: 250 });
  const { atlas, sequence, exploder, pathways } = app;

  const loop = gui.addFolder('Loop animation');
  loop.add(sequence, 'speed', 0.25, 3, 0.05).name('speed');
  loop.add(sequence.opts, 'direct').name('direct').onChange((v) => {
    pathways.setPathwayVisible('direct', v);
    sequence.rebuild();
    app.onStagesRebuilt();
  });
  loop.add(sequence.opts, 'indirect').name('indirect').onChange((v) => {
    pathways.setPathwayVisible('indirect', v);
    sequence.rebuild();
    app.onStagesRebuilt();
  });
  loop.add(app.state, 'tracts').name('tracts').onChange((v) => (pathways.group.visible = v));

  const view = gui.addFolder('View');
  view.add(exploder, 'target', 0, 1, 0.01).name('explode').listen();
  view.add(app.state, 'zoom', 0.3, 3, 0.01).name('zoom').listen().onChange((v) => app.setZoom(v));
  view.add(app.state, 'labels').name('labels').listen().onChange((v) => app.setLabels(v));
  view.add(app.state, 'autoRotate').name('rotate');
  view.add(app.bloom, 'strength', 0, 2.5, 0.05).name('glow');
  view.add(app.state, 'hemispheres', ['both', 'left', 'right']).name('hemisphere').onChange(() => app.applyVisibility());

  const op = gui.addFolder('Opacity');
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
    striatum: 'putamen', pallidum: 'pallidum', stn: 'STN', thalamus: 'VA·VL',
  };
  for (const g of Object.keys(OP_LABELS)) {
    op.add(opacity, g, 0, 1, 0.01).name(OP_LABELS[g]).onChange((v) => setGroupOpacity(g, v));
  }

  const vis = gui.addFolder('Structures').close();
  for (const [base, name] of Object.entries(SHORT_NAMES)) {
    app.state.visible[base] = true;
    vis.add(app.state.visible, base).name(name).onChange(() => app.applyVisibility());
  }

  if (window.innerWidth < 900) gui.close();
  return gui;
}
