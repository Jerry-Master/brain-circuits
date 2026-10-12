// Checks that the captions in src/brain/sequence.js match what the circuit
// actually produces. Run: node scripts/verify_model.mjs
import { Circuit, TRIAL, POP_KEYS, DT } from '../src/model/circuit.js';

const TRIALS = 6;
const WIN = {
  base: [0, TRIAL.cueOn],
  hyper: [TRIAL.cueOn, TRIAL.cueOn + 15],
  cue: [TRIAL.cueOn + 75, TRIAL.cueOff],
  post: [TRIAL.cueOff + 100, TRIAL.length],
};

function measure(setup) {
  const c = new Circuit();
  setup?.(c);
  c.run(TRIAL.length); // settle
  const acc = {};
  for (const w in WIN) acc[w] = Object.fromEntries(POP_KEYS.map((k) => [k, [0, 0]]));
  const n = {};
  const peak = { gpi: 0 };
  for (let i = 0; i < (TRIALS * TRIAL.length) / DT; i++) {
    c.step();
    for (const w in WIN) {
      if (c.t < WIN[w][0] || c.t >= WIN[w][1]) continue;
      n[w] = (n[w] || 0) + 1;
      for (const k of POP_KEYS) for (const ch of [0, 1]) acc[w][k][ch] += c.rate(k, ch);
      if (w === 'hyper') peak.gpi = Math.max(peak.gpi, c.rate('gpi', 0));
    }
  }
  for (const w in WIN) for (const k of POP_KEYS) acc[w][k] = acc[w][k].map((v) => v / n[w]);
  acc.peak = peak;
  return acc;
}

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${detail}`);
  if (!ok) fails++;
};
const f = (x) => x.toFixed(0);

const N = measure();
const b = N.base;
check('tonic GPi ~70 Hz', b.gpi[0] > 50 && b.gpi[0] < 90, f(b.gpi[0]));
check('tonic GPe ~60 Hz', b.gpe[0] > 40 && b.gpe[0] < 80, f(b.gpe[0]));
check('tonic STN ~20 Hz', b.stn[0] > 10 && b.stn[0] < 35, f(b.stn[0]));
check('MSNs silent at rest', b.d1[0] < 2 && b.d2[0] < 2, `${f(b.d1[0])}/${f(b.d2[0])}`);
check('hyperdirect: STN burst', N.hyper.stn[0] > 2 * b.stn[0], `${f(b.stn[0])} -> ${f(N.hyper.stn[0])}`);
check('hyperdirect: GPi early excitation', N.peak.gpi > b.gpi[0] + 15, `${f(b.gpi[0])} -> peak ${f(N.peak.gpi)}`);
check('direct: GPi-A pauses', N.cue.gpi[0] < 0.6 * b.gpi[0], f(N.cue.gpi[0]));
check('surround: GPi-B stays high', N.cue.gpi[1] > 0.9 * b.gpi[1], f(N.cue.gpi[1]));
check('selection: VLo-A > 2x VLo-B', N.cue.vl[0] > 2 * N.cue.vl[1], `${f(N.cue.vl[0])}/${f(N.cue.vl[1])}`);
check('offset: brake returns', N.post.gpi[0] > 0.8 * b.gpi[0], f(N.post.gpi[0]));

const sel = (r) => r.cue.vl[0] - r.cue.vl[1];
const D = measure((c) => c.setDopamine(0));
check('DA depleted: shallower GPi-A pause', D.cue.gpi[0] > 1.4 * N.cue.gpi[0], `${f(N.cue.gpi[0])} -> ${f(D.cue.gpi[0])}`);
check('DA depleted: less VLo-A release', D.cue.vl[0] < N.cue.vl[0], `${f(N.cue.vl[0])} -> ${f(D.cue.vl[0])} (A-B ${f(sel(N))} -> ${f(sel(D))})`);

const Ld = measure((c) => (c.lesion.direct = true));
check('direct lesion: GPi-A no pause', Ld.cue.gpi[0] > 0.8 * b.gpi[0], f(Ld.cue.gpi[0]));
const Lh = measure((c) => (c.lesion.hyperdirect = true));
check('hyperdirect lesion: no early GPi rise', Lh.peak.gpi < N.peak.gpi - 10, `peak ${f(N.peak.gpi)} -> ${f(Lh.peak.gpi)}`);
const Li = measure((c) => (c.lesion.indirect = true));
check('indirect lesion: weaker surround', Li.cue.gpi[1] < N.cue.gpi[1], `GPi-B ${f(N.cue.gpi[1])} -> ${f(Li.cue.gpi[1])}`);

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
