/**
 * Turns a forgotten switch arm into a build error.
 *
 * TypeScript only enforces exhaustiveness on functions that return a value.
 * The two most important dispatchers in this game — `applyEffect` and
 * `applyPassiveEffect` in sim/world.ts — return void, and tsconfig does not set
 * `noImplicitReturns`, so a new effect kind could be added to the union,
 * adapted, authored into a skill, pass every content gate, ship, and simply
 * never happen. Nothing would report it; the skill would just be inert.
 *
 * Calling this in the `default` arm forces the compiler to prove the union is
 * covered: an unhandled member is not assignable to `never`.
 *
 * Lives here rather than in sim/ or render/ because both need it, and a helper
 * this small is exactly the kind of thing that otherwise gets written twice and
 * then diverges.
 */
export function assertNever(value: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(value)}`);
}
