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

/**
 * A 1815 m pass with 44 m of relief: descending for the first 45 % of the lap,
 * flat for 25 %, climbing for the last 30 %.
 *
 * That split is deliberate and it is free. Gradient does not touch speed in
 * this sim — `pitch` only feeds the vertical follow — so a long descent costs
 * nothing in balance and buys seven tenths of a lap spent looking down at the
 * road you are about to be on. The climb at the end puts the far side of the
 * valley in shot from the low point.
 *
 * Two hairpins, narrowed to 15 m through the apex. They are 33.9 m at the
 * tightest, which is far more than [T6]'s ratio demands (4.52 against a
 * minimum of 2.5) — and they have to be, because the binding constraint here
 * is not the ratio at all. The verge mesh is lofted a fixed 20 m past the road
 * edge, so a corner tighter than `half + 20` folds its inside verge through
 * its own centre of curvature. At 23.5 m this course passed [T6] at 3.15 and
 * still produced one downward normal out of 3632. [T14] now states that floor
 * directly.
 *
 * Switchbacks proper are not here: two legs running parallel more than 120 m
 * apart along the lap is exactly the arrangement [T8] exists to forbid,
 * because the projection cannot tell which leg a kart is on. The pass reads as
 * a pass through the hairpins, the rock wall and the trees instead.
 *
 * The ramp at 0.29 sits on the descent, where `desiredVy` is already negative
 * and the launch is ADDED to it rather than replacing it (the v2 bug) — so it
 * throws further than the same ramp would on the flat.
 */
