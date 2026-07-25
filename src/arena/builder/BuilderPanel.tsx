import { useEffect, useMemo, useRef, useState } from "react";
import { buildCatalog } from "../parts/catalog";
import { validateBuild } from "../sim/build";
import type { BotSpec, PartCategory, PartDef } from "../sim/types";
import { createBuilderScene, type BuilderScene } from "./builderScene";
import { decodeSpec, encodeSpec, loadGarage, saveGarage } from "./storage";

export interface BuilderPanelProps {
  initialSpec?: BotSpec;
  onLaunch?: (spec: BotSpec) => void;
}

const CATEGORY_LABELS: Record<PartCategory, string> = {
  chassis: "シャーシ",
  drive: "駆動",
  weapon: "武器",
  armor: "装甲",
  utility: "補助"
};

function primaryValue(part: PartDef): string {
  if (part.category === "chassis") return `デッキ ${part.deck[0]}×${part.deck[1]} cell`;
  if (part.category === "drive") return `${part.torque} N·m / ${(part.maxOmega * part.radius).toFixed(1)} m/s`;
  if (part.category === "weapon") {
    if (part.motion === "spin") return `威力倍率 ×${part.damageMul} / ${part.maxOmega ?? 0} rad/s`;
    if (part.motion === "swing") return `力積 ${part.impulse ?? 0} N·s / ${part.cooldown ?? 0}s`;
    return `制御倍率 ×${part.damageMul}`;
  }
  if (part.category === "armor") return `装甲 ${part.armor} / HP ${part.hp}`;
  if (part.selfRight) return "反転復帰を追加";
  if (part.powerMul) return `トルク ×${part.powerMul}`;
  return `HP ${part.hp}`;
}

const copySpec = (spec: BotSpec, name = spec.name): BotSpec => ({
  ...spec,
  name,
  parts: spec.parts.map((part) => ({ ...part, cell: [...part.cell] as [number, number] }))
});

