/**
 * The content layer: characters, machines, abilities and the one function that
 * folds them into coefficients.
 *
 * Dependencies point one way. This directory may read `sim/balance.ts` for
 * constants; it must never import `sim/sim.ts`, and `sim/types.ts` refers to
 * characters and machines only as plain `string` ids. That keeps the catalog
 * loadable by the UI, the gates and the wire without dragging a simulation
 * behind it, and keeps the type layer acyclic.
 */

export {
  abilityById,
  CHARACTER_SKILLS,
  MACHINE_GIMMICKS,
  type AbilityCondition,
  type AbilityDef,
  type AbilityEffect,
  type TunableStat,
} from "./abilities";
export {
  CHARACTERS,
  REFERENCE_CHARACTER_ID,
  characterById,
  type CharacterDef,
  type DriverShape,
} from "./characters";
export {
  MACHINES,
  REFERENCE_MACHINE_ID,
  machineById,
  type MachineDef,
  type MachineShape,
  type UnlockRule,
} from "./machines";
export {
  CHARACTER_PHYSICS_KEYS,
  DISPLAY_STAT_KEYS,
  MACHINE_PHYSICS_KEYS,
  REFERENCE_TUNING,
  classTuningFor,
  combineTuning,
  type CharacterPhysicsKey,
  type DisplayStatKey,
  type DisplayStats,
  type KartTuning,
  type MachinePhysicsKey,
} from "./tuning";
