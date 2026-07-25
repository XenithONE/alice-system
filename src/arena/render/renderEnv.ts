import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export function configureRenderer(
  renderer: THREE.WebGLRenderer,
  opts: { shadows: boolean; pixelRatio: number; exposure?: number }
): void {
  renderer.setPixelRatio(opts.pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1.03;
  renderer.shadowMap.enabled = opts.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

export function installStudioEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  intensity = 0.4
): { dispose(): void } {
  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const target = generator.fromScene(room);
  room.dispose();
  generator.dispose();
  scene.environment = target.texture;
  scene.environmentIntensity = intensity;

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (scene.environment === target.texture) scene.environment = null;
      target.dispose();
    }
  };
}
