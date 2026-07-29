import { MAP, LANDMARKS } from '../world/mapData.js';
import { clamp } from '../util/math.js';

const TILE = 1400;            // offscreen resolution for the baked street plan
const WORLD = MAP.half * 2 + 240;

/**
 * Street plan minimap. The static network is baked once into an offscreen
 * canvas; each frame only the visible window plus moving blips are drawn.
 */
export class MiniMap {
  constructor(network) {
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.network = network;
    this.zoom = 0.42;           // pixels per metre
    this.label = document.getElementById('map-label');
    this._bake();

    this.canvas.style.pointerEvents = 'auto';
    this.canvas.addEventListener('wheel', (e) => {
      this.zoom = clamp(this.zoom * (e.deltaY > 0 ? 0.88 : 1.14), 0.12, 1.6);
      e.preventDefault();
    }, { passive: false });
  }

  _worldToTile(x, z) {
    return {
      x: ((x + WORLD / 2) / WORLD) * TILE,
      y: ((z + WORLD / 2) / WORLD) * TILE
    };
  }

  _bake() {
    const c = document.createElement('canvas');
    c.width = TILE;
    c.height = TILE;
    const g = c.getContext('2d');

    g.fillStyle = '#10161f';
    g.fillRect(0, 0, TILE, TILE);

    // parkland patches
    g.fillStyle = 'rgba(60,110,64,0.5)';
    for (const l of LANDMARKS) {
      if (l.id !== 'botanik' && l.id !== 'stadyum') continue;
      const p = this._worldToTile(l.x, l.z);
      g.beginPath();
      g.arc(p.x, p.y, (l.radius / WORLD) * TILE, 0, Math.PI * 2);
      g.fill();
    }

    const scale = TILE / WORLD;
    const drawPass = (filter, width, colour) => {
      g.strokeStyle = colour;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const edge of this.network.edges) {
        if (!filter(edge)) continue;
        g.lineWidth = Math.max(1, edge.width * scale * width);
        g.beginPath();
        edge.path.forEach((pt, i) => {
          const p = this._worldToTile(pt.x, pt.z);
          i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y);
        });
        g.stroke();
      }
    };

    drawPass(() => true, 1.5, '#232b36');
    drawPass((e) => e.minor, 0.9, '#39424f');
    drawPass((e) => !e.minor && !e.major, 1.0, '#556274');
    drawPass((e) => e.major && e.type !== 'highway', 1.0, '#8b97a8');
    drawPass((e) => e.type === 'highway', 1.0, '#d9a441');

    this.tile = c;
  }

  draw(vehicle, traffic, districtName) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const px = vehicle.position.x;
    const pz = vehicle.position.z;
    const zoom = this.zoom;

    ctx.save();
    ctx.clearRect(0, 0, W, H);

    // circular mask
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#0b1017';
    ctx.fillRect(0, 0, W, H);

    // baked plan, centred on the car
    const tileScale = (WORLD / TILE) ;
    const drawScale = zoom * tileScale;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(drawScale, drawScale);
    const centre = this._worldToTile(px, pz);
    ctx.translate(-centre.x, -centre.y);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.tile, 0, 0);
    ctx.restore();

    const toScreen = (x, z) => ({
      x: W / 2 + (x - px) * zoom,
      y: H / 2 + (z - pz) * zoom
    });

    // landmarks
    ctx.font = '700 8.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const l of LANDMARKS) {
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