const ALPINE_PASS: TrackSpec = {
  id: "alpine-pass",
  name: "ALPINE PASS",
  nameJa: "高原峠",
  blurb: "標高差44mの峠道。長い下りとヘアピン2つ、下りの途中に飛ぶランプ。",
  points: [
    { x: -18.2, y: 44, z: 298.4, width: 22 },
    { x: -32.5, y: 43.9, z: 298.3, width: 22 },
    { x: -46.6, y: 43.7, z: 296, width: 22 },
    { x: -60.1, y: 43.3, z: 291.4, width: 22 },
    { x: -79.3, y: 42.8, z: 283.1, width: 22 },
    { x: -98.6, y: 42.2, z: 274.9, width: 22 },
    { x: -117.8, y: 41.4, z: 266.6, width: 22 },
    { x: -137.1, y: 40.6, z: 258.4, width: 22 },
    { x: -156.3, y: 39.6, z: 250.1, width: 22 },
    { x: -175.6, y: 38.6, z: 241.9, width: 22 },
    { x: -194.8, y: 37.4, z: 233.6, width: 22 },
    { x: -214.1, y: 36.2, z: 225.4, width: 22 },
    { x: -229.8, y: 34.9, z: 216.4, width: 22 },
    { x: -243.2, y: 33.5, z: 204.1, width: 22 },
    { x: -253.4, y: 32.1, z: 189.1, width: 22 },
    { x: -259.9, y: 30.6, z: 172.2, width: 22 },
    { x: -265.5, y: 29.1, z: 151.1, width: 21.7 },
    { x: -271.1, y: 27.5, z: 130, width: 21.3 },
    { x: -276.6, y: 26, z: 108.9, width: 21 },
    { x: -282.2, y: 24.4, z: 87.8, width: 20.7 },
    { x: -287.7, y: 22.8, z: 66.6, width: 20.3 },
    { x: -293.3, y: 21.2, z: 45.5, width: 20 },
    { x: -295.6, y: 19.5, z: 28.9, width: 20 },
    { x: -293.9, y: 18, z: 12.2, width: 20 },
    { x: -288.2, y: 16.4, z: -3.6, width: 20 },
    { x: -278, y: 14.8, z: -24.1, width: 19.3 },
    { x: -267.7, y: 13.3, z: -44.5, width: 18.6 },
    { x: -257.5, y: 11.8, z: -65, width: 17.9 },
    { x: -247.3, y: 10.4, z: -85.5, width: 17.1 },
    { x: -237, y: 9.1, z: -106, width: 16.4 },
    { x: -226.8, y: 7.8, z: -126.4, width: 15.7 },
    { x: -216.5, y: 6.5, z: -146.9, width: 15 },
    { x: -211.4, y: 5.4, z: -154.8, width: 15 },
    { x: -204.7, y: 4.3, z: -161.3, width: 15 },
    { x: -196.7, y: 3.4, z: -166.2, width: 15 },
    { x: -176.3, y: 2.5, z: -175.7, width: 16.2 },
    { x: -155.8, y: 1.8, z: -185.3, width: 17.3 },
    { x: -135.3, y: 1.1, z: -194.9, width: 18.5 },
    { x: -114.8, y: 0.7, z: -204.4, width: 19.7 },
    { x: -94.3, y: 0.3, z: -214, width: 20.8 },
    { x: -73.9, y: 0.1, z: -223.5, width: 22 },
    { x: -64.5, y: 0, z: -227.3, width: 22 },
    { x: -54.7, y: 0, z: -230, width: 22 },
    { x: -44.8, y: 0, z: -231.5, width: 22 },
    { x: -21.4, y: 0, z: -233.9, width: 21 },
    { x: 1.9, y: 0, z: -236.2, width: 20 },
    { x: 25.2, y: 0, z: -238.5, width: 19 },
    { x: 48.5, y: 0, z: -240.9, width: 18 },
    { x: 71.8, y: 0, z: -243.2, width: 17 },
    { x: 95.1, y: 0, z: -245.5, width: 16 },
    { x: 118.5, y: 0, z: -247.8, width: 15 },
    { x: 131.7, y: 0, z: -247.1, width: 15 },
    { x: 144, y: 0, z: -242.2, width: 15 },
    { x: 154.3, y: 0, z: -233.7, width: 15 },
    { x: 167.8, y: 0, z: -218.2, width: 15.9 },
    { x: 181.4, y: 0, z: -202.6, width: 16.8 },
    { x: 195, y: 0, z: -187.1, width: 17.6 },
    { x: 208.6, y: 0, z: -171.6, width: 18.5 },
    { x: 222.2, y: 0, z: -156, width: 19.4 },
    { x: 235.8, y: 0, z: -140.5, width: 20.3 },
    { x: 249.4, y: 0, z: -125, width: 21.1 },
    { x: 263, y: 0, z: -109.4, width: 22 },
    { x: 272.6, y: 0, z: -95.8, width: 22 },
    { x: 279.2, y: 0, z: -80.6, width: 22 },
    { x: 282.4, y: 0, z: -64.3, width: 22 },
    { x: 284.5, y: 0.3, z: -43.1, width: 22.3 },
    { x: 286.5, y: 0.9, z: -21.9, width: 22.6 },
    { x: 288.5, y: 1.8, z: -0.7, width: 22.9 },
    { x: 290.5, y: 2.9, z: 20.5, width: 23.1 },
    { x: 292.5, y: 4.3, z: 41.7, width: 23.4 },
    { x: 294.6, y: 5.9, z: 62.9, width: 23.7 },
    { x: 296.6, y: 7.8, z: 84.1, width: 24 },
    { x: 295.8, y: 9.7, z: 106.9, width: 24 },
    { x: 289.4, y: 11.8, z: 128.8, width: 24 },
    { x: 277.7, y: 14.1, z: 148.3, width: 24 },
    { x: 263.8, y: 16.4, z: 165.9, width: 24 },
    { x: 250, y: 18.7, z: 183.5, width: 24 },
    { x: 236.1, y: 21.2, z: 201, width: 24 },
    { x: 222.3, y: 23.6, z: 218.6, width: 24 },
    { x: 208.5, y: 26, z: 236.2, width: 24 },
    { x: 194.6, y: 28.3, z: 253.8, width: 24 },
    { x: 181.6, y: 30.6, z: 267.2, width: 24 },
    { x: 166.1, y: 32.8, z: 277.6, width: 24 },
    { x: 148.7, y: 34.9, z: 284.6, width: 24 },
    { x: 130.3, y: 36.8, z: 287.8, width: 24 },
    { x: 109.1, y: 38.6, z: 289.3, width: 23.7 },
    { x: 87.9, y: 40.1, z: 290.9, width: 23.4 },
    { x: 66.7, y: 41.4, z: 292.4, width: 23.1 },
    { x: 45.4, y: 42.5, z: 293.9, width: 22.9 },
    { x: 24.2, y: 43.3, z: 295.4, width: 22.6 },
    { x: 3, y: 43.8, z: 296.9, width: 22.3 },
  ],
  itemBoxes: [
    { at: 0.1, offsets: [-0.6, -0.2, 0.2, 0.6] },
    { at: 0.37, offsets: [-0.5, 0.5] },
    { at: 0.62, offsets: [-0.6, -0.2, 0.2, 0.6] },
    { at: 0.85, offsets: [-0.55, 0, 0.55] },
  ],
  boostPads: [
    { at: 0.22, offset: -0.3 },
    { at: 0.52, offset: 0 },
    { at: 0.8, offset: 0.32 },
  ],
  ramps: [{ at: 0.29, offset: 0 }],
  theme: {
    skyLow: 0xd6e6f2,
    skyHigh: 0x2f6fb0,
    sunColor: 0xfff2dc,
    sunDir: [-0.42, 0.68, 0.6],
    sunIntensity: 3.6,
    ambient: 0.9,
    fog: 0xc3d8e8,
    // Thin: the point of a pass is seeing the far side of the valley.
    fogDensity: 0.0016,
    road: 0x4a4d55,
    roadEdge: 0xf4f7fa,
    rail: 0xb8bcc4,
    ground: 0x3f5a34,
    groundAccent: 0x9fd8ff,
    props: "conifer",
    bloom: 0.42,
    stars: 0,
    night: false,
  },
};

