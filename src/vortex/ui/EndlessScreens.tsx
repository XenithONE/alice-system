import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { getPart, SLOT_META } from "../content/catalog";
import { getActiveSkill, getPassiveSkill } from "../content/skills";
import type {
  EndlessRunState,
  RogueRewardOffer,
} from "../endless/types";
import {
  TOP_SLOTS,
  type PartId,
  type PartKind,
  type RogueBuildSpec,
  type TopSlot,
} from "../types";
import "./endless-ui.css";

const REWARD_DURATION_MS = 15_000;

const KIND_LABEL: Record<PartKind, string> = {
  stat: "PURE STAT",
  passive: "PASSIVE",
  active: "ACTIVE",
};
const STAT_SHORT = {
  attack: "ATK",
  defense: "DEF",
  stamina: "STA",
  stability: "BAL",
  mobility: "MOV",
  durability: "HP",
} as const;

const numberFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 0,
});

function formatNumber(value: number): string {
  return numberFormatter.format(Math.max(0, Math.round(value)));
}

function stackCount(build: RogueBuildSpec, slot: TopSlot): number {
  return build.parts[slot]?.length ?? 0;
}

function totalParts(build: RogueBuildSpec): number {
  return TOP_SLOTS.reduce(
    (sum, slot) => sum + stackCount(build, slot),
    0,
  );
}

function useRewardCountdown(
  sampledRemainingMs: number,
  paused: boolean,
): number {
  const safeSample = Math.max(0, sampledRemainingMs);
  const [remaining, setRemaining] = useState(safeSample);

  useEffect(() => {
    setRemaining(safeSample);
    if (paused || safeSample === 0) return;

    const sampledAt = performance.now();
    const interval = window.setInterval(() => {
      const next = Math.max(
        0,
        safeSample - (performance.now() - sampledAt),
      );
      setRemaining(next);
      if (next === 0) window.clearInterval(interval);
    }, 80);

    return () => window.clearInterval(interval);
  }, [paused, safeSample]);

  return remaining;
}

function offerForPlayer(
  run: EndlessRunState,
  playerId: string,
): RogueRewardOffer | undefined {
  return run.rewardOffers.find((candidate) => candidate.playerId === playerId);
}

export interface EndlessWaveBadgeProps {
  readonly wave: number;
  readonly isBoss: boolean;
  readonly enemyThreat: number;
  readonly clearedWaves?: number;
  readonly className?: string;
}

/**
 * Small edge HUD for the live battle. It deliberately stays pointer
 * transparent and out of the center of the 3D playfield.
 */
export function EndlessWaveBadge({
  wave,
  isBoss,
  enemyThreat,
  clearedWaves,
  className = "",
}: EndlessWaveBadgeProps) {
  return (
    <aside
      className={`vc-endless-wave-badge${isBoss ? " is-boss" : ""}${
        className ? ` ${className}` : ""
      }`}
      aria-label={`エンドレス Wave ${wave}${
        isBoss ? " ボス戦" : ""
      }、敵脅威 ${formatNumber(enemyThreat)}`}
      data-testid="endless-wave-badge"
    >
      <span className="vc-endless-wave-badge__index">
        <small>{isBoss ? "BOSS WAVE" : "ENDLESS WAVE"}</small>
        <strong>{String(wave).padStart(2, "0")}</strong>
      </span>
      <span className="vc-endless-wave-badge__threat">
        <small>ENEMY THREAT</small>
        <strong>{formatNumber(enemyThreat)}</strong>
      </span>
      {clearedWaves !== undefined && (
        <span className="vc-endless-wave-badge__cleared">
          <small>CLEARED</small>
          <strong>{formatNumber(clearedWaves)}</strong>
        </span>
      )}
    </aside>
  );
}

export interface EndlessRewardScreenProps {
  readonly run: EndlessRunState;
  /** The local player's offer, retained even between canonical snapshots. */
  readonly offer: RogueRewardOffer;
  readonly nextEnemyThreat: number;
  /** Host-sampled countdown. The UI locally interpolates between updates. */
  readonly remainingMs: number;
  readonly durationMs?: number;
  readonly onPick: (partId: PartId) => void;
  readonly onExit: () => void;
}

