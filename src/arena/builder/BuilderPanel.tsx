import { useEffect, useMemo, useRef, useState } from "react";
import { buildCatalog } from "../parts/catalog";
import { levelRises, riseForLevel, validateBuild } from "../sim/build";
import type {
  BotSpec,
  MountFace,
  PartCategory,
  PartDef,
  PartType,
  RoomSettings,
  WeaponAction,
  WeaponEffect,
  WeaponSlot
} from "../sim/types";
import { MOUNT_FACE_LABELS, PART_TYPE_LABELS, SLOT_KEYS } from "../sim/types";
import { createBuilderScene, type BuilderScene } from "./builderScene";
import { decodeSpec, encodeSpec, loadGarage, saveGarage } from "./storage";

export interface BuilderPanelProps {
  initialSpec?: BotSpec;
  settings: RoomSettings;
  onLaunch?: (spec: BotSpec) => void;
}

const CATEGORY_LABELS: Record<PartCategory, string> = {
  chassis: "シャーシ",
  drive: "駆動",
  weapon: "武装",
  armor: "装甲",
  utility: "補助",
  /*
   * 支柱。装甲でもユーティリティでもなく「上の段を作る構造材」なので、
   * ラベルと色の両方で他の5カテゴリと切り分ける。
   */
  structure: "構造"
};
/**
 * カテゴリの色。パーツカードの見出しバッジに載る。構造材（紫）は装甲（金）とも
 * 補助（緑）とも混ざらない色を割り当てる — デッキに置ける板という点では
 * 装甲・補助と見た目が近く、置いた結果が「段が増える」で全く違うため。
 */
const CATEGORY_ACCENT: Record<PartCategory, string> = {
  chassis: "#93a0a5",
  drive: "#5fb0c9",
  weapon: "#e0614f",
  armor: "#d2a638",
  utility: "#79c99a",
  structure: "#b083e0"
};
const EFFECT_LABELS: Record<WeaponEffect, string> = {
  spin: "回転",
  grind: "切削",
  impulse: "打撃",
  clamp: "掴み",
  flame: "火炎",
  static: "固定",
  deploy: "設置",
  net: "ネット",
  harpoon: "ハープーン"
};
const ACTION_LABELS: Record<WeaponAction, string> = {
  passive: "常時",
  held: "押している間",
  triggered: "一発"
};
const FACE_ICONS: Record<MountFace, string> = {
  deck: "⬆", underside: "⬇", left: "◀", right: "▶", front: "▲", rear: "▼", internal: "⚙"
};

function primaryValue(part: PartDef): string {
  if (part.category === "chassis") return `デッキ ${part.deck[0]}×${part.deck[1]} / HP ${part.hp}`;
  if (part.category === "drive") return `${part.torque} N·m / ${(part.maxOmega * part.radius).toFixed(1)} m/s`;
  if (part.category === "weapon") {
    if (part.effect === "spin") return `威力 ×${part.damageMul} / ${part.maxOmega ?? 0} rad/s`;
    if (part.effect === "grind" || part.effect === "flame" || part.effect === "clamp") {
      return `${part.dps ?? 0} DPS${part.fuel ? ` / 燃料 ${part.fuel}s` : ""}`;
    }
    if (part.effect === "impulse") return `${part.impulse ?? 0} N·s / CT ${part.cooldown ?? 0}s`;
    return `装甲 ${part.armor} / リーチ ${part.reach.toFixed(2)}m`;
  }
  if (part.category === "armor") return `装甲 ${part.armor} / HP ${part.hp}`;
  /*
   * 支柱を先に落とす。ここを通さないと残りは UtilityDef | RiserDef のままで、
   * 下の selfRight / powerMul / weaponPowerMul は RiserDef に存在しない。
   * 「rise が高さそのもの」は契約 A3（height === rise）なので、表示も rise 一本。
   */
  if (part.category === "structure") {
    return `段上げ ${(part.rise * 100).toFixed(0)} cm / HP ${part.hp}`;
  }
  if (part.selfRight) return "反転復帰機構";
  if (part.powerMul) return `駆動出力 ×${part.powerMul}`;
  if (part.weaponPowerMul) return `武器出力 ×${part.weaponPowerMul}`;
  return `HP ${part.hp}`;
}

