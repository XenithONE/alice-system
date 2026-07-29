/**
 * Gate: a phone is not handed a desktop scene.
 *
 * The bug this exists to stop had no symptom you could see in a screenshot —
 * the harbour looked right on a phone, it just ran the antialias pass, the
 * shadow pass and the full geometry at 1.75x the device pixel ratio, which is
 * 1.96x the pixels of the desktop tier it was supposed to be gentler than.
 * Nothing about "balanced" says that out loud, which is why it survived.
 *
 * Runs headless by faking the three globals detectHeroQuality reads.
 *
 * Run: npx tsx src/portfolio/qualitySelftest.ts
 */

// Makes this a module, so the top-level await below is legal.
export {};

declare const process: { exitCode?: number };

interface Device {
  readonly name: string;
  readonly width: number;
  readonly dpr: number;
  readonly coarse: boolean;
  readonly memory: number;
}

const DEVICES: readonly Device[] = [
  { name: "デスクトップ 1440 / 8GB", width: 1440, dpr: 1, coarse: false, memory: 8 },
  { name: "ノート 1280 / 4GB", width: 1280, dpr: 2, coarse: false, memory: 4 },
  { name: "iPhone 相当 390 / 4GB", width: 390, dpr: 3, coarse: true, memory: 4 },
  { name: "大型スマホ 430 / 8GB", width: 430, dpr: 3, coarse: true, memory: 8 },
  { name: "タブレット縦 834 / 4GB", width: 834, dpr: 2, coarse: true, memory: 4 },
  { name: "非力な PC 1280 / 2GB", width: 1280, dpr: 1, coarse: false, memory: 2 },
  // The only shape that reaches balanced: a big touch screen. Without it the
  // middle tier is never exercised and [Q7] has nothing to compare.
  { name: "タッチノート 1200 / 8GB", width: 1200, dpr: 2, coarse: true, memory: 8 }
];

function install(device: Device): void {
  // defineProperty, not assignment: node ships `navigator` as a getter-only
  // global, so `globalThis.navigator = {...}` throws.
  const set = (key: string, value: unknown): void => {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  set("window", {
    devicePixelRatio: device.dpr,
    innerWidth: device.width,
    location: { search: "" },
    matchMedia: (q: string) => ({
      matches: q.includes("pointer: coarse") ? device.coarse : false
    })
  });
  set("navigator", { deviceMemory: device.memory });
  set("document", { documentElement: { dataset: {} } });
}

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures.push(name);
};

const rows: Record<string, unknown>[] = [];
const results = new Map<
  string,
  { tier: string; detail: string; antialias: boolean; shadows: boolean; dpr: number; shadowMapSize: number }
>();

for (const device of DEVICES) {
  install(device);
  // Imported per device: detectHeroQuality reads the globals at call time, but
  // the module itself must load after the first install.
  const { detectHeroQuality } = await import("./quality");
  const q = detectHeroQuality();
  results.set(device.name, {
    tier: q.tier,
    detail: q.detail,
    antialias: q.antialias,
    shadows: q.shadows,
    dpr: q.dpr,
    shadowMapSize: q.shadowMapSize
  });
  rows.push({
    device: device.name,
    tier: q.tier,
    detail: q.detail,
    aa: q.antialias,
    shadows: q.shadows,
    dpr: q.dpr,
    mapSize: q.shadowMapSize
  });
}
console.table(rows);

const phone = results.get("iPhone 相当 390 / 4GB")!;
const bigPhone = results.get("大型スマホ 430 / 8GB")!;
const desktop = results.get("デスクトップ 1440 / 8GB")!;
const laptop = results.get("ノート 1280 / 4GB")!;
const weakPc = results.get("非力な PC 1280 / 2GB")!;

check(
  "[Q1] スマホは RAM が潤沢でも low（画面の大きさを見ている）",
  phone.tier === "low" && bigPhone.tier === "low",
  `4GB=${phone.tier} / 8GB=${bigPhone.tier}`
);

check(
  "[Q2] スマホでは MSAA と影のパスを両方止める",
  !phone.antialias && !phone.shadows && !bigPhone.antialias && !bigPhone.shadows,
  `aa=${phone.antialias} shadows=${phone.shadows}`
);

check(
  "[Q3] スマホのジオメトリは lite",
  phone.detail === "lite" && bigPhone.detail === "lite",
  `${phone.detail} / ${bigPhone.detail}`
);

// The original defect, stated as a number: a phone must never render more
// pixels than the desktop tier it is supposed to be lighter than.
check(
  "[Q4] スマホの dpr がデスクトップを上回らない（1.75 で 1.96 倍描いていた）",
  phone.dpr <= desktop.dpr && bigPhone.dpr <= desktop.dpr,
  `スマホ ${phone.dpr} / デスクトップ ${desktop.dpr}`
);

check(
  "[Q5] デスクトップは high のまま（軽量化がPCを巻き添えにしていない）",
  desktop.tier === "high" && desktop.antialias && desktop.shadows && desktop.detail === "full",
  `tier=${desktop.tier} aa=${desktop.antialias} shadows=${desktop.shadows}`
);

check(
  "[Q6] メモリの少ない PC も low に落ちる",
  weakPc.tier === "low" && !weakPc.shadows,
  `tier=${weakPc.tier} shadows=${weakPc.shadows}`
);

/*
 * The middle tier has to mean something. It used to be high in all but name -
 * same MSAA, same shadow pass, same geometry - so "balanced" told a reader
 * nothing. Assert a real difference rather than that a tier merely exists.
 *
 * The first version of this check was `... || true`, which passes whatever the
 * code does. A gate that cannot fail is not a gate.
 */
const balanced = results.get("タッチノート 1200 / 8GB")!;
check(
  "[Q7] balanced が high と別物（影マップが小さく、それでも描画は full）",
  balanced.tier === "balanced" &&
    balanced.shadowMapSize < desktop.shadowMapSize &&
    balanced.detail === "full" &&
    balanced.shadows,
  `tier=${balanced.tier} map=${balanced.shadowMapSize} vs ${desktop.shadowMapSize} detail=${balanced.detail}`
);

check(
  "[Q8] ノート PC は軽量化の巻き添えになっていない",
  laptop.tier === "high" && laptop.shadows && laptop.detail === "full",
  `tier=${laptop.tier} shadows=${laptop.shadows}`
);

if (failures.length > 0) {
  console.log(`QUALITY SELFTEST FAIL — ${failures.join(" / ")}`);
  process.exitCode = 1;
} else {
  console.log("QUALITY SELFTEST PASS");
}
