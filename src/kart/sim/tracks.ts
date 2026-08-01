/**
 * The three circuits.
 *
 * Control points only — every derived quantity (arc length, banking, grid
 * slots, checkpoint gates, the road mesh) comes out of `buildTrack`. Nothing
 * here states a distance or an angle, because a hand-written one would be a
 * second opinion about the same corner.
 */

import type { TrackSpec } from "./track";

const SUNSET_COAST: TrackSpec = {
  id: "sunset-coast",
  name: "SUNSET COAST",
  nameJa: "夕暮れの海岸線",
  blurb: "海沿いの高速サーキット。長い右スイーパーの先に、減速を強いるヘアピン。",
  points: [
    { x: -10.1, y: 8.5, z: 174.4, width: 23.2 },
    { x: -49.9, y: 9.0, z: 150.9, width: 21.0 },
    { x: -80.9, y: 8.6, z: 126.3, width: 20.3 },
    { x: -109.7, y: 7.4, z: 105.7, width: 19.0 },
    { x: -138.3, y: 5.6, z: 84.5, width: 23.7 },
    { x: -160.0, y: 3.6, z: 57.4, width: 24.2 },
    { x: -168.1, y: 1.8, z: 25.3, width: 24.2 },
    { x: -164.5, y: 0.5, z: -6.9, width: 21.7 },
    { x: -156.3, y: 0.0, z: -37.2, width: 19.4 },
    { x: -146.7, y: 0.4, z: -67.7, width: 21.6 },
    { x: -132.0, y: 1.6, z: -98.8, width: 23.5 },
    { x: -108.2, y: 3.4, z: -127.7, width: 22.9 },
    { x: -75.6, y: 5.4, z: -151.9, width: 21.6 },
    { x: -35.8, y: 7.2, z: -171.6, width: 21.5 },
    { x: 10.7, y: 8.5, z: -184.2, width: 22.7 },
    { x: 60.3, y: 9.0, z: -182.6, width: 24.2 },
    { x: 102.7, y: 8.6, z: -160.4, width: 24.2 },
    { x: 126.3, y: 7.4, z: -121.7, width: 24.2 },
    { x: 130.3, y: 5.6, z: -79.7, width: 22.2 },
    { x: 127.2, y: 3.6, z: -45.6, width: 24.0 },
    { x: 130.2, y: 1.8, z: -19.6, width: 24.2 },
    { x: 141.6, y: 0.5, z: 5.9, width: 20.5 },
    { x: 153.1, y: 0.0, z: 36.5, width: 24.2 },
    { x: 156.3, y: 0.4, z: 72.2, width: 24.2 },
    { x: 147.3, y: 1.6, z: 110.3, width: 23.9 },
    { x: 124.5, y: 3.4, z: 146.8, width: 24.2 },
    { x: 86.9, y: 5.4, z: 174.7, width: 24.2 },
    { x: 38.5, y: 7.2, z: 184.9, width: 24.2 },
  ],
  itemBoxes: [
    { at: 0.11, offsets: [-0.62, -0.2, 0.2, 0.62] },
    { at: 0.33, offsets: [-0.55, 0, 0.55] },
    { at: 0.57, offsets: [-0.62, -0.2, 0.2, 0.62] },
    { at: 0.79, offsets: [-0.5, 0.5] },
  ],
  // Offsets run along `rightOf`, which changed sides when the heading frame
  // was corrected; they are negated here so the circuits play as authored.
  boostPads: [
    { at: 0.245, offset: 0.34 },
    { at: 0.47, offset: -0.36 },
    { at: 0.885, offset: 0 },
  ],
  ramps: [{ at: 0.315, offset: -0.3 }, { at: 0.69, offset: 0.28 }],
  theme: {
    skyLow: 0xffb887,
    skyHigh: 0x27508f,
    sunColor: 0xffd9a8,
    sunDir: [-0.55, 0.42, -0.72],
    sunIntensity: 3.1,
    ambient: 0.55,
    fog: 0xf6bd95,
    fogDensity: 0.0022,
    road: 0x3a3d45,
    roadEdge: 0xf2f4f6,
    rail: 0xe94f3d,
    ground: 0xd9b378,
    groundAccent: 0x1f7f83,
    props: "palm",
    bloom: 0.55,
    stars: 0.12,
    night: false,
  },
};