export function BuilderPanel({ initialSpec, onLaunch }: BuilderPanelProps) {
  const catalog = useMemo(() => buildCatalog(), []);
  const [spec, setSpec] = useState<BotSpec>(() => copySpec(initialSpec ?? catalog.presets[0]!));
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [garage, setGarage] = useState<BotSpec[]>(() => loadGarage());
  const [shareCode, setShareCode] = useState("");
  const [notice, setNotice] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BuilderScene | null>(null);
  const validation = useMemo(() => validateBuild(spec, catalog), [catalog, spec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = createBuilderScene(canvas, catalog);
    scene.setSpec(spec);
    scene.onChange(setSpec);
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [catalog]);

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

  const duplicateGarage = (index: number): void => {
    const source = garage[index];
    if (!source) return;
    updateGarage([...garage, copySpec(source, `${source.name} コピー`)]);
  };

  const removeGarage = (index: number): void => {
    updateGarage(garage.filter((_, itemIndex) => itemIndex !== index));
  };

  const copyShareCode = async (): Promise<void> => {
    const code = encodeSpec(spec);
    setShareCode(code);
    try {
      await navigator.clipboard.writeText(code);
      setNotice("共有コードをコピーしました。");
    } catch {
      setNotice("共有コードを表示しました。手動でコピーしてください。");
    }
  };

  const importShareCode = (): void => {
    const decoded = decodeSpec(shareCode);
    if (!decoded) {
      setNotice("共有コードが壊れているか、形式が違います。");
      return;
    }
    loadSpec(decoded);
  };

  const selectPart = (partId: string): void => {
    setSelectedPart(partId);
    sceneRef.current?.setHoveredPart(partId);
  };

  return (
    <section className="sc-builder" aria-label="機体ビルダー">
      <style>{`
        .sc-builder{--ink:#e8e1d2;--muted:#91989a;--line:#323b3e;--panel:#171d1f;--red:#d5493f;--amber:#d5a52f;color:var(--ink);background:#0c1011;font:500 14px/1.45 system-ui,sans-serif;min-height:100%;padding:18px;box-sizing:border-box}
        .sc-builder *{box-sizing:border-box}.sc-builder button,.sc-builder input{font:inherit}.sc-builder__top{display:grid;grid-template-columns:minmax(235px,300px) minmax(360px,1fr) minmax(240px,300px);gap:14px;min-height:620px}
        .sc-panel{background:linear-gradient(145deg,#1b2224,#13181a);border:1px solid var(--line);box-shadow:0 14px 40px #0008,inset 0 1px #ffffff0a;padding:14px}
        .sc-panel h2,.sc-panel h3{font-family:Impact,"Arial Narrow",sans-serif;letter-spacing:.08em;margin:0 0 10px;font-weight:500}.sc-panel h2{font-size:20px}.sc-panel h3{font-size:15px;color:#c1c6c5}
        .sc-palette{overflow:auto;max-height:620px}.sc-part{width:100%;text-align:left;color:inherit;background:#111617;border:1px solid #2c3436;padding:9px;margin:0 0 7px;cursor:pointer;transition:border-color .14s,transform .14s}.sc-part:hover,.sc-part[aria-pressed=true]{border-color:var(--amber);transform:translateX(2px)}.sc-part strong{display:flex;justify-content:space-between;gap:8px}.sc-part small{display:block;color:var(--muted);margin-top:3px}.sc-part__value{color:#d7b454}
        .sc-stage{position:relative;padding:0;overflow:hidden;min-height:620px}.sc-stage canvas{display:block;width:100%;height:100%;min-height:620px;outline:none;cursor:crosshair}.sc-stage canvas:focus-visible{box-shadow:inset 0 0 0 2px var(--amber)}.sc-stage__hint{position:absolute;left:14px;bottom:12px;background:#090c0dcc;border:1px solid #394346;padding:7px 10px;color:#b9bfc0;font-size:12px;pointer-events:none}
        .sc-name{width:100%;background:#0e1314;border:1px solid #384144;color:var(--ink);padding:8px;margin-bottom:14px}.sc-stat{display:grid;grid-template-columns:1fr auto;gap:8px;border-bottom:1px solid #2d3537;padding:8px 0}.sc-stat b{font-variant-numeric:tabular-nums}.sc-mass{height:8px;background:#090c0d;margin:5px 0 12px;overflow:hidden}.sc-mass i{display:block;height:100%;background:var(--amber)}.sc-mass i.over{background:var(--red)}
        .sc-errors{margin:14px 0;padding:10px;background:#250f0f;border-left:3px solid var(--red);color:#efb1ac}.sc-errors ul{padding-left:19px;margin:5px 0}.sc-valid{color:#79c99a;margin:14px 0}.sc-launch{width:100%;padding:12px;background:var(--red);border:0;color:white;font-weight:800;letter-spacing:.12em;cursor:pointer}.sc-launch:disabled{filter:grayscale(1);opacity:.35;cursor:not-allowed}
        .sc-builder__bottom{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:14px;margin-top:14px}.sc-actions{display:flex;flex-wrap:wrap;gap:7px}.sc-actions button{background:#232b2d;color:var(--ink);border:1px solid #3b4649;padding:7px 10px;cursor:pointer}.sc-actions button:hover{border-color:var(--amber)}.sc-garage{display:grid;gap:7px;margin-top:10px}.sc-garage__item{display:grid;grid-template-columns:1fr auto;align-items:center;background:#101516;padding:8px}.sc-garage__item small{display:block;color:var(--muted)}.sc-share{width:100%;min-height:72px;resize:vertical;background:#0c1011;border:1px solid #394346;color:#b9d8df;padding:8px;font:12px/1.35 ui-monospace,monospace;word-break:break-all}.sc-notice{min-height:1.4em;color:#d7b454;margin:8px 0 0}
        @media(max-width:1000px){.sc-builder__top{grid-template-columns:240px 1fr}.sc-stats{grid-column:1/-1}.sc-builder__bottom{grid-template-columns:1fr 1fr}}@media(max-width:680px){.sc-builder{padding:9px}.sc-builder__top,.sc-builder__bottom{grid-template-columns:1fr}.sc-palette{max-height:420px}.sc-stage,.sc-stage canvas{min-height:440px}}
      `}</style>

      <div className="sc-builder__top">
        <aside className="sc-panel sc-palette">
          <h2>パーツラック</h2>
          {(Object.keys(CATEGORY_LABELS) as PartCategory[]).map((category) => (
            <div key={category}>
              <h3>{CATEGORY_LABELS[category]}</h3>
              {catalog.parts.filter((part) => part.category === category).map((part) => (
                <button
                  className="sc-part"
                  type="button"
                  key={part.id}
                  aria-pressed={selectedPart === part.id}
                  onClick={() => selectPart(part.id)}
                  onMouseEnter={() => sceneRef.current?.setHoveredPart(part.id)}
                  onMouseLeave={() => sceneRef.current?.setHoveredPart(selectedPart)}
                >
                  <strong><span>{part.nameJa}</span><span>{part.mass}kg</span></strong>
                  <small className="sc-part__value">{primaryValue(part)}</small>
                  <small>{part.blurb}</small>
                </button>
              ))}
            </div>
          ))}
        </aside>

        <div className="sc-panel sc-stage">
          <canvas ref={canvasRef} aria-label="機体組み立て3Dビュー" />
          <div className="sc-stage__hint">左クリック: 設置　右クリック / Delete: 撤去　R: 回転　ドラッグ: 周回　ホイール: ズーム</div>
        </div>

        <aside className="sc-panel sc-stats">
          <h2>機体ステータス</h2>
          <label>
            機体名
            <input
              className="sc-name"
              value={spec.name}
              maxLength={80}
              onChange={(event) => {
                const next = { ...spec, name: event.target.value || "名称未設定" };
                setSpec(next);
                sceneRef.current?.setSpec(next);
              }}
            />
          </label>
          <div className="sc-stat"><span>質量</span><b>{validation.stats.mass.toFixed(1)} / {validation.stats.massLimit} kg</b></div>
          <div className="sc-mass"><i className={validation.stats.mass > validation.stats.massLimit ? "over" : ""} style={{ width: `${Math.min(validation.stats.mass / validation.stats.massLimit * 100, 100)}%` }} /></div>
          <div className="sc-stat"><span>HP</span><b>{validation.stats.hp}</b></div>
          <div className="sc-stat"><span>装甲</span><b>{validation.stats.armor}</b></div>
          <div className="sc-stat"><span>最高速</span><b>{validation.stats.topSpeed.toFixed(1)} m/s</b></div>
          <div className="sc-stat"><span>トルク</span><b>{validation.stats.torque.toFixed(0)} N·m</b></div>
          <div className="sc-stat"><span>一撃威力</span><b>{validation.stats.hitPower.toFixed(0)}</b></div>
          {validation.ok ? (
            <p className="sc-valid">出撃条件を満たしています。</p>
          ) : (
            <div className="sc-errors" role="alert">
              <strong>出撃不可</strong>
              <ul>{validation.errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>
            </div>
          )}
          <button className="sc-launch" type="button" disabled={!validation.ok} onClick={() => onLaunch?.(copySpec(spec))}>出撃する</button>
        </aside>
      </div>

      <div className="sc-builder__bottom">
        <section className="sc-panel">
          <h2>ガレージ</h2>
          <div className="sc-actions"><button type="button" onClick={saveCurrent}>現在の機体を保存</button></div>
          <div className="sc-garage">
            {garage.length === 0 && <span>保存機体はありません。</span>}
            {garage.map((saved, index) => (
              <div className="sc-garage__item" key={`${saved.name}-${index}`}>
                <button className="sc-part" type="button" onClick={() => loadSpec(saved)}>
                  <strong>{saved.name}</strong><small>{validateBuild(saved, catalog).stats.mass.toFixed(1)}kg</small>
                </button>
                <div className="sc-actions">
                  <button type="button" onClick={() => duplicateGarage(index)}>複製</button>
                  <button type="button" onClick={() => removeGarage(index)}>削除</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="sc-panel">
          <h2>プリセット</h2>
          <div className="sc-actions">
            {catalog.presets.map((preset) => <button type="button" key={preset.name} onClick={() => loadSpec(preset)}>{preset.name}</button>)}
          </div>
        </section>

        <section className="sc-panel">
          <h2>共有コード</h2>
          <textarea className="sc-share" aria-label="共有コード" value={shareCode} onChange={(event) => setShareCode(event.target.value)} placeholder="ここに共有コードを貼り付け" />
          <div className="sc-actions">
            <button type="button" onClick={() => void copyShareCode()}>コピー</button>
            <button type="button" onClick={importShareCode}>貼り付け読込</button>
          </div>
          <p className="sc-notice" role="status">{notice}</p>
        </section>
      </div>
    </section>
  );
}

export default BuilderPanel;
