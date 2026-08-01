/**
 * The garage: driver, machine and colour, with the kart itself on a turntable.
 *
 * The livery picker lives here rather than on the menu because "how my kart
 * looks" was previously split across two screens, and a colour chosen without
 * the car in front of you is a colour chosen blind.
 *
 * Star ratings are display-only. They come from the catalog's `display` block,
 * which `[C6]` checks against the physics coefficients — the gate is what stops
 * a star from lying, not this file.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { abilityById } from "../content/abilities";
import { CHARACTERS } from "../content/characters";
import { MACHINES } from "../content/machines";
import { KART_ACHIEVEMENTS, unlockedKit } from "../meta/achievements";
import type { DailyState } from "../meta/daily";
import type { NkRecords } from "../meta/records";
import { LIVERIES } from "../render/palette";
import { createGarageScene, type GarageScene } from "../render/garageScene";
import { LiveryPicker } from "./MetaScreens";

type Tab = "rider" | "machine" | "color";

const STAT_LABELS: readonly (readonly [
  "speed" | "accel" | "handling" | "weight" | "luck",
  string,
])[] = [
  ["speed", "最高速"],
  ["accel", "加速"],
  ["handling", "旋回"],
  ["weight", "重さ"],
  ["luck", "アイテム運"],
];

function Stars({ value }: { value: number }): React.JSX.Element {
  return (
    <span className="nk-stars" aria-label={`${value} / 5`}>
      {"★★★★★".slice(0, value)}
      <i>{"★★★★★".slice(value)}</i>
    </span>
  );
}

function StatBlock({
  display,
}: {
  display: Record<string, number>;
}): React.JSX.Element {
  return (
    <dl className="nk-stat-block">
      {STAT_LABELS.map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            <Stars value={display[key] ?? 3} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function lockNote(unlock: { kind: string; id?: string }): string {
  if (unlock.kind === "free") return "";
  const achievement = KART_ACHIEVEMENTS.find((a) => a.id === unlock.id);
  return achievement ? `${achievement.title} — ${achievement.desc}` : "実績で解放";
}

export function GarageScreen({
  records,
  daily,
  characterId,
  machineId,
  livery,
  onCharacter,
  onMachine,
  onLivery,
  onBack,
}: {
  records: NkRecords;
  daily: DailyState;
  characterId: string;
  machineId: string;
  livery: number;
  onCharacter(id: string): void;
  onMachine(id: string): void;
  onLivery(index: number): void;
  onBack(): void;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("rider");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<GarageScene | null>(null);
  const unlocked = useMemo(() => unlockedKit(records, daily), [records, daily]);

  const character =
    CHARACTERS.find((entry) => entry.id === characterId) ?? CHARACTERS[0]!;
  const machine = MACHINES.find((entry) => entry.id === machineId) ?? MACHINES[0]!;
  // `[C2]` proves every id resolves, so a null here is a catalog gate failure
  // and not a case the UI should be inventing placeholder text for.
  const skill = abilityById(character.skillId);
  const gimmick = abilityById(machine.gimmickId);

  // Build once; `setKit` swaps the kart in place. Rebuilding the whole scene on
  // every click would drop the turntable back to its start angle mid-browse.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = createGarageScene({ canvas, machineId, livery });
    sceneRef.current = scene;
    const onResize = (): void =>
      scene.resize(canvas.clientWidth, canvas.clientHeight);
    window.addEventListener("resize", onResize);
    const seam = window as unknown as { __nitroGarage?: unknown };
    seam.__nitroGarage = {
      debugTick: (dt: number) => scene.debugTick(dt),
      getDebugState: () => scene.getDebugState(),
      // Lets the QA harness park the turntable, so every reference plate is
      // shot from the same angle and a silhouette change is the only thing
      // that can differ between two of them.
      nudgeSpin: (delta: number) => scene.nudgeSpin(delta),
    };
    return () => {
      window.removeEventListener("resize", onResize);
      delete seam.__nitroGarage;
      scene.dispose();
      sceneRef.current = null;
    };
    // Deliberately empty: the scene outlives every pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setKit(machineId, livery);
  }, [machineId, livery]);

  return (
    <div className="nk-screen nk-garage">
      <header>
        <p className="nk-eyebrow">GARAGE</p>
        <h1>ガレージ</h1>
        <p className="nk-tagline">
          ドライバーとマシンで能力が変わります。スキルは <kbd>E</kbd>、
          マシンギミックは <kbd>Shift</kbd>、どちらもクールダウン制です。
        </p>
      </header>

      <div className="nk-garage-body">
        <div className="nk-garage-stage">
          <canvas ref={canvasRef} />
          <p className="nk-garage-caption">
            {character.name} × {machine.name}
          </p>
        </div>

        <div className="nk-garage-panel">
          <div className="nk-tabs" role="tablist">
            {(
              [
                ["rider", "ドライバー"],
                ["machine", "マシン"],
                ["color", "カラー"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? "is-active" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "rider" ? (
            <>
              <div className="nk-riders">
                {CHARACTERS.map((entry) => {
                  const open = unlocked.characters.has(entry.id);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`nk-kit-card ${
                        entry.id === characterId ? "is-active" : ""
                      } ${open ? "" : "is-locked"}`}
                      disabled={!open}
                      title={open ? entry.blurbJa : lockNote(entry.unlock)}
                      onClick={() => onCharacter(entry.id)}
                    >
                      <strong>{entry.name}</strong>
                      <small>{open ? entry.nameJa : "🔒 未解放"}</small>
                    </button>
                  );
                })}
              </div>
              <div className="nk-kit-detail">
                <p className="nk-kit-blurb">{character.blurbJa}</p>
                <StatBlock display={character.display} />
                {skill ? (
                  <p className="nk-kit-ability">
                    <span className="nk-kbd">E</span>
                    <strong>{skill.nameJa}</strong>
                    <em>{skill.descJa}</em>
                    <span className="nk-cooldown">CD {skill.cooldownSec}s</span>
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          {tab === "machine" ? (
            <>
              <div className="nk-machines">
                {MACHINES.map((entry) => {
                  const open = unlocked.machines.has(entry.id);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`nk-kit-card ${
                        entry.id === machineId ? "is-active" : ""
                      } ${open ? "" : "is-locked"}`}
                      disabled={!open}
                      title={open ? entry.blurbJa : lockNote(entry.unlock)}
                      onClick={() => onMachine(entry.id)}
                    >
                      <strong>{entry.name}</strong>
                      <small>{open ? entry.nameJa : "🔒 未解放"}</small>
                    </button>
                  );
                })}
              </div>
              <div className="nk-kit-detail">
                <p className="nk-kit-blurb">{machine.blurbJa}</p>
                <StatBlock display={machine.display} />
                {gimmick ? (
                  <p className="nk-kit-ability">
                    <span className="nk-kbd">Shift</span>
                    <strong>{gimmick.nameJa}</strong>
                    <em>{gimmick.descJa}</em>
                    <span className="nk-cooldown">
                      CD {gimmick.cooldownSec}s
                    </span>
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          {tab === "color" ? (
            <div className="nk-kit-detail">
              <LiveryPicker
                records={records}
                daily={daily}
                value={livery}
                onChange={onLivery}
              />
              <p className="nk-kit-blurb">
                {LIVERIES[livery]?.name ?? ""} —
                8色は最初から、残りは実績で解放されます。
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="nk-row">
        <button type="button" className="nk-primary" onClick={onBack}>
          決定
        </button>
      </div>
    </div>
  );
}
