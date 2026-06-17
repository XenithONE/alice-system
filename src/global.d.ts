export {};

declare global {
  // Injected by Vite `define` from package.json version.
  const __APP_VERSION__: string;

  interface Window {
    __cosmos?: {
      revealPlanet: () => void;
      focusWorld: (id: string) => void;
      resetCamera: () => void;
      startTimeTrial: () => void;
      cancelTimeTrial: () => void;
    };
    // Legacy bonus-marker hook some games call via parent.__markD(); App makes it live.
    __markD?: (id: string) => void;
  }
}
