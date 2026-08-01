/**
 * The meta screens: grand-prix setup, time-trial setup, records/achievements,
 * the daily card and the livery picker. Kept out of Screens.tsx, which
 * already carries the race-flow screens.
 */

import { useMemo } from "react";
import { unlockedLiveries, KART_ACHIEVEMENTS, evaluateAchievements } from "../meta/achievements";
import { dailyCombo, kartDayKey, type DailyState } from "../meta/daily";
import { comboKey, type NkRecords } from "../meta/records";
import type { RoomSettings } from "../net/protocol";
import type { CupView } from "../net/session";
import { LIVERIES } from "../render/palette";
import { SPEED_CLASSES, WEATHER_KINDS } from "../sim/balance";
import { TRACKS } from "../sim/tracks";
import { formatTime } from "./Hud";
import { SettingsPanel } from "./Screens";

function signalHex(index: number): string {
  return `#${LIVERIES[index % LIVERIES.length]!.signal.toString(16).padStart(6, "0")}`;
}

export function LiveryPicker({
  records,
  daily,
  value,
  onChange,
}: {
  records: NkRecords;
  daily: DailyState;
  value: number;
  onChange(livery: number): void;
}): React.JSX.Element {
  const unlocked = useMemo(
    () => unlockedLiveries(records, daily),
    [records, daily],
  );
  return (
    <div className="nk-livery-picker">
      <span className="nk-field-label">カラー</span>
      <div className="nk-livery-grid">
        {LIVERIES.map((livery, index) => {
          const open = unlocked.has(index);
          return (
            <button
              key={livery.name}
              type="button"
              className={`nk-livery ${value === index ? "is-active" : ""} ${
                open ? "" : "is-locked"
              }`}
              title={
                open
                  ? livery.name
                  : `${livery.name} — ${
                      KART_ACHIEVEMENTS.find((a) => a.liveryUnlock === index)?.desc ?? "実績で解放"
                    }`
              }
              disabled={!open}
              onClick={() => onChange(index)}
            >
              <i style={{ background: `#${livery.body.toString(16).padStart(6, "0")}` }} />
              {!open ? <span className="nk-livery-lock">🔒</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function GpSetup({
  settings,
  onChange,
  onStart,
  onBack,
}: {
  settings: RoomSettings;
  onChange(patch: Partial<RoomSettings>): void;
  onStart(): void;
  onBack(): void;
}): React.JSX.Element {
  return (
    <div className="nk-screen nk-setup">
      <h2>グランプリ</h2>
      <p className="nk-note">
        全3コースを連戦し、順位ポイント（10/8/6/5/4/3/2/1）の合計で総合優勝を争います。
      </p>
      <div className="nk-dials">
        <label>
          <span>クラス</span>
          <select
            value={settings.speedClass}
            onChange={(event) => onChange({ speedClass: Number(event.target.value) })}
          >
            {SPEED_CLASSES.map((speedClass, index) => (
              <option key={speedClass.label} value={index}>
                {speedClass.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>ミラー</span>
          <select
            value={settings.mirror ? "on" : "off"}
            onChange={(event) => onChange({ mirror: event.target.value === "on" })}
          >
            <option value="off">なし</option>
            <option value="on">ミラー</option>
          </select>
        </label>
        <label>
          <span>天候</span>
          <select
            value={settings.weather}
            onChange={(event) => onChange({ weather: Number(event.target.value) })}
          >
            <option value={0}>晴れ</option>
            <option value={1}>雨</option>
          </select>
        </label>
        <label>
          <span>CPU の強さ</span>
          <select
            value={settings.cpuLevel}
            onChange={(event) => onChange({ cpuLevel: Number(event.target.value) })}
          >
            <option value={1}>ツーリスト</option>
            <option value={2}>レーサー</option>
            <option value={3}>ライバル</option>
          </select>
        </label>
      </div>
      <div className="nk-row">
        <button type="button" onClick={onBack}>
          戻る
        </button>
        <button type="button" className="nk-primary" onClick={onStart}>
          カップ開始
        </button>
      </div>
    </div>
  );
}

export function TtSetup({
  settings,
  records,
  onChange,
  onStart,
  onBack,
}: {
  settings: RoomSettings;
  records: NkRecords;
  onChange(patch: Partial<RoomSettings>): void;
  onStart(): void;
  onBack(): void;
}): React.JSX.Element {
  const key = comboKey(settings.trackId, settings.speedClass, settings.mirror);
  const best = records.tt[key];
  return (
    <div className="nk-screen nk-setup">
      <h2>タイムトライアル</h2>
      <p className="nk-note">
        1台・3周・アイテムなし（スタート時に3連ダッシュのみ）。自己ベストはゴーストとして一緒に走ります。
      </p>
      <SettingsPanel
        settings={settings}
        editable
        onChange={onChange}
        hideDials={["gp", "laps", "racerCount", "items", "cpuLevel"]}
      />
      <p className="nk-tt-best">
        このコースの自己ベスト:{" "}
        <b>{best?.bestMs ? formatTime(best.bestMs / 1000) : "記録なし"}</b>
        {best?.bestLapMs ? (
          <span>（ベストラップ {formatTime(best.bestLapMs / 1000)}）</span>
        ) : null}
      </p>
      <div className="nk-row">
        <button type="button" onClick={onBack}>
          戻る
        </button>
        <button type="button" className="nk-primary" onClick={onStart}>
          スタート
        </button>
      </div>
    </div>
  );
}

export function DailyCard({
  daily,
  onStart,
}: {
  daily: DailyState;
  onStart(): void;
}): React.JSX.Element {
  const combo = dailyCombo(kartDayKey());
  const track = TRACKS.find((spec) => spec.id === combo.trackId);
  return (
    <button type="button" className="nk-daily-card" onClick={onStart}>
      <span className="nk-daily-title">今日の挑戦</span>
      <b>
        {track?.name ?? combo.trackId} ・ {SPEED_CLASSES[combo.speedClass]!.label}
        {combo.mirror ? " ・ ミラー" : ""}
        {combo.weather === "rain" ? " ・ 雨" : ""}
      </b>
      <span className="nk-daily-meta">
        {daily.bestMs
          ? `本日ベスト ${formatTime(daily.bestMs / 1000)}`
          : "まだ走っていません"}
        {daily.streak > 1 ? ` ・ 連続 ${daily.streak} 日` : ""}
      </span>
    </button>
  );
}

export function RecordsScreen({
  records,
  daily,
  onBack,
}: {
  records: NkRecords;
  daily: DailyState;
  onBack(): void;
}): React.JSX.Element {
  const earned = useMemo(
    () => new Set(evaluateAchievements(records, daily)),
    [records, daily],
  );
  return (
    <div className="nk-screen nk-records">
      <h2>記録</h2>
      <div className="nk-stat-row">
        <div>
          <b>{records.races}</b>
          <span>レース</span>
        </div>
        <div>
          <b>{records.wins}</b>
          <span>勝利</span>
        </div>
        <div>
          <b>{records.podiums}</b>
          <span>表彰台</span>
        </div>
        <div>
          <b>{records.gpGolds}</b>
          <span>カップ制覇</span>
        </div>
        <div>
          <b>{records.miniTurbos}</b>
          <span>ミニターボ</span>
        </div>
        <div>
          <b>{records.tricksLanded}</b>
          <span>トリック</span>
        </div>
        <div>
          <b>{daily.streak}</b>
          <span>デイリー連続</span>
        </div>
      </div>

      <h3>実績</h3>
      <ul className="nk-achievements">
        {KART_ACHIEVEMENTS.map((achievement) => (
          <li
            key={achievement.id}
            className={earned.has(achievement.id) ? "is-earned" : undefined}
          >
            <b>{achievement.title}</b>
            <span>{achievement.desc}</span>
            {achievement.liveryUnlock !== undefined ? (
              <i
                title={`カラー解放: ${LIVERIES[achievement.liveryUnlock]!.name}`}
                style={{ background: signalHex(achievement.liveryUnlock) }}
              />
            ) : null}
          </li>
        ))}
      </ul>

      <h3>コース別ベスト（タイムトライアル）</h3>
      <table className="nk-best-table">
        <thead>
          <tr>
            <th>コース</th>
            <th>クラス</th>
            <th>タイム</th>
            <th>ベストラップ</th>
          </tr>
        </thead>
        <tbody>
          {TRACKS.flatMap((track) =>
            SPEED_CLASSES.map((speedClass, classIndex) => {
              const key = comboKey(track.id, classIndex, false);
              const tt = records.tt[key];
              if (!tt?.bestMs) return null;
              return (
                <tr key={key}>
                  <td>{track.name}</td>
                  <td>{speedClass.label}</td>
                  <td>{formatTime(tt.bestMs / 1000)}</td>
                  <td>{tt.bestLapMs ? formatTime(tt.bestLapMs / 1000) : "—"}</td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>

      <div className="nk-row">
        <button type="button" onClick={onBack}>
          メニューへ
        </button>
      </div>
    </div>
  );
}

export function CupPanel({ cup, seatNames }: { cup: CupView; seatNames: readonly string[] }): React.JSX.Element {
  return (
    <div className="nk-cup-panel">
      <h3>
        カップ順位 <small>ROUND {Math.min(cup.round + 1, cup.rounds)}/{cup.rounds}</small>
      </h3>
      <ol>
        {cup.standings.map((standing) => (
          <li key={standing.seat}>
            <span className="nk-cup-rank">{standing.rank}</span>
            <i style={{ background: signalHex(standing.seat) }} />
            <span className="nk-cup-name">
              {seatNames[standing.seat] ?? `P${standing.seat + 1}`}
            </span>
            <b>{standing.points}pt</b>
          </li>
        ))}
      </ol>
    </div>
  );
}
