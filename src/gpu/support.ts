/**
 * Can this machine run the page at all, asked before anything heavy loads.
 *
 * The order matters more than the answer. three/webgpu is 177 KB gzip; asking
 * the browser for an adapter costs a few milliseconds and no bytes. So the
 * probe runs first and the renderer chunk is only fetched once the answer is
 * yes — a reader on a browser without WebGPU downloads none of it.
 *
 * The reasons are separated because they are different messages to a reader.
 * "Your browser has no WebGPU" and "this page is being served over http, so
 * the browser withheld it" look identical from inside the page and mean
 * entirely different things to the person reading it. The second one caught
 * this project out during planning: the probe said false on about:blank, which
 * is not a secure context, and the honest conclusion "no WebGPU on this
 * machine" was wrong.
 */

export type GpuFailure = "no-api" | "insecure" | "no-adapter" | "no-device";

export interface GpuSupport {
  readonly ok: boolean;
  readonly reason?: GpuFailure;
  /** Japanese, and shown to the reader verbatim. */
  readonly detail: string;
  /** True when the browser handed back a software adapter. */
  readonly fallback: boolean;
}

const MESSAGES: Record<GpuFailure, string> = {
  "no-api": "このブラウザは WebGPU に対応していません",
  insecure: "安全なコンテキスト（https）でないため WebGPU が使えません",
  "no-adapter": "WebGPU は使えますが、描画できる GPU が見つかりません",
  "no-device": "GPU は見つかりましたが、デバイスを取得できませんでした"
};

const fail = (reason: GpuFailure): GpuSupport => ({ ok: false, reason, detail: MESSAGES[reason], fallback: false });

let pending: Promise<GpuSupport> | null = null;

/**
 * Memoised, because StrictMode mounts every effect twice and a second adapter
 * request is a second round trip to the driver for an answer that cannot have
 * changed. The promise is cached rather than the result, so two callers racing
 * on first paint share one request instead of starting two.
 */
export function probeWebGpu(): Promise<GpuSupport> {
  pending ??= run();
  return pending;
}

async function run(): Promise<GpuSupport> {
  if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu) {
    /* isSecureContext is the discriminator: a browser that HAS WebGPU still
       hides navigator.gpu on an insecure origin, and the two cases need
       different words. */
    return fail(typeof window !== "undefined" && !window.isSecureContext ? "insecure" : "no-api");
  }

  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch {
    return fail("no-adapter");
  }
  if (!adapter) return fail("no-adapter");

  /*
   * A device, then thrown away. The renderer will ask for its own — three's
   * backend owns that — and asking twice costs one extra driver round trip.
   * It buys the difference between "we believe this will work" and "this
   * worked once", which is the difference between showing the reader a
   * corridor and showing them a blank canvas with a console error.
   */
  try {
    const device = await adapter.requestDevice();
    device.destroy();
  } catch {
    return fail("no-device");
  }

  const fallback = (adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter === true;
  return {
    ok: true,
    fallback,
    detail: fallback ? "ソフトウェア描画の WebGPU で動作します" : "WebGPU で動作します"
  };
}
