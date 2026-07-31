import { clamp } from '../util/math.js';
import { MAP } from '../world/mapData.js';
import { drawFlag } from './minimap.js';

/**
 * Full-screen street map. Opens over the game, pans and zooms with mouse or
 * touch, and lets the player drop a destination marker that then shows up on
 * the minimap and as a heading arrow on the HUD.
 */
export class MapView {
  constructor(plan, game) {
    this.plan = plan;
    this.game = game;
    this.el = document.getElementById('mapview');
    this.canvas = document.getElementById('mapcanvas');
    this.ctx = this.canvas.getContext('2d');
    this.info = document.getElementById('map-info');

    this.zoom = 0.24;                 // pixels per metre
    this.centre = { x: 0, z: 0 };
    this.open = false;
    this._dpr = Math.min(2, window.devicePixelRatio || 1);
    this._pointers = new Map();
    this._moved = 0;
    this._pinchDist = 0;

    this._bindPointer();

    // route through the game so it also comes out of the frozen map state
    document.getElementById('map-close').addEventListener('click', () => this.game.closeMap());
    document.getElementById('map-clear').addEventListener('click', () => {
      this.game.setWaypoint(null);
      this.draw();
    });
    document.getElementById('map-centre').addEventListener('click', () => {
      this.centre.x = this.game.vehicle.position.x;
      this.centre.z = this.game.vehicle.position.z;
      this.draw();
    });
    window.addEventListener('resize', () => { if (this.open) this._resize(); });
  }

  _bindPointer() {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._moved = 0;
      if (this._pointers.size === 2) {
        const [a, b] = [...this._pointers.values()];
        this._pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });

    c.addEventListener('pointermove', (e) => {
      const prev = this._pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._pointers.size === 2) {
        const [a, b] = [...this._pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinchDist > 0) {
          this.zoom = clamp(this.zoom * (d / this._pinchDist), 0.06, 2.2);
        }
        this._pinchDist = d;
        this._moved += 20;
      } else {
        this.centre.x -= dx / this.zoom;
        this.centre.z -= dy / this.zoom;
        this._moved += Math.hypot(dx, dy);
      }
      this.draw();
    });

    const release = (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      const wasSingle = this._pointers.size === 1;
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinchDist = 0;
      // a tap that did not drag drops a destination marker
      if (wasSingle && this._moved < 8) {
        const rect = this.canvas.getBoundingClientRect();
        const p = this._screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        this.game.setWaypoint(p);
      }
      this.draw();
    };
    c.addEventListener('pointerup', release);
    c.addEventListener('pointercancel', release);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = clamp(this.zoom * (e.deltaY > 0 ? 0.88 : 1.14), 0.06, 2.2);
      this.draw();
    }, { passive: false });
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * this._dpr);
    this.canvas.height = Math.round(rect.height * this._dpr);
    this._w = rect.width;
    this._h = rect.height;
  }

  _screenToWorld(sx, sy) {
    return {
      x: this.centre.x + (sx - this._w / 2) / this.zoom,
      z: this.centre.z + (sy - this._h / 2) / this.zoom
    };
  }

  _worldToScreen(x, z) {
    return {
      x: this._w / 2 + (x - this.centre.x) * this.zoom,
      y: this._h / 2 + (z - this.centre.z) * this.zoom
    };
  }

  toggle() {
    this.open ? this.close() : this.show();
  }

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    this.centre.x = this.game.vehicle.position.x;
    this.centre.z = this.game.vehicle.position.z;
    this._resize();
    // open showing the whole district, whatever the screen size
    this.zoom = clamp(
      Math.min(this._w, this._h) / (MAP.half * 2 + 240), 0.06, 2.2
    );
    this.draw();
  }

  close() {
    this.open = false;
    this.el.classList.add('hidden');
    this._pointers.clear();
  }

  draw() {
    if (!this.open) return;
    const ctx = this.ctx;
    const W = this._w;
    const H = this._h;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1017';
    ctx.fillRect(0, 0, W, H);

    // baked plan
    const drawScale = this.zoom * (this.plan.world / this.plan.tile);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(drawScale, drawScale);
    const c = this.plan.toTile(this.centre.x, this.centre.z);
    ctx.translate(-c.x, -c.y);
    ctx.drawImage(this.plan.canvas, 0, 0);
    ctx.restore();

    // Labels are placed greedily and anything that would collide with one
    // already drawn is dropped, so a zoomed-out map stays readable.
    const taken = [];
    const fits = (x, y, w, h) => {
      for (const r of taken) {
        if (Math.abs(x - r.x) * 2 < w + r.w && Math.abs(y - r.y) * 2 < h + r.h) return false;
      }
      taken.push({ x, y, w, h });
      return true;
    };

    // landmarks first — they win the space
    ctx.textAlign = 'center';
    ctx.font = '700 11.5px Inter, system-ui, sans-serif';
    for (const l of this.plan.landmarks) {
      const p = this._worldToScreen(l.x, l.z);
      if (p.x < -80 || p.x > W + 80 || p.y < -50 || p.y > H + 50) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb347';
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
      const w = ctx.measureText(l.name).width + 10;
      if (fits(p.x, p.y - 12, w, 15)) {
        ctx.fillStyle = '#ffdcaa';
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 3;
        ctx.strokeText(l.name, p.x, p.y - 12);
        ctx.fillText(l.name, p.x, p.y - 12);
      }
    }

    // neighbourhood names fill whatever is left
    ctx.font = '600 10.5px Inter, system-ui, sans-serif';
    for (const zn of this.plan.zones) {
      const p = this._worldToScreen(zn.x, zn.z);
      if (p.x < -60 || p.x > W + 60 || p.y < -40 || p.y > H + 40) continue;
      const label = zn.name.toUpperCase();
      const w = ctx.measureText(label).width + 10;
      if (!fits(p.x, p.y, w, 14)) continue;
      ctx.fillStyle = 'rgba(176,196,222,0.8)';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeText(label, p.x, p.y);
      ctx.fillText(label, p.x, p.y);
    }

    // traffic
    ctx.fillStyle = 'rgba(127,212,255,0.85)';
    this.game.traffic.forEachActive((a) => {
      const p = this._worldToScreen(a.x, a.z);
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) return;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    });

    const v = this.game.vehicle;
    const wp = this.game.waypoint;

    // the suggested route, drawn along the actual streets
    const route = this.game.route;
    if (route && route.points.length > 1) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      route.points.forEach((q, i) => {
        const s = this._worldToScreen(q.x, q.z);
        i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
      });
      ctx.strokeStyle = 'rgba(6,26,14,0.85)';
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = '#5ce08a';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.restore();
    } else if (wp) {
      // no road route found — fall back to the straight line
      const a = this._worldToScreen(v.position.x, v.position.z);
      const b = this._worldToScreen(wp.x, wp.z);
      ctx.save();
      ctx.setLineDash([7, 6]);
      ctx.strokeStyle = 'rgba(92,224,138,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }
    if (wp) {
      const b = this._worldToScreen(wp.x, wp.z);
      drawFlag(ctx, b.x, b.y);
    }

    // the car
    const p = this._worldToScreen(v.position.x, v.position.z);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-v.yaw + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 9);
    ctx.lineTo(0, 5);
    ctx.lineTo(-7, 9);
    ctx.closePath();
    ctx.fillStyle = '#ff8a3d';
    ctx.strokeStyle = '#1b1005';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (this.info) {
      this.info.textContent = wp
        ? (route
          ? `Hedef: ${(route.length / 1000).toFixed(1)} km yol · ${route.legs.length} manevra`
          : `Hedef: ${Math.round(Math.hypot(wp.x - v.position.x, wp.z - v.position.z))} m — haritaya dokunarak taşı`)
        : 'Hedef koymak için haritaya dokun · sürükle = kaydır · çift parmak = yakınlaştır';
    }
  }
}
