import { useEffect, useMemo, useRef, useState } from "react";
import { buildCatalog } from "../parts/catalog";
import { validateBuild } from "../sim/build";
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
  utility: "補助"
};
const EFFECT_LABELS: Record<WeaponEffect, string> = {
  spin: "回転",
  grind: "切削",
  impulse: "打撃",
  clamp: "掴み",
  flame: "火炎",
  static: "固定"
};
const ACTION_LABELS: Record<WeaponAction, string> = {
  passive: "常時",
  held: "押している間",
  triggered: "一発"
};
const FACE_ICONS: Record<MountFace, string> = {
  deck: "⬆", underside: "⬇", left: "◀", right: "▶", front: "▲", rear: "▼"
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
  if (part.selfRight) return "反転復帰機構";
  if (part.powerMul) return `駆動出力 ×${part.powerMul}`;
  if (part.weaponPowerMul) return `武器出力 ×${part.weaponPowerMul}`;
  return `HP ${part.hp}`;
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
  const [garage, setGarage] = useState<BotSpec[]>(() => loadGarage());
  const [shareCode, setShareCode] = useState("");
  const [notice, setNotice] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BuilderScene | null>(null);
  const validation = useMemo(() => validateBuild(spec, catalog, settings), [catalog, settings, spec]);
  const remaining = settings.pointBudget - validation.stats.cost;

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
  const availableTypes = PART_TYPE_LABELS.map(([type, label]) => ({
    type, label, count: catalog.parts.filter((part) => part.type === type).length
  })).filter((item) => item.count > 0);
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
          <canvas ref={canvasRef} aria-label="実機ロボット組み立て3Dビュー" />
          <div className="sc-stage__hint">左クリック: 取付　右クリック / Delete: 撤去　R: 回転　ドラッグ: 周回　ホイール: ズーム</div>
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
