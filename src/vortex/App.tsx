import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { FX_FAMILY_TINTS, fxFamilyForSkill } from "./content/fxFamily";
import { makeCpuBuild } from "./content/cpuBuild";
import { vortexAudio } from "./audio/engine";
import type { SkillRuntimeState } from "./sim/types";
import {
  ACTIVE_SKILLS,
  LINEAGE_META,
  PARTS,
  PASSIVE_SKILLS,
  ROLE_META,
  SLOT_META,
  TOP_LINEAGES,
  TOP_ROLES,
  TOP_SLOTS,
  applyDraftPick,
  advanceAutomaticDraftTurns,
  createDefaultBuild,
  createDraftState,
  currentDraftPlayerIndex,
  currentDraftSlot,
  deriveBuildStats,
  draftBuildForPlayer,
  getActiveSkill,
  getPart,
  getPartsForSlot,
  getPassiveSkill,
  legalDraftPicks,
  searchParts,
  validateBuild,
  type BuildCostLimit,
  type DraftState,
  type PartKind,
  type TopBuildSpec,
  type TopLineage,
  type TopPartDef,
  type TopRole,
  type TopSlot,
  type VortexGameMode,
  type VortexPlayerCount,
  type VortexRoomSettings
} from "./content";
import {
  decodeBuild,
  encodeBuild,
  loadGarage,
  saveGarage,
  upsertGarageBuild
} from "./builder/storage";
import { resolvedBuildFromDerived } from "./sim/catalogAdapter";
import {
  RING_ARENAS,
  aiActivation,
  createVortexSim,
  type MatchResult,
  type MatchState,
  type SeatIndex,
  type SimEvent,
  type SimRingArena,
  type SkillSlot,
  type VortexSim
} from "./sim";
import {
  createVortexBuilderScene,
  type VortexBuilderScene
} from "./render/builderScene";
import {
  createVortexBattleScene,
  type BattleArenaVisual,
  type BattleSnapshotVisual,
  type VortexBattleScene
} from "./render/battleScene";
import type { TopVisualPart, TopVisualSpec } from "./render/topFactory";
import {
  createLaunchMeter,
  type LaunchMeterSpec,
  type LaunchStopResult
} from "./launch";
import { LaunchMeterScreen } from "./ui/LaunchMeterScreen";
import {
  EndlessGameOverScreen,
  EndlessRewardScreen,
  EndlessWaveBadge
} from "./ui/EndlessScreens";
import { generateEndlessEnemy } from "./endless";
import {
  createBroadcastChannelWire,
  createGuestSession,
  createHostSession,
  normalizeRoomCode,
  type VortexLobby,
  type VortexResult,
  type VortexSession,
  type VortexSnapshot,
  type VortexStartPayload,
  type LaunchPhaseView,
  type EndlessStateView
} from "./net";

type Screen =
  | "title"
  | "mode"
  | "builder"
  | "draft"
  | "room"
  | "launch"
  | "match"
  | "result";
type NetworkRole = "solo" | "host" | "guest";

interface GameSettings {
  playerCount: VortexPlayerCount;
  costLimit: BuildCostLimit;
  arenaId: SimRingArena["id"];
  mode: VortexGameMode;
}

interface FinishedMatch {
  result: MatchResult;
  state: MatchState;
  builds: readonly TopBuildSpec[];
}

interface NetworkDraftSnapshot {
  draft: DraftState;
  deadlineAt: number;
}

interface LocalLaunchState {
  readonly builds: readonly TopBuildSpec[];
  readonly spec: LaunchMeterSpec;
  readonly cpuPowers: readonly number[];
}

interface NetworkStartInfo extends Omit<VortexStartPayload, "settings"> {
  readonly settings: GameSettings;
}

const BASE_URL = import.meta.env.BASE_URL;
const PLAYER_COLORS = [0x48d9ff, 0xffa83d, 0xff5bd7, 0x65f4a5] as const;
const STAT_LABELS = {
  attack: "攻撃",
  defense: "防御",
  stamina: "持久",
  stability: "安定",
  mobility: "機動",
  durability: "耐久"
} as const;
const RING_DESCRIPTIONS: Record<SimRingArena["id"], string> = {
  "core-bowl": "中央へ自然に引き寄せる標準的な深皿。攻防持久すべてが機能します。",
  "wide-dish": "広く浅い長期戦型。高機動の追跡と持久構成が力を発揮します。",
  "pressure-crater": "狭く急角度の圧力釜。序盤から激しい衝突と場外が発生します。",
  "wave-ring": "対称的な波状バンクが軌道を揺さぶり、衝突角を刻々と変化させます。",
  "eclipse-ring": "中央隆起と環状窪みを併せ持つ二重軌道。位置条件スキル向けです。"
};

const DEFAULT_SETTINGS: GameSettings = {
  playerCount: 4,
  costLimit: 1000,
  arenaId: "core-bowl",
  mode: "custom"
};

function isFiniteBudget(value: BuildCostLimit): boolean {
  return Number.isFinite(value);
}

function budgetLabel(value: BuildCostLimit): string {
  return Number.isFinite(value) ? String(value) : "∞";
}

function postArenaNavigation(target: "lobby" | "harbor"): void {
  if (window.parent !== window) {
    window.parent.postMessage({ type: "alice-arena:navigate", target }, window.location.origin);
    return;
  }
  window.location.assign(BASE_URL);
}

function buildFromUrl(): TopBuildSpec {
  const code = new URLSearchParams(window.location.search).get("build");
  return (code ? decodeBuild(code) : null) ?? createDefaultBuild("VORTEX-01");
}

function partToVisual(part: TopPartDef): TopVisualPart {
  const signature =
    part.grade !== "signature"
      ? undefined
      : part.id.endsWith("-zenith")
        ? 0
        : part.id.endsWith("-paragon")
          ? 1
          : 2;
  return {
    id: part.id,
    slot: TOP_SLOTS.indexOf(part.slot),
    lineage: TOP_LINEAGES.indexOf(part.lineage),
    role: TOP_ROLES.indexOf(part.role),
    grade: part.grade === "signature" ? 2 : part.grade - 1,
    ...(signature === undefined ? {} : { signature }),
    color: part.visual.primaryColor
  };
}

function buildToVisual(build: TopBuildSpec): TopVisualSpec {
  return {
    paint: build.paint,
    parts: TOP_SLOTS.map((slot) => getPart(build.parts[slot])).filter(
      (part): part is TopPartDef => part !== undefined
    ).map(partToVisual)
  };
}


function makeBattleBuilds(
  player: TopBuildSpec,
  settings: GameSettings
): readonly TopBuildSpec[] {
  return Array.from({ length: settings.playerCount }, (_, seat) =>
    seat === 0
      ? player
      : {
          ...makeCpuBuild(seat, settings.costLimit, settings.arenaId.length + settings.playerCount),
          paint: PLAYER_COLORS[seat % PLAYER_COLORS.length]!
        }
  );
}

function arenaVisual(arena: SimRingArena): BattleArenaVisual {
  const radius = arena.outRadius;
  return {
    id: arena.id,
    radius,
    lipHeight: 0.42,
    profile: arena.profile.map((point) => [point.radius / radius, point.height] as const),
    waveAmplitude: arena.waveAmplitude,
    waveCount: arena.waveCount,
    colors:
      arena.id === "pressure-crater"
        ? [0x100707, 0x39201b, 0xff8d3e]
        : arena.id === "eclipse-ring"
          ? [0x070613, 0x25213c, 0xc277ff]
          : [0x050a0d, 0x19313a, 0x62ddff]
  };
}

function createRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]!).join("");
}

