// Scrolling multi-lane membrane-potential oscilloscope (2D canvas).

const SUBSTEPS_PER_SAMPLE = 5; // 0.5 ms per stored sample at 0.1 ms integration
const WINDOW_SAMPLES = 1400; // 700 ms of simulated time
const V_MIN = -90;
const V_MAX = 35;

export class Scope {
  constructor(canvas, traces) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.traces = traces; // [{label, color}]
    this.buf = traces.map(() => new Float32Array(WINDOW_SAMPLES).fill(-70));
    this.head = 0;
    this.sub = 0;
    this.spiked = traces.map(() => false);
    this.stageText = '';
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
  }

  /** one integration step's membrane potentials (spikes passed as +30) */
  sample(vm) {
    for (let i = 0; i < vm.length; i++) if (vm[i] >= 30) this.spiked[i] = true;
    if (++this.sub < SUBSTEPS_PER_SAMPLE) return;
    for (let i = 0; i < vm.length; i++) {
      // keep spike peaks that fell between stored samples, otherwise the latest value
      this.buf[i][this.head] = this.spiked[i] ? 30 : vm[i];
      this.spiked[i] = false;
    }
    this.head = (this.head + 1) % WINDOW_SAMPLES;
    this.sub = 0;
  }

  draw() {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const dpr = this.dpr ?? 1;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#060912';
    ctx.fillRect(0, 0, W, H);

    const n = this.traces.length;
    const lane = H / n;
    const left = 72 * dpr;
    const plotW = W - left - 8 * dpr;
    ctx.font = `${11 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';

    for (let i = 0; i < n; i++) {
      const y0 = i * lane;
      const yOf = (v) => y0 + lane * 0.92 - ((v - V_MIN) / (V_MAX - V_MIN)) * lane * 0.84;

      // lane separator + -70 mV reference
      ctx.strokeStyle = 'rgba(140,170,220,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y0 + lane);
      ctx.lineTo(W, y0 + lane);
      ctx.stroke();
      ctx.setLineDash([3 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(left, yOf(-70));
      ctx.lineTo(W, yOf(-70));
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = this.traces[i].color;
      ctx.fillText(this.traces[i].label, 8 * dpr, y0 + lane / 2);

      ctx.strokeStyle = this.traces[i].color;
      ctx.lineWidth = 1.3 * dpr;
      ctx.beginPath();
      const buf = this.buf[i];
      for (let k = 0; k < WINDOW_SAMPLES; k++) {
        const v = buf[(this.head + k) % WINDOW_SAMPLES];
        const x = left + (k / (WINDOW_SAMPLES - 1)) * plotW;
        if (k === 0) ctx.moveTo(x, yOf(v));
        else ctx.lineTo(x, yOf(v));
      }
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(200,210,230,0.55)';
    ctx.textAlign = 'right';
    ctx.fillText('Vm · 700 ms window · dashed −70 mV', W - 8 * dpr, 9 * dpr);
    ctx.textAlign = 'left';
  }
}
