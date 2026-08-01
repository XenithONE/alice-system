/**
 * CENTRAL LOOP's identity: a city that is bigger than the circuit.
 *
 * The loop is 316 m across and the buildings behind it are 250 m tall, so the
 * scale reads as "a race through a city" rather than "a race past some blocks".
 * Everything is placed off the track's own bounds, so a relayout carries the
 * skyline with it.
 *
 * Three landmarks and one instanced field, in that order of importance:
 *   - the viaduct, crossing the south-east at 14 m — the one legal use of the
 *     corridor gate's above-4.2 m allowance, and the biggest single sight
 *   - the canal and its bridge on the north-west, under the raised road
 *   - four billboards whose panels scroll, which is what makes the city read
 *     as switched-on rather than as a model of one
 *   - a skyscraper ring, instanced, thinning with `detail`
 *
 * Nothing here is a texture from disk: the billboard faces are painted on a
 * canvas through `context.texture`, so the budget gate builds the identical
 * graph in Node with blanks.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../../../lib/seed";
import { sampleAt, type Track } from "../../sim/track";
import { emissiveStrip, type SetPieceBundle, type SetPieceContext } from "./index";

interface Billboard {
  readonly material: THREE.MeshBasicMaterial;
  readonly speed: number;
}

export function buildCityLoop(
  track: Track,
  context: SetPieceContext,
): SetPieceBundle {
  const group = new THREE.Group();
  group.name = "setpiece:city-loop";
  const disposables: { dispose(): void }[] = [];
  const theme = track.spec.theme;
  const random = mulberry32(0xc17e ^ track.samples.length);

  const centerX = (track.bounds.minX + track.bounds.maxX) / 2;
  const centerZ = (track.bounds.minZ + track.bounds.maxZ) / 2;
  const groundY = track.bounds.minY - 1.5;
  const spanX = track.bounds.maxX - track.bounds.minX;
  const spanZ = track.bounds.maxZ - track.bounds.minZ;
  const outerRadius = Math.max(spanX, spanZ) * 0.5 + 120;

  // ── The skyscraper ring ───────────────────────────────────────────────────
  {
    const count = Math.max(14, Math.round(46 * context.detail));
    const towerGeometry = new THREE.BoxGeometry(1, 1, 1);
    const towerMaterial = new THREE.MeshStandardMaterial({
      color: 0x232a38,
      roughness: 0.74,
      metalness: 0.22,
    });
    const towers = new THREE.InstancedMesh(
      towerGeometry,
      towerMaterial,
      count,
    );
    const crownGeometry = new THREE.BoxGeometry(1, 1, 1);
    const crownMaterial = emissiveStrip(theme.groundAccent, 1.25);
    const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i += 1) {
      /*
       * A ring, jittered. A regular ring reads as a fence; a uniform random
       * scatter puts towers in the middle of the circuit. Angle from the index
       * plus a jitter under one slot keeps them outside and irregular.
       */
      const angle =
        (i / count) * Math.PI * 2 + (random() - 0.5) * ((Math.PI * 2) / count);
      const radius = outerRadius + random() * 260;
      const height = 60 + random() * 190;
      const wide = 22 + random() * 30;
      const deep = 22 + random() * 30;
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      dummy.position.set(x, groundY + height / 2, z);
      dummy.rotation.set(0, random() * Math.PI, 0);
      dummy.scale.set(wide, height, deep);
      dummy.updateMatrix();
      towers.setMatrixAt(i, dummy.matrix);
      // The lit band sits just under the parapet, matching the roadside props.
      dummy.scale.set(wide * 1.02, 2.4, deep * 1.02);
      dummy.position.set(x, groundY + height - 8, z);
      dummy.updateMatrix();
      crowns.setMatrixAt(i, dummy.matrix);
    }
    towers.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    towers.castShadow = context.shadows;
    towers.frustumCulled = false;
    crowns.frustumCulled = false;
    group.add(towers, crowns);
    disposables.push(
      { dispose: () => towerGeometry.dispose() },
      { dispose: () => towerMaterial.dispose() },
      { dispose: () => towers.dispose() },
      { dispose: () => crownGeometry.dispose() },
      { dispose: () => crownMaterial.dispose() },
      { dispose: () => crowns.dispose() },
    );
  }

  // ── The viaduct, crossing the south-east ─────────────────────────────────
  {
    /*
     * 14 m clear of the road. The corridor gate allows geometry above 4.2 m
     * precisely so a circuit can be crossed like this; nothing else in the
     * game uses that allowance, and this is the sight it was left open for.
     * The deck spans well past both shoulders so the piers land off-road.
     */
    const sample = sampleAt(track, track.length * 0.68);
    const deckY = sample.y + 14;
    const parts: THREE.BufferGeometry[] = [];
    const deck = new THREE.BoxGeometry(200, 2.6, 13);
    deck.translate(0, deckY, 0);
    parts.push(deck.toNonIndexed());
    const parapetLeft = new THREE.BoxGeometry(200, 1.5, 0.8);
    parapetLeft.translate(0, deckY + 2, 6.2);
    parts.push(parapetLeft.toNonIndexed());
    const parapetRight = new THREE.BoxGeometry(200, 1.5, 0.8);
    parapetRight.translate(0, deckY + 2, -6.2);
    parts.push(parapetRight.toNonIndexed());
    for (const offset of [-78, -26, 26, 78]) {
      const pier = new THREE.BoxGeometry(6, deckY - groundY, 8);
      pier.translate(offset, groundY + (deckY - groundY) / 2, 0);
      parts.push(pier.toNonIndexed());
    }
    const merged = mergeGeometries(parts)!;
    for (const part of parts) part.dispose();
    const material = new THREE.MeshStandardMaterial({
      color: 0x3d4452,
      roughness: 0.86,
      metalness: 0.1,
    });
    const viaduct = new THREE.Mesh(merged, material);
    viaduct.castShadow = context.shadows;
    viaduct.position.set(sample.x, 0, sample.z);
    // Across the road, not along it: the deck's long axis is the road's right.
    viaduct.rotation.y = Math.atan2(sample.rx, sample.rz) + Math.PI / 2;
    group.add(viaduct);
    disposables.push(
      { dispose: () => merged.dispose() },
      { dispose: () => material.dispose() },
    );
  }

  // ── The canal, under the raised north-west ───────────────────────────────
  {
    const sample = sampleAt(track, track.length * 0.14);
    const water = new THREE.PlaneGeometry(340, 44);
    water.rotateX(-Math.PI / 2);
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x16324f,
      roughness: 0.24,
      metalness: 0.5,
    });
    const canal = new THREE.Mesh(water, waterMaterial);
    canal.position.set(sample.x, groundY - 3.5, sample.z);
    canal.rotation.y = Math.atan2(sample.rx, sample.rz) + Math.PI / 2;
    canal.receiveShadow = context.shadows;
    group.add(canal);
    disposables.push(
      { dispose: () => water.dispose() },
      { dispose: () => waterMaterial.dispose() },
    );
  }

  // ── Billboards ───────────────────────────────────────────────────────────
  const billboards: Billboard[] = [];
  {
    const faces = Math.max(2, Math.round(4 * context.detail));
    for (let i = 0; i < faces; i += 1) {
      const at = 0.06 + (i / faces) * 0.92;
      const sample = sampleAt(track, track.length * at);
      const side = i % 2 === 0 ? 1 : -1;
      const lateral = side * (sample.half + 30);
      const texture = context.texture(256, (ctx, size) => {
        const hue = [0x59d7ff, 0xff5a8a, 0xffd23f, 0x7cf6a0][i % 4]!;
        ctx.fillStyle = "#0a0d14";
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = `#${hue.toString(16).padStart(6, "0")}`;
        for (let band = 0; band < 7; band += 1) {
          const h = 6 + ((band * 37) % 22);
          ctx.globalAlpha = 0.25 + ((band * 13) % 60) / 100;
          ctx.fillRect(12, 18 + band * 34, size - 24, h);
        }
        ctx.globalAlpha = 1;
      });
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      const panel = new THREE.PlaneGeometry(26, 13);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        toneMapped: false,
      });
      const board = new THREE.Mesh(panel, material);
      board.position.set(
        sample.x + sample.rx * lateral,
        sample.y + 15,
        sample.z + sample.rz * lateral,
      );
      // Facing the road: turn the panel's normal back along the offset.
      board.rotation.y = Math.atan2(-sample.rx * side, -sample.rz * side);
      group.add(board);

      const legGeometry = new THREE.BoxGeometry(1.2, 16, 1.2);
      const legMaterial = new THREE.MeshStandardMaterial({
        color: 0x2a303c,
        roughness: 0.8,
      });
      for (const legOffset of [-9, 9]) {
        const leg = new THREE.Mesh(legGeometry, legMaterial);
        leg.position.set(
          board.position.x + Math.cos(board.rotation.y) * legOffset,
          sample.y + 7,
          board.position.z - Math.sin(board.rotation.y) * legOffset,
        );
        leg.castShadow = context.shadows;
        group.add(leg);
      }
      billboards.push({ material, speed: 0.08 + (i % 3) * 0.05 });
      disposables.push(
        { dispose: () => panel.dispose() },
        { dispose: () => material.dispose() },
        { dispose: () => texture.dispose() },
        { dispose: () => legGeometry.dispose() },
        { dispose: () => legMaterial.dispose() },
      );
    }
  }

  return {
    group,
    update(elapsed) {
      for (const board of billboards) {
        // Scrolling the map rather than swapping textures: one uniform write
        // per board per frame, no allocation, and it reads as a video wall.
        if (board.material.map) {
          board.material.map.offset.y = (-elapsed * board.speed) % 1;
        }
      }
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
