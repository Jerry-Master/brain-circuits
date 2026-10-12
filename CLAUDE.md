# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (opens browser)
- `npm run build` / `npm run preview` — production build to `dist/` / serve it
- `npm run verify [motor|attention|executive]` — headless check (`scripts/verify_model.mjs`) that the phase captions in `src/windows/*.js` match what the spiking models produce. Run after changing model parameters or captions. Attention/executive thresholds are deliberately loose.
- `npm run meshes` — regenerate `public/meshes/*.glb` + `manifest.json` from the Allen Human Reference Atlas. Needs the Python venv at `.venv/` with `scripts/requirements.txt` (BrainGlobe downloads the atlas). Only needed when changing mesh generation; GLBs are committed.

No test suite or linter. `demo*.mp4` are untracked recordings, not source.

## Architecture

Three.js + Vite single-page visualiser with three windows (tabs, `#motor` / `#attention` / `#executive`, keys 1/2/3): the cortico-basal ganglia-thalamo-cortical motor loop, Posner's attention networks (lateralised ANT task), and the DLPFC-BG-MD working-memory gating loop with ACC. Vanilla ES modules, entry `src/main.js` (renderer, bloom, CSS2D labels, `setWindow`, render loop).

Key idea: **nothing is scripted downstream of the task stimuli.** Each window runs a real spiking simulation; everything visible reads from it.

- `src/model/engine.js` — `Network`: Izhikevich / MSN neurons, conductance AMPA/GABA/NMDA synapses, optional I_CAN bistability, per-projection delays, `focal|diffuse|cross` topology, seeded RNG. Subclasses override `inputs()`, `gain(proj)`, `newTrial()`, `afterStep()`.
- `src/model/circuit.js` (motor), `attention.js` (LC/NE alerting, SC-pulvinar-IPS/FEF orienting, TPJ, ACC-lPFC conflict; RT from a response attractor), `executive.js` (DLPFC stripes gated by caudate-GPi-MD, phasic SNc burst, ACC→STN).
- `src/windows/*.js` — one definition per window: phases + captions, structure → population map (with hemisphere → channel), resting rates, tracts, explode vectors, HUD diagram + per-phase focus, GUI controls, optional task inset. Add a window here and register it in `main.js`.
- `src/brain/sequence.js` — generic narration over a window's phases.
- `src/brain/` — atlas meshes (`loadAtlas.js`, per-structure materials), glow (`materials.js`), exploded view (`explode.js`), tract spike rendering (`pathways.js`).
- `src/neurons/` — single-cell views, motor window only (panel hidden elsewhere).
- `src/ui/` — lil-gui panel rebuilt per window (`panel.js`), HUD ring / cluster diagram (`hud.js`).
- `scripts/build_meshes.py` — marching-cubes meshes from the atlas annotation volume, split per hemisphere, RAS-like mm centred on brain centroid. FEF/DLPFC are MFG split by the premotor mask; LC is approximated (not in the atlas).