/**
 * The first circuit that is not made of tarmac.
 *
 * A paved farm road across the top of a mesa, a cliff lip that drops the whole
 * 24 m in a fifth of a lap, then a basin floor of dirt and one gravel wash
 * before the climb back up. The drop needs no ramp: the sim launches a kart
 * when the ground stops falling as fast as it is, so a short steep face taken
 * at speed does it by itself.
 *
 * Surface budget, chosen against the limits rather than by eye:
 *   dirt   47% of the lap
 *   gravel 12% — 197 m, under the 220 m of continuous gravel that would drop a
 *          200cc kart below DRIFT_MIN_SPEED and strand [H2]'s mini-turbo floor
 *   asphalt 41% — the farm road, and the only place on the circuit with grip
 *          to spare. That is where the overtake is.
 *
 * Corners are 34.3 m at the tightest against a 30.5 m floor: [T14], not [T6],
 * is what sets that — the verge folds through its own centre before the
 * projection ever gets confused.
 */
const DUST_BASIN: TrackSpec = {
  id: "dust-basin",
  name: "DUST BASIN",
  nameJa: "土煙の窪地",
  blurb: "台地の農道から崖を飛び降り、ダートと砂利の窪地を回る。掴めるのは舗装区間だけ。",
  points: [
    { x: 13.4, y: 24, z: 249, width: 26 },
    { x: 4.5, y: 24, z: 249.2, width: 26 },
    { x: -4.3, y: 24, z: 248.4, width: 26 },
    { x: -13, y: 24, z: 246.6, width: 26 },
    { x: -33.9, y: 24, z: 241.1, width: 26 },
    { x: -54.9, y: 24, z: 235.6, width: 26 },
    { x: -75.8, y: 24, z: 230.1, width: 26 },
    { x: -96.7, y: 24, z: 224.6, width: 26 },
    { x: -117.6, y: 24, z: 219.1, width: 26 },
    { x: -138.5, y: 24, z: 213.6, width: 26 },
    { x: -159.4, y: 24, z: 208.1, width: 26 },
    { x: -177.6, y: 24, z: 200.4, width: 26 },
    { x: -192.9, y: 24, z: 187.9, width: 26 },
    { x: -204.2, y: 24, z: 171.7, width: 26 },
    { x: -213.5, y: 24, z: 152.9, width: 25.7 },
    { x: -222.9, y: 24, z: 134.1, width: 25.3 },
    { x: -232.3, y: 24, z: 115.4, width: 25 },
    { x: -241.7, y: 24, z: 96.6, width: 24.7 },
    { x: -251.1, y: 24, z: 77.8, width: 24.3 },
    { x: -260.5, y: 23.9, z: 59.1, width: 24 },
    { x: -265.1, y: 23.3, z: 46.3, width: 24 },
    { x: -266.8, y: 22.3, z: 32.7, width: 24 },
    { x: -265.4, y: 20.9, z: 19.2, width: 24 },
    { x: -260.8, y: 19.2, z: -1.2, width: 23.1 },
    { x: -256.3, y: 17.4, z: -21.7, width: 22.3 },
    { x: -251.8, y: 15.3, z: -42.1, width: 21.4 },
    { x: -247.2, y: 13.2, z: -62.5, width: 20.6 },
    { x: -242.7, y: 11, z: -83, width: 19.7 },
    { x: -238.1, y: 8.9, z: -103.4, width: 18.9 },
    { x: -233.6, y: 6.9, z: -123.9, width: 18 },
    { x: -230.1, y: 5, z: -133.7, width: 18 },
    { x: -224.2, y: 3.3, z: -142.4, width: 18 },
    { x: -216.4, y: 1.9, z: -149.4, width: 18 },
    { x: -198.7, y: 0.8, z: -161.6, width: 18.9 },
    { x: -180.9, y: 0.2, z: -173.7, width: 19.7 },
    { x: -163.2, y: 0, z: -185.9, width: 20.6 },
    { x: -145.5, y: 0, z: -198.1, width: 21.4 },
    { x: -127.7, y: 0, z: -210.3, width: 22.3 },
    { x: -110, y: 0, z: -222.5, width: 23.1 },
    { x: -92.3, y: 0, z: -234.7, width: 24 },
    { x: -77, y: 0, z: -242.9, width: 24 },
    { x: -60.3, y: 0, z: -247.6, width: 24 },
    { x: -43, y: 0, z: -248.6, width: 24 },
    { x: -20.9, y: 0, z: -247.5, width: 23.1 },
    { x: 1.2, y: 0, z: -246.4, width: 22.3 },
    { x: 23.3, y: 0, z: -245.3, width: 21.4 },
    { x: 45.4, y: 0, z: -244.2, width: 20.6 },
    { x: 67.6, y: 0, z: -243.1, width: 19.7 },
    { x: 89.7, y: 0, z: -242, width: 18.9 },
    { x: 111.8, y: 0, z: -240.9, width: 18 },
    { x: 123, y: 0, z: -238.8, width: 18 },
    { x: 133.3, y: 0, z: -233.7, width: 18 },
    { x: 141.8, y: 0, z: -226, width: 18 },
    { x: 156.7, y: 0, z: -208.3, width: 18.9 },
    { x: 171.7, y: 0, z: -190.6, width: 19.7 },
    { x: 186.6, y: 0, z: -172.9, width: 20.6 },
    { x: 201.6, y: 0, z: -155.2, width: 21.4 },
    { x: 216.5, y: 0, z: -137.4, width: 22.3 },
    { x: 231.5, y: 0.2, z: -119.7, width: 23.1 },
    { x: 246.5, y: 0.6, z: -102, width: 24 },
    { x: 256.3, y: 1.2, z: -86.7, width: 24 },
    { x: 261.8, y: 1.9, z: -69.4, width: 24 },
    { x: 262.7, y: 2.7, z: -51.3, width: 24 },
    { x: 261, y: 3.7, z: -29, width: 24.3 },
    { x: 259.2, y: 4.7, z: -6.8, width: 24.7 },
    { x: 257.5, y: 5.9, z: 15.5, width: 25 },
    { x: 255.7, y: 7.1, z: 37.8, width: 25.3 },
    { x: 253.9, y: 8.4, z: 60.1, width: 25.7 },
    { x: 252.2, y: 9.7, z: 82.4, width: 26 },
    { x: 248.8, y: 11, z: 99.8, width: 26 },
    { x: 241.7, y: 12.4, z: 116.1, width: 26 },
    { x: 231.2, y: 13.7, z: 130.4, width: 26 },
    { x: 215.2, y: 15.1, z: 147.7, width: 26 },
    { x: 199.3, y: 16.4, z: 165, width: 26 },
    { x: 183.3, y: 17.6, z: 182.3, width: 26 },
    { x: 167.3, y: 18.8, z: 199.6, width: 26 },
    { x: 151.3, y: 19.9, z: 216.9, width: 26 },
    { x: 136.1, y: 20.9, z: 229.7, width: 26 },
    { x: 118.2, y: 21.8, z: 238.4, width: 26 },
    { x: 98.7, y: 22.5, z: 242.4, width: 26 },
    { x: 77.4, y: 23.2, z: 244, width: 26 },
    { x: 56.1, y: 23.6, z: 245.7, width: 26 },
    { x: 34.8, y: 23.9, z: 247.3, width: 26 },
  ],
  surfaceZones: [
    { from: 0.26, to: 0.62, kind: "dirt" },
    { from: 0.66, to: 0.78, kind: "gravel" },
    { from: 0.82, to: 0.93, kind: "dirt" },
  ],
  itemBoxes: [
    { at: 0.12, offsets: [-0.6, -0.2, 0.2, 0.6] },
    { at: 0.45, offsets: [-0.5, 0.5] },
    { at: 0.64, offsets: [-0.6, -0.2, 0.2, 0.6] },
    { at: 0.88, offsets: [-0.55, 0, 0.55] },
  ],
  boostPads: [
    { at: 0.15, offset: 0 },
    { at: 0.5, offset: -0.32 },
    { at: 0.86, offset: 0.3 },
  ],
  theme: {
    skyLow: 0xf6d9a8,
    skyHigh: 0x4f86c6,
    sunColor: 0xffe6c0,
    sunDir: [0.5, 0.72, -0.48],
    sunIntensity: 3.9,
    ambient: 0.85,
    fog: 0xe3c69a,
    fogDensity: 0.0021,
    road: 0x50504e,
    // The dirt and gravel stretches sample this instead; see SURFACE_BLEND.
    looseRoad: 0x9a6f45,
    roadEdge: 0xf0e6d2,
    rail: 0xa8815a,
    ground: 0xb98d5c,
    groundAccent: 0xe0a15a,
    props: "boulder",
    bloom: 0.5,
    stars: 0,
    night: false,
  },
};

export const TRACKS: readonly TrackSpec[] = [
  SUNSET_COAST,
  NEON_CANYON,
  SKY_GARDEN,
  CITY_LOOP,
  ALPINE_PASS,
  DUST_BASIN,
];

export type TrackId = (typeof TRACKS)[number]["id"];

export const DEFAULT_TRACK_ID = SUNSET_COAST.id;

export function trackSpecById(id: string): TrackSpec {
  return TRACKS.find((track) => track.id === id) ?? SUNSET_COAST;
}
