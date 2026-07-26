import * as THREE from "three";
import type { EntSnap } from "../net/protocol";
import { industrialMaterial } from "./industrialKit";

export const BOT_COLORS = [0xc73c32, 0x2878a9, 0x3a8b68, 0xd69a24] as const;

const shared = <T extends THREE.BufferGeometry>(geometry: T): T => {
  geometry.userData.scShared = true;
  return geometry;
};

const padGeometry = shared(new THREE.CylinderGeometry(0.28, 0.3, 0.024, 16));
const widePadGeometry = shared(new THREE.CylinderGeometry(0.5, 0.52, 0.02, 24));
const spikeGeometry = shared(new THREE.ConeGeometry(0.09, 0.18, 4));
const projectileGeometry = shared(new THREE.IcosahedronGeometry(0.16, 1));
const harpoonGeometry = shared(new THREE.ConeGeometry(0.09, 0.42, 8));
const mineCapGeometry = shared(new THREE.CylinderGeometry(0.13, 0.16, 0.07, 12));
const oilStripeGeometry = shared(new THREE.BoxGeometry(0.62, 0.012, 0.055));
const glueStripeGeometry = shared(new THREE.TorusGeometry(0.31, 0.025, 6, 20));
const netWireGeometry = shared(new THREE.WireframeGeometry(projectileGeometry));

export interface EntityVisual {
  readonly root: THREE.Group;
  readonly kind: number;
}

export function createEntityVisual(entity: EntSnap): EntityVisual {
  const kind = Math.floor(entity.k / 4);
  const owner = entity.k % 4;
  const root = new THREE.Group();
  root.name = kind < 4 ? "deployed-trap" : "projectile";
  const dark = industrialMaterial("steel", kind === 2 ? 0x171a18 : 0x343a3b);
  const ownerMaterial = industrialMaterial("steel", BOT_COLORS[owner as 0 | 1 | 2 | 3]);

  if (kind === 0) {
    const plate = new THREE.Mesh(padGeometry, dark);
    root.add(plate);
    for (let index = 0; index < 4; index += 1) {
      const spike = new THREE.Mesh(spikeGeometry, ownerMaterial);
      const angle = index * Math.PI / 2;
      spike.position.set(Math.cos(angle) * 0.13, 0.1, Math.sin(angle) * 0.13);
      root.add(spike);
    }
  } else if (kind === 1) {
    root.add(new THREE.Mesh(padGeometry, dark));
    const cap = new THREE.Mesh(
      mineCapGeometry,
      ownerMaterial
    );
    cap.position.y = 0.045;
    root.add(cap);
  } else if (kind === 2) {
    const slick = new THREE.Mesh(
      widePadGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x101713,
        metalness: 0.05,
        roughness: 0.18,
        transparent: true,
        opacity: 0.86
      })
    );
    root.add(slick);
    const stripe = new THREE.Mesh(
      oilStripeGeometry,
      ownerMaterial
    );
    stripe.position.y = 0.018;
    root.add(stripe);
  } else if (kind === 3) {
    root.add(new THREE.Mesh(widePadGeometry, industrialMaterial("polymer", 0x8a7b32)));
    const stripe = new THREE.Mesh(
      glueStripeGeometry,
      ownerMaterial
    );
    stripe.rotation.x = Math.PI / 2;
    stripe.position.y = 0.025;
    root.add(stripe);
  } else if (kind === 4) {
    root.add(new THREE.Mesh(projectileGeometry, ownerMaterial));
    const cage = new THREE.LineSegments(
      netWireGeometry,
      new THREE.LineBasicMaterial({ color: 0xdce2dc })
    );
    root.add(cage);
  } else {
    const dart = new THREE.Mesh(harpoonGeometry, ownerMaterial);
    dart.rotation.x = -Math.PI / 2;
    root.add(dart);
  }
  root.position.set(entity.x, entity.y, entity.z);
  root.rotation.y = entity.r;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = kind < 4;
    }
  });
  return { root, kind };
}
