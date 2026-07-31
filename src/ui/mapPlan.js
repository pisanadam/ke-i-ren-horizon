import { MAP, LANDMARKS, ZONES, METRO_LINES } from '../world/mapData.js';

// Ankara spans nearly ten kilometres, so the plan needs the extra resolution
// to keep the side streets from turning into mush.
const TILE = 2600;                       // offscreen resolution of the baked plan
const WORLD = MAP.half * 2 + 240;        // world span the plan covers

/**
 * The street plan, drawn once into an offscreen canvas. Both the corner
 * minimap and the full-screen map read from it, so the network is only
 * rasterised a single time.
 */
export class MapPlan {
  constructor(network) {
    this.network = network;
    this.tile = TILE;
    this.world = WORLD;
    this.canvas = document.createElement('canvas');
    this.canvas.width = TILE;
    this.canvas.height = TILE;
    this._bake();
  }

  /** World metres → pixel inside the baked tile. */
  toTile(x, z) {
    return {
      x: ((x + WORLD / 2) / WORLD) * TILE,
      y: ((z + WORLD / 2) / WORLD) * TILE
    };
  }

  /** Pixel inside the baked tile → world metres. */
  toWorld(px, py) {
    return {
      x: (px / TILE) * WORLD - WORLD / 2,
      z: (py / TILE) * WORLD - WORLD / 2
    };
  }

  _bake() {
    const g = this.canvas.getContext('2d');
    const scale = TILE / WORLD;

    g.fillStyle = '#10161f';
    g.fillRect(0, 0, TILE, TILE);

    // the district itself, so the surrounding hills read as "off map"
    const a = this.toTile(-MAP.half, -MAP.half);
    const b = this.toTile(MAP.half, MAP.half);
    g.fillStyle = '#141c26';
    g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);

    // parkland
    g.fillStyle = 'rgba(60,110,64,0.5)';
    for (const l of LANDMARKS) {
      if (!l.green) continue;
      const p = this.toTile(l.x, l.z);
      g.beginPath();
      g.arc(p.x, p.y, l.radius * scale, 0, Math.PI * 2);
      g.fill();
    }

    const pass = (filter, widthMul, colour) => {
      g.strokeStyle = colour;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const edge of this.network.edges) {
        if (!filter(edge)) continue;
        g.lineWidth = Math.max(1, edge.width * scale * widthMul);
        g.beginPath();
        edge.path.forEach((pt, i) => {
          const p = this.toTile(pt.x, pt.z);
          i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y);
        });
        g.stroke();
      }
    };

    pass(() => true, 1.6, '#232b36');
    pass((e) => e.minor, 0.9, '#39424f');
    pass((e) => !e.minor && !e.major, 1.0, '#5b6878');
    pass((e) => e.major && e.type !== 'highway', 1.0, '#93a0b2');
    pass((e) => e.type === 'highway', 1.0, '#b98a3c');

    // metro on top of the streets, each line in its own colour with the
    // stations marked, so the network reads at a glance
    for (const line of METRO_LINES) {
      const hex = `#${line.colour.toString(16).padStart(6, '0')}`;
      g.strokeStyle = 'rgba(6,10,16,0.85)';
      g.lineWidth = 8;   // fixed tile pixels: a metro diagram reads as a diagram,
      g.lineJoin = 'round';              // not as another road width
      g.beginPath();
      line.stations.forEach((st, i) => {
        const p = this.toTile(st.x, st.z);
        i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y);
      });
      g.stroke();

      g.strokeStyle = hex;
      g.lineWidth = 4.6;
      g.stroke();

      g.fillStyle = '#f2f5f8';
      g.strokeStyle = hex;
      g.lineWidth = 1.8;
      for (const st of line.stations) {
        const p = this.toTile(st.x, st.z);
        g.beginPath();
        g.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }

    this.landmarks = LANDMARKS;
    this.zones = ZONES;
  }
}
