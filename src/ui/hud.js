// Stage card: animated loop-ring diagram, rolling stage number, staggered text reveals, progress pips.

const SVG = 'http://www.w3.org/2000/svg';
const CX = 110;
const CY = 110;
const R = 78;

const GLU = '#ffb347';
const GABA = '#5cc8ff';
const DA = '#e17bd6';
const NE = '#9cff6e';

const pt = (deg, r = R) => [CX + r * Math.cos((deg * Math.PI) / 180), CY + r * Math.sin((deg * Math.PI) / 180)];
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};

function stagger(target, text, { unit = 'char', step = 18, cls = 'reveal' } = {}) {
  const pieces = unit === 'char' ? [...text] : text.split(/(\s+)/);
  target.className = `${target.className.replace(/\b(reveal|leaving)\b/g, '').trim()} ${cls}`.trim();
  target.style.setProperty('--step', `${step}ms`);
  target.replaceChildren(
    ...pieces.map((p, i) => {
      const s = document.createElement('span');
      s.textContent = p;
      s.style.setProperty('--i', i);
      return s;
    }),
  );
}

function swapText(target, text, opts) {
  if (!target.children.length) return stagger(target, text, opts);
  target.classList.remove('reveal');
  target.classList.add('leaving');
  clearTimeout(target._t);
  target._t = setTimeout(() => stagger(target, text, opts), 260);
}

export class Hud {
  constructor() {
    this.svg = document.getElementById('loop-ring');
    this.num = document.getElementById('stage-num');
    this.title = document.getElementById('stage-title');
    this.desc = document.getElementById('stage-desc');
    this.pips = document.getElementById('pips');
    this.lastIndex = -1;
  }

  /** switch to a window: its sequence, diagram ({nodes, arcs, clusters?}) and per-phase focus map */
  load(sequence, hud, focus) {
    this.sequence = sequence;
    this.def = hud;
    this.focus = focus;
    this.solo = null;
    this.buildRing();
    this.lastIndex = -1;
  }

  buildRing() {
    const svg = this.svg;
    const { nodes: NODES, arcs: ARCS, clusters = [] } = this.def;
    svg.replaceChildren();
    const defs = el('defs', {}, svg);
    for (const [name, color] of [['glu', GLU], ['gaba', GABA], ['da', DA], ['ne', NE]]) {
      const m = el('marker', { id: `arrow-${name}`, viewBox: '0 0 10 10', refX: 7, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0 1L9 5L0 9z', fill: color }, m);
    }
    for (const c of clusters) {
      const g = el('g', { class: 'cluster', style: `color:${c.color}` }, svg);
      el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 8 }, g);
      el('text', { x: c.x + 5, y: c.y + c.h - 5 }, g).textContent = c.label;
    }
    const ring = NODES.some((n) => n.angle != null);
    if (ring) el('circle', { cx: CX, cy: CY, r: R, fill: 'none', stroke: 'rgba(255,255,255,0.05)', 'stroke-dasharray': '1 4' }, svg);
    const xy = Object.fromEntries(NODES.map((n) => [n.id, n.xy ?? pt(n.angle)]));
    const pos = Object.fromEntries(NODES.map((n) => [n.id, n.angle]));
    this.arcs = {};
    for (const a of ARCS) {
      let d;
      if (a.chord) {
        // gentle curve between node centres, bowed off the centre label; trimmed to the node rims
        const [ax, ay] = xy[a.from];
        const [bx, by] = xy[a.to];
        const len = Math.hypot(bx - ax, by - ay);
        const qx = (ax + bx) / 2 + ((by - ay) / len) * a.chord;
        const qy = (ay + by) / 2 - ((bx - ax) / len) * a.chord;
        const trim = (x, y, d) => {
          const l = Math.hypot(qx - x, qy - y);
          return [x + ((qx - x) / l) * d, y + ((qy - y) / l) * d];
        };
        const [x1, y1] = trim(ax, ay, 9);
        const [x2, y2] = trim(bx, by, 10);
        d = `M${x1} ${y1} Q${qx} ${qy} ${x2} ${y2}`;
      } else {
        const [x1, y1] = pt(pos[a.from] + 11);
        const [x2, y2] = pt(pos[a.to] - 11);
        d = `M${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2}`;
      }
      const marker = a.color === GLU ? 'glu' : a.color === DA ? 'da' : a.color === NE ? 'ne' : 'gaba';
      const path = el('path', { d, class: 'arc', stroke: a.color, 'marker-end': `url(#arrow-${marker})` }, svg);
      if (a.dashed) path.setAttribute('stroke-dasharray', '2 3');
      this.arcs[a.id] = { ...a, path, len: path.getTotalLength() };
    }

    this.nodes = {};
    for (const n of NODES) {
      const g = el('g', { class: 'node', style: `color:${n.color}` }, svg);
      const [x, y] = xy[n.id];
      el('circle', { class: 'halo', cx: x, cy: y, r: 6 }, g);
      el('circle', { cx: x, cy: y, r: n.xy ? 4 : 5, stroke: n.color }, g);
      const [lx, ly] = n.xy ? [x, y + 15] : pt(n.angle, R + 19);
      el('text', { x: lx, y: ly + 3, 'text-anchor': 'middle' }, g).textContent = n.label;
      this.nodes[n.id] = g;
    }
    this.comet = el('circle', { r: 3.2, class: 'comet', fill: '#fff' }, svg);
  }

