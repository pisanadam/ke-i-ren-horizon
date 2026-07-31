import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAMPS } from './mapData.js';

/**
 * The jump ramps, meshed at a much finer step than the terrain so the curve
 * of the take-off reads properly. The surface is sampled from the same
 * `rampRise` the physics uses, so what you see is exactly what you drive on.
 */
export function buildRamps(ground, colliders) {
  const group = new THREE.Group();
  group.name = 'ramps';
  const decks = [];
  const trims = [];

  for (const r of RAMPS) {
    const NU = 24;
    const NV = 8;
    const cos = Math.cos(r.yaw);
    const sin = Math.sin(r.yaw);
    const verts = [];
    const uvs = [];
    const idx = [];

    for (let i = 0; i <= NU; i++) {
      for (let j = 0; j <= NV; j++) {
        const u = i / NU;
        const v = (j / NV) * 2 - 1;
        // ramp frame -> world (matches rampAt's inverse rotation)
        const along = u * r.len;
        const across = v * (r.wide / 2);
        const x = r.x + across * cos + along * sin;
        const z = r.z - across * sin + along * cos;
        verts.push(x, ground.heightAt(x, z) + 0.03, z);
        uvs.push(v * 0.5 + 0.5, u * r.len / 6);
      }
    }
    for (let i = 0; i < NU; i++) {
      for (let j = 0; j < NV; j++) {
        const a = i * (NV + 1) + j;
        const b = a + NV + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const deck = new THREE.BufferGeometry();
    deck.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    deck.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    deck.setIndex(idx);
    deck.computeVertexNormals();
    decks.push(deck);

    // a skirt down each side so you cannot see under the take-off
    for (const side of [-1, 1]) {
      const sv = [];
      const si = [];
      const suv = [];
      for (let i = 0; i <= NU; i++) {
        const u = i / NU;
        const along = u * r.len;
        const across = side * (r.wide / 2);
        const x = r.x + across * cos + along * sin;
        const z = r.z - across * sin + along * cos;
        const top = ground.heightAt(x, z) + 0.03;
        const foot = ground.heightAt(x, z) - ground.rampRise(x, z) - 0.4;
        sv.push(x, top, z, x, foot, z);
        suv.push(0, along / 6, 1, along / 6);
      }
      for (let i = 0; i < NU; i++) {
        const a = i * 2;
        si.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      const skirt = new THREE.BufferGeometry();
      skirt.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
      skirt.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
      skirt.setIndex(si);
      skirt.computeVertexNormals();
      trims.push(skirt);
    }
  }

  const add = (geos, mat, name) => {
    const valid = geos.filter(Boolean);
    if (!valid.length) return;
    const merged = mergeGeometries(valid, false);
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    valid.forEach((g) => g.dispose());
  };

  add(decks, new THREE.MeshStandardMaterial({ color: 0x6f7377, roughness: 0.86 }), 'ramp-decks');
  add(trims, new THREE.MeshStandardMaterial({
    color: 0x4d5155, roughness: 0.9, side: THREE.DoubleSide
  }), 'ramp-sides');
  return group;
}