function cpuLaunchPower(seed: number, seat: number): number {
  let value = (seed ^ Math.imul(seat + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  const normalized = ((value ^ (value >>> 16)) >>> 0) / 4_294_967_296;
  return 0.68 + normalized * 0.49;
}

function useBroadcastTransport(): boolean {
  return new URLSearchParams(window.location.search).get("transport") === "broadcast";
}

function toRoomSettings(settings: GameSettings): VortexRoomSettings {
  return {
    costLimit: settings.costLimit,
    arenaId: settings.arenaId,
    mode: settings.mode,
    playerCount: settings.playerCount,
    cpuCount: settings.mode === "endless" ? 0 : settings.playerCount - 1,
    seed: Date.now() >>> 0,
    draftTurnSec: 12
  };
}

function snapshotToMatchState(
  snapshot: VortexSnapshot,
  names: readonly string[],
  lobby: VortexLobby | null
): MatchState {
  return {
    tick: snapshot.tick,
    elapsed: snapshot.elapsed,
    phase: snapshot.phase,
    suddenDeathStage: snapshot.suddenDeathStage,
    arenaId: snapshot.arenaId,
    tops: snapshot.tops.map((top) => ({
      seat: top.seat,
      name: names[top.seat] ?? lobby?.seats[top.seat]?.name ?? `P${top.seat + 1}`,
      alive: top.alive,
      hp: top.hp,
      hpMax: top.hpMax,
      spin: top.spin,
      position: [top.x, top.y, top.z],
      rotation: [top.qx, top.qy, top.qz, top.qw],
      velocity: [top.vx, top.vy, top.vz],
      skills: top.skills.map((skill) => ({
        slot: skill.slot,
        skillId: skill.skillId,
        name: skill.skillId ? getActiveSkill(skill.skillId)?.nameJa ?? skill.skillId : null,
        cooldownRemaining: skill.cooldown,
        chargesRemaining: skill.charges,
        ready: skill.ready,
        blockedReason: skill.blocked,
        groupSize: skill.groupSize,
        readyCount: skill.readyCount
      })),
      lastHitAt: Number.NEGATIVE_INFINITY,
      cpu: lobby?.seats[top.seat]?.occupant === "cpu"
    }))
  };
}

function TopBar({
  onLogo,
  status = "HOST PHYSICS / 60 HZ"
}: {
  onLogo: () => void;
  status?: string;
}) {
  return (
    <header className="vc-topbar">
      <button className="vc-btn vc-btn--ghost vc-btn--icon" onClick={onLogo} aria-label="戻る">
        ←
      </button>
      <div className="vc-brand">
        <i />
        VORTEX CROWN
        <small>ARENA // 02</small>
      </div>
      <div className="vc-topbar__status">{status}</div>
    </header>
  );
}

function TitleScreen({
  onSolo,
  onHost,
  onJoin
}: {
  onSolo: () => void;
  onHost: () => void;
  onJoin: () => void;
}) {
  return (
    <main className="vc-title" data-testid="vortex-title">
      <img
        className="vc-title__art"
        src={`${BASE_URL}assets/vortex-crown-cover.webp`}
        alt=""
        fetchPriority="high"
      />
      <section className="vc-title__content">
        <div className="vc-kicker">ALICE HARBOR / ARENA PROJECT 02</div>
        <h1>
          VORTEX <span>CROWN</span>
        </h1>
        <p className="vc-title__lead">
          7部位・777パーツで近未来競技コマを設計。物理演算で激突する2〜4機の頂点を、
          1〜7のActiveスキルだけで奪い取れ。
        </p>
        <div className="vc-title__actions">
          <button className="vc-btn vc-btn--primary" onClick={onSolo} data-testid="solo-start">
            SOLO / CPU BATTLE
          </button>
          <button className="vc-btn" onClick={onHost}>
            P2P HOST
          </button>
          <button className="vc-btn" onClick={onJoin}>
            ROOM JOIN
          </button>
          <button className="vc-btn vc-btn--ghost" onClick={() => postArenaNavigation("lobby")}>
            闘技場ロビーへ
          </button>
        </div>
        <ul className="vc-title__specs">
          <li><strong>777</strong> ORIGINAL PARTS</li>
          <li><strong>7</strong> ACTIVE SLOTS</li>
          <li><strong>5</strong> PHYSICS RINGS</li>
          <li><strong>2–4</strong> PLAYER P2P</li>
        </ul>
      </section>
    </main>
  );
}

function SettingsFields({
  settings,
  onChange,
  allowPlayers = true
}: {
  settings: GameSettings;
  onChange: (settings: GameSettings) => void;
  allowPlayers?: boolean;
}) {
  return (
    <div className="vc-config">
      <div className="vc-field">
        <label htmlFor="vc-player-count">参加機体</label>
        <select
          id="vc-player-count"
          value={settings.playerCount}
          disabled={!allowPlayers}
          onChange={(event) =>
            onChange({ ...settings, playerCount: Number(event.target.value) as VortexPlayerCount })
          }
        >
          <option value={2}>2機</option>
          <option value={3}>3機</option>
          <option value={4}>4機</option>
        </select>
      </div>
      <div className="vc-field">
        <label htmlFor="vc-cost-limit">コスト上限</label>
        <select
          id="vc-cost-limit"
          value={Number.isFinite(settings.costLimit) ? settings.costLimit : "infinity"}
          onChange={(event) =>
            onChange({
              ...settings,
              costLimit:
                event.target.value === "infinity" ? Number.POSITIVE_INFINITY : Number(event.target.value)
            })
          }
        >
          <option value={700}>700 / LIGHT</option>
          <option value={1000}>1000 / STANDARD</option>
          <option value={1300}>1300 / HEAVY</option>
          <option value="infinity">∞ / SANDBOX</option>
        </select>
      </div>
      <div className="vc-field">
        <label htmlFor="vc-ring">リング</label>
        <select
          id="vc-ring"
          value={settings.arenaId}
          onChange={(event) =>
            onChange({ ...settings, arenaId: event.target.value as SimRingArena["id"] })
          }
        >
          {RING_ARENAS.map((arena) => (
            <option value={arena.id} key={arena.id}>{arena.nameJa} / {arena.name}</option>
          ))}
        </select>
      </div>
      <div className="vc-field">
        <span>カタログ</span>
        <strong>{PARTS.length} PARTS / {ACTIVE_SKILLS.length + PASSIVE_SKILLS.length} SKILLS</strong>
      </div>
    </div>
  );
}

function ModeScreen({
  role,
  settings,
  onSettings,
  onBack,
  onCustom,
  onDraft,
  onEndless,
  onQuick
}: {
  role: NetworkRole;
  settings: GameSettings;
  onSettings: (settings: GameSettings) => void;
  onBack: () => void;
  onCustom: () => void;
  onDraft: () => void;
  onEndless: () => void;
  onQuick: () => void;
}) {
  const online = role !== "solo";
  return (
    <main className="vc-screen">
      <TopBar onLogo={onBack} status={online ? "P2P AUTHORITATIVE HOST" : "LOCAL RAPier SESSION"} />
      <div className="vc-shell">
        <div className="vc-section-head">
          <div>
            <div className="vc-kicker">{online ? "P2P ROOM SETUP" : "SOLO OPERATIONS"}</div>
            <h1>SELECT FORMAT</h1>
            <p>リングとコストを決め、自由構築またはスネークドラフトで出撃します。</p>
          </div>
          <button className="vc-btn vc-btn--ghost" onClick={() => postArenaNavigation("lobby")}>
            闘技場へ戻る
          </button>
        </div>
        <div className="vc-mode-grid">
          <button className="vc-mode-card" onClick={onCustom} data-testid="mode-custom">
            <b>CUSTOM</b>
            <small>777-PART FREE BUILD</small>
            <p>全7部位を3Dエディタで組み上げ、コストとシナジーを見ながら完成させます。</p>
          </button>
          <button className="vc-mode-card" onClick={onDraft} data-testid="mode-draft">
            <b>DRAFT</b>
            <small>7-ROUND SNAKE PICK</small>
            <p>部位ごとに順番を反転。取得済みパーツと予算予約をホストが厳密に検証します。</p>
          </button>
          {role === "host" && (
            <button
              className="vc-mode-card vc-mode-card--endless"
              onClick={onEndless}
              data-testid="mode-endless"
            >
              <b>ENDLESS CO-OP</b>
              <small>2–4 PILOTS / ROGUELIKE WAVES</small>
              <p>
                人数分の仲間だけで共闘。各WAVE後に3択でパーツを重ね、
                同部位Activeを一斉発動して無限強化の敵へ挑みます。
              </p>
            </button>
          )}
          <button className="vc-mode-card" onClick={onQuick}>
            <b>QUICK LAUNCH</b>
            <small>INSTANT PHYSICS MATCH</small>
            <p>現在の保存機体で即出撃。CPUはコスト内で役割と系統を組み合わせます。</p>
          </button>
        </div>
        <SettingsFields settings={settings} onChange={onSettings} />
        <div style={{ marginTop: 16, color: "var(--vc-muted)", fontSize: 11, lineHeight: 1.8 }}>
          {RING_DESCRIPTIONS[settings.arenaId]}
        </div>
      </div>
    </main>
  );
}

function BuilderCanvas({
  build,
  selectedSlot,
  exploded,
  onReady
}: {
  build: TopBuildSpec;
  selectedSlot: TopSlot;
  exploded: boolean;
  onReady?: (scene: VortexBuilderScene | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<VortexBuilderScene | null>(null);
  const visual = useMemo(() => buildToVisual(build), [build]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = createVortexBuilderScene(canvas, visual);
    sceneRef.current = scene;
    onReady?.(scene);
    return () => {
      onReady?.(null);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setSpec(visual);
  }, [visual]);

  useEffect(() => {
    sceneRef.current?.setSelectedSlot(TOP_SLOTS.indexOf(selectedSlot));
  }, [selectedSlot]);

  useEffect(() => {
    sceneRef.current?.setExploded(exploded);
  }, [exploded]);

  return <canvas ref={canvasRef} aria-label="7部位3Dコマプレビュー" />;
}

function BuilderScreen({
  build,
  settings,
  onBuild,
  onBack,
  onLaunch,
  launchLabel = "LAUNCH MATCH"
}: {
  build: TopBuildSpec;
  settings: GameSettings;
  onBuild: (build: TopBuildSpec) => void;
  onBack: () => void;
  onLaunch: () => void;
  launchLabel?: string;
}) {
  const [slot, setSlot] = useState<TopSlot>("crest");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<PartKind | "all">("all");
  const [lineage, setLineage] = useState<TopLineage | "all">("all");
  const [role, setRole] = useState<TopRole | "all">("all");
  const [compareMode, setCompareMode] = useState(false);
  const [comparison, setComparison] = useState<TopPartDef | null>(null);
  const [exploded, setExploded] = useState(true);
  const [statsOpen, setStatsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [garage, setGarage] = useState<TopBuildSpec[]>(() => loadGarage());
  const [scene, setScene] = useState<VortexBuilderScene | null>(null);
  const currentPart = getPart(build.parts[slot])!;
  const derived = useMemo(() => deriveBuildStats(build), [build]);
  const validation = useMemo(
    () => validateBuild(build, settings.costLimit),
    [build, settings.costLimit]
  );
  const parts = useMemo(
    () =>
      searchParts(slot, {
        query,
        kinds: kind === "all" ? undefined : [kind],
        lineages: lineage === "all" ? undefined : [lineage],
        roles: role === "all" ? undefined : [role]
      }),
    [slot, query, kind, lineage, role]
  );
  const selectedActive = currentPart.activeSkillId
    ? getActiveSkill(currentPart.activeSkillId)
    : undefined;
  const selectedPassive = currentPart.passiveSkillId
    ? getPassiveSkill(currentPart.passiveSkillId)
    : undefined;

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  const save = () => {
    const next = upsertGarageBuild(garage, build);
    saveGarage(next);
    setGarage(next);
    showToast(`GARAGEへ「${build.name}」を保存しました`);
  };

  const share = async () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("build", encodeBuild(build));
    try {
      await navigator.clipboard.writeText(url.toString());
      showToast("共有URLをコピーしました");
    } catch {
      window.prompt("共有URLをコピーしてください", url.toString());
    }
  };

  return (
    <main className="vc-screen">
      <TopBar onLogo={onBack} status={`BUILD COST ${derived.totalCost} / ${budgetLabel(settings.costLimit)}`} />
      <div className="vc-builder">
        <aside className="vc-builder__parts">
          <div className="vc-panel-head">
            <small>SLOT {SLOT_META[slot].number} / {SLOT_META[slot].purposeJa}</small>
            <h2>{SLOT_META[slot].name} // {SLOT_META[slot].nameJa}</h2>
          </div>
          <div className="vc-slot-tabs" aria-label="部位選択">
            {TOP_SLOTS.map((candidate) => (
              <button
                key={candidate}
                className={candidate === slot ? "is-active" : ""}
                onClick={() => setSlot(candidate)}
                aria-label={`${SLOT_META[candidate].number} ${SLOT_META[candidate].nameJa}`}
              >
                {SLOT_META[candidate].number}
              </button>
            ))}
          </div>
          <div className="vc-part-tools">
            <input
              className="vc-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名称・系統・スキル検索"
              aria-label="パーツ検索"
            />
            <select
              className="vc-search"
              value={kind}
              onChange={(event) => setKind(event.target.value as PartKind | "all")}
              aria-label="パーツ種別"
            >
              <option value="all">ALL</option>
              <option value="stat">STAT</option>
              <option value="passive">PASSIVE</option>
              <option value="active">ACTIVE</option>
            </select>
            <button
              className={`vc-btn${compareMode ? " vc-btn--primary" : ""}`}
              onClick={() => {
                setCompareMode((value) => !value);
                setComparison(null);
              }}
              aria-pressed={compareMode}
            >
              比較
            </button>
          </div>
          <div className="vc-part-tools">
            <select
              className="vc-search"
              value={lineage}
              onChange={(event) => setLineage(event.target.value as TopLineage | "all")}
              aria-label="系統"
            >
              <option value="all">全9系統</option>
              {TOP_LINEAGES.map((value) => (
                <option value={value} key={value}>{LINEAGE_META[value].nameJa}</option>
              ))}
            </select>
            <select
              className="vc-search"
              value={role}
              onChange={(event) => setRole(event.target.value as TopRole | "all")}
              aria-label="役割"
            >
              <option value="all">全役割</option>
              {TOP_ROLES.map((value) => (
                <option value={value} key={value}>{ROLE_META[value].nameJa}</option>
              ))}
            </select>
          </div>
          <div className="vc-part-list" data-testid="part-list">
            {parts.map((part) => (
              <button
                className={`vc-part${part.id === currentPart.id ? " is-selected" : ""}`}
                key={part.id}
                onClick={() => {
                  if (compareMode) setComparison(part);
                  else onBuild({
                    ...build,
                    parts: { ...build.parts, [slot]: part.id }
                  });
                }}
              >
                <span
                  className="vc-part__glyph"
                  style={{ "--part-color": `#${part.visual.primaryColor.toString(16).padStart(6, "0")}` } as CSSProperties}
                >
                  {part.visual.bladeCount}
                </span>
                <span>
                  <strong>{part.nameJa}</strong>
                  <small>{part.lineage} / {part.role} / {part.kind} / {String(part.grade)}</small>
                </span>
                <span className="vc-part__cost">{part.cost}C</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="vc-builder__stage">
          <BuilderCanvas
            build={build}
            selectedSlot={slot}
            exploded={exploded}
            onReady={setScene}
          />
          <div className="vc-stage-label">
            <strong>{build.name}</strong>
            DRAG ROTATE / WHEEL ZOOM / {exploded ? "EXPLODED" : "ASSEMBLED"} VIEW
          </div>
          <div className="vc-stage-tools">
            <button className="vc-btn" onClick={() => setExploded((value) => !value)}>
              {exploded ? "完成表示" : "分解表示"}
            </button>
            <button className="vc-btn" onClick={() => scene?.resetCamera()}>視点リセット</button>
            <button className="vc-btn" onClick={() => setStatsOpen((value) => !value)}>性能</button>
          </div>
        </section>

        <aside className={`vc-builder__stats${statsOpen ? " is-open" : ""}`}>
          <div className="vc-panel-head">
            <small>LIVE BUILD ANALYSIS</small>
            <h2>{currentPart.nameJa}</h2>
            <button
              className="vc-panel-close"
              type="button"
              onClick={() => setStatsOpen(false)}
              aria-label="性能パネルを閉じる"
            >
              ×
            </button>
          </div>
          <div className="vc-stat-block">
            <label className="vc-field" style={{ padding: 8 }}>
              <span>機体名</span>
              <input
                value={build.name}
                maxLength={64}
                onChange={(event) => onBuild({ ...build, name: event.target.value })}
              />
            </label>
            <label className="vc-field" style={{ padding: 8, marginTop: 8 }}>
              <span>エネルギーペイント</span>
              <input
                type="color"
                value={`#${build.paint.toString(16).padStart(6, "0")}`}
                onChange={(event) => onBuild({
                  ...build,
                  paint: Number.parseInt(event.target.value.slice(1), 16)
                })}
              />
            </label>
            <div className="vc-budget">
              <strong>{derived.totalCost} C</strong>
              <small>LIMIT {budgetLabel(settings.costLimit)}</small>
            </div>
            <div className={`vc-budget-meter${validation.ok ? "" : " is-over"}`}>
              <i
                style={{
                  width: `${Number.isFinite(settings.costLimit)
                    ? Math.min(100, derived.totalCost / settings.costLimit * 100)
                    : Math.min(100, derived.totalCost / 13)}%`
                }}
              />
            </div>
          </div>
          <div className="vc-stat-block vc-stats">
            {(Object.keys(STAT_LABELS) as (keyof typeof STAT_LABELS)[]).map((stat) => (
              <div className="vc-stat" key={stat}>
                <span>{STAT_LABELS[stat]}</span>
                <span className="vc-stat__bar">
                  <i style={{ width: `${Math.min(100, derived.stats[stat] / 6)}%` }} />
                </span>
                <strong>{Math.round(derived.stats[stat])}</strong>
              </div>
            ))}
          </div>
          <div className="vc-stat-block">
            <div className="vc-kicker">SELECTED PART</div>
            <p style={{ color: "var(--vc-muted)", fontSize: 10, lineHeight: 1.65 }}>
              {currentPart.descriptionJa}
            </p>
            {(selectedActive || selectedPassive) && (
              <div className={`vc-chip ${selectedActive ? "vc-chip--active" : "vc-chip--passive"}`}>
                <b>{selectedActive ? "ACTIVE" : "PASSIVE"} // {(selectedActive ?? selectedPassive)!.nameJa}</b>
                <small>{(selectedActive ?? selectedPassive)!.descriptionJa}</small>
              </div>
            )}
            {comparison && (
              <div className="vc-chip vc-chip--active" style={{ marginTop: 8 }}>
                <b>COMPARE // {comparison.nameJa}</b>
                <small>
                  {Object.entries(STAT_LABELS).map(([stat, label]) => {
                    const key = stat as keyof typeof STAT_LABELS;
                    const delta = comparison.stats[key] - currentPart.stats[key];
                    return `${label} ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`;
                  }).join(" / ")}
                </small>
                <button
                  className="vc-btn vc-btn--primary"
                  style={{ marginTop: 7 }}
                  onClick={() => {
                    onBuild({ ...build, parts: { ...build.parts, [slot]: comparison.id } });
                    setComparison(null);
                    setCompareMode(false);
                  }}
                >
                  このパーツを装着
                </button>
              </div>
            )}
          </div>
          <div className="vc-stat-block">
            <div className="vc-kicker">SYNERGY FORECAST</div>
            <div className="vc-synergy-list" style={{ marginTop: 10 }}>
              {derived.synergies.length ? derived.synergies.map(({ synergy, sourceCount }) => (
                <div className="vc-chip" key={synergy.id}>
                  <b>{synergy.nameJa} × {sourceCount}</b>
                  <small>{synergy.descriptionJa}</small>
                </div>
              )) : (
                <small style={{ color: "var(--vc-muted)" }}>2部位以上の同系統または複合役割で発動</small>
              )}
            </div>
          </div>
          {!validation.ok && (
            <ul className="vc-errors">
              {validation.errors.map((error) => <li key={`${error.code}:${error.slot}`}>{error.message}</li>)}
            </ul>
          )}
          {garage.length > 0 && (
            <div className="vc-stat-block">
              <label className="vc-field" style={{ padding: 8 }}>
                <span>GARAGE LOAD ({garage.length})</span>
                <select
                  defaultValue=""
                  onChange={(event) => {
                    const selected = garage[Number(event.target.value)];
                    if (selected) onBuild(selected);
                    event.currentTarget.value = "";
                  }}
                >
                  <option value="" disabled>保存機体を選択</option>
                  {garage.map((saved, index) => (
                    <option key={`${saved.name}:${index}`} value={index}>{saved.name}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="vc-builder__actions">
            <button className="vc-btn" onClick={save}>保存</button>
            <button className="vc-btn" onClick={share}>共有</button>
            <button
              className="vc-btn vc-btn--primary"
              disabled={!validation.ok}
              onClick={onLaunch}
              data-testid="builder-launch"
            >
              {launchLabel}
            </button>
          </div>
        </aside>
      </div>
      {toast && <div className="vc-toast" role="status">{toast}</div>}
    </main>
  );
}

function DraftScreen({
  settings,
  onBack,
  onComplete
}: {
  settings: GameSettings;
  onBack: () => void;
  onComplete: (builds: readonly TopBuildSpec[]) => void;
}) {
  const [draft, setDraft] = useState<DraftState>(() =>
    createDraftState({
      players: settings.playerCount,
      costLimit: settings.costLimit,
      seed: `${settings.arenaId}:${Date.now()}`,
      nowMs: Date.now()
    })
  );
  const [now, setNow] = useState(Date.now());
  const slot = currentDraftSlot(draft);
  const playerIndex = currentDraftPlayerIndex(draft);
  const legal = useMemo(() => legalDraftPicks(draft), [draft]);
  const remaining = Math.max(0, Math.ceil((draft.deadlineMs - now) / 1000));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (draft.completed) return;
    const next = advanceAutomaticDraftTurns(draft, now);
    if (next !== draft) setDraft(next);
  }, [draft, now]);

  useEffect(() => {
    if (!draft.completed) return;
    const builds = draft.players.map((player, seat) =>
      draftBuildForPlayer(draft, seat, player.name, PLAYER_COLORS[seat]!)
    );
    const timer = window.setTimeout(() => onComplete(builds), 450);
    return () => window.clearTimeout(timer);
  }, [draft, onComplete]);

  const pick = (part: TopPartDef) => {
    if (playerIndex !== 0) return;
    setDraft((current) => advanceAutomaticDraftTurns(applyDraftPick(current, part.id, Date.now()), Date.now()));
  };

  return (
    <main className="vc-screen">
      <TopBar onLogo={onBack} status="SNAKE ORDER / 12 SEC TURN" />
      <div className="vc-draft">
        <aside>
          <div>
            <small style={{ color: "var(--vc-muted)" }}>TURN TIMER</small>
            <div className="vc-draft__timer">{remaining.toString().padStart(2, "0")}</div>
          </div>
          <div className="vc-draft__order">
            {draft.players.map((player, index) => (
              <div
                className={`vc-draft__seat${index === playerIndex ? " is-turn" : ""}`}
                key={player.id}
              >
                <strong>{player.name}</strong><br />
                <small>{player.isCpu ? "CPU AUTO" : "YOU"}</small>
              </div>
            ))}
          </div>
        </aside>
        <section className="vc-draft__pool">
          <div className="vc-section-head">
            <div>
              <div className="vc-kicker">ROUND {(draft.slotIndex + 1).toString().padStart(2, "0")} / 07</div>
              <h2>{slot ? `${SLOT_META[slot].name} // ${SLOT_META[slot].nameJa}` : "ASSEMBLING"}</h2>
              <p>{playerIndex === 0 ? "パーツを1つ選択してください" : "CPUが候補を解析中…"}</p>
            </div>
            <button className="vc-btn" onClick={onBack}>ドラフト中止</button>
          </div>
          <div className="vc-part-list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))" }}>
            {legal.map((part) => (
              <button
                className="vc-part"
                key={part.id}
                disabled={playerIndex !== 0}
                onClick={() => pick(part)}
              >
                <span
                  className="vc-part__glyph"
                  style={{ "--part-color": `#${part.visual.primaryColor.toString(16).padStart(6, "0")}` } as CSSProperties}
                >
                  {part.visual.bladeCount}
                </span>
                <span>
                  <strong>{part.nameJa}</strong>
                  <small>{part.lineage} / {part.role} / {part.kind}</small>
                </span>
                <span className="vc-part__cost">{part.cost}C</span>
              </button>
            ))}
          </div>
        </section>
        <aside>
          <div className="vc-kicker">PICK LOG</div>
          {draft.players.map((player, playerSeat) => (
            <div className="vc-stat-block" key={player.id}>
              <strong>{player.name}</strong>
              <div style={{ marginTop: 7, color: "var(--vc-muted)", fontSize: 9, lineHeight: 1.8 }}>
                {TOP_SLOTS.map((partSlot) => (
                  <div key={partSlot}>
                    {SLOT_META[partSlot].number}. {draft.picks[playerSeat]?.[partSlot]
                      ? getPart(draft.picks[playerSeat]![partSlot]!)?.nameJa
                      : "—"}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </aside>
      </div>
    </main>
  );
}

function NetworkDraftScreen({
  snapshot,
  seat,
  session,
  onExit
}: {
  snapshot: NetworkDraftSnapshot;
  seat: SeatIndex | null;
  session: VortexSession;
  onExit: () => void;
}) {
  const { draft, deadlineAt } = snapshot;
  const [now, setNow] = useState(() => performance.now());
  const slot = currentDraftSlot(draft);
  const playerIndex = currentDraftPlayerIndex(draft);
  const legal = useMemo(() => legalDraftPicks(draft), [draft]);
  const myTurn = seat !== null && playerIndex === seat;
  const remaining = draft.completed
    ? 0
    : Math.max(0, Math.ceil((deadlineAt - now) / 1000));

  useEffect(() => {
    setNow(performance.now());
    const timer = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);

  return (
    <main className="vc-screen">
      <TopBar onLogo={onExit} status="P2P DRAFT / HOST VERIFIED / 12 SEC" />
      <div className="vc-draft">
        <aside>
          <div>
            <small style={{ color: "var(--vc-muted)" }}>HOST TURN TIMER</small>
            <div className="vc-draft__timer">{remaining.toString().padStart(2, "0")}</div>
          </div>
          <div className="vc-draft__order">
            {draft.players.map((player, index) => (
              <div
                className={`vc-draft__seat${index === playerIndex ? " is-turn" : ""}`}
                key={player.id}
              >
                <strong>{player.name}</strong><br />
                <small>
                  {index === seat ? "YOU" : player.isCpu ? "CPU AUTO" : `P${index + 1}`}
                </small>
              </div>
            ))}
          </div>
        </aside>
        <section className="vc-draft__pool">
          <div className="vc-section-head">
            <div>
              <div className="vc-kicker">
                NETWORK ROUND {Math.min(7, draft.slotIndex + 1).toString().padStart(2, "0")} / 07
              </div>
              <h2>
                {slot
                  ? `${SLOT_META[slot].name} // ${SLOT_META[slot].nameJa}`
                  : "HOST ASSEMBLING BUILDS"}
              </h2>
              <p>
                {draft.completed
                  ? "7部位を検証し、物理戦を同期しています…"
                  : myTurn
                    ? "あなたの手番です。ホストが合法候補・取得済みID・残予算を再検証します。"
                    : `${draft.players[playerIndex ?? 0]?.name ?? "PLAYER"} の選択を待っています。`}
              </p>
            </div>
            <button className="vc-btn" onClick={onExit}>ルーム退出</button>
          </div>
          <div
            className="vc-part-list"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))"
            }}
          >
            {legal.map((part) => (
              <button
                className="vc-part"
                key={part.id}
                disabled={!myTurn || draft.completed}
                onClick={() => session.submitDraftPick(part.id)}
              >
                <span
                  className="vc-part__glyph"
                  style={{
                    "--part-color": `#${part.visual.primaryColor.toString(16).padStart(6, "0")}`
                  } as CSSProperties}
                >
                  {part.visual.bladeCount}
                </span>
                <span>
                  <strong>{part.nameJa}</strong>
                  <small>{part.lineage} / {part.role} / {part.kind}</small>
                </span>
                <span className="vc-part__cost">{part.cost}C</span>
              </button>
            ))}
          </div>
        </section>
        <aside>
          <div className="vc-kicker">CANONICAL PICK LOG</div>
          {draft.players.map((player, playerSeat) => (
            <div className="vc-stat-block" key={player.id}>
              <strong>{player.name}</strong>
              <div style={{ marginTop: 7, color: "var(--vc-muted)", fontSize: 9, lineHeight: 1.8 }}>
                {TOP_SLOTS.map((partSlot) => (
                  <div key={partSlot}>
                    {SLOT_META[partSlot].number}. {draft.picks[playerSeat]?.[partSlot]
                      ? getPart(draft.picks[playerSeat]![partSlot]!)?.nameJa
                      : "—"}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </aside>
      </div>
    </main>
  );
}

function stateToVisual(
  state: MatchState,
  events: readonly SimEvent[]
): BattleSnapshotVisual {
  return {
    tick: state.tick,
    elapsed: state.elapsed,
    phase: state.phase,
    bots: state.tops.map((top) => ({
      seat: top.seat,
      alive: top.alive,
      x: top.position[0],
      y: top.position[1],
      z: top.position[2],
      qx: top.rotation[0],
      qy: top.rotation[1],
      qz: top.rotation[2],
      qw: top.rotation[3],
      hp: top.hp,
      spin: top.spin
    })),
    // Straight through. Translating these into a second shape is what lost
    // shockwave, sudden-death and skillId in the first place.
    events
  };
}

/**
 * The skill dock, once.
 *
 * There were two of these — one in MatchScreen, one in NetworkMatchView — and
 * they had already drifted: only the network copy showed the stacked-slot sync
 * count, and only the solo copy carried an aria-label. Two copies of one
 * control means every fix lands in one of them.
 *
 * Empty slots are not rendered. Seven buttons reading "NO ACTIVE" told the
 * player nothing except that the dock has seven positions, and pushed the ones
 * that do something to the edge of a row they did not need to share.
 */
/**
 * Mute toggle. Reads/writes the singleton, keeps a local mirror only so
 * React re-renders the label — the singleton (and vc.audio.v1 behind it)
 * stays the single source of truth, which is why the M key handler does not
 * need to reach this component.
 */
function AudioToggle() {
  const [muted, setMutedState] = useState(vortexAudio.muted);
  useEffect(() => {
    // The M key flips the singleton without React knowing; poll cheaply.
    const timer = window.setInterval(() => setMutedState(vortexAudio.muted), 500);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <button
      className="vc-btn vc-btn--ghost"
      style={{ pointerEvents: "auto" }}
      aria-label={muted ? "音を出す" : "音を消す"}
      title="M"
      onClick={() => {
        vortexAudio.unlock();
        vortexAudio.setMuted(!muted);
        setMutedState(!muted);
      }}
    >
      {muted ? "SOUND OFF" : "SOUND ON"}
    </button>
  );
}

function SkillDock({
  skills,
  disabled,
  onActivate
}: {
  skills: readonly SkillRuntimeState[] | undefined;
  disabled: boolean;
  onActivate: (slot: SkillSlot) => void;
}) {
  const equipped = Array.from({ length: 7 }, (_, index) => ({
    index,
    skill: skills?.[index]
  })).filter((entry) => entry.skill?.skillId);

  /* A build really can carry no active skills — QUICK LAUNCH produces one.
     Seven disabled buttons said that badly; saying nothing at all says it
     worse, because the player cannot tell the dock from a bug. */
  if (equipped.length === 0) {
    return (
      <div className="vc-skills vc-skills--empty" aria-label="アクティブスキル">
        <p>この機体にアクティブスキルはありません</p>
      </div>
    );
  }

  return (
    <div className="vc-skills" aria-label="アクティブスキル">
      {equipped.map(({ index, skill }) => {
        const definition = skill?.skillId ? getActiveSkill(skill.skillId) : undefined;
        const totalCooldown = definition?.cooldownSec ?? 1;
        const remaining = Math.max(0, skill?.cooldownRemaining ?? 0);
        const family = fxFamilyForSkill(skill?.skillId ?? undefined);
        const stacked = (skill?.groupSize ?? 1) > 1;
        return (
          <button
            className="vc-skill"
            key={index}
            data-family={family ?? undefined}
            data-ready={skill?.ready ? "yes" : "no"}
            disabled={!skill?.ready || disabled}
            onClick={() => onActivate((index + 1) as SkillSlot)}
            style={
              {
                "--cooldown": `${Math.min(100, (remaining / totalCooldown) * 100)}%`,
                /* The button wears the colour its effect will be, so the dock
                   and the arena teach each other. */
                "--family": family ? FX_FAMILY_TINTS[family] : "var(--vc-cyan)"
              } as CSSProperties
            }
            aria-label={`${index + 1} ${skill?.name ?? ""}${skill?.ready ? "" : " 使用不可"}`}
          >
            <span className="vc-skill__key">{index + 1}</span>
            <strong>{skill?.name}</strong>
            <small>
              {stacked
                ? `${skill?.readyCount ?? 0}/${skill?.groupSize} SYNC`
                : remaining > 0.05
                  ? `${remaining.toFixed(1)}s`
                  : (skill?.chargesRemaining ?? -1) < 0
                    ? "∞"
                    : `×${skill?.chargesRemaining}`}
            </small>
          </button>
        );
      })}
    </div>
  );
}

function MatchScreen({
  builds,
  settings,
  launchPowers,
  onExit,
  onFinished
}: {
  builds: readonly TopBuildSpec[];
  settings: GameSettings;
  launchPowers: readonly number[];
  onExit: () => void;
  onFinished: (match: FinishedMatch) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<VortexSim | null>(null);
  const sceneRef = useRef<VortexBattleScene | null>(null);
  const [state, setState] = useState<MatchState | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [error, setError] = useState("");
  const resultSent = useRef(false);

  const activate = useCallback((slot: SkillSlot) => {
    simRef.current?.activate(0, slot);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^[1-7]$/u.test(event.key)) {
        event.preventDefault();
        activate(Number(event.key) as SkillSlot);
      } else if (event.key === "Escape") {
        setPaused((value) => !value);
      } else if (event.key === "m" || event.key === "M") {
        vortexAudio.setMuted(!vortexAudio.muted);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // The sudden-death drone must not outlive the match that earned it.
      vortexAudio.reset();
    };
  }, [activate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let animation = 0;
    let previous = performance.now();
    let accumulator = 0;
    const scene = createVortexBattleScene(canvas, vortexAudio);
    sceneRef.current = scene;
    /* Verification seam. The battle canvas cannot be screenshotted from the
       harness, so the only way to check what is actually in the scene — draw
       calls, triangles, whether the arcade got built — is to ask it. */
    (window as unknown as { __vortexScene?: unknown }).__vortexScene = scene;
    const arena = RING_ARENAS.find((candidate) => candidate.id === settings.arenaId)!;
    const visualBuilds = builds.map(buildToVisual);
    scene.setup(visualBuilds, builds.map((build) => build.name), arenaVisual(arena), 0);

    const onLost = (event: Event) => {
      event.preventDefault();
      setError("WebGLコンテキストを復旧しています…");
    };
    const onRestored = () => {
      setError("");
      scene.setup(visualBuilds, builds.map((build) => build.name), arenaVisual(arena), 0);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    void createVortexSim({
      seed: Date.now() >>> 0,
      builds: builds.map((build) => resolvedBuildFromDerived(deriveBuildStats(build))),
      names: builds.map((build) => build.name),
      arena,
      cpuSeats: builds.slice(1).map((_, index) => (index + 1) as SeatIndex),
      launchPower: launchPowers,
      countdownSec: 2.25,
      suddenDeathSec: 120,
      maxDurationSec: 240
    }).then((sim) => {
      if (disposed) {
        sim.dispose();
        return;
      }
      simRef.current = sim;
      const initial = sim.getState();
      setState(initial);
      scene.pushSnapshot(stateToVisual(initial, []));
      setLoading(false);

      const loop = (now: number) => {
        if (disposed) return;
        const delta = Math.min(0.1, Math.max(0, (now - previous) / 1000));
        previous = now;
        if (!pausedRef.current && !document.hidden) {
          accumulator = Math.min(0.1, accumulator + delta);
          let steps = 0;
          while (accumulator >= 1 / 60 && steps < 5) {
            sim.step();
            if (sim.phase === "live" && sim.tick % 12 === 0) {
              for (let seat = 1; seat < builds.length; seat += 1) {
                const slot = aiActivation(sim, seat as SeatIndex);
                if (slot !== null) sim.activate(seat as SeatIndex, slot);
              }
            }
            accumulator -= 1 / 60;
            steps += 1;
          }
          if (sim.tick % 3 === 0 || sim.phase === "over") {
            const nextState = sim.getState();
            const events = sim.drainEvents();
            scene.pushSnapshot(stateToVisual(nextState, events));
            setState(nextState);
          }
          const result = sim.result();
          if (result && !resultSent.current) {
            resultSent.current = true;
            const finalState = sim.getState();
            window.setTimeout(() => {
              if (!disposed) onFinished({ result, state: finalState, builds });
            }, 1200);
          }
        }
        animation = requestAnimationFrame(loop);
      };
      animation = requestAnimationFrame(loop);
    }).catch((reason: unknown) => {
      setLoading(false);
      setError(reason instanceof Error ? reason.message : "物理エンジンの起動に失敗しました");
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(animation);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      simRef.current?.dispose();
      simRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, [builds, settings.arenaId, launchPowers, onFinished]);

  useEffect(() => {
    pausedRef.current = paused;
    sceneRef.current?.setPaused(paused);
  }, [paused]);

  const me = state?.tops[0];
  const time = Math.floor(state?.elapsed ?? 0);
  const clock = `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}`;
  const countdown = state?.phase === "countdown";

  return (
    <main className="vc-match" data-testid="vortex-match">
      <canvas ref={canvasRef} />
      <div className="vc-match__top">
        <div className="vc-roster">
          {(state?.tops ?? builds.map((build, seat) => ({
            seat,
            name: build.name,
            alive: true,
            hp: 1,
            hpMax: 1,
            spin: 1
          }))).map((top) => (
            <div className={`vc-fighter${top.alive ? "" : " is-out"}`} key={top.seat}>
              <div className="vc-fighter__head">
                <b>P{top.seat + 1} {top.name}</b>
                <span>{top.alive ? "ACTIVE" : "OUT"}</span>
              </div>
              <div className="vc-fighter__meters">
                <span className="vc-meter vc-meter--hp">
                  <i style={{ width: `${Math.max(0, top.hp / Math.max(1, top.hpMax) * 100)}%` }} />
                </span>
                <span className="vc-meter">
                  <i style={{ width: `${Math.min(100, top.spin / 1.3)}%` }} />
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="vc-match__clock">
          {clock}
          <small>{(state?.suddenDeathStage ?? 0) > 0 ? `SUDDEN DEATH ${state!.suddenDeathStage}` : "BATTLE TIME"}</small>
        </div>
        <AudioToggle />
        <button className="vc-btn vc-btn--ghost" style={{ pointerEvents: "auto" }} onClick={() => setPaused((value) => !value)}>
          {paused ? "再開" : "PAUSE"}
        </button>
      </div>
      {(loading || countdown || paused || error) && (
        <div className="vc-match__message">
          {error || (loading ? "LOADING" : paused ? "PAUSED" : "READY")}
          <small>{paused ? "ESCで再開 / 終了は右上" : "HOST PHYSICS SYNCHRONIZING"}</small>
          {paused && (
            <button
              className="vc-btn vc-btn--danger"
              style={{ pointerEvents: "auto", marginTop: 30 }}
              onClick={onExit}
            >
              MATCHを終了
            </button>
          )}
        </div>
      )}
      <SkillDock skills={me?.skills} disabled={paused} onActivate={activate} />
    </main>
  );
}

function ResultScreen({
  match,
  onRematch,
  onBuilder,
  onTitle
}: {
  match: FinishedMatch;
  onRematch: () => void;
  onBuilder: () => void;
  onTitle: () => void;
}) {
  const sorted = [...match.state.tops].sort((first, second) => {
    if (first.alive !== second.alive) return first.alive ? -1 : 1;
    return second.hp - first.hp;
  });
  const winner = match.result.winner;
  return (
    <main className="vc-result">
      <TopBar onLogo={onTitle} status="MATCH ARCHIVE COMPLETE" />
      <section className="vc-result__card">
        <div className="vc-result__rank">FINAL CLASSIFICATION</div>
        <h1>{winner === 0 ? "VICTORY" : winner === null ? "DRAW" : "DEFEAT"}</h1>
        <h2>
          {winner === null ? "生存機なし" : `${match.state.tops.find((top) => top.seat === winner)?.name} が王冠を獲得`}
          {" / "}{match.result.reason === "ring-out" ? "場外決着" : match.result.reason === "destroyed" ? "破壊決着" : "判定"}
        </h2>
        <div className="vc-result__table">
          {sorted.map((top, index) => (
            <div className="vc-result__row" key={top.seat}>
              <b>{index + 1}</b>
              <strong>{top.name}</strong>
              <span>HP {Math.round(top.hp)}</span>
              <span>SPIN {Math.round(top.spin)}</span>
              <span>{top.alive ? "SURVIVED" : "KNOCKOUT"}</span>
            </div>
          ))}
        </div>
        <div className="vc-title__actions" style={{ justifyContent: "center" }}>
          <button className="vc-btn vc-btn--primary" onClick={onRematch}>REMATCH</button>
          <button className="vc-btn" onClick={onBuilder}>BUILD EDIT</button>
          <button className="vc-btn vc-btn--ghost" onClick={onTitle}>TITLE</button>
        </div>
      </section>
    </main>
  );
}

function endlessThreat(
  seed: number,
  wave: number,
  playerCount: VortexPlayerCount
): number {
  const enemyCount = playerCount === 2 ? 1 : 2;
  return Array.from({ length: enemyCount }, (_, variant) =>
    generateEndlessEnemy(seed, wave, variant).threatScore
  ).reduce((total, threat) => total + threat, 0);
}

function EndlessNetworkStateScreen({
  state,
  seat,
  playerCount,
  session,
  onExit
}: {
  state: EndlessStateView;
  seat: SeatIndex;
  playerCount: VortexPlayerCount;
  session: VortexSession;
  onExit: () => void;
}) {
  const nextThreat = useMemo(
    () => endlessThreat(state.run.seed, state.run.wave + 1, playerCount),
    [playerCount, state.run.seed, state.run.wave]
  );
  const totalAcquiredParts = useMemo(
    () =>
      state.run.players.reduce(
        (total, player) =>
          total +
          TOP_SLOTS.reduce(
            (playerTotal, slot) => playerTotal + player.build.parts[slot].length,
            0
          ),
        0
      ) - state.run.players.length * TOP_SLOTS.length,
    [state.run.players]
  );

  if (state.phase === "game-over" && state.gameOver) {
    return (
      <EndlessGameOverScreen
        reachedWave={state.gameOver.wave}
        clearedWaves={state.gameOver.cleared}
        score={state.gameOver.score}
        totalAcquiredParts={totalAcquiredParts}
        onExit={onExit}
      />
    );
  }

  const offer = state.run.rewardOffers.find(
    (candidate) => candidate.playerId === `seat-${seat + 1}`
  );
  if (state.phase === "reward" && offer) {
    return (
      <EndlessRewardScreen
        run={state.run}
        offer={offer}
        nextEnemyThreat={nextThreat}
        remainingMs={state.remainingMs}
        onPick={(partId) => session.submitEndlessReward(partId)}
        onExit={onExit}
      />
    );
  }

  return (
    <main className="vc-screen">
      <TopBar onLogo={onExit} status="ENDLESS HOST STATE" />
      <div className="vc-match__message">
        NEXT WAVE SYNCHRONIZING
        <small>ホストから正規WAVE状態を受信しています</small>
      </div>
    </main>
  );
}

function NetworkMatchView({
  session,
  snapshot,
  builds,
  names,
  settings,
  startInfo,
  endlessState,
  lobby,
  onExit
}: {
  session: VortexSession;
  snapshot: VortexSnapshot | null;
  builds: readonly TopBuildSpec[];
  names: readonly string[];
  settings: GameSettings;
  startInfo: NetworkStartInfo;
  endlessState: EndlessStateView | null;
  lobby: VortexLobby | null;
  onExit: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<VortexBattleScene | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [webglMessage, setWebglMessage] = useState("");
  const state = useMemo(
    () => snapshot ? snapshotToMatchState(snapshot, names, lobby) : null,
    [snapshot, names, lobby]
  );
  const mySeat = session.seat ?? 0;
  const me = state?.tops.find((top) => top.seat === mySeat);
  const battlePresentation = useMemo(
    () =>
      settings.mode === "endless" && startInfo.wave !== null
        ? {
            playerCount: settings.playerCount,
            wave: startInfo.wave,
            stackCounts: startInfo.stackCounts
          }
        : undefined,
    [
      settings.mode,
      settings.playerCount,
      startInfo.stackCounts,
      startInfo.wave
    ]
  );
  const currentThreat = useMemo(
    () =>
      settings.mode === "endless" &&
      startInfo.wave !== null &&
      endlessState
        ? endlessThreat(
            endlessState.run.seed,
            startInfo.wave,
            settings.playerCount
          )
        : 0,
    [
      endlessState,
      settings.mode,
      settings.playerCount,
      startInfo.wave
    ]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = createVortexBattleScene(canvas, vortexAudio);
    sceneRef.current = scene;
    const arena = RING_ARENAS.find((candidate) => candidate.id === settings.arenaId)!;
    scene.setup(
      builds.map(buildToVisual),
      names,
      arenaVisual(arena),
      mySeat,
      battlePresentation
    );
    const onLost = (event: Event) => {
      event.preventDefault();
      setWebglMessage("WebGLコンテキストを復旧しています…");
    };
    const onRestored = () => {
      setWebglMessage("");
      scene.setup(
        builds.map(buildToVisual),
        names,
        arenaVisual(arena),
        mySeat,
        battlePresentation
      );
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [battlePresentation, builds, names, settings.arenaId, mySeat]);

  useEffect(() => {
    if (!snapshot || !sceneRef.current) return;
    const matchState = snapshotToMatchState(snapshot, names, lobby);
    sceneRef.current.pushSnapshot(stateToVisual(matchState, snapshot.events));
  }, [snapshot, names, lobby]);

  useEffect(() => {
    sceneRef.current?.setPaused(menuOpen);
  }, [menuOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^[1-7]$/u.test(event.key)) {
        event.preventDefault();
        session.activate(Number(event.key) as SkillSlot);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen((value) => !value);
      } else if (event.key === "m" || event.key === "M") {
        vortexAudio.setMuted(!vortexAudio.muted);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      vortexAudio.reset();
    };
  }, [session]);

  const time = Math.floor(state?.elapsed ?? 0);
  const clock = `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}`;
  return (
    <main className="vc-match" data-testid="vortex-network-match">
      <canvas ref={canvasRef} />
      {startInfo.wave !== null && (
        <EndlessWaveBadge
          wave={startInfo.wave}
          isBoss={startInfo.wave % 5 === 0}
          enemyThreat={currentThreat}
          clearedWaves={endlessState?.run.clearedWaves}
        />
      )}
      <div className="vc-match__top">
        <div className="vc-roster">
          {(state?.tops ?? []).map((top) => (
            <div
              className={`vc-fighter${top.alive ? "" : " is-out"}${
                startInfo.teamIds[top.seat] === 1 ? " is-enemy" : ""
              }`}
              key={top.seat}
            >
              <div className="vc-fighter__head">
                <b>
                  {startInfo.teamIds[top.seat] === 1
                    ? "ENEMY"
                    : top.seat === mySeat
                      ? "YOU"
                      : `ALLY ${top.seat + 1}`}{" "}
                  {top.name}
                </b>
                <span>{top.alive ? "ACTIVE" : "OUT"}</span>
              </div>
              <div className="vc-fighter__meters">
                <span className="vc-meter vc-meter--hp">
                  <i style={{ width: `${Math.max(0, top.hp / Math.max(1, top.hpMax) * 100)}%` }} />
                </span>
                <span className="vc-meter">
                  <i style={{ width: `${Math.min(100, top.spin / 1.3)}%` }} />
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="vc-match__clock">
          {clock}
          <small>{(state?.suddenDeathStage ?? 0) > 0 ? `SUDDEN DEATH ${state!.suddenDeathStage}` : "20 HZ HOST SNAPSHOT"}</small>
        </div>
        <AudioToggle />
        <button className="vc-btn vc-btn--ghost" style={{ pointerEvents: "auto" }} onClick={() => setMenuOpen((value) => !value)}>
          MENU
        </button>
      </div>
      {(!snapshot || state?.phase === "countdown" || menuOpen || webglMessage) && (
        <div className="vc-match__message">
          {webglMessage || (menuOpen ? "NETWORK MENU" : snapshot ? "READY" : "SYNCING")}
          <small>{menuOpen ? "ホスト物理は継続します" : "100 MS INTERPOLATION BUFFER"}</small>
          {menuOpen && (
            <div className="vc-title__actions" style={{ justifyContent: "center", pointerEvents: "auto", marginTop: 28 }}>
              <button className="vc-btn" onClick={() => setMenuOpen(false)}>戦闘へ戻る</button>
              <button className="vc-btn vc-btn--danger" onClick={onExit}>ルーム退出</button>
            </div>
          )}
        </div>
      )}
      <SkillDock skills={me?.skills} disabled={menuOpen} onActivate={(slot) => session.activate(slot)} />
    </main>
  );
}

function NetworkRoomFlow({
  role,
  settings,
  onSettings,
  onBack,
  onEditBuild,
  build,
  onBuild,
  cpuBuilds,
  roomCode,
  onRoomCodeChange
}: {
  role: Exclude<NetworkRole, "solo">;
  settings: GameSettings;
  onSettings: (settings: GameSettings) => void;
  onBack: () => void;
  onEditBuild: () => void;
  build: TopBuildSpec;
  onBuild: (build: TopBuildSpec) => void;
  cpuBuilds?: readonly TopBuildSpec[];
  roomCode: string;
  onRoomCodeChange: (roomCode: string) => void;
}) {
  const generated = useMemo(createRoomCode, []);
  const buildCost = useMemo(() => deriveBuildStats(build).totalCost, [build]);
  const [session, setSession] = useState<VortexSession | null>(null);
  const sessionRef = useRef<VortexSession | null>(null);
  const [lobby, setLobby] = useState<VortexLobby | null>(null);
  const lobbyRef = useRef<VortexLobby | null>(null);
  const [snapshot, setSnapshot] = useState<VortexSnapshot | null>(null);
  const snapshotRef = useRef<VortexSnapshot | null>(null);
  const [networkDraft, setNetworkDraft] = useState<NetworkDraftSnapshot | null>(null);
  const [launchPhase, setLaunchPhase] = useState<LaunchPhaseView | null>(null);
  const [endlessState, setEndlessState] = useState<EndlessStateView | null>(null);
  const [startInfo, setStartInfo] = useState<NetworkStartInfo | null>(null);
  const [finished, setFinished] = useState<FinishedMatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [editingGuestBuild, setEditingGuestBuild] = useState(false);
  const [guestReady, setGuestReady] = useState(false);
  const [roomSettingsReceived, setRoomSettingsReceived] = useState(role === "host");
  const resultTimer = useRef<number | null>(null);

  const callbacks = useMemo(() => ({
    onLobby(nextLobby: VortexLobby) {
      lobbyRef.current = nextLobby;
      setLobby(nextLobby);
      const currentSeat = sessionRef.current?.seat;
      if (currentSeat !== null && currentSeat !== undefined) {
        setGuestReady(Boolean(nextLobby.seats[currentSeat]?.ready));
      }
    },
    onRoomSettings(roomSettings: VortexRoomSettings) {
      setRoomSettingsReceived(true);
      onSettings({
        playerCount: roomSettings.playerCount,
        costLimit:
          roomSettings.costLimit >= Number.MAX_SAFE_INTEGER
            ? Number.POSITIVE_INFINITY
            : roomSettings.costLimit,
        arenaId: roomSettings.arenaId as SimRingArena["id"],
        mode: roomSettings.mode
      });
    },
    onDraftState(nextDraft: DraftState, remainingMs: number) {
      setNetworkDraft({
        draft: nextDraft,
        deadlineAt: performance.now() + Math.max(0, remainingMs)
      });
    },
    onLaunchPhase(nextLaunch: LaunchPhaseView) {
      setLaunchPhase(nextLaunch);
      setStartInfo(null);
      setSnapshot(null);
      snapshotRef.current = null;
    },
    onEndlessState(nextEndless: EndlessStateView) {
      setEndlessState(nextEndless);
      if (nextEndless.phase !== "battle") {
        setLaunchPhase(null);
        setStartInfo(null);
        setSnapshot(null);
        snapshotRef.current = null;
      }
    },
    onStart(payload: VortexStartPayload) {
      setSnapshot(null);
      snapshotRef.current = null;
      setNetworkDraft(null);
      setLaunchPhase(null);
      setFinished(null);
      if (payload.settings.mode !== "endless") setEndlessState(null);
      setStartInfo({
        seed: payload.seed,
        builds: payload.builds,
        names: payload.names,
        launchPowers: payload.launchPowers,
        teamIds: payload.teamIds,
        wave: payload.wave,
        stackCounts: payload.stackCounts,
        settings: {
          playerCount: payload.settings.playerCount,
          costLimit:
            payload.settings.costLimit >= Number.MAX_SAFE_INTEGER
              ? Number.POSITIVE_INFINITY
              : payload.settings.costLimit,
          arenaId: payload.settings.arenaId as SimRingArena["id"],
          mode: payload.settings.mode
        }
      });
    },
    onSnapshot(nextSnapshot: VortexSnapshot) {
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
    },
    onResult(result: VortexResult) {
      const terminal = snapshotRef.current;
      setStartInfo((current) => {
        if (!current || !terminal) return current;
        const finalState = snapshotToMatchState(terminal, current.names, lobbyRef.current);
        resultTimer.current = window.setTimeout(() => {
          setFinished({
            result: { ...result },
            state: finalState,
            builds: current.builds
          });
        }, 900);
        return current;
      });
    },
    onError(message: string) {
      setError(message);
      setBusy(false);
    },
    onEnded(message: string) {
      const active = sessionRef.current;
      sessionRef.current = null;
      setSession(null);
      setNetworkDraft(null);
      setLaunchPhase(null);
      setEndlessState(null);
      setStartInfo(null);
      setSnapshot(null);
      snapshotRef.current = null;
      setGuestReady(false);
      setEditingGuestBuild(false);
      setRoomSettingsReceived(false);
      setBusy(false);
      setError(message);
      active?.dispose();
    }
  }), [onSettings]);

  useEffect(() => () => {
    if (resultTimer.current !== null) window.clearTimeout(resultTimer.current);
    sessionRef.current?.dispose();
    sessionRef.current = null;
  }, []);

  const attachSession = (next: VortexSession) => {
    sessionRef.current = next;
    setSession(next);
    setBusy(false);
  };

  const openHost = async () => {
    if (busy || sessionRef.current) return;
    setBusy(true);
    setError("");
    try {
      const next = await createHostSession({
        roomCode: generated,
        name: build.name,
        build,
        settings: toRoomSettings(settings),
        cpuBuilds: cpuBuilds ?? makeBattleBuilds(build, settings).slice(1),
        ...(useBroadcastTransport() ? { wire: createBroadcastChannelWire() } : {})
      }, callbacks);
      attachSession(next);
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : "ルームを開けませんでした");
    }
  };

  const joinRoom = async () => {
    if (busy || sessionRef.current) return;
    setBusy(true);
    setError("");
    setRoomSettingsReceived(false);
    try {
      const normalized = normalizeRoomCode(roomCode);
      const next = await createGuestSession(normalized, {
        name: build.name,
        build,
        interpolate: true,
        ...(useBroadcastTransport() ? { wire: createBroadcastChannelWire() } : {})
      }, callbacks);
      attachSession(next);
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : "ルームへ接続できませんでした");
    }
  };

  const startHost = async () => {
    if (!sessionRef.current || busy) return;
    setBusy(true);
    setError("");
    try {
      await sessionRef.current.start();
      setBusy(false);
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : "対戦を開始できませんでした");
    }
  };

  const confirmGuestBuild = async () => {
    const active = sessionRef.current;
    if (!active || busy || !roomSettingsReceived) return;
    const validation = validateBuild(
      build,
      settings.mode === "draft" ? Number.POSITIVE_INFINITY : settings.costLimit
    );
    if (!validation.ok) {
      setError(validation.errors.map((issue) => issue.message).join(" / "));
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (
        (settings.mode === "custom" || settings.mode === "endless") &&
        !active.updateBuild(build)
      ) {
        throw new Error("ビルド更新を送信できませんでした。");
      }
      await active.start();
      setEditingGuestBuild(false);
      setBusy(false);
    } catch (reason) {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : "READYにできませんでした");
    }
  };

  const exit = () => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    onBack();
  };

  if (finished) {
    return (
      <ResultScreen
        match={finished}
        onRematch={exit}
        onBuilder={exit}
        onTitle={exit}
      />
    );
  }

  if (role === "guest" && session && editingGuestBuild) {
    return (
      <BuilderScreen
        build={build}
        settings={settings}
        onBuild={onBuild}
        onBack={() => setEditingGuestBuild(false)}
        onLaunch={confirmGuestBuild}
        launchLabel={busy ? "VERIFYING…" : "ビルドを確定してREADY"}
      />
    );
  }

  if (launchPhase && session && session.seat !== null) {
    const visibleSeatCount =
      launchPhase.kind === "endless"
        ? endlessState?.run.players.length ?? settings.playerCount
        : launchPhase.specs.length;
    const localSpec = launchPhase.specs[session.seat];
    if (localSpec) {
      return (
        <LaunchMeterScreen
          spec={localSpec}
          remainingMs={launchPhase.remainingMs}
          seat={session.seat}
          seats={launchPhase.powers
            .slice(0, visibleSeatCount)
            .map((power, seat) => ({
              seat,
              name:
                endlessState?.run.players[seat]?.name ??
                lobby?.seats[seat]?.name ??
                `P${seat + 1}`,
              stopped: power !== null,
              power
            }))}
          wave={launchPhase.wave ?? undefined}
          title={
            launchPhase.kind === "endless"
              ? "SQUAD LAUNCH SYNCHRONIZER"
              : "LAUNCH SYNCHRONIZER"
          }
          onStop={(result) =>
            session.submitLaunchStop(result.stoppedAtMs)
          }
          onExit={exit}
        />
      );
    }
  }

  if (
    endlessState &&
    endlessState.phase !== "battle" &&
    session &&
    session.seat !== null
  ) {
    return (
      <EndlessNetworkStateScreen
        state={endlessState}
        seat={session.seat}
        playerCount={settings.playerCount}
        session={session}
        onExit={exit}
      />
    );
  }

  if (startInfo && session) {
    return (
      <NetworkMatchView
        session={session}
        snapshot={snapshot}
        builds={startInfo.builds}
        names={startInfo.names}
        settings={startInfo.settings}
        startInfo={startInfo}
        endlessState={endlessState}
        lobby={lobby}
        onExit={exit}
      />
    );
  }

  if (networkDraft && session) {
    return (
      <NetworkDraftScreen
        snapshot={networkDraft}
        seat={session.seat}
        session={session}
        onExit={exit}
      />
    );
  }

  const seats = lobby?.seats.slice(0, settings.playerCount) ??
    Array.from({ length: settings.playerCount }, (_, seat) => ({
      seat: seat as SeatIndex,
      name: seat === 0 && role === "host" ? build.name : "WAITING PEER",
      occupant: seat === 0 && role === "host" ? "host" as const : "empty" as const,
      ready: seat === 0 && role === "host",
      build: seat === 0 && role === "host" ? build : null
    }));
  const exactEndlessSquadReady =
    settings.mode !== "endless" ||
    seats.length === settings.playerCount &&
      seats.every((seat) =>
        (seat.occupant === "host" || seat.occupant === "guest") && seat.ready
      );

  return (
    <main className="vc-screen">
      <TopBar
        onLogo={exit}
        status={useBroadcastTransport() ? "BROADCASTCHANNEL QA TRANSPORT" : "PEERJS / HOST AUTHORITATIVE"}
      />
      <div className="vc-shell">
        <div className="vc-section-head">
          <div>
            <div className="vc-kicker">PRIVATE P2P ROOM</div>
            <h1>{role === "host" ? "HOST LOBBY" : "JOIN ROOM"}</h1>
            <p>専用 `vc-` プロトコル、20Hz量子化スナップショット、100ms補間で同期します。</p>
          </div>
        </div>
        <div className="vc-lobby-grid">
          <div className="vc-seats">
            {seats.map((seat) => (
              <div className="vc-seat" key={seat.seat}>
                <span className="vc-seat__num">{seat.seat + 1}</span>
                <span>
                  <strong>{seat.name}</strong>
                  <small>{seat.occupant.toUpperCase()} / {seat.build ? "BUILD VERIFIED" : "NO BUILD"}</small>
                </span>
                <span className="vc-seat__ready">{seat.ready ? "READY" : seat.occupant === "empty" ? "OPEN" : "HOLD"}</span>
              </div>
            ))}
          </div>
          <div>
            {role === "host" ? (
              <div className="vc-room-code">
                <small>ROOM CODE</small>
                <strong>vc-{generated}</strong>
              </div>
            ) : (
              <label className="vc-field">
                <span>ROOM CODE</span>
                <input
                  value={roomCode}
                  onChange={(event) => onRoomCodeChange(event.target.value.toUpperCase())}
                  placeholder="vc-ABC123"
                  maxLength={9}
                />
              </label>
            )}
            <p style={{ color: "var(--vc-muted)", fontSize: 11, lineHeight: 1.7 }}>
              {settings.mode === "endless"
                ? "ENDLESSは設定人数ぶんの2〜4人が全員READYで開始。開始後のゲスト切断は同じ機体をCPUが引き継ぎます。"
                : "空席は開始時にCPUで補充。ゲスト切断時は同じ機体をCPUが引き継ぎ、ホスト切断時はルームを終了します。"}
            </p>
            {error && <div className="vc-errors" role="alert">{error}</div>}
            {role === "host" && !session && (
              <button className="vc-btn vc-btn--primary" style={{ width: "100%" }} disabled={busy} onClick={openHost}>
                {busy ? "OPENING…" : "P2Pルームを開く"}
              </button>
            )}
            {role === "host" && session && (
              <>
                <button
                  className="vc-btn vc-btn--primary"
                  style={{ width: "100%" }}
                  disabled={busy || !exactEndlessSquadReady}
                  onClick={startHost}
                >
                  {busy
                    ? "STARTING…"
                    : settings.mode === "endless"
                      ? exactEndlessSquadReady
                        ? "全員でENDLESSを開始"
                        : `${settings.playerCount}人全員のREADY待ち`
                      : "空席をCPUで補充して開始"}
                </button>
                <button
                  className="vc-btn vc-btn--ghost"
                  style={{ width: "100%", marginTop: 8 }}
                  onClick={async () => {
                    await navigator.clipboard.writeText(`vc-${generated}`);
                    setCopied(true);
                  }}
                >
                  {copied ? "コピー済み" : "ルームコードをコピー"}
                </button>
              </>
            )}
            {role === "guest" && !session && (
              <>
                <div className="vc-guest-build">
                  <span>
                    <small>YOUR BUILD</small>
                    <strong>{build.name}</strong>
                  </span>
                  <b>{buildCost} C</b>
                </div>
                <div className="vc-guest-actions">
                  <button
                    className="vc-btn"
                    disabled={busy}
                    onClick={onEditBuild}
                    data-testid="guest-edit-build"
                  >
                    自機を編集
                  </button>
                  <button
                    className="vc-btn vc-btn--primary"
                    disabled={busy || !/^(?:VC-)?[A-Z0-9]{6}$/iu.test(roomCode)}
                    onClick={joinRoom}
                  >
                    {busy ? "CONNECTING…" : "接続してルーム設定を取得"}
                  </button>
                </div>
                <p className="vc-guest-validation-note">
                  接続後にホストの人数・リング・コスト上限を取得し、その設定で機体を確定できます。
                </p>
              </>
            )}
            {role === "guest" && session && (
              <>
                <div className="vc-room-code">
                  <small>STATUS</small>
                  <strong style={{ fontSize: 28 }}>
                    {!roomSettingsReceived
                      ? "CONNECTED / FETCHING RULES"
                      : guestReady
                        ? "READY / WAIT HOST"
                        : "CONNECTED / BUILD REQUIRED"}
                  </strong>
                </div>
                <div className="vc-guest-build">
                  <span>
                    <small>HOST RULE / YOUR BUILD</small>
                    <strong>
                      {settings.mode.toUpperCase()} · {settings.costLimit === Number.POSITIVE_INFINITY
                        ? "∞"
                        : settings.costLimit}C / {build.name}
                    </strong>
                  </span>
                  <b>{buildCost} C</b>
                </div>
                <div className="vc-guest-actions">
                  {roomSettingsReceived && (
                    settings.mode === "custom" || settings.mode === "endless"
                  ) && (
                    <button
                      className="vc-btn"
                      disabled={busy}
                      onClick={() => setEditingGuestBuild(true)}
                      data-testid="guest-edit-connected-build"
                    >
                      ホスト設定で自機を編集
                    </button>
                  )}
                  <button
                    className="vc-btn vc-btn--primary"
                    disabled={busy || guestReady || !roomSettingsReceived}
                    onClick={confirmGuestBuild}
                    data-testid="guest-ready"
                  >
                    {busy
                      ? "VERIFYING…"
                      : guestReady
                        ? "READY"
                        : settings.mode === "draft"
                          ? "ドラフトREADY"
                          : "ビルドを検証してREADY"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("title");
  useEffect(() => {
    // Browsers gate AudioContext behind a gesture; any first input anywhere
    // in the app is that gesture. unlock() is idempotent and cheap after the
    // first call, so the listeners simply stay on.
    const unlock = () => vortexAudio.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  const [role, setRole] = useState<NetworkRole>("solo");
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [build, setBuild] = useState<TopBuildSpec>(buildFromUrl);
  const [battleBuilds, setBattleBuilds] = useState<readonly TopBuildSpec[]>([]);
  const [launchPowers, setLaunchPowers] = useState<readonly number[]>([]);
  const [localLaunch, setLocalLaunch] = useState<LocalLaunchState | null>(null);
  const [localLaunchResult, setLocalLaunchResult] =
    useState<LaunchStopResult | null>(null);
  const [finished, setFinished] = useState<FinishedMatch | null>(null);
  const [guestRoomCode, setGuestRoomCode] = useState("");

  const launch = useCallback((builds: readonly TopBuildSpec[]) => {
    const seed = Date.now() >>> 0;
    setLocalLaunch({
      builds,
      spec: createLaunchMeter({ seed }).spec,
      cpuPowers: builds.map((_, seat) =>
        seat === 0 ? 0 : cpuLaunchPower(seed, seat)
      )
    });
    setLocalLaunchResult(null);
    setFinished(null);
    setScreen("launch");
  }, []);

  useEffect(() => {
    if (!localLaunch || !localLaunchResult) return;
    const timer = window.setTimeout(() => {
      setBattleBuilds(localLaunch.builds);
      setLaunchPowers(
        localLaunch.cpuPowers.map((power, seat) =>
          seat === 0 ? localLaunchResult.power : power
        )
      );
      setLocalLaunch(null);
      setLocalLaunchResult(null);
      setScreen("match");
    }, 720);
    return () => window.clearTimeout(timer);
  }, [localLaunch, localLaunchResult]);

  const launchCurrent = useCallback(() => {
    if (!validateBuild(build, settings.costLimit).ok) {
      setScreen("builder");
      return;
    }
    launch(makeBattleBuilds(build, settings));
  }, [build, settings, launch]);

  const openHostRoom = useCallback(() => {
    if (!validateBuild(build, settings.costLimit).ok) {
      setScreen("builder");
      return;
    }
    setScreen("room");
  }, [build, settings.costLimit]);

  const openRole = (nextRole: NetworkRole) => {
    setRole(nextRole);
    setBattleBuilds([]);
    setLaunchPowers([]);
    setLocalLaunch(null);
    setLocalLaunchResult(null);
    if (nextRole === "guest") {
      setGuestRoomCode("");
      setScreen("room");
    } else {
      setScreen("mode");
    }
  };

  return (
    <div className="vc-app">
      {screen === "title" && (
        <TitleScreen
          onSolo={() => openRole("solo")}
          onHost={() => openRole("host")}
          onJoin={() => openRole("guest")}
        />
      )}
      {screen === "mode" && (
        <ModeScreen
          role={role}
          settings={settings}
          onSettings={setSettings}
          onBack={() => setScreen("title")}
          onCustom={() => {
            setSettings((current) => ({ ...current, mode: "custom" }));
            setScreen("builder");
          }}
          onDraft={() => {
            setSettings((current) => ({
              ...current,
              mode: "draft",
              costLimit: Number.isFinite(current.costLimit) ? current.costLimit : 1300
            }));
            setScreen(role === "host" ? "room" : "draft");
          }}
          onEndless={() => {
            setSettings((current) => ({
              ...current,
              mode: "endless",
              costLimit: Number.isFinite(current.costLimit) ? current.costLimit : 1000
            }));
            setScreen("builder");
          }}
          onQuick={() => {
            setSettings((current) => ({ ...current, mode: "custom" }));
            if (role === "host") openHostRoom();
            else launchCurrent();
          }}
        />
      )}
      {screen === "builder" && (
        <BuilderScreen
          build={build}
          settings={settings}
          onBuild={setBuild}
          onBack={() => setScreen(role === "guest" ? "room" : "mode")}
          onLaunch={
            role === "host"
              ? openHostRoom
              : role === "guest"
                ? () => setScreen("room")
                : launchCurrent
          }
          launchLabel={role === "guest" ? "編集を確定してROOMへ" : undefined}
        />
      )}
      {screen === "draft" && (
        <DraftScreen
          settings={settings}
          onBack={() => setScreen("mode")}
          onComplete={(builds) => {
            setBuild(builds[0]!);
            if (role === "host") {
              setBattleBuilds(builds);
              setScreen("room");
            } else {
              launch(builds);
            }
          }}
        />
      )}
      {screen === "room" && role !== "solo" && (
        <NetworkRoomFlow
          role={role}
          settings={settings}
          onSettings={setSettings}
          build={build}
          onBuild={setBuild}
          cpuBuilds={settings.mode === "draft" ? battleBuilds.slice(1) : undefined}
          onBack={() => setScreen(role === "guest" ? "title" : "mode")}
          onEditBuild={() => setScreen("builder")}
          roomCode={guestRoomCode}
          onRoomCodeChange={setGuestRoomCode}
        />
      )}
      {screen === "launch" && localLaunch && (
        <LaunchMeterScreen
          spec={localLaunch.spec}
          remainingMs={localLaunch.spec.durationMs}
          seat={0}
          seats={localLaunch.builds.map((candidate, seat) => ({
            seat,
            name: candidate.name,
            stopped: seat !== 0 || localLaunchResult !== null,
            power:
              seat === 0
                ? localLaunchResult?.power ?? null
                : localLaunch.cpuPowers[seat] ?? 0.6
          }))}
          onStop={setLocalLaunchResult}
          onExit={() => {
            setLocalLaunch(null);
            setLocalLaunchResult(null);
            setScreen("mode");
          }}
        />
      )}
      {screen === "match" && battleBuilds.length >= 2 && (
        <MatchScreen
          builds={battleBuilds}
          settings={settings}
          launchPowers={launchPowers}
          onExit={() => setScreen("mode")}
          onFinished={(match) => {
            setFinished(match);
            setScreen("result");
          }}
        />
      )}
      {screen === "result" && finished && (
        <ResultScreen
          match={finished}
          onRematch={() => launch(finished.builds)}
          onBuilder={() => setScreen("builder")}
          onTitle={() => setScreen("title")}
        />
      )}
    </div>
  );
}