  /** rebuild pips + pathway visibility after the stage list changes */
  setStages(stages, pathwayOn) {
    this.pips.replaceChildren(
      ...stages.map((st, i) => {
        const b = document.createElement('button');
        b.title = st.title;
        b.appendChild(document.createElement('i'));
        b.addEventListener('click', () => this.sequence.goto(i));
        return b;
      }),
    );
    document.getElementById('stage-count').textContent = String(stages.length).padStart(2, '0');
    for (const a of Object.values(this.arcs)) a.path.classList.toggle('off', !!a.pathway && pathwayOn[a.pathway] === false);
    this.lastIndex = -1;
  }

  /** highlight one sub-network ({nodes, arcs}) instead of the phase focus; null restores it */
  setSolo(chip) {
    this.solo = chip;
    if (this.stage) this.highlight(this.stage);
  }

  highlight(stage) {
    const map = this.solo ?? this.focus[stage.key] ?? { nodes: [], arcs: [] };
    for (const [id, g] of Object.entries(this.nodes)) g.classList.toggle('on', map.nodes.includes(id));
    for (const [id, a] of Object.entries(this.arcs)) a.path.classList.toggle('on', map.arcs.includes(id));
    this.activeArcs = map.arcs.map((id) => this.arcs[id]).filter(Boolean);
  }

  showStage(stage, index) {
    this.stage = stage;
    this.highlight(stage);

    const title = stage.title.replace(/^\d+\s*·\s*/, '');
    if (index !== this.lastIndex) {
      swapText(this.num, String(index + 1).padStart(2, '0'), { step: 70 });
      this.num.classList.add('roll');
      swapText(this.title, title, { step: 16 });
      swapText(this.desc, stage.desc(this.sequence.opts), { unit: 'word', step: 22 });
    }
    this.lastIndex = index;
    [...this.pips.children].forEach((b, i) => {
      b.classList.toggle('done', i < index);
      b.firstChild.style.width = i < index ? '100%' : '0';
    });
  }

  update(progress, index) {
    const pip = this.pips.children[index];
    if (pip) pip.firstChild.style.width = `${(progress * 100).toFixed(1)}%`;

    // comet travels along the active arcs (in sequence) or rests on the active node
    if (this.activeArcs?.length) {
      const total = this.activeArcs.reduce((s, a) => s + a.len, 0);
      let d = Math.min(progress * 1.15, 1) * total;
      for (const a of this.activeArcs) {
        if (d <= a.len || a === this.activeArcs.at(-1)) {
          const p = a.path.getPointAtLength(Math.min(d, a.len));
          this.comet.setAttribute('cx', p.x);
          this.comet.setAttribute('cy', p.y);
          this.comet.setAttribute('fill', a.color);
          this.comet.style.color = a.color;
          break;
        }
        d -= a.len;
      }
      this.comet.style.opacity = 1;
    } else {
      this.comet.style.opacity = 0;
    }
  }
}
