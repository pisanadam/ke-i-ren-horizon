import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP, LANDMARKS } from './mapData.js';
import { softDotTexture } from '../textures.js';
import { makeRng, randRange, randPick } from '../util/math.js';
import { QUALITY } from '../quality.js';

/**
 * Everything that dresses the streets: pavement trees, lamp columns, signal
 * heads, bus shelters, bins, parked cars, overhead lines and pedestrians.
 */

function tinted(geo, colour) {
  const c = new THREE.Color(colour);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function mergeInto(group, geos, mat, name, cast = true, receive = true) {
  const valid = geos.filter(Boolean);
  if (!valid.length) return null;
  const merged = mergeGeometries(valid, false);
  valid.forEach((g) => g.dispose());
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
  return mesh;
}

/** Simple low-poly car used for the parked cars lining the streets. */
function parkedCarGeo(rng, colour) {
  const parts = [];
  const L = randRange(rng, 4.0, 4.8);
  const W = randRange(rng, 1.75, 1.95);
  const body = new THREE.BoxGeometry(W, 0.72, L);
  body.translate(0, 0.62, 0);
  parts.push(tinted(body, colour));

  const cabinL = L * randRange(rng, 0.44, 0.54);
  const cabin = new THREE.BoxGeometry(W * 0.88, 0.62, cabinL);
  cabin.translate(0, 1.28, randRange(rng, -0.35, 0.15));
  parts.push(tinted(cabin, colour));

  const glass = new THREE.BoxGeometry(W * 0.9, 0.42, cabinL * 0.96);
  glass.translate(0, 1.36, randRange(rng, -0.35, 0.15));
  parts.push(tinted(glass, 0x2b3a48));

  const wheelGeo = () => {
    const g = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 8);
    g.rotateZ(Math.PI / 2);
    return g;
  };
  const wx = W / 2 - 0.04;
  const wz = L * 0.32;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = wheelGeo();
    w.translate(sx * wx, 0.32, sz * wz);
    parts.push(tinted(w, 0x14161a));
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

export function buildProps(network, ground, colliders) {
  const rng = makeRng(515151);
  const group = new THREE.Group();
  group.name = 'props';

  const poleGeos = [];
  const furnitureGeos = [];
  const parkedGeos = [];
  const wirePoints = [];

  // Where each breakable thing sits inside its merged mesh. The merge keeps
  // the order it is given, so a running vertex count is all it takes to know
  // which slice belongs to which lamp post.
  const breakables = [];
  let poleVerts = 0;
  let parkedVerts = 0;
  const pushPole = (geo) => {
    poleGeos.push(geo);
    poleVerts += geo.attributes.position.count;
    return geo;
  };
  const pushParked = (geo) => {
    parkedGeos.push(geo);
    parkedVerts += geo.attributes.position.count;
    return geo;
  };

  // instanced buffers
  const trunks = [];
  const canopies = [];
  const lampHeads = [];
  const signalLenses = [];   // {x,y,z,rot,lightIndex,group,lens}

  const inLandmark = (x, z, scale = 1) =>
    LANDMARKS.some((l) => Math.hypot(x - l.x, z - l.z) < l.radius * scale);

  const CAR_COLOURS = [
    0xb8bcc2, 0x2b3138, 0xe8e8e6, 0x8d1f1f, 0x1f3f7a, 0x4b5a3c,
    0x9a7b3f, 0x6e6e73, 0x1b6b5a, 0xd8ccb4, 0x3a3a3a, 0xa03a2a
  ];

  // ------------------------------------------------------------ per-edge
  for (const edge of network.edges) {
    const hw = edge.width * 0.5;
    const walk = edge.major ? 4.0 : 3.0;
    const total = edge.length;
    if (total < 24) continue;
    const cum = edge.cum;

    const at = (s) => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / Math.max(1e-4, cum[i] - cum[i - 1]);
      const a = edge.path[i - 1];
      const b = edge.path[i];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        dx, dz, rx: dz, rz: -dx
      };
    };

    // ---- street lighting -------------------------------------------------
    const lampGap = edge.type === 'highway' ? 44 : edge.major ? 34 : 46;
    let side = 1;
    for (let s = 12; s < total - 10; s += lampGap) {
      const p = at(s);
      const off = hw + (edge.type === 'highway' ? 2.2 : 1.4);
      const x = p.x + p.rx * side * off;
      const z = p.z + p.rz * side * off;
      const y = p.y + 0.16;
      const h = edge.type === 'highway' ? 11 : edge.major ? 9 : 7.5;

      const start = poleVerts;
      const pole = new THREE.CylinderGeometry(0.11, 0.16, h, 6);
      pole.translate(x, y + h / 2, z);
      pushPole(tinted(pole, 0x545a60));

      // curved arm reaching over the carriageway
      const armLen = 2.6;
      const arm = new THREE.BoxGeometry(armLen, 0.14, 0.14);
      arm.translate(-armLen / 2, 0, 0);
      const m = new THREE.Matrix4()
        .makeTranslation(x, y + h, z)
        .multiply(new THREE.Matrix4().makeRotationY(Math.atan2(p.rx * side, p.rz * side)));
      arm.applyMatrix4(m);
      pushPole(tinted(arm, 0x545a60));

      const hx = x - p.rx * side * armLen * 0.9;
      const hz = z - p.rz * side * armLen * 0.9;
      lampHeads.push({
        x: hx, y: y + h - 0.15, z: hz,
        rot: Math.atan2(p.dx, p.dz),
        poolY: p.y + (edge.layer ?? 0.05) + 0.04,
        poolR: h * 0.85
      });

      breakables.push({
        kind: 'lamba', x, y, z, height: h,
        start, count: poleVerts - start,
        box: colliders.add(x, z, 0.2, 0.2, 0),
        lampIndex: lampHeads.length - 1,
        colour: 0x545a60, headColour: 0x22252a
      });
      side *= -1;
    }

    // ---- pavement trees --------------------------------------------------
    if (edge.type !== 'highway') {
      const gap = edge.major ? 17 : 24;
      for (let s = 8; s < total - 8; s += gap * randRange(rng, 0.75, 1.3)) {
        for (const sd of [-1, 1]) {
          if (rng() > (edge.major ? 0.72 : 0.42) * QUALITY.treeDensity) continue;
          const p = at(s);
          const off = hw + 0.4 + walk * randRange(rng, 0.35, 0.7);
          const x = p.x + p.rx * sd * off;
          const z = p.z + p.rz * sd * off;
          if (Math.abs(x) > MAP.half || Math.abs(z) > MAP.half) continue;
          if (inLandmark(x, z, 0.95)) continue;
          const scale = randRange(rng, 0.8, 1.35);
          trunks.push({ x, y: p.y + 0.16, z, s: scale, rot: rng() * Math.PI * 2 });
        }
      }
    }

    // ---- bus shelters ----------------------------------------------------
    if (edge.major && total > 120 && rng() < 0.55) {
      const s = randRange(rng, 30, total - 30);
      const p = at(s);
      const sd = rng() > 0.5 ? 1 : -1;
      const off = hw + 0.4 + walk * 0.55;
      const x = p.x + p.rx * sd * off;
      const z = p.z + p.rz * sd * off;
      const rot = Math.atan2(p.dx, p.dz);
      const m = new THREE.Matrix4()
        .makeTranslation(x, p.y + 0.16, z)
        .multiply(new THREE.Matrix4().makeRotationY(rot));

      const roof = new THREE.BoxGeometry(1.9, 0.12, 5.2);
      roof.translate(0, 2.5, 0);
      roof.applyMatrix4(m);
      furnitureGeos.push(tinted(roof, 0x39404a));

      const back = new THREE.BoxGeometry(0.1, 2.1, 5.2);
      back.translate(-sd * 0.85, 1.35, 0);
      back.applyMatrix4(m);
      furnitureGeos.push(tinted(back, 0x2f4a63));

      for (const zz of [-2.4, 2.4]) {
        const col = new THREE.BoxGeometry(0.12, 2.5, 0.12);
        col.translate(sd * 0.85, 1.25, zz);
        col.applyMatrix4(m);
        furnitureGeos.push(tinted(col, 0x39404a));
      }
      const bench = new THREE.BoxGeometry(0.45, 0.1, 3.4);
      bench.translate(-sd * 0.55, 0.5, 0);
      bench.applyMatrix4(m);
      furnitureGeos.push(tinted(bench, 0x7a5a3a));
      colliders.add(x, z, 1.1, 2.7, rot);
    }

    // ---- parked cars -----------------------------------------------------
    // Two wheels up on the kerb, the way half of Ankara parks. Keeping them
    // out of the running lane means traffic and the player never clip them.
    if (edge.type !== 'highway' && !edge.minor) {
      for (let s = 14; s < total - 14; s += randRange(rng, 6.5, 15)) {
        const sd = rng() > 0.5 ? 1 : -1;
        if (rng() > 0.55) continue;
        const p = at(s);
        const off = hw + 0.15;
        const x = p.x + p.rx * sd * off;
        const z = p.z + p.rz * sd * off;
        if (inLandmark(x, z, 0.9)) continue;
        if (colliders.resolveCircle(x, z, 2.0)) continue;
        const colour = randPick(rng, CAR_COLOURS);
        const geo = parkedCarGeo(rng, colour);
        const rot = Math.atan2(p.dx, p.dz) + (sd > 0 ? Math.PI : 0) + randRange(rng, -0.05, 0.05);
        geo.applyMatrix4(
          new THREE.Matrix4()
            .makeTranslation(x, p.y + 0.1, z)
            .multiply(new THREE.Matrix4().makeRotationY(rot))
        );
        const start = parkedVerts;
        pushParked(geo);
        breakables.push({
          kind: 'park', x, y: p.y + 0.1, z, height: 1.5, yaw: rot,
          start, count: parkedVerts - start,
          box: colliders.add(x, z, 1.0, 2.2, rot),
          colour
        });
      }
    }

    // ---- bins and benches ------------------------------------------------
    if (edge.type !== 'highway') {
      for (let s = 20; s < total - 20; s += randRange(rng, 55, 130)) {
        const p = at(s);
        const sd = rng() > 0.5 ? 1 : -1;
        const off = hw + 0.4 + walk * 0.5;
        const x = p.x + p.rx * sd * off;
        const z = p.z + p.rz * sd * off;
        if (rng() > 0.5) {
          const bin = new THREE.CylinderGeometry(0.34, 0.28, 0.9, 8);
          bin.translate(x, p.y + 0.6, z);
          furnitureGeos.push(tinted(bin, 0x2e6a4a));
        } else {
          const rot = Math.atan2(p.dx, p.dz);
          const m = new THREE.Matrix4()
            .makeTranslation(x, p.y + 0.16, z)
            .multiply(new THREE.Matrix4().makeRotationY(rot));
          const seat = new THREE.BoxGeometry(0.5, 0.09, 1.8);
          seat.translate(0, 0.46, 0);
          seat.applyMatrix4(m);
          furnitureGeos.push(tinted(seat, 0x8a6a42));
          const backr = new THREE.BoxGeometry(0.09, 0.5, 1.8);
          backr.translate(-0.22, 0.72, 0);
          backr.applyMatrix4(m);
          furnitureGeos.push(tinted(backr, 0x8a6a42));
        }
      }
    }

    // ---- overhead power lines on the back streets ------------------------
    if (edge.minor && total > 60) {
      const sd = rng() > 0.5 ? 1 : -1;
      let prev = null;
      for (let s = 10; s < total - 6; s += 42) {
        const p = at(s);
        const off = hw + 0.4 + walk * 0.8;
        const x = p.x + p.rx * sd * off;
        const z = p.z + p.rz * sd * off;
        const h = 8.4;
        const pole = new THREE.CylinderGeometry(0.13, 0.19, h, 6);
        pole.translate(x, p.y + h / 2, z);
        poleGeos.push(tinted(pole, 0x6b6257));
        const cross = new THREE.BoxGeometry(1.7, 0.1, 0.1);
        cross.translate(x, p.y + h - 0.5, z);
        cross.applyMatrix4(new THREE.Matrix4());
        poleGeos.push(tinted(cross, 0x6b6257));
        const top = new THREE.Vector3(x, p.y + h - 0.5, z);
        if (prev) {
          const sag = new THREE.Vector3().lerpVectors(prev, top, 0.5);
          sag.y -= 1.1;
          const curve = new THREE.QuadraticBezierCurve3(prev, sag, top);
          const pts = curve.getPoints(6);
          for (let i = 0; i < pts.length - 1; i++) {
            wirePoints.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
          }
        }
        prev = top;
      }
    }
  }

  // --------------------------------------------------------- traffic lights
  for (const light of network.lights) {
    const node = network.nodes[light.node];
    for (let gi = 0; gi < light.groups.length; gi++) {
      for (const edgeId of light.groups[gi]) {
        const e = network.edges[edgeId];
        const fromA = e.a === node.id;
        const p0 = fromA ? e.path[0] : e.path[e.path.length - 1];
        const p1 = fromA ? e.path[1] : e.path[e.path.length - 2];
        let dx = p1.x - p0.x;
        let dz = p1.z - p0.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        const rx = dz;
        const rz = -dx;
        const hw = e.width * 0.5;
        const d = e.width * 0.5 * 1.28 + 5.5;
        const x = node.x + dx * d + rx * (hw + 1.1);
        const z = node.z + dz * d + rz * (hw + 1.1);
        const y = node.y + 0.16;

        const H = 5.2;
        const start = poleVerts;
        const pole = new THREE.CylinderGeometry(0.1, 0.14, H, 6);
        pole.translate(x, y + H / 2, z);
        pushPole(tinted(pole, 0x3c4148));

        const armLen = Math.min(hw + 0.8, 6);
        const arm = new THREE.BoxGeometry(armLen, 0.12, 0.12);
        arm.translate(-armLen / 2, 0, 0);
        arm.applyMatrix4(
          new THREE.Matrix4()
            .makeTranslation(x, y + H, z)
            .multiply(new THREE.Matrix4().makeRotationY(Math.atan2(rx, rz)))
        );
        pushPole(tinted(arm, 0x3c4148));

        const hx = x - rx * armLen * 0.85;
        const hz = z - rz * armLen * 0.85;
        const hy = y + H - 0.45;

        const housing = new THREE.BoxGeometry(0.42, 1.25, 0.34);
        housing.translate(hx, hy, hz);
        housing.applyMatrix4(new THREE.Matrix4());
        pushPole(tinted(housing, 0x22262b));

        const lensFrom = signalLenses.length;
        for (let lens = 0; lens < 3; lens++) {
          signalLenses.push({
            x: hx - dx * 0.2,
            y: hy + 0.4 - lens * 0.4,
            z: hz - dz * 0.2,
            rot: Math.atan2(-dx, -dz),
            light,
            group: gi,
            lens
          });
        }
        breakables.push({
          kind: 'lamba', x, y, z, height: H,
          start, count: poleVerts - start,
          box: colliders.add(x, z, 0.2, 0.2, 0),
          lensFrom, lensCount: 3,
          colour: 0x3c4148, headColour: 0x22262b
        });
      }
    }
  }

  // ------------------------------------------------------- scattered trees
  // Scattered near the streets rather than over the whole map: Ankara covers
  // 90 km² here, and trees sprinkled uniformly over that would be invisible.
  const treeTarget = QUALITY.trees;
  const edges = network.edges;
  let tries = 0;
  while (trunks.length < treeTarget && tries < treeTarget * 8) {
    tries++;
    const edge = edges[Math.floor(rng() * edges.length)];
    if (!edge || edge.path.length < 2) continue;
    const p = edge.path[Math.floor(rng() * edge.path.length)];
    const spread = randRange(rng, 14, 120);
    const ang = rng() * Math.PI * 2;
    const x = p.x + Math.cos(ang) * spread;
    const z = p.z + Math.sin(ang) * spread;
    if (Math.abs(x) > MAP.half || Math.abs(z) > MAP.half) continue;

    const near = network.nearestRoad(x, z);
    if (near && near.dist < near.halfWidth + 6) continue;
    if (colliders.overlaps(x, z, 1.4, 1.4, 0, 0.5)) continue;
    const green = ground.isGreen(x, z);
    if (!green && rng() > 0.34) continue;
    trunks.push({
      x,
      y: ground.heightAt(x, z),
      z,
      s: randRange(rng, green ? 0.9 : 0.65, green ? 1.6 : 1.15),
      rot: rng() * Math.PI * 2
    });
  }

  for (const t of trunks) {
    canopies.push(t);
  }

  // --------------------------------------------------------------- meshes
  const poleMesh = mergeInto(
    group,
    poleGeos,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.25 }),
    'poles'
  );
  mergeInto(
    group,
    furnitureGeos,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    'furniture'
  );
  const parkedMesh = mergeInto(
    group,
    parkedGeos,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35 }),
    'parked-cars'
  );
  // the merged buffers get written to when something is knocked down
  for (const b of breakables) b.mesh = b.kind === 'park' ? parkedMesh : poleMesh;

  if (wirePoints.length) {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePoints, 3));
    const wires = new THREE.LineSegments(
      wg,
      new THREE.LineBasicMaterial({ color: 0x1c1e22, transparent: true, opacity: 0.75 })
    );
    wires.name = 'wires';
    group.add(wires);
  }

  // ---- trees (instanced) -------------------------------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 3.0, 6);
  trunkGeo.translate(0, 1.5, 0);
  const trunkMesh = new THREE.InstancedMesh(
    trunkGeo,
    new THREE.MeshStandardMaterial({ color: 0x5c4632, roughness: 0.95 }),
    trunks.length
  );
  const canopyGeo = new THREE.IcosahedronGeometry(2.15, 0);
  canopyGeo.scale(1, 1.18, 1);
  canopyGeo.translate(0, 4.1, 0);
  const canopyMesh = new THREE.InstancedMesh(
    canopyGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true }),
    canopies.length
  );

  const dummy = new THREE.Object3D();
  const leaf = new THREE.Color();
  const leafPalette = [0x4f7a37, 0x5f8a3c, 0x44682f, 0x6d8f45, 0x3d6b3a, 0x7a8f4a];
  trunks.forEach((t, i) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.rotation.set(0, t.rot, 0);
    dummy.scale.setScalar(t.s);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);
    dummy.scale.set(t.s * randRange(rng, 0.85, 1.2), t.s * randRange(rng, 0.85, 1.25), t.s * randRange(rng, 0.85, 1.2));
    dummy.updateMatrix();
    canopyMesh.setMatrixAt(i, dummy.matrix);
    leaf.setHex(randPick(rng, leafPalette));
    leaf.offsetHSL(0, randRange(rng, -0.06, 0.06), randRange(rng, -0.05, 0.05));
    canopyMesh.setColorAt(i, leaf);
    // A tree you can drive through is not a tree. Each one gets a trunk-sized
    // collider and goes on the breakable list, so hitting it at speed snaps it
    // instead of passing through as if it were a poster.
    breakables.push({
      kind: 'agac', x: t.x, y: t.y, z: t.z, height: 3.2 * t.s, scale: t.s,
      leaf: leaf.getHex(),
      instances: [{ mesh: trunkMesh, index: i }, { mesh: canopyMesh, index: i }],
      box: colliders.add(t.x, t.z, 0.34 * t.s, 0.34 * t.s, 0)
    });
  });
  trunkMesh.instanceMatrix.needsUpdate = true;
  canopyMesh.instanceMatrix.needsUpdate = true;
  if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
  trunkMesh.castShadow = true;
  canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;
  trunkMesh.name = 'tree-trunks';
  canopyMesh.name = 'tree-canopies';
  group.add(trunkMesh, canopyMesh);

  // ---- lamp heads (emissive, dimmed during the day) ----------------------
  const headGeo = new THREE.BoxGeometry(0.7, 0.16, 0.36);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x22252a,
    emissive: new THREE.Color(0xffd9a0),
    emissiveIntensity: 0,
    roughness: 0.5
  });
  const headMesh = new THREE.InstancedMesh(headGeo, headMat, Math.max(1, lampHeads.length));
  lampHeads.forEach((h, i) => {
    dummy.position.set(h.x, h.y, h.z);
    dummy.rotation.set(0, h.rot, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    headMesh.setMatrixAt(i, dummy.matrix);
  });
  headMesh.count = lampHeads.length;
  headMesh.instanceMatrix.needsUpdate = true;
  headMesh.name = 'lamp-heads';
  group.add(headMesh);

  // ---- pools of light on the tarmac beneath each lamp --------------------
  const poolGeo = new THREE.CircleGeometry(1, 14);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({
    map: softDotTexture(),
    color: 0xffd9a0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const poolMesh = new THREE.InstancedMesh(poolGeo, poolMat, Math.max(1, lampHeads.length));
  lampHeads.forEach((hd, i) => {
    dummy.position.set(hd.x, hd.poolY, hd.z);
    dummy.rotation.set(0, hd.rot, 0);
    dummy.scale.setScalar(hd.poolR);
    dummy.updateMatrix();
    poolMesh.setMatrixAt(i, dummy.matrix);
  });
  poolMesh.count = lampHeads.length;
  poolMesh.instanceMatrix.needsUpdate = true;
  poolMesh.renderOrder = 1;
  poolMesh.name = 'lamp-pools';
  group.add(poolMesh);

  // ---- signal lenses -----------------------------------------------------
  const lensGeo = new THREE.CircleGeometry(0.14, 10);
  const lensMat = new THREE.MeshBasicMaterial({ vertexColors: false, toneMapped: false });
  const lensMesh = new THREE.InstancedMesh(lensGeo, lensMat, Math.max(1, signalLenses.length));
  signalLenses.forEach((s, i) => {
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(0, s.rot, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    lensMesh.setMatrixAt(i, dummy.matrix);
    lensMesh.setColorAt(i, new THREE.Color(0x111111));
  });
  lensMesh.count = signalLenses.length;
  lensMesh.instanceMatrix.needsUpdate = true;
  lensMesh.name = 'signal-lenses';
  group.add(lensMesh);

  // ---- pedestrians -------------------------------------------------------
  const pedestrians = createPedestrians(network, rng);
  group.add(pedestrians.mesh);

  // The instanced bits that have to vanish along with their column. Trees
  // filled theirs in as they were placed, so this must add to the list rather
  // than replace it — clearing it left every felled tree still standing.
  for (const b of breakables) {
    if (!b.instances) b.instances = [];
    if (b.lampIndex !== undefined) {
      b.instances.push({ mesh: headMesh, index: b.lampIndex });
      b.instances.push({ mesh: poolMesh, index: b.lampIndex });
    }
    if (b.lensFrom !== undefined) {
      for (let i = 0; i < b.lensCount; i++) {
        b.instances.push({ mesh: lensMesh, index: b.lensFrom + i });
      }
    }
  }

  return {
    group,
    lampMaterial: headMat,
    lampPoolMaterial: poolMat,
    signalLenses,
    lensMesh,
    pedestrians,
    breakables,
    treeCount: trunks.length
  };
}

/** Walkers that shuffle along the pavements; purely cosmetic. */
const PED_RANGE = 260;      // how far from the car pedestrians are kept

function createPedestrians(network, rng) {
  const COUNT = QUALITY.pedestrians;
  const edges = network.edges.filter((e) => e.type !== 'highway' && e.length > 40);
  const people = [];

  const body = new THREE.CapsuleGeometry(0.22, 0.72, 4, 8);
  body.translate(0, 0.82, 0);
  const head = new THREE.SphereGeometry(0.15, 8, 6);
  head.translate(0, 1.48, 0);
  const geo = mergeGeometries([body, head], false);
  body.dispose();
  head.dispose();

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.castShadow = true;
  mesh.name = 'pedestrians';

  const palette = [0x33415c, 0x7d4b3a, 0x4a5d3a, 0x8a2f3a, 0x2d3a45, 0xb0a58c, 0x5c3f6b, 0x1f2933];
  const colour = new THREE.Color();

  for (let i = 0; i < COUNT; i++) {
    const edge = edges.length ? edges[Math.floor(rng() * edges.length)] : null;
    people.push({
      edge,
      s: rng() * (edge ? edge.length : 1),
      dir: rng() > 0.5 ? 1 : -1,
      side: rng() > 0.5 ? 1 : -1,
      speed: randRange(rng, 0.9, 1.6),
      phase: rng() * Math.PI * 2,
      check: rng() * 2
    });
    colour.setHex(palette[Math.floor(rng() * palette.length)]);
    mesh.setColorAt(i, colour);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const dummy = new THREE.Object3D();
  const probe = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };

  /**
   * Moves someone to a street near the car. Ankara covers ninety square
   * kilometres, so a fixed sprinkling of pedestrians would leave every
   * pavement in sight empty; instead the same handful follow the player.
   */
  const rehome = (p, at) => {
    for (let tries = 0; tries < 24; tries++) {
      const e = edges[Math.floor(rng() * edges.length)];
      if (!e) return;
      const mid = e.path[Math.floor(e.path.length / 2)];
      const d = Math.hypot(mid.x - at.x, mid.z - at.z);
      if (d > PED_RANGE) continue;
      p.edge = e;
      p.s = rng() * e.length;
      p.dir = rng() > 0.5 ? 1 : -1;
      p.side = rng() > 0.5 ? 1 : -1;
      return;
    }
  };

  function update(dt, time, at) {
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (at) {
        p.check -= dt;
        if (p.check <= 0) {
          p.check = 1.5 + rng();
          const mid = p.edge ? p.edge.path[Math.floor(p.edge.path.length / 2)] : null;
          if (!mid || Math.hypot(mid.x - at.x, mid.z - at.z) > PED_RANGE * 1.35) rehome(p, at);
        }
      }
      if (!p.edge) continue;
      p.s += p.speed * p.dir * dt;
      if (p.s > p.edge.length) {
        p.s = p.edge.length;
        p.dir = -1;
      } else if (p.s < 0) {
        p.s = 0;
        p.dir = 1;
      }
      network.pointAlong(p.edge, p.s, true, probe);
      const off = (p.edge.width * 0.5 + 0.4 + (p.edge.major ? 2.0 : 1.5)) * p.side;
      const rx = -probe.dz;
      const rz = probe.dx;
      const x = probe.x + rx * off;
      const z = probe.z + rz * off;
      const bob = Math.abs(Math.sin(time * p.speed * 3.4 + p.phase)) * 0.06;
      dummy.position.set(x, probe.y + 0.16 + bob, z);
      dummy.rotation.set(0, Math.atan2(probe.dx * p.dir, probe.dz * p.dir), 0);
      dummy.scale.set(1, 0.94 + bob * 0.6, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh, update };
}
