/**
 * SCRAP CROWN v2 — arena definitions.
 * Pure data. Hazards stay clear of each other and corner spawns (~±5.5, ±5.5).
 */
import type { ArenaDef } from "../sim/types";

/** Pit radius matches ARCHITECTURE diameter 2.2 m. */
const PIT_R = 1.1;
const SAW_R = 0.85;

export const ARENAS: readonly ArenaDef[] = [
  {
    id: "the-box",
    name: "The Box",
    nameJa: "ザ・ボックス",
    size: 16,
    wallHeight: 2.4,
    pit: null,
    // Two mid-lane saws on the Z axis; far from corner spawns at ±5.5
    saws: [
      { x: 0, z: 3.2, r: SAW_R },
      { x: 0, z: -3.2, r: SAW_R }
    ],
    // Floor jets offset on X so they do not sit under saws or spawns
    flameJets: [
      { x: 3.0, z: 0 },
      { x: -3.0, z: 0 }
    ]
  },
  {
    id: "the-pit",
    name: "The Pit",
    nameJa: "ザ・ピット",
    size: 16,
    wallHeight: 2.4,
    // Offset from center; clearance to ±5.5 spawns and to the three saws
    pit: { x: 2.2, z: -1.4, r: PIT_R },
    saws: [
      { x: -3.4, z: 3.0, r: SAW_R },
      { x: 3.6, z: 3.2, r: SAW_R },
      { x: -3.4, z: -3.4, r: SAW_R }
    ],
    flameJets: []
  },
  {
    id: "the-forge",
    name: "The Forge",
    nameJa: "ザ・フォージ",
    size: 16,
    wallHeight: 2.4,
    pit: null,
    // Single center saw; four flame jets make the floor a kill zone
    saws: [{ x: 0, z: 0, r: SAW_R }],
    flameJets: [
      { x: 2.8, z: 2.8 },
      { x: -2.8, z: 2.8 },
      { x: 2.8, z: -2.8 },
      { x: -2.8, z: -2.8 }
    ]
  }
];
