export type WorldKind = "game" | "app" | "hidden";
export type LaunchMode = "overlay";

export interface World {
  id: string;
  title: string;
  kind: WorldKind;
  url: string;
  texture: string;
  cover: string;
  color: number;
  atmosphere: number;
  size: number;
  ring: boolean;
  clouds: boolean;
  tags: string[];
  description: string;
  statusKey: string | null;
  hidden: boolean;
  launchMode: LaunchMode;
}

export type FragmentId = "anomaly" | "terminal" | "lantern" | "rift" | "voice" | "idle";

export const SIGNAL_FRAGMENTS: FragmentId[] = ["anomaly", "terminal", "lantern", "rift", "voice", "idle"];

export const WORLDS: World[] = [
  {
    id: "eidolon",
    title: "THE EIDOLON",
    kind: "game",
    url: "games/the-eidolon.html",
    texture: "assets/planet-eidolon-hq.jpg",
    cover: "assets/the-eidolon-cover.jpg",
    color: 0x6f7bb0,
    atmosphere: 0x9fb6ff,
    size: 3.1,
    ring: false,
    clouds: true,
    tags: ["Three.js", "3D", "Horror"],
    description: "闇の虚空を懐中電灯で進む一人称ホラー探索。眼の怪物を避け、信号の断片を持ち帰る。",
    statusKey: "alice_bonus_the_eidolon",
    hidden: false,
    launchMode: "overlay"
  },
  {
    id: "rift_courier",
    title: "RIFT COURIER",
    kind: "game",
    url: "games/rift-courier.html",
    texture: "assets/planet-rift-hq.jpg",
    cover: "assets/rift-courier-cover.jpg",
    color: 0x33e7c8,
    atmosphere: 0x7fffea,
    size: 2.65,
    ring: true,
    clouds: false,
    tags: ["Three.js", "3D", "Arcade"],
    description: "崩壊するリフトを飛び、光のキーを集め、最後のゲート中心を抜ける3D飛行ゲーム。",
    statusKey: "alice_bonus_rift_courier",
    hidden: false,
    launchMode: "overlay"
  },
  {
    id: "iwbtg",
    title: "I WANNA BE THE SIGNAL",
    kind: "game",
    url: "games/iwbtg/",
    texture: "assets/planet-iwbtg-hq.jpg",
    cover: "assets/iwbtg-cover.png",
    color: 0xff5c9d,
    atmosphere: 0xff8ebc,
    size: 2.35,
    ring: false,
    clouds: true,
    tags: ["HTML5", "Canvas", "死にゲー"],
    description: "偽の床、見えない壁、嘘のセーブ。全力でプレイヤーを騙す高難度2Dアクション。",
    statusKey: "alice_bonus_iwbtg",
    hidden: false,
    launchMode: "overlay"
  },
  {
    id: "locker_hunt",
    title: "LOCKER HUNT",
    kind: "game",
    url: "games/locker-hunt.html",
    texture: "assets/planet-locker-hq.jpg",
    cover: "assets/locker-hunt-cover.jpg",
    color: 0x6fae7e,
    atmosphere: 0x9bffc0,
    size: 2.7,
    ring: false,
    clouds: true,
    tags: ["HTML5", "Canvas", "Horror"],
    description: "学校の廊下でロッカーを開け、小さな影を探すコメディホラー探索ゲーム。",
    statusKey: "alice_bonus_locker_hunt",
    hidden: false,
    launchMode: "overlay"
  },
  {
    id: "signal_runner",
    title: "SIGNAL RUNNER",
    kind: "game",
    url: "games/signal-runner.html",
    texture: "assets/planet-signal-hq.png",
    cover: "assets/signal-runner-cover.jpg",
    color: 0x2fd6c0,
    atmosphere: 0x6ffff0,
    size: 2.5,
    ring: false,
    clouds: true,
    tags: ["HTML5", "Canvas", "Arcade"],
    description: "崩れていく信号の隙間を抜け、光る断片を回収するアーケード回避ゲーム。",
    statusKey: "alice_bonus_signal_runner",
    hidden: false,
    launchMode: "overlay"
  },
  {
    id: "constellation",
    title: "CONSTELLATION",
    kind: "game",
    url: "games/constellation.html",
    texture: "assets/planet-constellation-hq.jpg",
    cover: "assets/constellation-cover.jpg",
    color: 0xbcd0ff,
    atmosphere: 0xe5ecff,
    size: 2.85,
    ring: true,
    clouds: false,
    tags: ["HTML5", "Canvas", "Puzzle"],
    description: "星を正しい順に結び、沈黙した信号を再同期する記憶パズル。",
    statusKey: "alice_bonus_constellation",
    hidden: false,
    launchMode: "overlay"
  },
  {
    id: "dragons_keep",
    title: "DRAGON'S KEEP",
    kind: "game",
    url: "games/dragons-keep.html",
    texture: "assets/planet-dragons-hq.png",
    cover: "assets/dragons-keep-cover.jpg",
    color: 0xff7a3c,
    atmosphere: 0xffc16e,
    size: 3,
    ring: false,
    clouds: true,
    tags: ["HTML5", "Canvas", "Pinball"],
    description: "城門マルチボール、ワームホール、魔の渦を巡るファンタジーピンボール。",
    statusKey: "alice_bonus_dragons_keep",
    hidden: false,
    launchMode: "overlay"
  },
  {
    id: "core",
    title: "THE CORE",
    kind: "app",
    url: "sy.html",
    texture: "assets/planet-core-hq.jpg",
    cover: "assets/entity.jpg",
    color: 0x9a78d8,
    atmosphere: 0xd0a6ff,
    size: 3.65,
    ring: true,
    clouds: true,
    tags: ["Web Audio", "Synth", "App"],
    description: "信号の源。波形、ノイズ、記憶を操作するR'LYEH ENGINEの音響中枢。",
    statusKey: null,
    hidden: false,
    launchMode: "overlay"
  },
  {
    id: "observer_node",
    title: "OBSERVER NODE",
    kind: "hidden",
    url: "sy.html",
    texture: "assets/planet-observer-hq.jpg",
    cover: "assets/entity.jpg",
    color: 0x143a4a,
    atmosphere: 0x33e7c8,
    size: 2.45,
    ring: false,
    clouds: true,
    tags: ["Hidden", "Signal", "???"],
    description: "座標の外側にある観測不能な惑星。信号断片かターミナル操作で姿を現す。",
    statusKey: "alice_planet_hint",
    hidden: true,
    launchMode: "overlay"
  }
];

export function routePath(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
}

export function assetPath(path: string): string {
  return routePath(path);
}

export function publicHomePath(): string {
  return import.meta.env.BASE_URL;
}
