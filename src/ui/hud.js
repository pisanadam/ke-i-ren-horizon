import { clamp, lerp } from '../util/math.js';

const TAU = Math.PI * 2;
const START = Math.PI * 0.75;   // needle sweep start (lower-left)
const SWEEP = Math.PI * 1.5;    // 270 degrees of dial

/** Analogue speedometer + rev ring drawn on a 2D canvas. */
export class Hud {
  constructor() {
    this.canvas = document.getElementById('gauge');
    this.ctx = this.canvas.getContext('2d');
    this.district = document.getElementById('district');
    this.clock = document.getElementById('clock');
    this.perf = document.getElementById('perf');
    this.gear = document.getElementById('gear');
    this.kmh = document.getElementById('kmh');
    this.coord = document.getElementById('coord');
    this.tips = document.getElementById('tips');
    this.toast = document.getElementById('toast');

    this._needle = 0;
    this._rev = 0;
    this._toastTimer = 0;
    this._dpr = Math.min(2, window.devicePixelRatio || 1);
    this._resize();
    window.addEventListener('resize', () => this._resize());

    this.tips.textContent =
      'C kamera · Boşluk el freni · H klakson · R düzelt · T saat · N ışınlan · M harita · G garaj';
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || 260;
    const h = rect.height || 260;
    this.canvas.width = Math.round(w * this._dpr);
    this.canvas.height = Math.round(h * this._dpr);
    this._w = w;
    this._h = h;
  }

  showToast(text, seconds = 2.4) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this._toastTimer = seconds;
  }

  setDistrict(name) {
    if (this.district.textContent !== name) this.district.textContent = name;
  }

  update(dt, vehicle, info) {
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.toast.classList.remove('show');
    }

    const speed = Math.abs(vehicle.speedKmh);
    this._needle = lerp(this._needle, speed, 1 - Math.exp(-12 * dt));
    this._rev = lerp(this._rev, vehicle.rpm, 1 - Math.exp(-14 * dt));

    this.gear.textContent = vehicle.gear === -1 ? 'R' : String(vehicle.gear);
    this.kmh.innerHTML = `${Math.round(speed)} <i>km/s</i>`;
    this.clock.textContent = info.clock;
    this.perf.textContent = `${info.fps} fps`;
    this.coord.textContent = `${Math.round(vehicle.position.x)}, ${Math.round(vehicle.position.z)}`;

    this._draw(vehicle, speed);
  }

  _draw(vehicle, speed) {
    const ctx = this.ctx;
    const dpr = this._dpr;
    const w = this._w;
    const h = this._h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 6;
    const maxKmh = Math.ceil((vehicle.spec.topSpeed * 3.6 * 1.12) / 20) * 20;

    // outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, R, START, START + SWEEP);
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(14, 20, 32, 0.72)';
    ctx.stroke();

    // rev ring
    const revT = clamp((this._rev - 800) / 6400, 0, 1);
    ctx.beginPath();
    ctx.arc(cx, cy, R, START, START + SWEEP * revT);
    ctx.lineWidth = 5;
    const revGrad = ctx.createLinearGradient(0, 0, w, h);
    revGrad.addColorStop(0, '#34d3ff');
    revGrad.addColorStop(0.65, '#ffb03d');
    revGrad.addColorStop(1, '#ff3d3d');
    ctx.strokeStyle = revGrad;
    ctx.stroke();

    // speed arc
    const spT = clamp(speed / maxKmh, 0, 1);
    ctx.beginPath();
    ctx.arc(cx, cy, R - 10, START, START + SWEEP * spT);
    ctx.lineWidth = 8;
    ctx.strokeStyle = spT > 0.88 ? '#ff5a4a' : '#ff8a3d';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';

    // ticks
    const majorEvery = maxKmh > 220 ? 40 : 20;
    ctx.font = `600 ${Math.round(R * 0.10)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= maxKmh; v += majorEvery / 2) {
      const t = v / maxKmh;
      const a = START + SWEEP * t;
      const major = v % majorEvery === 0;
      const r0 = R - (major ? 20 : 16);
      const r1 = R - 14;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineWidth = major ? 2.2 : 1;
      ctx.strokeStyle = major ? 'rgba(235,242,255,0.82)' : 'rgba(180,196,220,0.4)';
      ctx.stroke();
      if (major) {
        const rt = R - 32;
        ctx.fillStyle = 'rgba(200,214,235,0.75)';
        ctx.fillText(String(v), cx + Math.cos(a) * rt, cy + Math.sin(a) * rt);
      }
    }

    // needle
    const na = START + SWEEP * clamp(this._needle / maxKmh, 0, 1);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(na);
    ctx.beginPath();
    ctx.moveTo(-R * 0.10, 0);
    ctx.lineTo(R - 16, -2.2);
    ctx.lineTo(R - 16, 2.2);
    ctx.closePath();
    ctx.fillStyle = '#ff5a3d';
    ctx.shadowColor = 'rgba(255,90,61,0.7)';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, TAU);
    ctx.fillStyle = '#e9eef8';
    ctx.fill();

    // status pips
    const pipY = cy + R * 0.62;
    const pips = [
      { on: !vehicle.onRoad, colour: '#c9a227', label: 'TOPRAK' },
      { on: vehicle.slip > 0.35, colour: '#ff5a4a', label: 'KAYMA' }
    ];
    ctx.font = `700 ${Math.round(R * 0.085)}px Inter, system-ui, sans-serif`;
    pips.forEach((p, i) => {
      if (!p.on) return;
      const px = cx + (i === 0 ? -R * 0.34 : R * 0.34);
      ctx.fillStyle = p.colour;
      ctx.globalAlpha = 0.9;
      ctx.fillText(p.label, px, pipY);
      ctx.globalAlpha = 1;
    });
  }
}