const NEON_CANYON: TrackSpec = {
  id: "neon-canyon",
  name: "NEON CANYON",
  nameJa: "ネオン峡谷",
  blurb: "夜の峡谷を縫うテクニカル。連続ヘアピンとトンネル内のブーストパッド。",
  points: [
    { x: 150.1, y: 9.7, z: 99.8, width: 22.9 },
    { x: 113.8, y: 13.0, z: 117.2, width: 17.8 },
    { x: 82.4, y: 14.0, z: 130.2, width: 18.5 },
    { x: 54.4, y: 12.3, z: 142.6, width: 23.0 },
    { x: 25.2, y: 8.6, z: 147.6, width: 23.0 },
    { x: -3.5, y: 4.3, z: 142.0, width: 19.2 },
    { x: -29.9, y: 1.0, z: 134.8, width: 23.0 },
    { x: -59.4, y: 0.0, z: 135.1, width: 18.1 },
    { x: -96.8, y: 1.7, z: 136.9, width: 23.0 },
    { x: -136.0, y: 5.4, z: 126.0, width: 23.0 },
    { x: -165.4, y: 9.7, z: 97.4, width: 23.0 },
    { x: -179.9, y: 13.0, z: 57.8, width: 22.2 },
    { x: -181.4, y: 14.0, z: 15.4, width: 22.3 },
    { x: -169.8, y: 12.3, z: -24.3, width: 23.0 },
    { x: -145.2, y: 8.6, z: -55.8, width: 22.7 },
    { x: -115.8, y: 4.3, z: -77.0, width: 19.0 },
    { x: -93.6, y: 1.0, z: -96.4, width: 23.0 },
    { x: -79.8, y: 0.0, z: -126.0, width: 17.6 },
    { x: -62.1, y: 1.7, z: -162.8, width: 23.0 },
    { x: -32.0, y: 5.4, z: -187.4, width: 23.0 },
    { x: 4.5, y: 9.7, z: -185.6, width: 23.0 },
    { x: 36.3, y: 13.0, z: -164.1, width: 20.3 },
    { x: 61.4, y: 14.0, z: -139.7, width: 19.1 },
    { x: 84.5, y: 12.3, z: -119.5, width: 17.5 },
    { x: 107.6, y: 8.6, z: -99.7, width: 19.6 },
    { x: 130.0, y: 4.3, z: -76.5, width: 18.3 },
    { x: 153.3, y: 1.0, z: -49.2, width: 18.8 },
    { x: 176.7, y: 0.0, z: -15.0, width: 21.9 },
    { x: 189.8, y: 1.7, z: 27.2, width: 23.0 },
    { x: 180.4, y: 5.4, z: 69.4, width: 23.0 },
  ],
  itemBoxes: [
    { at: 0.08, offsets: [-0.55, 0, 0.55] },
    { at: 0.29, offsets: [-0.6, -0.2, 0.2, 0.6] },
    { at: 0.52, offsets: [-0.5, 0.5] },
    { at: 0.71, offsets: [-0.6, -0.2, 0.2, 0.6] },
    { at: 0.9, offsets: [-0.55, 0, 0.55] },
  ],
  boostPads: [
    { at: 0.185, offset: -0.3 },
    { at: 0.44, offset: 0.32 },
    { at: 0.63, offset: -0.28 },
    { at: 0.955, offset: 0, width: 5 },
  ],
  ramps: [{ at: 0.27, offset: 0.3 }, { at: 0.77, offset: -0.3 }],
  theme: {
    skyLow: 0x39146b,
    skyHigh: 0x04030e,
    sunColor: 0xb07dff,
    sunDir: [0.35, 0.62, 0.55],
    sunIntensity: 1.35,
    ambient: 0.4,
    fog: 0x1b0f33,
    fogDensity: 0.0042,
    road: 0x1d1d27,
    roadEdge: 0x37f5ff,
    rail: 0xff2d8f,
    ground: 0x2b1a44,
    groundAccent: 0x7a2bd8,
    props: "neon",
    bloom: 1.15,
    stars: 0.9,
    night: true,
  },
};

