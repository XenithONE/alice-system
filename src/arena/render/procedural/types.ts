import type * as THREE from "three";

export interface ProceduralDrive {
  readonly root: THREE.Group;
  applyPhase(phase: number): void;
}
