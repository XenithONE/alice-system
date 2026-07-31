/**
 * Every texture is drawn here, at runtime, on a canvas.
 *
 * Nothing is fetched. The page ships no image bytes for the circuit at all,
 * which keeps the entry small and means a track's look is a function of its
 * theme rather than of an asset someone has to remember to re-export.
 */

import * as THREE from "three";

function canvas(size: number): {
  element: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const element = document.createElement("canvas");
  element.width = size;
  element.height = size;
  const context = element.getContext("2d")!;
  return { element, context };
}

/** Deterministic value noise so a reload does not reshuffle the asphalt. */
function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

export function asphaltTexture(color: number, repeat = 8): THREE.Texture {
  const { element, context } = canvas(512);
  context.fillStyle = hex(color);
  context.fillRect(0, 0, 512, 512);
  const random = noise(0x9e37);
  // Aggregate speckle, then a couple of long streaks in the direction of travel.
  for (let i = 0; i < 26_000; i += 1) {
    const shade = random();
    const alpha = 0.05 + shade * 0.09;
    context.fillStyle =
      shade > 0.55 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha * 1.4})`;
    const size = 1 + Math.floor(random() * 2.4);
    context.fillRect(random() * 512, random() * 512, size, size);
  }
  for (let i = 0; i < 14; i += 1) {
    context.strokeStyle = `rgba(0,0,0,${0.03 + random() * 0.05})`;
    context.lineWidth = 4 + random() * 22;
    context.beginPath();
    const x = random() * 512;
    context.moveTo(x, 0);
    context.bezierCurveTo(x + 30, 170, x - 30, 340, x + random() * 20 - 10, 512);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, repeat);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A rumble strip: alternating blocks along the length of the road. */
export function rumbleTexture(a: number, b: number): THREE.Texture {
  const { element, context } = canvas(64);
  context.fillStyle = hex(a);
  context.fillRect(0, 0, 64, 32);
  context.fillStyle = hex(b);
  context.fillRect(0, 32, 64, 32);
  // Knock the pale half back: pure white curbs bloomed into a light strip.
  context.fillStyle = "rgba(0,0,0,0.16)";
  context.fillRect(0, 32, 64, 32);
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function checkerTexture(squares = 8): THREE.Texture {
  const size = 256;
  const { element, context } = canvas(size);
  const cell = size / squares;
  for (let y = 0; y < squares; y += 1) {
    for (let x = 0; x < squares; x += 1) {
      context.fillStyle = (x + y) % 2 === 0 ? "#f4f6f8" : "#15181c";
      context.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Ground cover — grass, sand or rock depending on the theme colours. */
export function groundTexture(base: number, accent: number): THREE.Texture {
  const { element, context } = canvas(512);
  context.fillStyle = hex(base);
  context.fillRect(0, 0, 512, 512);
  const random = noise(0x51ed);
  for (let i = 0; i < 3_600; i += 1) {
    const x = random() * 512;
    const y = random() * 512;
    const r = 6 + random() * 46;
    const gradient = context.createRadialGradient(x, y, 0, x, y, r);
    const mix = random();
    gradient.addColorStop(
      0,
      `rgba(${(accent >> 16) & 255},${(accent >> 8) & 255},${accent & 255},${0.05 + mix * 0.13})`,
    );
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  }
  for (let i = 0; i < 9_000; i += 1) {
    context.fillStyle = `rgba(0,0,0,${0.02 + random() * 0.07})`;
    context.fillRect(random() * 512, random() * 512, 2, 2);
  }
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Tiling is set by the band's own v scale; repeating here as well put
  // a 1.3 m tile on a 48 m apron and the moiré looked like wire mesh.
  texture.repeat.set(2, 1);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft round sprite used by every particle system. */
export function sparkTexture(): THREE.Texture {
  const { element, context } = canvas(64);
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.75)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The "?" panel on an item box. */
export function itemBoxTexture(): THREE.Texture {
  const { element, context } = canvas(128);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 128, 128);
  context.fillStyle = "#1b1f26";
  context.font = "bold 92px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("?", 64, 70);
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Boost pad chevrons pointing along the road. */
export function boostPadTexture(color: number): THREE.Texture {
  const { element, context } = canvas(128);
  context.fillStyle = "rgba(0,0,0,0)";
  context.clearRect(0, 0, 128, 128);
  context.fillStyle = hex(color);
  for (let row = 0; row < 3; row += 1) {
    const y = 18 + row * 40;
    context.beginPath();
    context.moveTo(16, y + 26);
    context.lineTo(64, y);
    context.lineTo(112, y + 26);
    context.lineTo(112, y + 40);
    context.lineTo(64, y + 14);
    context.lineTo(16, y + 40);
    context.closePath();
    context.fill();
  }
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