const SKY_GARDEN: TrackSpec = {
  id: "sky-garden",
  name: "SKY GARDEN",
  nameJa: "空中庭園",
  blurb: "雲上の庭園を巡る立体レイアウト。大きな高低差と細い橋が続く。",
  points: [
    { x: -113.0, y: 21.0, z: 103.5, width: 22.1 },
    { x: -114.9, y: 14.3, z: 67.6, width: 19.3 },
    { x: -117.8, y: 5.4, z: 39.4, width: 22.5 },
    { x: -125.2, y: 0.2, z: 14.2, width: 19.7 },
    { x: -136.0, y: 2.2, z: -13.1, width: 18.2 },
    { x: -149.2, y: 10.0, z: -47.1, width: 20.9 },
    { x: -155.8, y: 18.4, z: -88.2, width: 22.8 },
    { x: -141.2, y: 22.0, z: -125.0, width: 22.8 },
    { x: -104.7, y: 18.3, z: -141.6, width: 22.8 },
    { x: -62.9, y: 9.7, z: -138.0, width: 20.2 },
    { x: -28.7, y: 2.0, z: -129.7, width: 20.9 },
    { x: -1.1, y: 0.3, z: -126.2, width: 20.4 },
    { x: 25.7, y: 5.6, z: -126.0, width: 18.7 },
    { x: 55.2, y: 14.5, z: -126.8, width: 18.4 },
    { x: 90.1, y: 21.1, z: -126.2, width: 22.2 },
    { x: 126.0, y: 21.0, z: -115.4, width: 22.8 },
    { x: 149.9, y: 14.3, z: -88.2, width: 22.8 },
    { x: 155.6, y: 5.4, z: -52.0, width: 21.7 },
    { x: 152.7, y: 0.2, z: -17.4, width: 18.7 },
    { x: 149.9, y: 2.2, z: 14.5, width: 20.7 },
    { x: 142.5, y: 10.0, z: 44.9, width: 22.8 },
    { x: 125.5, y: 18.4, z: 71.0, width: 22.0 },
    { x: 104.4, y: 22.0, z: 92.4, width: 18.6 },
    { x: 83.6, y: 18.3, z: 113.1, width: 19.7 },
    { x: 60.3, y: 9.7, z: 132.4, width: 22.8 },
    { x: 32.3, y: 2.0, z: 145.7, width: 20.7 },
    { x: 1.3, y: 0.3, z: 155.3, width: 18.3 },
    { x: -33.4, y: 5.6, z: 163.9, width: 22.1 },
    { x: -70.7, y: 14.5, z: 162.6, width: 22.8 },
    { x: -100.2, y: 21.1, z: 140.5, width: 22.8 },
  ],
  itemBoxes: [
    { at: 0.14, offsets: [-0.58, 0, 0.58] },
    { at: 0.36, offsets: [-0.62, -0.2, 0.2, 0.62] },
    { at: 0.6, offsets: [-0.5, 0.5] },
    { at: 0.83, offsets: [-0.6, -0.2, 0.2, 0.6] },
  ],
  boostPads: [
    { at: 0.22, offset: 0 },
    { at: 0.5, offset: 0.3 },
    { at: 0.735, offset: -0.32 },
  ],
  ramps: [
    { at: 0.115, offset: 0 },
    { at: 0.44, offset: -0.3 },
    { at: 0.655, offset: 0.3 },
  ],
  theme: {
    skyLow: 0xdff0ff,
    skyHigh: 0x3f86d6,
    sunColor: 0xfff3dd,
    sunDir: [0.48, 0.74, 0.24],
    sunIntensity: 3.4,
    ambient: 0.72,
    fog: 0xd5e9ff,
    fogDensity: 0.0026,
    road: 0x4c515c,
    roadEdge: 0xfff6e2,
    rail: 0xf0c04a,
    ground: 0x63b95a,
    groundAccent: 0xf2ead6,
    props: "topiary",
    bloom: 0.42,
    stars: 0,
    night: false,
  },
};