/** 数値が未計算・非有限でも「—」で落ち着かせる。0 を捏造しない。 */
function formatStat(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

const copySpec = (spec: BotSpec, name = spec.name): BotSpec => ({
  ...spec,
  name,
  parts: spec.parts.map((part) => ({ ...part, cell: [...part.cell] as [number, number] }))
});

export function BuilderPanel({ initialSpec, settings, onLaunch }: BuilderPanelProps) {
  const catalog = useMemo(() => buildCatalog(), []);
  const [spec, setSpec] = useState<BotSpec>(() => copySpec(initialSpec ?? catalog.presets[0]!));
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [category, setCategory] = useState<PartCategory | "all">("all");
  const [effect, setEffect] = useState<WeaponEffect | "all">("all");
  const [partType, setPartType] = useState<PartType | "all">("all");
  const [query, setQuery] = useState("");
  const [face, setFace] = useState<MountFace>("deck");
  const [level, setLevel] = useState(0);
  const [garage, setGarage] = useState<BotSpec[]>(() => loadGarage());
  const [shareCode, setShareCode] = useState("");
  const [notice, setNotice] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BuilderScene | null>(null);
  const validation = useMemo(() => validateBuild(spec, catalog, settings), [catalog, settings, spec]);
  const remaining = settings.pointBudget - validation.stats.cost;

  /*
   * 段（storey）。0 が船体デッキで、maxLevels は「船体デッキを1と数えた段数」
   * （types.ts の ChassisDef 参照）なので、選べるのは 0 .. maxLevels - 1。
   * 既存フレームは全て maxLevels: 1 ＝ 0 段目だけ、つまり多段不可。
   * ただし読み込んだ機体が既にそれより上を使っていたら、その段も表に出す。
   * 見えない段に置かれたパーツは撤去もできなくなるため。
   */
  const chassisDef = catalog.byId.get(spec.chassisId);
  const maxLevels = chassisDef?.category === "chassis" ? Math.max(1, chassisDef.maxLevels) : 1;
  const usedTopLevel = spec.parts.reduce(
    (top, placed) => Math.max(top, placed.face === "deck" ? placed.level ?? 0 : 0),
    0
  );
  const highestLevel = Math.max(maxLevels - 1, usedTopLevel);
  // 段の高さは levelRises() だけが出典。ここは表示のために読むだけで、足さない。
  const rises = useMemo(() => levelRises(spec, catalog), [catalog, spec]);
  const stability = validation.stats.stability;
  const unstable = Number.isFinite(stability) && stability < 1;

  useEffect(() => {
    sceneRef.current?.setLevel(level);
  }, [level]);
  useEffect(() => {
    if (level > highestLevel) setLevel(highestLevel);
  }, [highestLevel, level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = createBuilderScene(canvas, catalog, settings);
    scene.setSpec(spec);
    scene.onChange(setSpec);
    sceneRef.current = scene;
    const attachDebugSeam = (): void => {
      if (sceneRef.current !== scene || !window.__sc) return;
      window.__sc.builder = {
        debugTick: (dt) => scene.debugTick(dt),
        getDebugState: () => scene.getDebugState(),
        captureFrame: () => scene.captureFrame(),
        setEnvironmentEnabled: (enabled) => scene.setEnvironmentEnabled(enabled)
      };
    };
    attachDebugSeam();
    queueMicrotask(attachDebugSeam);
    return () => {
      if (window.__sc?.builder) delete window.__sc.builder;
      scene.dispose();
      sceneRef.current = null;
    };
  }, [catalog, settings]);

  const loadSpec = (next: BotSpec): void => {
    const clone = copySpec(next);
    setSpec(clone);
    sceneRef.current?.setSpec(clone);
    setNotice(`「${clone.name}」を読み込みました。`);
  };
  const updateGarage = (next: BotSpec[]): void => {
    setGarage(next);
    saveGarage(next);
  };
  const saveCurrent = (): void => {
    updateGarage([...garage, copySpec(spec)]);
    setNotice(`「${spec.name}」をガレージに保存しました。`);
  };
  const copyShareCode = async (): Promise<void> => {
    const code = encodeSpec(spec);
    setShareCode(code);
    try {
      await navigator.clipboard.writeText(code);
      setNotice("共有コードをコピーしました。");
    } catch {
      setNotice("共有コードを表示しました。");
    }
  };
  const importShareCode = (): void => {
    const decoded = decodeSpec(shareCode);
    if (!decoded) return setNotice("共有コードが壊れているか、形式が違います。");
    loadSpec(decoded);
  };
  const selectPart = (partId: string): void => {
    const part = catalog.byId.get(partId);
    if (part && part.category !== "chassis" && !part.faces.includes(face)) {
      const nextFace = part.faces[0] ?? "deck";
      setFace(nextFace);
      sceneRef.current?.setFace(nextFace);
    }
    setSelectedPart(partId);
    sceneRef.current?.setHoveredPart(partId);
  };
  const wouldExceed = (part: PartDef): boolean => {
    if (part.category !== "chassis") return validation.stats.cost + part.cost > settings.pointBudget;
    const current = catalog.byId.get(spec.chassisId);
    return validation.stats.cost - (current?.cost ?? 0) + part.cost > settings.pointBudget;
  };
  /*
   * 種別タブの正本は PART_TYPE_LABELS（types.ts）。ただし「カタログに在るのに表に無い」
   * 種別が出ると、そのパーツはタブから永久に辿れなくなる。
   * ⚠ 実測（2026-07-26）: PartType に "riser" はあるのに PART_TYPE_LABELS に
   * ["riser", "支柱"] が無く、支柱5点がタブに出ない。types.ts は契約なので実装では
   * 直さず、ここは「表から漏れた種別を末尾に出す」保険だけを置く。ラベルは種別キーの
   * まま出す — 日本語名をここで作ると types.ts と二重の出典になるため。
   * types.ts に行が入れば、この後段は自動的に空になる。
   */
  const labelledTypes = new Set<PartType>(PART_TYPE_LABELS.map(([type]) => type));
  const countOfType = (type: PartType): number =>
    catalog.parts.filter((part) => part.type === type).length;
  const availableTypes = [
    ...PART_TYPE_LABELS.map(([type, label]) => ({ type, label, count: countOfType(type) })),
    ...[...new Set(catalog.parts.map((part) => part.type))]
      .filter((type) => !labelledTypes.has(type))
      .map((type) => ({ type, label: type, count: countOfType(type) }))
  ].filter((item) => item.count > 0);
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const shownParts = catalog.parts.filter((part) =>
    (partType === "all" || part.type === partType) &&
    (category === "all" || part.category === category) &&
    (effect === "all" || part.category === "weapon" && part.effect === effect) &&
    (!normalizedQuery || `${part.name} ${part.nameJa}`.toLocaleLowerCase("ja").includes(normalizedQuery))
  );
  const slotPart = (slot: WeaponSlot) => catalog.byId.get(
    slot === "primary" ? validation.stats.primaryId ?? "" :
    slot === "secondary" ? validation.stats.secondaryId ?? "" :
    validation.stats.tertiaryId ?? ""
  );
  const selectedDef = selectedPart ? catalog.byId.get(selectedPart) : null;

  return (
    <section className="sc-builder" aria-label="機体ビルダー">
      <style>{`
        .sc-builder{--ink:#e8e5dc;--muted:#899194;--line:#343c3f;--panel:#151a1c;--red:#d64b3e;--amber:#e2a92f;color:var(--ink);background:#090c0d;font:500 14px/1.45 system-ui,sans-serif;min-height:100%;padding:18px;box-sizing:border-box}
        .sc-builder *{box-sizing:border-box}.sc-builder button,.sc-builder input,.sc-builder select{font:inherit}.sc-builder__top{display:grid;grid-template-columns:minmax(270px,330px) minmax(390px,1fr) minmax(260px,310px);gap:14px;min-height:650px}
        .sc-panel{background:linear-gradient(150deg,#1b2123,#111516);border:1px solid var(--line);box-shadow:0 16px 42px #000a,inset 0 1px #ffffff0b;padding:14px}.sc-panel h2{font:600 20px Oswald,sans-serif;letter-spacing:.1em;margin:0 0 11px}.sc-panel h3{font:600 11px "Space Mono",monospace;letter-spacing:.11em;color:#aab0b0;margin:16px 0 7px}
        .sc-filters{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px}.sc-filters select{width:100%;background:#0d1112;color:var(--ink);border:1px solid #414a4d;padding:7px}.sc-palette{overflow:auto;max-height:650px}.sc-part{width:100%;text-align:left;color:inherit;background:#0e1314;border:1px solid #2d3537;padding:10px;margin:0 0 7px;cursor:pointer;transition:border-color .14s,transform .14s,opacity .14s}.sc-part:hover,.sc-part[aria-pressed=true]{border-color:var(--amber);transform:translateX(2px)}.sc-part:disabled{filter:grayscale(1);opacity:.34;cursor:not-allowed;transform:none}.sc-part__head{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:start}.sc-part__cost{color:#ffd05a;font:700 22px/1 "Space Mono",monospace}.sc-part__cost small{font-size:9px;color:#aeb3b2}.sc-part__meta{display:flex;gap:5px;flex-wrap:wrap;margin:6px 0}.sc-badge{border:1px solid #4c5659;color:#c4cac8;padding:2px 5px;font:700 9px "Space Mono",monospace;letter-spacing:.05em}.sc-badge--action{border-color:#765d28;color:#f1c55c}.sc-part small{display:block;color:var(--muted);margin-top:3px}.sc-part__value{color:#d6d9d4!important}
        .sc-stage{position:relative;padding:0;overflow:hidden;min-height:650px}.sc-stage canvas{display:block;width:100%;height:100%;min-height:650px;outline:none;cursor:crosshair}.sc-stage__hint{position:absolute;left:14px;bottom:12px;background:#060809df;border:1px solid #394346;padding:7px 10px;color:#b9bfc0;font-size:12px;pointer-events:none}
        .sc-budget{margin-bottom:13px}.sc-budget__line{display:flex;justify-content:space-between;align-items:end}.sc-budget__line strong{font:700 27px "Space Mono",monospace}.sc-budget__line strong.over{color:#ef6658}.sc-budget__bar{height:12px;background:#080a0b;border:1px solid #31393b;overflow:hidden}.sc-budget__bar i{display:block;height:100%;background:linear-gradient(90deg,#c58216,#f0c348)}.sc-budget__bar i.over{background:#d64b3e}.sc-remaining{color:#9da4a4;font-size:11px;margin-top:5px}.sc-weight{color:#c9cecc;margin:9px 0 13px}.sc-slots{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:10px 0 15px}.sc-slot{min-height:70px;border:1px solid #40494c;background:#0c1011;padding:8px}.sc-slot span{display:block;color:#e3b349;font:700 9px "Space Mono",monospace}.sc-slot strong{display:block;margin-top:7px;font-size:12px}.sc-slot small{color:#7e8789}.sc-name{width:100%;background:#0c1011;border:1px solid #3b4447;color:var(--ink);padding:8px;margin-bottom:12px}.sc-stat{display:grid;grid-template-columns:1fr auto;gap:8px;border-bottom:1px solid #2d3537;padding:7px 0}.sc-stat b{font-variant-numeric:tabular-nums}.sc-errors{margin:12px 0;padding:10px;background:#250f0f;border-left:3px solid var(--red);color:#efb1ac}.sc-errors ul{padding-left:19px;margin:5px 0}.sc-valid{color:#79c99a}.sc-launch{width:100%;padding:12px;background:var(--red);border:0;color:white;font-weight:800;letter-spacing:.12em;cursor:pointer}.sc-launch:disabled{filter:grayscale(1);opacity:.35}
        .sc-builder__bottom{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:14px;margin-top:14px}.sc-actions{display:flex;flex-wrap:wrap;gap:7px}.sc-actions button{background:#232b2d;color:var(--ink);border:1px solid #3b4649;padding:7px 10px;cursor:pointer}.sc-garage{display:grid;gap:7px;margin-top:10px}.sc-garage__item{display:grid;grid-template-columns:1fr auto;align-items:center;background:#101516;padding:8px}.sc-share{width:100%;min-height:72px;resize:vertical;background:#0c1011;border:1px solid #394346;color:#b9d8df;padding:8px;font:12px ui-monospace,monospace}.sc-notice{min-height:1.4em;color:#d7b454}
        .sc-type-tabs{display:flex;gap:5px;overflow-x:auto;padding:1px 0 9px;scrollbar-width:thin}.sc-type-tabs button{flex:0 0 auto;border:1px solid #3b4547;background:#0b0f10;color:#aeb5b5;padding:5px 7px;font-size:10px;cursor:pointer}.sc-type-tabs button[aria-pressed=true]{color:#101313;background:var(--amber);border-color:#efc45d}.sc-type-tabs small{opacity:.72}.sc-search{width:100%;margin-bottom:7px;background:#090d0e;color:var(--ink);border:1px solid #465052;padding:8px}.sc-part__head strong small{font-size:10px;font-weight:500}.sc-part__cost{font-size:25px}.sc-faces{display:flex;gap:3px;margin-top:6px}.sc-face-icon{width:21px;height:21px;display:grid;place-items:center;border:1px solid #465052;color:#e1b34e;font-size:10px}.sc-face-selector{position:absolute;left:50%;top:12px;display:flex;gap:5px;transform:translateX(-50%);z-index:2;padding:6px;background:#080b0ce8;border:1px solid #3d4648}.sc-face-selector button{min-width:54px;padding:6px;background:#161c1e;color:#c1c7c6;border:1px solid #465053;cursor:pointer;font-size:10px}.sc-face-selector button[aria-pressed=true]{background:#d2a02f;color:#111;border-color:#f2cd69}.sc-face-selector button:disabled{opacity:.22;cursor:not-allowed}.sc-slots{grid-template-columns:1fr}.sc-slot{min-height:61px}
        .sc-level-selector{position:absolute;left:50%;top:58px;display:flex;gap:5px;align-items:center;transform:translateX(-50%);z-index:2;padding:5px 8px;background:#080b0ce8;border:1px solid #3d4648}.sc-level-selector>span{font:700 9px "Space Mono",monospace;letter-spacing:.09em;color:#9aa2a2}.sc-level-selector button{min-width:40px;padding:5px 7px;background:#161c1e;color:#c1c7c6;border:1px solid #465053;cursor:pointer;font-size:11px}.sc-level-selector button[aria-pressed=true]{background:#b083e0;color:#120a1c;border-color:#d0aef2}.sc-level-selector button:disabled{opacity:.24;cursor:not-allowed}.sc-level-selector button small{display:block;font-size:8px;opacity:.75}
        .sc-badge--cat{font-weight:800}.sc-stat b.warn{color:#f0a63c}.sc-note{margin:7px 0 0;color:#9aa2a2;font-size:11px;line-height:1.4}.sc-note--warn{color:#f0a63c}
        @media(max-width:1050px){.sc-builder__top{grid-template-columns:280px 1fr}.sc-stats{grid-column:1/-1}.sc-builder__bottom{grid-template-columns:1fr 1fr}}@media(max-width:700px){.sc-builder{padding:9px}.sc-builder__top,.sc-builder__bottom{grid-template-columns:1fr}.sc-palette{max-height:460px}.sc-stage,.sc-stage canvas{min-height:450px}}
      `}</style>

      <div className="sc-builder__top">
        <aside className="sc-panel sc-palette">
          <h2>PARTS INVENTORY</h2>
          <div className="sc-type-tabs" aria-label="パーツ種別">
            <button type="button" aria-pressed={partType === "all"} onClick={() => setPartType("all")}>すべて <small>{catalog.parts.length}</small></button>
            {availableTypes.map((item) => <button type="button" key={item.type} aria-pressed={partType === item.type} onClick={() => setPartType(item.type)}>{item.label} <small>{item.count}</small></button>)}
          </div>
          <input className="sc-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・日本語名で検索" aria-label="パーツ検索" />
          <div className="sc-filters">
            <label>カテゴリ<select value={category} onChange={(event) => setCategory(event.target.value as PartCategory | "all")}>
              <option value="all">すべて</option>
              {(Object.keys(CATEGORY_LABELS) as PartCategory[]).map((key) => <option value={key} key={key}>{CATEGORY_LABELS[key]}</option>)}
            </select></label>
            <label>効果<select value={effect} onChange={(event) => setEffect(event.target.value as WeaponEffect | "all")}>
              <option value="all">すべて</option>
              {(Object.keys(EFFECT_LABELS) as WeaponEffect[]).map((key) => <option value={key} key={key}>{EFFECT_LABELS[key]}</option>)}
            </select></label>
          </div>
          {shownParts.map((part) => {
            const unavailable = wouldExceed(part);
            return (
              <button className="sc-part" type="button" key={part.id} disabled={unavailable}
                aria-pressed={selectedPart === part.id}
                title={unavailable ? `残り${Math.max(0, remaining)}ptでは購入できません` : undefined}
                onClick={() => selectPart(part.id)}
                onMouseEnter={() => sceneRef.current?.setHoveredPart(part.id)}
                onMouseLeave={() => sceneRef.current?.setHoveredPart(selectedPart)}>
                <span className="sc-part__head"><strong>{part.nameJa}<small> / {part.name}</small></strong><span className="sc-part__cost">{part.cost}<small> PT</small></span></span>
                <span className="sc-part__meta">
                  <span className="sc-badge sc-badge--cat" style={{ borderColor: CATEGORY_ACCENT[part.category], color: CATEGORY_ACCENT[part.category] }}>{CATEGORY_LABELS[part.category]}</span>
                  <span className="sc-badge">{part.mass} kg</span>
                  <span className="sc-badge">{PART_TYPE_LABELS.find(([type]) => type === part.type)?.[1]}</span>
                  {part.category === "weapon" && <span className="sc-badge sc-badge--action">{ACTION_LABELS[part.action]}</span>}
                  {part.category === "weapon" && <span className="sc-badge">{part.slot === "primary" ? "主兵装" : part.slot === "secondary" ? "副兵装" : "第3兵装"}</span>}
                </span>
                <span className="sc-faces" aria-label="取り付け可能面">{part.faces.map((mountFace) => <span className="sc-face-icon" title={MOUNT_FACE_LABELS.find(([key]) => key === mountFace)?.[1]} key={mountFace}>{FACE_ICONS[mountFace]}</span>)}</span>
                <small className="sc-part__value">{primaryValue(part)}</small>
                <small>{unavailable ? `購入不可 — 残り ${Math.max(0, remaining)} pt` : part.blurb}</small>
              </button>
            );
          })}
        </aside>

        <div className="sc-panel sc-stage">
          <div className="sc-face-selector" aria-label="取り付け面">
            {MOUNT_FACE_LABELS.map(([mountFace, label]) => {
              const disabled = Boolean(selectedDef && selectedDef.category !== "chassis" && !selectedDef.faces.includes(mountFace));
              return <button type="button" key={mountFace} disabled={disabled} aria-pressed={face === mountFace} onClick={() => {
                setFace(mountFace);
                sceneRef.current?.setFace(mountFace);
              }}>{FACE_ICONS[mountFace]} {label}</button>;
            })}
          </div>
          {/*
            段セレクタ。段は上面（デッキ）だけの概念（契約 H1）なので、他の面を
            選んでいるときは出さない。選択中の段のパーツだけが取付・撤去の対象で、
            下の段は 3D 側で薄く描いて残す（積んでいるものが見えないと組めない）。
          */}
          {face === "deck" && (
            <div className="sc-level-selector" aria-label="デッキの段">
              <span>段</span>
              {Array.from({ length: highestLevel + 1 }, (_, index) => index).map((choice) => {
                const overMax = choice > maxLevels - 1;
                return (
                  <button type="button" key={choice} aria-pressed={level === choice} disabled={overMax && choice !== level}
                    title={overMax
                      ? `このフレームは${maxLevels}段までです（${maxLevels === 1 ? "多段不可" : `0〜${maxLevels - 1}段`}）`
                      : `床から +${(riseForLevel(rises, choice) * 100).toFixed(0)} cm`}
                    onClick={() => setLevel(choice)}>
                    {choice}<small>+{(riseForLevel(rises, choice) * 100).toFixed(0)}cm</small>
                  </button>
                );
              })}
              {maxLevels === 1 && highestLevel === 0 &&
                <span title="支柱を置いて段を作れるフレームに換えてください">多段不可</span>}
            </div>
          )}
          <canvas ref={canvasRef} aria-label="実機ロボット組み立て3Dビュー" />
          <div className="sc-stage__hint">左クリック: 取付　右クリック / Delete: 撤去　R: 回転　ドラッグ: 周回　ホイール: ズーム{face === "deck" ? `　／ 操作中の段: ${level}` : ""}</div>
        </div>

        <aside className="sc-panel sc-stats">
          <h2>BUILD SHEET</h2>
          <label>機体名<input className="sc-name" value={spec.name} maxLength={80} onChange={(event) => {
            const next = { ...spec, name: event.target.value || "名称未設定" };
            setSpec(next);
            sceneRef.current?.setSpec(next);
          }} /></label>
          <div className="sc-budget">
            <div className="sc-budget__line"><span>ポイント</span><strong className={remaining < 0 ? "over" : ""}>{validation.stats.cost} / {settings.pointBudget}</strong></div>
            <div className="sc-budget__bar"><i className={remaining < 0 ? "over" : ""} style={{ width: `${Math.min(validation.stats.cost / settings.pointBudget * 100, 100)}%` }} /></div>
            <div className="sc-remaining">残り {Math.max(0, remaining)} pt</div>
          </div>
          <div className="sc-weight">重量: <strong>{validation.stats.mass.toFixed(1)} kg</strong>（上限なし）</div>
          <h3>WEAPON SLOTS</h3>
          <div className="sc-slots">
            {SLOT_KEYS.map(([slot, key], index) => {
              const item = slotPart(slot);
              return <div className="sc-slot" key={slot}><span>0{index + 1} / {key.toUpperCase()} / {slot.toUpperCase()}</span>
                <strong>{item?.nameJa ?? "EMPTY"}</strong><small>{item?.category === "weapon" ? ACTION_LABELS[item.action] : "未装備"}</small></div>;
            })}
          </div>
          <div className="sc-stat"><span>HP</span><b>{validation.stats.hp}</b></div>
          <div className="sc-stat"><span>装甲</span><b>{validation.stats.armor}</b></div>
          <div className="sc-stat"><span>最高速</span><b>{validation.stats.topSpeed.toFixed(1)} m/s</b></div>
          <div className="sc-stat"><span>トルク</span><b>{validation.stats.torque.toFixed(0)} N·m</b></div>
          <div className="sc-stat"><span>一撃威力</span><b>{validation.stats.hitPower.toFixed(0)}</b></div>
          <div className="sc-stat"><span>継続火力</span><b>{validation.stats.sustainedDps.toFixed(0)} DPS</b></div>
          {/*
            高さの代償（契約 H7）。安定度 = 接地幅 ÷ (2 × 重心高) で、1.0 を切ると
            押されて転ぶ。高く積めることを売りにする以上、その代償を数字で見せる。
            隠すと「積んだら勝ち」になり、段が選択でなくなる。
          */}
          <div className="sc-stat"><span>重心高</span><b>{formatStat(validation.stats.comHeight, 3)} m</b></div>
          <div className="sc-stat"><span>接地幅</span><b>{formatStat(validation.stats.trackWidth, 3)} m</b></div>
          <div className="sc-stat"><span>安定度</span><b className={unstable ? "warn" : ""}>{formatStat(stability, 2)}</b></div>
          <div className="sc-stat"><span>最上段</span><b>{formatStat(validation.stats.topLevel, 0)}</b></div>
          <p className={unstable ? "sc-note sc-note--warn" : "sc-note"} role={unstable ? "status" : undefined}>
            {unstable
              ? `安定度 ${formatStat(stability, 2)} — 1.00 未満は押されると転びます。重心を下げるか、駆動の間隔を広げてください。`
              : "安定度 = 接地幅 ÷ (2 × 重心高)。1.00 未満は押されると転びます。"}
          </p>
          <div className="sc-stat"><span>機関出力</span><b>{validation.stats.powerKw.toFixed(1)} / {validation.stats.powerDemandKw.toFixed(1)} kW</b></div>
          <div className="sc-stat"><span>蓄電</span><b>{validation.stats.chargeKj.toFixed(1)} / {validation.stats.chargeDemandKj.toFixed(1)} kJ</b></div>
          <div className="sc-stat"><span>燃料</span><b>{validation.stats.fuelL.toFixed(1)} L</b></div>
          <div className="sc-stat"><span>冷却</span><b>{validation.stats.coolingKw.toFixed(1)} / {validation.stats.heatKw.toFixed(1)} kW</b></div>
          <div className="sc-stat"><span>機関室セル</span><b>{validation.stats.internalCells} / {validation.stats.internalCellsMax}</b></div>
          <div className="sc-stat"><span>加速時間</span><b>{Number.isFinite(validation.stats.spinUpSec) ? `${validation.stats.spinUpSec.toFixed(1)} 秒` : "∞"}</b></div>
          {validation.warnings.length > 0 &&
            <div className="sc-errors" role="status"><strong>注意</strong><ul>{validation.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}
          {validation.ok ? <p className="sc-valid">出撃条件を満たしています。</p> :
            <div className="sc-errors" role="alert"><strong>出撃不可</strong><ul>{validation.errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul></div>}
          <button className="sc-launch" type="button" disabled={!validation.ok} onClick={() => onLaunch?.(copySpec(spec))}>出撃する</button>
        </aside>
      </div>

      <div className="sc-builder__bottom">
        <section className="sc-panel"><h2>ガレージ</h2><div className="sc-actions"><button type="button" onClick={saveCurrent}>現在の機体を保存</button></div>
          <div className="sc-garage">{garage.length === 0 && <span>保存機体はありません。</span>}
            {garage.map((saved, index) => <div className="sc-garage__item" key={`${saved.name}-${index}`}>
              <button className="sc-part" type="button" onClick={() => loadSpec(saved)}><strong>{saved.name}</strong><small>{validateBuild(saved, catalog, settings).stats.cost}pt / {validateBuild(saved, catalog, settings).stats.mass.toFixed(1)}kg</small></button>
              <div className="sc-actions"><button type="button" onClick={() => updateGarage([...garage, copySpec(saved, `${saved.name} コピー`)])}>複製</button><button type="button" onClick={() => updateGarage(garage.filter((_, itemIndex) => itemIndex !== index))}>削除</button></div>
            </div>)}
          </div>
        </section>
        <section className="sc-panel"><h2>プリセット</h2><div className="sc-actions">{catalog.presets.map((preset) => <button type="button" key={preset.name} onClick={() => loadSpec(preset)}>{preset.name}</button>)}</div></section>
        <section className="sc-panel"><h2>共有コード</h2><textarea className="sc-share" aria-label="共有コード" value={shareCode} onChange={(event) => setShareCode(event.target.value)} placeholder="ここに共有コードを貼り付け" />
          <div className="sc-actions"><button type="button" onClick={() => void copyShareCode()}>コピー</button><button type="button" onClick={importShareCode}>貼り付け読込</button></div><p className="sc-notice" role="status">{notice}</p></section>
      </div>
    </section>
  );
}

export default BuilderPanel;
