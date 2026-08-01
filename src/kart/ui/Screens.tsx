import type { NitroLobby, RoomSettings } from "../net/protocol";
import type { CupView } from "../net/session";
import { liveryOf } from "../render/palette";
import { machineById } from "../content/machines";
import { SPEED_CLASSES } from "../sim/balance";
import type { RaceResult } from "../sim/types";
import { TRACKS } from "../sim/tracks";
import type { TouchState } from "../input";
import { formatTime } from "./Hud";
import { CupPanel } from "./MetaScreens";

const CPU_LABELS = ["ツーリスト", "レーサー", "ライバル"];

export function Menu({
  name,
  onName,
  onSolo,
  onGp,
  onTt,
  onRecords,
  onGarage,
  onHost,
  onJoin,
  busy,
  error,
  garageSummary,
  dailyCard,
}: {
  name: string;
  onName(value: string): void;
  onSolo(): void;
  onGp(): void;
  onTt(): void;
  onRecords(): void;
  onGarage(): void;
  onHost(): void;
  onJoin(code: string): void;
  busy: string | null;
  error: string | null;
  /** "VERA × WISP · AZURE" — what the garage button is currently holding. */
  garageSummary?: string;
  dailyCard?: React.ReactNode;
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
        <button type="button" className="nk-primary" onClick={onGp} disabled={busy !== null}>
          グランプリ
          <small>3戦カップ・総合優勝を狙う</small>
        </button>
        <button type="button" onClick={onSolo} disabled={busy !== null}>
          VSレース
          <small>1戦だけ CPU と走る</small>
        </button>
        <button type="button" onClick={onTt} disabled={busy !== null}>
          タイムトライアル
          <small>ゴーストと自己ベスト</small>
        </button>
        <button type="button" onClick={onGarage} disabled={busy !== null}>
          ガレージ
          <small>{garageSummary ?? "ドライバー・マシン・カラー"}</small>
        </button>
        <button type="button" onClick={onRecords} disabled={busy !== null}>
          記録
          <small>実績・ベスト・解放カラー</small>
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

      {dailyCard}
      {busy ? <p className="nk-note">{busy}</p> : null}
      {error ? <p className="nk-error">{error}</p> : null}

      <section className="nk-controls-help">
        <h2>操作</h2>
        <dl>
          <div>
            <dt>↑ ↓</dt>
            <dd>アクセル・ブレーキ / バック</dd>
          </div>
          <div>
            <dt>← →</dt>
            <dd>ステアリング</dd>
          </div>
          <div>
            <dt>Space</dt>
            <dd>ジャンプドリフト（跳ねて、着地の舵で向きが決まる）</dd>
          </div>
          <div>
            <dt>Shift</dt>
            <dd>マシンギミック（クールダウン制）</dd>
          </div>
          <div>
            <dt>E</dt>
            <dd>キャラスキル（クールダウン制）</dd>
          </div>
          <div>
            <dt>A S D</dt>
            <dd>アイテム 1・2・3</dd>
          </div>
          <div>
            <dt>Q</dt>
            <dd>後方確認</dd>
          </div>
        </dl>
        <p>
          アイテムが A / S / D に移ったため、ステアリングは方向キーのみになりました。
          ゲームパッド対応（RT アクセル・LT ブレーキ・A ドリフト・X / LB / RB
          アイテム・十字↑ スキル・十字↓ ギミック）。
          スマートフォンでは画面のボタンで操作します。
        </p>
      </section>
    </div>
  );
}

