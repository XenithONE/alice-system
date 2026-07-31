import type { NitroLobby, RoomSettings } from "../net/protocol";
import { liveryOf } from "../render/palette";
import type { RaceResult } from "../sim/types";
import { TRACKS } from "../sim/tracks";
import type { TouchState } from "../input";
import { formatTime } from "./Hud";

const CPU_LABELS = ["ツーリスト", "レーサー", "ライバル"];

export function Menu({
  name,
  onName,
  onSolo,
  onHost,
  onJoin,
  busy,
  error,
}: {
  name: string;
  onName(value: string): void;
  onSolo(): void;
  onHost(): void;
  onJoin(code: string): void;
  busy: string | null;
  error: string | null;
}): React.JSX.Element {
  return (
    <div className="nk-screen nk-menu">
      <header>
        <p className="nk-eyebrow">THREE.JS × P2P KART RACING</p>
        <h1>
          NITRO<span>CROWN</span>
        </h1>
        <p className="nk-tagline">
          8台のグリッド、ドリフトからのミニターボ、8種のアイテム。
          <br />
          ルームコードひとつで最大4人がブラウザだけで対戦できます。
        </p>
      </header>

      <label className="nk-field">
        <span>ドライバー名</span>
        <input
          value={name}
          maxLength={12}
          onChange={(event) => onName(event.target.value)}
          placeholder="PLAYER"
        />
      </label>

      <div className="nk-menu-actions">
        <button type="button" className="nk-primary" onClick={onSolo} disabled={busy !== null}>
          ソロレース
          <small>CPU と走る</small>
        </button>
        <button type="button" onClick={onHost} disabled={busy !== null}>
          ルームを作る
          <small>ホストになる（最大4人）</small>
        </button>
        <form
          className="nk-join"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem(
              "room",
            ) as HTMLInputElement;
            if (input.value.trim().length > 0) onJoin(input.value);
          }}
        >
          <input
            name="room"
            placeholder="ルームコード"
            maxLength={9}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" disabled={busy !== null}>
            参加
          </button>
        </form>
      </div>

      {busy ? <p className="nk-note">{busy}</p> : null}
      {error ? <p className="nk-error">{error}</p> : null}

      <section className="nk-controls-help">
        <h2>操作</h2>
        <dl>
          <div>
            <dt>↑ / W</dt>
            <dd>アクセル</dd>
          </div>
          <div>
            <dt>↓ / S</dt>
            <dd>ブレーキ・バック</dd>
          </div>
          <div>
            <dt>← → / A D</dt>
            <dd>ステアリング</dd>
          </div>
          <div>
            <dt>Space / Shift</dt>
            <dd>ドリフト（溜めてミニターボ）</dd>
          </div>
          <div>
            <dt>Z / Ctrl</dt>
            <dd>アイテム使用</dd>
          </div>
          <div>
            <dt>Q</dt>
            <dd>後方確認</dd>
          </div>
        </dl>
        <p>
          ゲームパッド対応（RT アクセル・LT ブレーキ・B ドリフト・X アイテム）。
          スマートフォンでは画面下のボタンで操作します。
        </p>
      </section>
    </div>
  );
}

