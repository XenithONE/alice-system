import { ARENAS } from "../parts/arenas";
import { buildCatalog } from "../parts/catalog";
import { validateBuild } from "./build";
import { createArenaSim, initPhysics } from "./world";
import {
  DEFAULT_ROOM_SETTINGS,
  type ArenaSim,
  type BotSpec,
  type Catalog
} from "./types";

export interface MechanismHarness {
  readonly sim: ArenaSim;
  readonly catalog: Catalog;
  readonly specs: readonly BotSpec[];
}

export async function createMechanismHarness(): Promise<MechanismHarness> {
  await initPhysics();
  const catalog = buildCatalog();
  const arena = ARENAS[0]!;
  const settings = { ...DEFAULT_ROOM_SETTINGS, arenaId: arena.id };
  const valid = catalog.presets.filter(
    (spec) =>
      spec.parts.some((placed) => {
        const part = catalog.byId.get(placed.partId);
        return part?.category === "weapon";
      }) && validateBuild(spec, catalog, settings).ok
  );
  if (valid.length === 0) throw new Error("no valid weapon preset available");
  const specs = Array.from({ length: 4 }, (_, index) => valid[index % valid.length]!);
  const sim = createArenaSim({
    seed: 505,
    specs,
    names: specs.map((spec) => spec.name),
    catalog,
    arena,
    settings
  });
  return { sim, catalog, specs };
}
