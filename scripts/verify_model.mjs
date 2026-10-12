// Checks that the captions in src/brain/sequence.js match what the circuit
// actually produces. Run: node scripts/verify_model.mjs
import { Circuit, TRIAL, POP_KEYS, DT } from '../src/model/circuit.js';
import { Attention, TRIAL as AT } from '../src/model/attention.js';
import { Executive, TRIAL as ET } from '../src/model/executive.js';

const only = process.argv[2]; // motor | attention | executive

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

if (!only || only === 'motor') {
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

}

// ---------- attention (src/windows/attention.js captions); loose thresholds ----------
if (!only || only === 'attention') {
  const a = new Attention();
  let lcCue = 0, lcNone = 0, nc = 0, nn = 0;
  let tpjInv = 0, tpjVal = 0, ni = 0, nv = 0;
  a.run(AT.length);
  for (let i = 0; i < (64 * AT.length) / DT; i++) {
    a.step();
    const t = a.t, cue = a.trial.cue;
    if (t >= AT.cueOn + 60 && t < AT.cueOn + 200) {
      if (cue === 'none') { lcNone += a.meanRate('lc'); nn++; } else { lcCue += a.meanRate('lc'); nc++; }
    }
    if (t >= AT.targetOn + 60 && t < AT.targetOn + 250) {
      const r = a.rate('tpj', a.trial.loc);
      if (cue === 'invalid') { tpjInv += r; ni++; } else if (cue === 'valid') { tpjVal += r; nv++; }
    }
  }
  check('alert: LC burst on cue trials', lcCue / nc > lcNone / nn + 2, `${f(lcNone / nn)} -> ${f(lcCue / nc)}`);
  check('reorient: TPJ invalid > valid', tpjInv / ni > tpjVal / nv, `${f(tpjVal / nv)} / ${f(tpjInv / ni)}`);
  const m = (k, v) => {
    const r = a.history.filter((h) => h.correct && h[k] === v).map((h) => h.rt);
    return r.reduce((x, y) => x + y, 0) / r.length;
  };
  check('conflict: incongruent slower', m('flank', 'incongruent') > m('flank', 'congruent'), `${f(m('flank', 'congruent'))} / ${f(m('flank', 'incongruent'))}`);
  check('alerting: no cue slower than double', m('cue', 'none') > m('cue', 'double'), `${f(m('cue', 'none'))} / ${f(m('cue', 'double'))}`);
  check('orienting: double slower than valid', m('cue', 'double') > m('cue', 'valid'), `${f(m('cue', 'double'))} / ${f(m('cue', 'valid'))}`);
}

// ---------- executive (src/windows/executive.js captions) ----------
if (!only || only === 'executive') {
  const run = (setup) => {
    const e = new Executive();
    setup?.(e);
    const r = { base: [0, 0], hold: [0, 0], gpiBase: 0, gpiGate: 0 };
    let nb = 0, nh = 0, ng = 0;
    e.run(ET.length);
    for (let i = 0; i < (4 * ET.length) / DT; i++) {
      e.step();
      const A = e.cueStripe, B = e.distStripe;
      if (e.t >= 50 && e.t < ET.cueOn) { r.base[0] += e.meanRate('dlpfc'); r.gpiBase += e.meanRate('gpi'); nb++; }
      if (e.t >= ET.cueOn + 80 && e.t < ET.cueOff + 50) { r.gpiGate += e.rate('gpi', A); ng++; }
      if (e.t >= ET.distOff + 150 && e.t < ET.clearOn) { r.hold[0] += e.rate('dlpfc', A); r.hold[1] += e.rate('dlpfc', B); nh++; }
    }
    return { base: r.base[0] / nb, gpiBase: r.gpiBase / nb, gpiGate: r.gpiGate / ng, holdA: r.hold[0] / nh, holdB: r.hold[1] / nh };
  };
  const E = run();
  check('exec: tonic GPi, quiet DLPFC', E.gpiBase > 40 && E.base < 8, `GPi ${f(E.gpiBase)} DLPFC ${f(E.base)}`);
  check('exec: GPi pauses for relevant item', E.gpiGate < 0.6 * E.gpiBase, f(E.gpiGate));
  check('exec: item held through distractor', E.holdA > 3 * E.base + 10 && E.holdA > 3 * E.holdB, `A ${f(E.holdA)} B ${f(E.holdB)}`);
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