export function EndlessRewardScreen({
  run,
  offer,
  nextEnemyThreat,
  remainingMs,
  durationMs = REWARD_DURATION_MS,
  onPick,
  onExit,
}: EndlessRewardScreenProps) {
  const canonicalOffer = offerForPlayer(run, offer.playerId) ?? offer;
  const localPlayer = run.players.find(
    (player) => player.id === canonicalOffer.playerId,
  );
  const selectedPartId = canonicalOffer.selectedPartId;
  const selectedCount = run.players.reduce(
    (count, player) =>
      count +
      (offerForPlayer(run, player.id)?.selectedPartId !== null &&
      offerForPlayer(run, player.id) !== undefined
        ? 1
        : 0),
    0,
  );
  const remaining = useRewardCountdown(
    remainingMs,
    selectedPartId !== null,
  );
  const safeDuration = Math.max(1, durationMs);
  const timerProgress = Math.min(1, remaining / safeDuration);
  const isNextBoss = (run.wave + 1) % 5 === 0;

  const choices = useMemo(
    () =>
      canonicalOffer.choices.map((choice) => {
        const part = getPart(choice.partId);
        const active =
          part?.activeSkillId !== undefined
            ? getActiveSkill(part.activeSkillId)
            : undefined;
        const passive =
          part?.passiveSkillId !== undefined
            ? getPassiveSkill(part.passiveSkillId)
            : undefined;
        const exactCopies =
          localPlayer?.build.parts[choice.slot]?.filter(
            (partId) => partId === choice.partId,
          ).length ?? 0;
        const slotParts = localPlayer
          ? stackCount(localPlayer.build, choice.slot)
          : 0;
        const statSummary = part
          ? Object.entries(part.stats)
              .sort((first, second) => second[1] - first[1])
              .slice(0, 2)
              .map(
                ([stat, value]) =>
                  `${STAT_SHORT[stat as keyof typeof STAT_SHORT]} ${Math.round(value)}`,
              )
              .join(" · ")
          : "";
        return {
          choice,
          part,
          active,
          passive,
          exactCopies,
          slotParts,
          statSummary,
        };
      }),
    [canonicalOffer.choices, localPlayer],
  );

  const pick = useCallback(
    (partId: PartId) => {
      if (selectedPartId === null && remaining > 0) onPick(partId);
    },
    [onPick, remaining, selectedPartId],
  );

  useEffect(() => {
    if (selectedPartId !== null) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.repeat
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      const index = Number(event.key) - 1;
      const candidate = choices[index];
      if (index >= 0 && index < 3 && candidate && remaining > 0) {
        event.preventDefault();
        pick(candidate.choice.partId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choices, pick, remaining, selectedPartId]);

  return (
    <main
      className="vc-endless-reward"
      aria-labelledby="endless-reward-title"
      data-testid="endless-reward-screen"
    >
      <div className="vc-endless-reward__scan" aria-hidden="true" />
      <header className="vc-endless-reward__header">
        <div>
          <div className="vc-kicker">CO-OP ROGUE CIRCUIT / REWARD PHASE</div>
          <h1 id="endless-reward-title">
            <span>WAVE {run.clearedWaves}</span> CLEAR
          </h1>
          <p>
            各選手が1パーツを獲得。取得パーツは同じ部位へ重ねて装着されます。
          </p>
        </div>
        <button className="vc-btn vc-btn--ghost" onClick={onExit}>
          RUNを終了
        </button>
      </header>

      <section className="vc-endless-reward__threat" aria-label="次Wave情報">
        <span>
          <small>NEXT ENCOUNTER</small>
          <strong>
            WAVE {run.wave + 1}
            {isNextBoss && <b>BOSS</b>}
          </strong>
        </span>
        <i aria-hidden="true" />
        <span>
          <small>ENEMY THREAT</small>
          <strong>{formatNumber(nextEnemyThreat)}</strong>
        </span>
        <span
          className={`vc-endless-reward__timer${
            remaining <= 5_000 ? " is-critical" : ""
          }`}
          style={
            {
              "--vc-reward-time": timerProgress,
            } as CSSProperties
          }
          role="timer"
          aria-live="off"
          aria-label={`選択残り ${Math.ceil(remaining / 1000)} 秒`}
        >
          <small>AUTO PICK</small>
          <strong>{Math.ceil(remaining / 1000).toString().padStart(2, "0")}</strong>
        </span>
      </section>

      <div className="vc-endless-reward__body">
        <aside className="vc-endless-squad" aria-label="チームのパーツスタック">
          <div className="vc-endless-section-label">
            <span>SQUAD STACK MATRIX</span>
            <b>
              {selectedCount}/{run.players.length} LOCKED
            </b>
          </div>
          <div className="vc-endless-squad__players">
            {run.players.map((player, seat) => {
              const playerOffer = offerForPlayer(run, player.id);
              const locked = playerOffer?.selectedPartId !== null &&
                playerOffer !== undefined;
              const isLocal = player.id === canonicalOffer.playerId;
              return (
                <article
                  className={`vc-endless-player${locked ? " is-locked" : ""}${
                    isLocal ? " is-local" : ""
                  }`}
                  key={player.id}
                >
                  <div className="vc-endless-player__head">
                    <span>P{seat + 1}</span>
                    <strong>{player.name}</strong>
                    <b>{locked ? "LOCKED" : "CHOOSING"}</b>
                  </div>
                  <div className="vc-endless-player__stacks">
                    {TOP_SLOTS.map((slot) => (
                      <span
                        key={slot}
                        title={`${SLOT_META[slot].nameJa}: ${stackCount(
                          player.build,
                          slot,
                        )}個`}
                      >
                        <small>{SLOT_META[slot].number}</small>
                        <b>{stackCount(player.build, slot)}</b>
                      </span>
                    ))}
                  </div>
                  <small className="vc-endless-player__total">
                    TOTAL {totalParts(player.build)} PARTS
                    {isLocal ? " / YOU" : ""}
                  </small>
                </article>
              );
            })}
          </div>
        </aside>

        <section className="vc-endless-picks" aria-label="獲得パーツ候補">
          <div className="vc-endless-section-label">
            <span>CHOOSE ONE // KEY 1–3</span>
            <b>{localPlayer?.name ?? "LOCAL PILOT"}</b>
          </div>
          <div className="vc-endless-picks__cards">
            {choices.map(
              (
                {
                  choice,
                  part,
                  active,
                  passive,
                  exactCopies,
                  slotParts,
                  statSummary,
                },
                index,
              ) => {
                const selected = selectedPartId === choice.partId;
                const disabled = selectedPartId !== null || remaining <= 0;
                return (
                  <button
                    className={`vc-endless-pick${selected ? " is-selected" : ""}`}
                    data-kind={part?.kind ?? choice.kind}
                    aria-pressed={selected}
                    disabled={disabled}
                    key={choice.partId}
                    onClick={() => pick(choice.partId)}
                    data-testid={`endless-reward-choice-${index + 1}`}
                  >
                    <span className="vc-endless-pick__number">
                      <small>OPTION</small>
                      <b>{index + 1}</b>
                    </span>
                    <span className="vc-endless-pick__slot">
                      {SLOT_META[choice.slot].number} /{" "}
                      {SLOT_META[choice.slot].name.toUpperCase()} ·{" "}
                      {choice.grade === "signature"
                        ? "SIGNATURE"
                        : `G${choice.grade}`}{" "}
                      · {choice.lineage.toUpperCase()} / {choice.role.toUpperCase()}
                    </span>
                    <span className="vc-endless-pick__kind">
                      {KIND_LABEL[part?.kind ?? choice.kind]}
                    </span>
                    <strong className="vc-endless-pick__name">
                      {part?.nameJa ?? choice.partId}
                      <small>{part?.name ?? choice.partId}</small>
                    </strong>
                    <span className="vc-endless-pick__cost">
                      <small>PART COST</small>
                      <b>{formatNumber(part?.cost ?? 0)}</b>
                    </span>
                    <span className="vc-endless-pick__stack">
                      <small>{SLOT_META[choice.slot].nameJa} STACK</small>
                      <b>
                        {slotParts} <i>→</i> {slotParts + 1}
                      </b>
                    </span>
                    <span className="vc-endless-pick__skill">
                      {active ? (
                        <>
                          <small>ACTIVE // 同部位一斉発動</small>
                          <b>{active.nameJa}</b>
                          <em>{active.descriptionJa}</em>
                        </>
                      ) : passive ? (
                        <>
                          <small>PASSIVE // 常時スタック</small>
                          <b>{passive.nameJa}</b>
                          <em>{passive.descriptionJa}</em>
                        </>
                      ) : (
                        <>
                          <small>PURE STAT // SKILLLESS</small>
                          <b>基礎出力ブースト</b>
                          <em>
                            スキルを持たない代わりに高い基礎能力を加算。
                          </em>
                        </>
                      )}
                      {statSummary && (
                        <span className="vc-endless-pick__stats">
                          {statSummary}
                        </span>
                      )}
                    </span>
                    {exactCopies > 0 && (
                      <span className="vc-endless-pick__duplicate">
                        DUPLICATE x{exactCopies} / STACK +1
                      </span>
                    )}
                    <span className="vc-endless-pick__action">
                      {selected
                        ? "SELECTED"
                        : disabled
                          ? "WAITING"
                          : `PRESS ${index + 1} TO INSTALL`}
                    </span>
                  </button>
                );
              },
            )}
          </div>
        </section>
      </div>

      <footer
        className={`vc-endless-reward__status${
          selectedPartId !== null ? " is-locked" : ""
        }`}
        role="status"
        aria-live="polite"
      >
        <i aria-hidden="true" />
        <span>
          {selectedPartId !== null
            ? "獲得パーツを確定しました。ほかのプレイヤーを待っています…"
            : selectedCount > 0
              ? `${selectedCount}人が選択済み。残り時間内にパーツを選んでください。`
              : "候補を1つ選択してください。時間切れ時はホストが自動選択します。"}
        </span>
      </footer>
    </main>
  );
}

export interface EndlessGameOverScreenProps {
  readonly reachedWave: number;
  readonly clearedWaves: number;
  readonly score: number;
  readonly totalAcquiredParts: number;
  readonly onExit: () => void;
}

export function EndlessGameOverScreen({
  reachedWave,
  clearedWaves,
  score,
  totalAcquiredParts,
  onExit,
}: EndlessGameOverScreenProps) {
  return (
    <main
      className="vc-endless-gameover"
      aria-labelledby="endless-gameover-title"
      data-testid="endless-gameover-screen"
    >
      <div className="vc-endless-gameover__rings" aria-hidden="true" />
      <div className="vc-endless-gameover__content">
        <div className="vc-kicker">CO-OP ROGUE CIRCUIT / RUN ARCHIVE</div>
        <p className="vc-endless-gameover__eyebrow">ALL TOPS ELIMINATED</p>
        <h1 id="endless-gameover-title">RUN OVER</h1>
        <p className="vc-endless-gameover__copy">
          回転は止まっても、獲得ログは王冠記録庫へ刻まれる。
        </p>

        <section className="vc-endless-gameover__stats" aria-label="RUN成績">
          <span>
            <small>REACHED</small>
            <strong>WAVE {formatNumber(reachedWave)}</strong>
          </span>
          <span>
            <small>CLEARED</small>
            <strong>{formatNumber(clearedWaves)}</strong>
          </span>
          <span className="is-score">
            <small>SQUAD SCORE</small>
            <strong>{formatNumber(score)}</strong>
          </span>
          <span>
            <small>PARTS ACQUIRED</small>
            <strong>+{formatNumber(totalAcquiredParts)}</strong>
          </span>
        </section>

        <button className="vc-btn vc-btn--primary" onClick={onExit} autoFocus>
          闘技場へ戻る
        </button>
      </div>
    </main>
  );
}
