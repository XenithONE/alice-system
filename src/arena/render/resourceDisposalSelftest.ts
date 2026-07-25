import * as THREE from "three";
import { disposeTree } from "../builder/builderScene";
import { disposeObject } from "./arenaScene";

declare const process: { exitCode?: number };

function exercise(dispose: (root: THREE.Object3D) => void): {
  sharedDisposals: number;
  localDisposals: number;
} {
  const root = new THREE.Group();
  const shared = new THREE.BoxGeometry(1, 1, 1);
  const local = new THREE.BoxGeometry(1, 1, 1);
  shared.userData.scShared = true;
  let sharedDisposals = 0;
  let localDisposals = 0;
  shared.addEventListener("dispose", () => { sharedDisposals += 1; });
  local.addEventListener("dispose", () => { localDisposals += 1; });
  root.add(
    new THREE.Mesh(shared, new THREE.MeshBasicMaterial()),
    new THREE.Mesh(local, new THREE.MeshBasicMaterial())
  );
  dispose(root);
  return { sharedDisposals, localDisposals };
}

const arena = exercise(disposeObject);
const builder = exercise(disposeTree);
const ghostRoot = new THREE.Group();
const ghostGeometry = new THREE.BoxGeometry(1, 1, 1);
ghostGeometry.userData.scShared = true;
let ghostDisposals = 0;
ghostGeometry.addEventListener("dispose", () => { ghostDisposals += 1; });
ghostRoot.add(new THREE.Mesh(ghostGeometry, new THREE.MeshBasicMaterial()));
for (let index = 0; index < 125; index += 1) {
  disposeTree(ghostRoot);
  ghostRoot.add(new THREE.Mesh(ghostGeometry, new THREE.MeshBasicMaterial()));
}

const problems: string[] = [];
if (arena.sharedDisposals !== 0 || arena.localDisposals !== 1) problems.push(`arena disposal ${JSON.stringify(arena)}`);
if (builder.sharedDisposals !== 0 || builder.localDisposals !== 1) problems.push(`builder disposal ${JSON.stringify(builder)}`);
if (ghostDisposals !== 0) problems.push(`ghost pointermove disposed shared geometry ${ghostDisposals} times`);

console.log(JSON.stringify({
  arena,
  builder,
  ghostPointerMoves: 125,
  ghostSharedDisposals: ghostDisposals,
  problems
}, null, 2));
if (problems.length) process.exitCode = 1;
