import GUI from 'lil-gui';
import { GROUP_OPACITY } from '../brain/materials.js';

let gui = null;
const opacity = { ...GROUP_OPACITY };
const OP_LABELS = {
  shell: 'brain', cortex: 'cortex', context: 'context',
  striatum: 'striatum', pallidum: 'pallidum', stn: 'STN', nigra: 'S. nigra', thalamus: 'thalamic nuclei', brainstem: 'brainstem',
};

/**
 * lil-gui control panel, rebuilt for each window. `app` exposes: def (active
 * window), model, atlas, sequence, exploder, pathways, bloom, state, setLabels(on),
 * setZoom(z), setGroupOpacity(group, v), applyVisibility(), onStagesRebuilt().
 */
export function buildGui(app) {
  const wasOpen = gui ? !gui._closed : false;
  gui?.destroy();
  gui = new GUI({ title: 'Controls', width: 250 });
  const { def, sequence, exploder } = app;

  const loop = gui.addFolder('Model').close();
  loop.add(sequence, 'speed', 0.25, 3, 0.05).name('playback speed');
  def.gui(loop, app);
  loop.add(app.state, 'tracts').name('show tracts').onChange((v) => (app.pathways.group.visible = v));
  loop.add(app.state, 'focus').name('phase focus').listen();

  const view = gui.addFolder('View').close();
  view.add(exploder, 'target', 0, 1, 0.01).name('explode').listen();
  view.add(app.state, 'zoom', 0.3, 3, 0.01).name('zoom').listen().onChange((v) => app.setZoom(v));
  view.add(app.state, 'labels').name('labels').listen().onChange((v) => app.setLabels(v));
  view.add(app.state, 'autoRotate').name('rotate');
  view.add(app.bloom, 'strength', 0, 2.5, 0.05).name('glow');
  view.add(app.state, 'hemispheres', ['both', 'left', 'right']).name('hemisphere').onChange(() => app.applyVisibility());

  const op = gui.addFolder('Opacity').close();
  const groups = new Set(['shell', ...Object.keys(def.structures).map((b) => app.groupOf(b))]);
  for (const g of Object.keys(OP_LABELS)) {
    if (!groups.has(g)) continue;
    op.add(opacity, g, 0, 1, 0.01).name(OP_LABELS[g]).onChange((v) => app.setGroupOpacity(g, v));
  }

  const vis = gui.addFolder('Structures').close();
  app.state.visible.brain ??= true;
  vis.add(app.state.visible, 'brain').name('Whole brain').onChange(() => app.applyVisibility());
  for (const [base, s] of Object.entries(def.structures)) {
    app.state.visible[base] ??= true;
    vis.add(app.state.visible, base).name(s.name).onChange(() => app.applyVisibility());
  }

  if (wasOpen) gui.open();
  else gui.close();
  return gui;
}

export { opacity as groupOpacity };