/**
 * A rounded rectangle 316 x 256 m. The shape is doing structural work, not
 * just aesthetic: opposite sides sit 256 m apart, so [T8] — which forbids two
 * stretches more than 120 m apart along the lap from coming within a road's
 * width of each other — is satisfied by the geometry rather than by luck. The
 * measured clearance is 70 m.
 *
 * Corners are nominally 50 m but the spline tightens them to 33; the ratio
 * against the 9 m half-width is 3.47, and it is 3.47 because the width is
 * EASED into the corner rather than switched. A step from 22 to 18 at the
 * corner entry undershoots below 18 on the way in, putting the narrowest road
 * exactly where the radius is smallest.
 *
 * The east side opens to 30 m: not a shortcut, a room. Two lines fit through
 * it, which is the whole idea — the plan considered a real branching route and
 * rejected it, because one arc length is the only progress authority the sim
 * has, and a second path would need a second one.
 */
const CITY_LOOP: TrackSpec = {
  id: "city-loop",
  name: "CENTRAL LOOP",
  nameJa: "都心環状",
  blurb: "青の時間の都心を一周する高速レイアウト。216mの直線と高架、幅30mの広場での駆け引き。",
  points: [
    { x: 108, y: 4.4, z: 128, width: 20 },
    { x: 77.1, y: 4.8, z: 128, width: 22 },
    { x: 46.3, y: 5.2, z: 128, width: 22 },
    { x: 15.4, y: 5.5, z: 128, width: 22 },
    { x: -15.4, y: 5.7, z: 128, width: 22 },
    { x: -46.3, y: 5.9, z: 128, width: 22 },
    { x: -77.1, y: 6, z: 128, width: 20 },
    { x: -108, y: 6, z: 128, width: 18 },
    { x: -119.1, y: 5.9, z: 126.7, width: 18 },
    { x: -129.7, y: 5.8, z: 123, width: 18 },
    { x: -139.2, y: 5.6, z: 117.1, width: 18 },
    { x: -147.1, y: 5.3, z: 109.2, width: 18 },
    { x: -153, y: 5, z: 99.7, width: 18 },
    { x: -156.7, y: 4.6, z: 89.1, width: 18 },
    { x: -158, y: 4.1, z: 78, width: 20 },
    { x: -158, y: 3.6, z: 55.7, width: 22 },
    { x: -158, y: 3, z: 33.4, width: 22 },
    { x: -158, y: 2.4, z: 11.1, width: 22 },
    { x: -158, y: 1.8, z: -11.1, width: 22 },
    { x: -158, y: 1.2, z: -33.4, width: 22 },
    { x: -158, y: 0.5, z: -55.7, width: 20 },
    { x: -158, y: -0.1, z: -78, width: 18 },
    { x: -156.7, y: -0.6, z: -89.1, width: 18 },
    { x: -153, y: -1, z: -99.7, width: 18 },
    { x: -147.1, y: -1.4, z: -109.2, width: 18 },
    { x: -139.2, y: -1.8, z: -117.1, width: 18 },
    { x: -129.7, y: -2.2, z: -123, width: 18 },
    { x: -119.1, y: -2.6, z: -126.7, width: 18 },
    { x: -108, y: -2.9, z: -128, width: 20 },
    { x: -77.1, y: -3.2, z: -128, width: 22 },
    { x: -46.3, y: -3.5, z: -128, width: 22 },
    { x: -15.4, y: -3.7, z: -128, width: 22 },
    { x: 15.4, y: -3.8, z: -128, width: 22 },
    { x: 46.3, y: -3.9, z: -128, width: 22 },
    { x: 77.1, y: -4, z: -128, width: 20 },
    { x: 108, y: -4, z: -128, width: 18 },
    { x: 119.1, y: -4, z: -126.7, width: 18 },
    { x: 129.7, y: -3.9, z: -123, width: 18 },
    { x: 139.2, y: -3.7, z: -117.1, width: 18 },
    { x: 147.1, y: -3.5, z: -109.2, width: 18 },
    { x: 153, y: -3.3, z: -99.7, width: 18 },
    { x: 156.7, y: -3, z: -89.1, width: 18 },
    { x: 158, y: -2.7, z: -78, width: 20 },
    { x: 158, y: -2.4, z: -55.7, width: 30 },
    { x: 158, y: -2, z: -33.4, width: 30 },
    { x: 158, y: -1.6, z: -11.1, width: 30 },
    { x: 158, y: -1.2, z: 11.1, width: 30 },
    { x: 158, y: -0.8, z: 33.4, width: 30 },
    { x: 158, y: -0.3, z: 55.7, width: 24 },
    { x: 158, y: 0.2, z: 78, width: 18 },
    { x: 156.7, y: 0.9, z: 89.1, width: 18 },
    { x: 153, y: 1.5, z: 99.7, width: 18 },
    { x: 147.1, y: 2.2, z: 109.2, width: 18 },
    { x: 139.2, y: 2.8, z: 117.1, width: 18 },
    { x: 129.7, y: 3.4, z: 123, width: 18 },
    { x: 119.1, y: 3.9, z: 126.7, width: 18 },
  ],
  itemBoxes: [
    { at: 0.08, offsets: [-0.6, -0.2, 0.2, 0.6] },
    { at: 0.34, offsets: [-0.55, 0, 0.55] },
    { at: 0.6, offsets: [-0.6, -0.2, 0.2, 0.6] },
    { at: 0.86, offsets: [-0.5, 0.5] },
  ],
  boostPads: [
    { at: 0.2, offset: 0 },
    { at: 0.47, offset: -0.3 },
    { at: 0.74, offset: 0.34 },
  ],
  theme: {
    skyLow: 0xf3a877,
    skyHigh: 0x1e3563,
    sunColor: 0xffd2ab,
    /*
     * Elevation 0.5, not 0.3. At dusk the sun is low by definition, but a
     * directional light that low puts the entire road in its own buildings'
     * shadow — the first shoot came back with black tarmac and a lit skyline,
     * which reads as night rather than as blue hour. High enough to reach the
     * road, low enough to throw the long shadows the cascades exist for.
     */
    sunDir: [0.62, 0.5, 0.72],
    sunIntensity: 3.2,
    // Cities bounce light. The ambient carries the near field here rather than
    // the sun, which is what makes the shadowed side of a block still readable.
    ambient: 1.05,
    fog: 0x3b4c72,
    // Denser than the coast: the far side of the loop is 250 m away and the
    // skyline behind it needs to sit back rather than crowd the road.
    fogDensity: 0.003,
    road: 0x474b59,
    roadEdge: 0xeef2f6,
    rail: 0x6a748a,
    ground: 0x2e3648,
    groundAccent: 0x59d7ff,
    props: "building",
    bloom: 0.72,
    stars: 0.3,
    // Headlights on. Not a night circuit, but the light is going and the grid
    // is the only thing on the road that can carry its own.
    night: true,
  },
};

export const TRACKS: readonly TrackSpec[] = [
  SUNSET_COAST,
  NEON_CANYON,
  SKY_GARDEN,
  CITY_LOOP,
];

export type TrackId = (typeof TRACKS)[number]["id"];

export const DEFAULT_TRACK_ID = SUNSET_COAST.id;

export function trackSpecById(id: string): TrackSpec {
  return TRACKS.find((track) => track.id === id) ?? SUNSET_COAST;
}