export function SettingsPanel({
  settings,
  editable,
  onChange,
  hideDials = [],
}: {
  settings: RoomSettings;
  editable: boolean;
  onChange(patch: Partial<RoomSettings>): void;
  hideDials?: readonly string[];
}): React.JSX.Element {
  const show = (dial: string): boolean => !hideDials.includes(dial);
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
        {show("gp") ? (
          <label>
            <span>モード</span>
            <select
              value={settings.gp ? "gp" : "single"}
              disabled={!editable}
              onChange={(event) =>
                onChange({ gp: event.target.value === "gp" })
              }
            >
              <option value="single">シングルレース</option>
              <option value="gp">グランプリ（3戦）</option>
            </select>
          </label>
        ) : null}
        {show("speedClass") ? (
          <label>
            <span>クラス</span>
            <select
              value={settings.speedClass}
              disabled={!editable}
              onChange={(event) =>
                onChange({ speedClass: Number(event.target.value) })
              }
            >
              {SPEED_CLASSES.map((speedClass, index) => (
                <option key={speedClass.label} value={index}>
                  {speedClass.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {show("mirror") ? (
          <label>
            <span>ミラー</span>
            <select
              value={settings.mirror ? "on" : "off"}
              disabled={!editable}
              onChange={(event) =>
                onChange({ mirror: event.target.value === "on" })
              }
            >
              <option value="off">なし</option>
              <option value="on">ミラー</option>
            </select>
          </label>
        ) : null}
        {show("weather") ? (
          <label>
            <span>天候</span>
            <select
              value={settings.weather}
              disabled={!editable}
              onChange={(event) =>
                onChange({ weather: Number(event.target.value) })
              }
            >
              <option value={0}>晴れ</option>
              <option value={1}>雨</option>
            </select>
          </label>
        ) : null}
        {show("laps") ? (
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
        ) : null}
        {show("racerCount") ? (
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
        ) : null}
        {show("cpuLevel") ? (
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
        ) : null}
        {show("items") ? (
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
        ) : null}
        {show("freeKit") ? (
        <label>
          <span>マシン</span>
          <select
            value={settings.freeKit ? "free" : "uniform"}
            disabled={!editable}
            onChange={(event) =>
              onChange({ freeKit: event.target.value === "free" })
            }
          >
            <option value="uniform">全員そろえる（公平）</option>
            <option value="free">各自の選択を使う</option>
          </select>
        </label>
        ) : null}
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
      <h2>VSレース</h2>
      <SettingsPanel
        settings={settings}
        editable
        onChange={onChange}
        // `freeKit` is a room rule about players racing each other; solo has
        // no second player, so the garage pick simply applies.
        hideDials={["gp", "freeKit"]}
      />
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
  onGarage,
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
  onGarage(): void;
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
            {seat.occupant === "empty" ? null : (
              <em className="nk-seat-kit">
                {machineById(seat.machineId).name}
              </em>
            )}
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
        <button type="button" onClick={onGarage}>
          ガレージ
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
  cup,
  onNextRound,
  isHost,
  newBests,
  unlockToast,
  rematchLabel,
}: {
  result: RaceResult;
  focusSeat: number;
  onRematch(): void;
  onMenu(): void;
  canRematch: boolean;
  cup?: CupView | null;
  onNextRound?(): void;
  isHost?: boolean;
  newBests?: { bestLap: boolean; bestRace: boolean };
  unlockToast?: readonly string[];
  rematchLabel?: string;
}): React.JSX.Element {
  const mine = result.standings.find((standing) => standing.id === focusSeat);
  const cupRunning = cup ? !cup.finished : false;
  const seatNames = result.standings
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((standing) => standing.name);
  return (
    <div className="nk-screen nk-results">
      <h2>{cup && cup.finished ? "最終リザルト" : "リザルト"}</h2>
      {unlockToast && unlockToast.length > 0 ? (
        <p className="nk-unlock-toast">新しいカラーを解放: {unlockToast.join("・")}</p>
      ) : null}
      {mine ? (
        <p className="nk-result-headline">
          <b>{mine.place}</b> 位 / {result.standings.length} 台
          <span>
            ベストラップ {formatTime(mine.bestLap)}
            {newBests && newBests.bestLap ? (
              <em className="nk-new-record"> NEW RECORD!</em>
            ) : null}
          </span>
        </p>
      ) : null}
      {cup ? <CupPanel cup={cup} seatNames={seatNames} /> : null}
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
        {cupRunning && (isHost ?? true) && onNextRound ? (
          <button type="button" className="nk-primary" onClick={onNextRound}>
            次のレースへ（ROUND {Math.min((cup?.round ?? 0) + 2, cup?.rounds ?? 3)}/{cup?.rounds}）
          </button>
        ) : null}
        {cupRunning && isHost === false ? (
          <span className="nk-note">ホストの開始を待っています…</span>
        ) : null}
        {!cupRunning && canRematch ? (
          <button type="button" className="nk-primary" onClick={onRematch}>
            {rematchLabel ?? "もう一度"}
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
      {/* Item slots along the top edge: three small targets a thumb can find
          without leaving the wheel, and far from the one that fires a drift. */}
      <div className="nk-touch-items">
        <button type="button" {...bind("item0", true)}>
          1
        </button>
        <button type="button" {...bind("item1", true)}>
          2
        </button>
        <button type="button" {...bind("item2", true)}>
          3
        </button>
      </div>
      <div className="nk-touch-left">
        <button type="button" {...bind("steer", -1)}>
          ◀
        </button>
        <button type="button" {...bind("steer", 1)}>
          ▶
        </button>
      </div>
      <div className="nk-touch-right">
        <button
          type="button"
          className="nk-touch-ability"
          {...bind("gimmick", true)}
        >
          G
        </button>
        <button
          type="button"
          className="nk-touch-ability nk-touch-skill"
          {...bind("skill", true)}
        >
          S
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
