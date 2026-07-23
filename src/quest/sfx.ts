/** RELIC ROAD — lightweight SFX / BGM manager (HTMLAudioElement pool). */

const SFX_BASE = "/assets/quest/audio/";
const SFX_VOL = 0.5;
const MUSIC_VOL = 0.35;
const MUTE_KEY = "rr_muted";

export type SfxName =
  | "ui-click"
  | "ui-confirm"
  | "ui-error"
  | "modal-open"
  | "hit-deal"
  | "hit-take"
  | "levelup"
  | "coin"
  | "magic";

const SFX_FILES: Record<SfxName, string> = {
  "ui-click": "ui-click.ogg",
  "ui-confirm": "ui-confirm.ogg",
  "ui-error": "ui-error.ogg",
  "modal-open": "modal-open.ogg",
  "hit-deal": "hit-deal.ogg",
  "hit-take": "hit-take.ogg",
  levelup: "levelup.ogg",
  coin: "coin.ogg",
  magic: "magic.ogg",
};

const POOL_SIZE = 3;
const pools = new Map<SfxName, HTMLAudioElement[]>();
let musicEl: HTMLAudioElement | null = null;
let unlocked = false;
let musicWanted = false;
let mutedState = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();

function ensurePool(name: SfxName): HTMLAudioElement[] {
  let pool = pools.get(name);
  if (pool) return pool;
  pool = Array.from({ length: POOL_SIZE }, () => {
    const audio = new Audio(`${SFX_BASE}${SFX_FILES[name]}`);
    audio.preload = "auto";
    audio.volume = SFX_VOL;
    return audio;
  });
  pools.set(name, pool);
  return pool;
}

function ensureMusic(): HTMLAudioElement {
  if (musicEl) return musicEl;
  musicEl = new Audio(`${SFX_BASE}overworld-loop.ogg`);
  musicEl.loop = true;
  musicEl.preload = "auto";
  musicEl.volume = MUSIC_VOL;
  return musicEl;
}

function unlock(): void {
  if (unlocked) return;
  unlocked = true;
  // Warm one silent play attempt so later plays are less likely to reject.
  for (const name of Object.keys(SFX_FILES) as SfxName[]) {
    ensurePool(name);
  }
  ensureMusic();
  if (musicWanted && !mutedState) {
    void ensureMusic().play().catch(() => undefined);
  }
}

function attachUnlockListeners(): void {
  if (typeof window === "undefined") return;
  const once = () => {
    unlock();
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
  };
  window.addEventListener("pointerdown", once, { passive: true });
  window.addEventListener("keydown", once);
}

attachUnlockListeners();

function applyMute(): void {
  for (const pool of pools.values()) {
    for (const audio of pool) audio.muted = mutedState;
  }
  if (musicEl) {
    musicEl.muted = mutedState;
    if (mutedState) musicEl.pause();
    else if (musicWanted && unlocked) void musicEl.play().catch(() => undefined);
  }
}

export const sfx = {
  play(name: SfxName): void {
    if (mutedState) return;
    unlock();
    const pool = ensurePool(name);
    const free = pool.find(a => a.paused || a.ended) ?? pool[0]!;
    try {
      free.pause();
      free.currentTime = 0;
      free.volume = SFX_VOL;
      free.muted = mutedState;
      void free.play().catch(() => undefined);
    } catch {
      /* ignore play failures (autoplay policy, missing file) */
    }
  },

  /** BGM only when the user explicitly turns music on (no autoplay). */
  music(on: boolean): void {
    musicWanted = on;
    unlock();
    const audio = ensureMusic();
    audio.volume = MUSIC_VOL;
    audio.muted = mutedState;
    if (on && !mutedState) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  },

  get muted(): boolean {
    return mutedState;
  },

  get musicOn(): boolean {
    return musicWanted;
  },

  setMuted(value: boolean): void {
    mutedState = value;
    try {
      localStorage.setItem(MUTE_KEY, value ? "1" : "0");
    } catch {
      /* private mode */
    }
    applyMute();
  },
};