export function SettingsPanel({
  settings,
  editable,
  onChange,
}: {
  settings: RoomSettings;
  editable: boolean;
  onChange(patch: Partial<RoomSettings>): void;
}): React.JSX.Element {
  return (
    <div className="nk-settings">
      <div className="nk-tracks">
        {TRACKS.map((track) => (
          <button
            key={track.id}
            type="button"
            className={settings.trackId === track.id ? "is-active" : undefined}
            disabled={!editable}
            onClick={() => onChange({ trackId: track.id })}
          >
            <b>{track.name}</b>
            <span>{track.nameJa}</span>
            <small>{track.blurb}</small>
          </button>
        ))}
      </div>
      <div className="nk-dials">
        <label>
          <span>周回数</span>
          <select
            value={settings.laps}
            disabled={!editable}
            onChange={(event) => onChange({ laps: Number(event.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((laps) => (
              <option key={laps} value={laps}>
                {laps} 周
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>出走台数</span>
          <select
            value={settings.racerCount}
            disabled={!editable}
            onChange={(event) =>
              onChange({ racerCount: Number(event.target.value) })
            }
          >
            {[4, 6, 8].map((count) => (
              <option key={count} value={count}>
                {count} 台
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>CPU の強さ</span>
          <select
            value={settings.cpuLevel}
            disabled={!editable}
            onChange={(event) =>
              onChange({ cpuLevel: Number(event.target.value) })
            }
          >
            {[1, 2, 3].map((level) => (
              <option key={level} value={level}>
                {CPU_LABELS[level - 1]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>アイテム</span>
          <select
            value={settings.items ? "on" : "off"}
            disabled={!editable}
            onChange={(event) =>
              onChange({ items: event.target.value === "on" })
            }
          >
            <option value="on">あり</option>
            <option value="off">なし</option>
          </select>
        </label>
      </div>
    </div>
  );
}

export function SoloSetup({
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
      <h2>ソロレース</h2>
      <SettingsPanel settings={settings} editable onChange={onChange} />
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

export function Lobby({
  lobby,
  isHost,
  roomCode,
  ready,
  onReady,
  onSettings,
  onStart,
  onLeave,
  note,
}: {
  lobby: NitroLobby | null;
  isHost: boolean;
  roomCode: string | null;
  ready: boolean;
  onReady(value: boolean): void;
  onSettings(patch: Partial<RoomSettings>): void;
  onStart(): void;
  onLeave(): void;
  note: string | null;
}): React.JSX.Element {
  const humans = lobby?.seats.filter((seat) => seat.occupant !== "cpu") ?? [];
  const joined = humans.filter(
    (seat) => seat.occupant === "host" || seat.occupant === "guest",
  );
  const allReady =
    joined.length > 0 &&
    joined.every((seat) => seat.occupant === "host" || seat.ready);

  return (
    <div className="nk-screen nk-lobby">
      <h2>ルーム</h2>
      {roomCode ? (
        <div className="nk-room-code">
          <span>ルームコード</span>
          <b>{roomCode}</b>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(roomCode);
            }}
          >
            コピー
          </button>
        </div>
      ) : null}

      <ul className="nk-seats">
        {(lobby?.seats ?? []).map((seat) => (
          <li key={seat.seat} className={`occupant-${seat.occupant}`}>
            <i
              style={{
                background: `#${liveryOf(seat.livery)
                  .signal.toString(16)
                  .padStart(6, "0")}`,
              }}
            />
            <b>{seat.name}</b>
            <span>
              {seat.occupant === "host"
                ? "ホスト"
                : seat.occupant === "guest"
                  ? seat.ready
                    ? "準備OK"
                    : "準備中"
                  : seat.occupant === "cpu"
                    ? "CPU"
                    : "空席"}
            </span>
          </li>
        ))}
      </ul>

      {lobby ? (
        <SettingsPanel
          settings={lobby.settings}
          editable={isHost}
          onChange={onSettings}
        />
      ) : null}

      {note ? <p className="nk-note">{note}</p> : null}

      <div className="nk-row">
        <button type="button" onClick={onLeave}>
          退出
        </button>
        {isHost ? (
          <button type="button" className="nk-primary" onClick={onStart}>
            レース開始
            {allReady ? "" : "（未準備あり）"}
          </button>
        ) : (
          <button
            type="button"
            className={ready ? "nk-primary" : undefined}
            onClick={() => onReady(!ready)}
          >
            {ready ? "準備完了" : "準備する"}
          </button>
        )}
      </div>
    </div>
  );
}

export function Results({
  result,
  focusSeat,
  onRematch,
  onMenu,
  canRematch,
}: {
  result: RaceResult;
  focusSeat: number;
  onRematch(): void;
  onMenu(): void;
  canRematch: boolean;
}): React.JSX.Element {
  const mine = result.standings.find((standing) => standing.id === focusSeat);
  return (
    <div className="nk-screen nk-results">
      <h2>リザルト</h2>
      {mine ? (
        <p className="nk-result-headline">
          <b>{mine.place}</b> 位 / {result.standings.length} 台
          <span>ベストラップ {formatTime(mine.bestLap)}</span>
        </p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>順位</th>
            <th>ドライバー</th>
            <th>タイム</th>
            <th>ベストラップ</th>
          </tr>
        </thead>
        <tbody>
          {result.standings.map((standing) => (
            <tr
              key={standing.id}
              className={standing.id === focusSeat ? "is-me" : undefined}
            >
              <td>{standing.place}</td>
              <td>
                <i
                  style={{
                    background: `#${liveryOf(standing.livery)
                      .signal.toString(16)
                      .padStart(6, "0")}`,
                  }}
                />
                {standing.name}
                {standing.cpu ? <small>CPU</small> : null}
              </td>
              <td>{standing.finished ? formatTime(standing.time) : "DNF"}</td>
              <td>{formatTime(standing.bestLap)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="nk-row">
        <button type="button" onClick={onMenu}>
          メニューへ
        </button>
        {canRematch ? (
          <button type="button" className="nk-primary" onClick={onRematch}>
            もう一度
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** On-screen controls. They write straight into the live input state. */
export function TouchControls({ touch }: { touch: TouchState }): React.JSX.Element {
  const bind = (key: keyof TouchState, value: boolean | number) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      (touch[key] as boolean | number) = value;
    },
    onPointerUp: () => {
      (touch[key] as boolean | number) = typeof value === "number" ? 0 : false;
    },
    onPointerCancel: () => {
      (touch[key] as boolean | number) = typeof value === "number" ? 0 : false;
    },
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  });

  return (
    <div className="nk-touch" aria-hidden="true">
      <div className="nk-touch-left">
        <button type="button" {...bind("steer", -1)}>
          ◀
        </button>
        <button type="button" {...bind("steer", 1)}>
          ▶
        </button>
      </div>
      <div className="nk-touch-right">
        <button type="button" className="nk-touch-item" {...bind("item", true)}>
          ITEM
        </button>
        <button type="button" className="nk-touch-drift" {...bind("drift", true)}>
          DRIFT
        </button>
        <button
          type="button"
          className="nk-touch-accel"
          {...bind("throttle", true)}
        >
          ▲
        </button>
        <button type="button" className="nk-touch-brake" {...bind("brake", true)}>
          ▼
        </button>
      </div>
    </div>
  );
}
