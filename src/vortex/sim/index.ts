import { aiActivation } from "./ai";
import { RING_ARENAS } from "./rings";
import type { CreateVortexSimOptions, VortexSim } from "./types";
import {
  createVortexSim as createInitializedVortexSim,
  initPhysics,
} from "./world";

/**
 * Public async constructor. Rapier's WASM module is initialized exactly once
 * before any world is created.
 */
export async function createVortexSim<TSource = unknown>(
  options: CreateVortexSimOptions<TSource>,
): Promise<VortexSim> {
  await initPhysics();
  return createInitializedVortexSim(options);
}

export { aiActivation, initPhysics, RING_ARENAS };
export {
  buildRingSurfaceMesh,
  ringArenaById,
  sampleRingHeight,
} from "./rings";
export {
  resolveCatalogBuild,
  resolvedBuildFromDerived,
} from "./catalogAdapter";
export * from "./types";
