import { clamp } from '../util/math.js';

/**
 * Corner minimap. Reads the baked street plan and overlays the car, traffic,
 * landmarks and whatever destination the player has marked on the big map.
 */
export class MiniMap {
  constructor(plan) {
    this.plan = plan;
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.zoom = 0.42;                 // pixels per metre
    this.label = document.getElementById('map-label');

    this.canvas.style.pointerEvents = 'auto';
    this.canvas.addEventListener('wheel', (e) => {
      this.zoom = clamp(this.zoom * (e.deltaY > 0 ? 0.88 : 1.14), 0.12, 1.6);
      e.preventDefault();
    }, { passive: false });
  }

  draw(vehicle, traffic, districtName, waypoint) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const px = vehicle.position.x;
    const pz = vehicle.position.z;
    const zoom = this.zoom;

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#0b1017';
    ctx.fillRect(0, 0, W, H);

    // baked plan, centred on the car
    const drawScale = zoom * (this.plan.world / this.plan.tile);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(drawScale, drawScale);
    const centre = this.plan.toTile(px, pz);
    ctx.translate(-centre.x, -centre.y);
    ctx.drawImage(this.plan.canvas, 0, 0);
    ctx.restore();

    const toScreen = (x, z) => ({
      x: W / 2 + (x - px) * zoom,
      y: H / 2 + (z - pz) * zoom
    });

    // landmarks
    ctx.font = '700 8.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const l of this.plan.landmarks) {
      const p = toScreen(l.x, l.z);
      if (p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb347';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (zoom > 0.3) {
        ctx.fillStyle = 'rgba(255,220,180,0.92)';
        ctx.fillText(l.name.split(' ')[0], p.x, p.y - 6);
      }
    }

    // traffic
    ctx.fillStyle = '#7fd4ff';
    traffic.forEachActive((a) => {
      const p = toScreen(a.x, a.z);
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) return;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    });

    // marked destination, clamped to the rim when it is off the map
    if (waypoint) {
      const p = toScreen(waypoint.x, waypoint.z);
      const R = W / 2 - 10;
      let dx = p.x - W / 2;
      let dy = p.y - H / 2;
      const d = Math.hypot(dx, dy);
      const off = d > R;
      if (off) { dx = (dx / d) * R; dy = (dy / d) * R; }
      drawFlag(ctx, W / 2 + dx, H / 2 + dy, off);
    }

    // player arrow
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-vehicle.yaw + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-5.5, 7);
    ctx.closePath();
    ctx.fillStyle = '#ff8a3d';
    ctx.strokeStyle = '#1b1005';
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    // frame + compass
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(140,180,255,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = '700 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200,220,255,0.6)';
    ctx.fillText('K', W / 2, 14);
    ctx.restore();

    if (districtName && this.label) {
      this.label.innerHTML = `${districtName} · <span>${Math.round(px)}, ${Math.round(pz)}</span>`;
    }
  }
}

export function drawFlag(ctx, x, y, hollow = false) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = hollow ? 'rgba(92,224,138,0.45)' : '#5ce08a';
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = '#0d2b18';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = '#0d2b18';
  ctx.fill();
  ctx.restore();
}
