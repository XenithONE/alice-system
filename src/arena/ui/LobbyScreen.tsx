import type { SeatInfo } from "../net/protocol";

interface LobbyScreenProps {
  room: string;
  seats: readonly SeatInfo[];
  mySeat: number;
  ready: boolean;
  loading: boolean;
  error: string;
  massOf(seat: SeatInfo): number | null;
  onReady(ready: boolean): void;
  onBack(): void;
}

const OCCUPANT: Record<SeatInfo["occupant"], string> = {
  host: "HOST",
  guest: "GUEST",
  ai: "AI",
  empty: "空席"
};

export function LobbyScreen({ room, seats, mySeat, ready, loading, error, massOf, onReady, onBack }: LobbyScreenProps) {
  const copyRoom = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(room);
    } catch {
      // The selectable room code remains available when clipboard access is denied.
    }
  };
  return (
    <main className="sc-lobby">
      <header className="sc-screen-head">
        <button className="sc-text-button" type="button" onClick={onBack}>← タイトルへ</button>
        <div>
          <span>FIGHT LOBBY</span>
          <h1>出撃準備</h1>
        </div>
        <button className="sc-room-code" type="button" onClick={() => void copyRoom()} title="ルームコードをコピー">
          <small>ROOM CODE</small><strong>{room}</strong><i>コピー</i>
        </button>
      </header>
      <section className="sc-seats" aria-label="参加者">
        {Array.from({ length: 4 }, (_, index) => {
          const seat = seats[index] ?? {
            seat: index, name: `SEAT ${index + 1}`, occupant: "empty", ready: false, spec: null
          } as SeatInfo;
          const mass = massOf(seat);
          return (
            <article className={`sc-seat sc-seat--${index}${index === mySeat ? " is-you" : ""}`} key={index}>
              <div className="sc-seat__number">{String(index + 1).padStart(2, "0")}</div>
              <div className="sc-seat__status"><span>{OCCUPANT[seat.occupant]}</span>{index === mySeat && <b>YOU</b>}</div>
              <h2>{seat.name}</h2>
              <dl>
                <div><dt>機体</dt><dd>{seat.spec?.name ?? "未登録"}</dd></div>
                <div><dt>質量</dt><dd>{mass === null ? "—" : `${mass.toFixed(1)} kg`}</dd></div>
              </dl>
              <div className={`sc-seat__ready${seat.ready ? " is-ready" : ""}`}>{seat.ready ? "READY" : "STANDBY"}</div>
            </article>
          );
        })}
      </section>
      <footer className="sc-lobby__foot">
        <p className="sc-network-note"><b>通信仕様について</b> ホストは物理演算を直接操作するため、ゲストより入力遅延が少なく有利です。</p>
        <div>
          {error && <p className="sc-error" role="alert">{error}</p>}
          <button className="sc-button sc-button--primary sc-button--ready" type="button" disabled={loading}
            onClick={() => onReady(!ready)}>{loading ? "接続中…" : ready ? "READY 解除" : "READY"}</button>
        </div>
      </footer>
    </main>
  );
}
