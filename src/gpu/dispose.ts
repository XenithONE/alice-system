import type { Object3D } from "three/webgpu";

/**
 * Give back everything a scene graph is holding.
 *
 * Geometries and textures are GPU allocations that the garbage collector
 * cannot see: dropping the last JavaScript reference to a Mesh frees the
 * JavaScript object and leaves its vertex buffer on the card. React
 * StrictMode mounts every effect twice in development, so a scene that
 * forgets this leaks a whole corridor on the first render of every reload —
 * which shows up not as an error but as the second boot being slower than the
 * first, forever.
 *
 * Imported from three/webgpu rather than three on purpose. The two entry
 * points share three.core.js, so Object3D is the same class either way — but
 * relying on that is how a module ends up holding a WebGL material and a
 * WebGPU renderer and finding out at run time.
 */
type Disposable = { dispose?: () => void };

export function disposeTree(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as unknown as {
      geometry?: Disposable;
      material?: Disposable | Disposable[];
    };
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
  });
  root.removeFromParent();
}

function disposeMaterial(material: Disposable): void {
  /* Textures are not reachable from the material's own dispose() — three
     leaves them alone deliberately, because two materials may share one map.
     The scene that made them has to say so. */
  for (const value of Object.values(material as Record<string, unknown>)) {
    if (value && typeof value === "object" && "isTexture" in value) {
      (value as Disposable).dispose?.();
    }
  }
  material.dispose?.();
}
