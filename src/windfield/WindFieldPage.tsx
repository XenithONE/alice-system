import { useCallback, useState } from "react";
import { GpuRoot, type GpuFactory, type GpuState } from "../gpu/GpuRoot";
import { applyMotion, useMotion } from "../portfolio/motion";
import { FIELD } from "./field";

const BASE = import.meta.env.BASE_URL;

/*
 * WIND FIELD — a page about a field, which sometimes is one.
 *
 * The prose below is not a fallback either. It says what the field is, what is
 * being computed and how to walk it, and it is the same text whether or not
 * the canvas above it ever starts. A reader on a phone, a reader with motion
 * off and a reader on a browser without WebGPU all get a finished page; only
 * the top of it changes.
 */

function MotionToggle() {
  const on = useMotion();
  return (
    <button
      type="button"
      className="nav-toggle"
      aria-pressed={on}
      aria-label="モーション"
      title="風と揺れを切り替え"
      onClick={() => applyMotion(on ? "off" : "on")}
    >
      {on ? (
        <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M1 4.2c2.2-2.2 4.3 2.2 6.5 0s4.3 2.2 6.5 0" />
          <path d="M1 7.7c2.2-2.2 4.3 2.2 6.5 0s4.3 2.2 6.5 0" />
          <path d="M1 11.2c2.2-2.2 4.3 2.2 6.5 0s4.3 2.2 6.5 0" />
        </svg>
      ) : (
        <svg viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M1 7.5h13" />
        </svg>
      )}
    </button>
  );
}

const loadWorld: GpuFactory = (canvas, hooks) =>
  import("./scene/world").then((m) => m.createWindFieldWorld(canvas, hooks));
const load = () => Promise.resolve(loadWorld);

export function WindFieldPage() {
  const motion = useMotion();
  const [gpu, setGpu] = useState<GpuState>({ kind: "idle" });
  const onState = useCallback((next: GpuState) => setGpu(next), []);
  const live = gpu.kind === "live";

  /*
   * The wind is motion the reader did not ask for; walking is motion they did.
   * So motion OFF does NOT turn the world off here — unlike the gallery, where
   * the camera walks by itself. It freezes the wind and leaves the field
   * standing, which is what the quality tier's motionScale does.
   */
  const note =
    gpu.kind === "unsupported"
      ? `この環境では草原を描けません（${gpu.detail}）。下に何を計算しているかを書いています。`
      : gpu.kind === "failed"
        ? "草原の起動に失敗しました。再読み込みで直ることがあります。"
        : !motion && live
          ? "モーションをオフにしているので、風は止まっています。歩くことはできます。"
          : null;

  return (
    <div className="wf">
      <a className="skip-link" href="#wf-about">
        解説へ移動
      </a>

      <div className="wf-stage">
        <GpuRoot className="wf-canvas" liveClass="wf-live" load={load} enabled onState={onState} />

        <div className="wf-chrome">
          <a className="wf-back" href={BASE}>
            <span aria-hidden="true">←</span> AlicE sYsTeM
          </a>
          <MotionToggle />
        </div>

        {live && (
          <div className="wf-keys" role="note">
            <p>
              <b>W A S D</b> / 矢印キー — 歩く
            </p>
            <p>
              <b>Shift</b> — 走る · <b>F</b> — 一人称
            </p>
            <p>
              <b>ドラッグ</b> — 見回す（ポインタは奪いません）
            </p>
          </div>
        )}
      </div>

      <section className="wf-copy" id="wf-about">
        <p className="wf-eyebrow">WEBGPU · COMPUTE SHADER · 実験作</p>
        <h1 className="wf-title">WIND FIELD</h1>
        <p className="wf-sub">風の原</p>
        <p className="wf-lede">
          {FIELD.size}メートル四方の草原を歩けます。地形も、草の一本一本の揺れも、毎フレーム
          GPU のコンピュートシェーダが計算しています。
        </p>
        {note && <p className="wf-note">{note}</p>}

        {!live && (
          <figure className="wf-poster">
            <img
              src={`${BASE}assets/windfield/wind-field-poster.webp`}
              alt="風になびく草原。低い丘の上に草が一面に生え、遠くまで続いている。"
              width={1600}
              height={900}
              loading="lazy"
              decoding="async"
            />
            <figcaption>WebGPU で描かれる草原（実際のレンダリング）</figcaption>
          </figure>
        )}

        <dl className="wf-tech">
          <dt>地形は一つの事実</dt>
          <dd>
            起伏はコンピュートシェーダが一度だけ生成し、その結果を一度だけ CPU
            に読み戻します。以降、足元の高さも、草の根元も、描かれる地面も、すべて同じ
            {(FIELD.grid * FIELD.grid).toLocaleString()} 個の数値から来ます。CPU
            側にノイズ関数の写しはありません — 二つの実装が食い違って「見えている丘をすり抜ける」ことが起き得ない書き方です。
          </dd>
          <dt>草はバッファ 3 本にまとめてある</dt>
          <dd>
            WebGPU の既定では 1 ステージあたりストレージバッファは 8
            本まで。位置・高さ・回転・色を別々に持つと上限を超えるので、vec4
            に詰めてあります。配置は起動時に一度、風は毎フレーム、どちらも一回のディスパッチです。
          </dd>
          <dt>止まるのは風であって、あなたではない</dt>
          <dd>
            モーションをオフにすると風・雲・カメラの揺れは完全に停止しますが、歩くことはできます。読者が自分で要求した運動と、周辺で勝手に起きる運動は別のものだからです。
          </dd>
        </dl>
      </section>
    </div>
  );
}
