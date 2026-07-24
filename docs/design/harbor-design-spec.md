# AlicE sYsTeM — Harbor World design specification

## Accepted visual references

- `alice-harbor-reference.png`: environment, palette, material and lighting source.
- `harbor-desktop-concept.png`: first desktop viewport and sailing HUD.
- `harbor-walk-project-concept.png`: disembarked walking state and selected-work rail.
- `harbor-mobile-concept.png`: cinematic mobile tour and works-sheet continuation.

## Product promise

The portfolio is a playable fantasy harbor assembled from toy bricks. On a capable desktop,
the visitor sails a small skiff into the harbor, docks, disembarks as a block figure and
discovers projects along the promenade. On mobile, the same route becomes a guided cinematic
tour with swipe/tap navigation. Every project and studio section remains available through
semantic HTML, keyboard navigation and a poster-backed fallback.

## World-to-content map

| Landmark | Content |
| --- | --- |
| Promenade poster easels | All 14 works and project details |
| Lighthouse | AI Lab |
| Market atelier | Prompt Archive |
| Castle gate / studio terrace | Stack and studio notes |
| Harbor map | Direct accessible navigation to every district |

## Allowed first-viewport copy

- `AlicE sYsTeM`
- `WORKS`
- `AI LAB`
- `PROMPT ARCHIVE`
- `MAP`
- `港を旅して、作品を遊ぶ。`
- `航海をはじめる`
- `WASD 移動`
- `視点操作`
- `← → 舵を切る`
- `DOCK`

No eyebrow, kicker, badge, metric, proof chip or extra visible subtitle is allowed above the
fold. UI controls remain code-native; the harbor artwork is never tinted by a color overlay.

## Desktop states

### Sailing

- Third-person camera behind the skiff.
- `W/S` throttle, `A/D` or arrow keys steering, pointer drag for a small camera orbit.
- The nearest eligible dock is marked in-world and on the map.
- `E` or the visible dock action changes to walking mode when the skiff is inside the dock
  trigger.

### Walking

- Third-person camera behind the block figure.
- `WASD` movement, `Shift` run, `E` inspect.
- Project posters are physical harbor easels. Hover/focus highlights the nearest portal;
  selection opens the existing project detail experience.
- The skiff remains moored and can be re-boarded at the dock.

### Accessible navigation

- `MAP` opens a semantic landmark navigator.
- `WORKS`, `AI LAB` and `PROMPT ARCHIVE` scroll to the equivalent DOM sections.
- A visible `3D / CINEMA` experience control switches to the poster-backed browse path without
  losing content.
- The canvas never receives essential text or the only copy of an action.

## Mobile behavior

- Cinematic camera follows the harbor route; there is no free-movement physics.
- Horizontal swipe/tap moves between `WORKS`, `AI LAB`, `PROMPTS` and `STUDIO`.
- Pause and mute controls are explicit; audio is muted by default.
- A deep-navy editorial sheet continues into the full works list.
- Reduced motion, no WebGL, low-memory or data-saver contexts start directly on the reference
  image plus the semantic works list.

## Visual tokens

### Color

- Sky blue: `#73bde8`
- Water cyan: `#08a9c5`
- Water deep: `#036b8e`
- Cream brick: `#d8c39d`
- Terracotta: `#a9472f`
- Cobalt roof: `#1767aa`
- Teal roof: `#138b88`
- Foliage: `#3a8f47`
- Brass accent: `#e6ad46`
- Warm window: `#ffc45b`
- Editorial navy: `#061c31`
- Bone white: `#f6f1e7`

### Typography

- Display serif: `"Shippori Mincho", "Yu Mincho", serif`.
- Editorial sans: `"Barlow Condensed", "Arial Narrow", sans-serif`.
- Japanese UI: `"Noto Sans JP", "Yu Gothic", sans-serif`.
- Hero headline: responsive `clamp(3rem, 6vw, 7.5rem)`, regular weight, tight line height.
- Navigation and HUD: 12–14 px desktop, 15–18 px touch targets on mobile, tracked uppercase.

### Geometry and surfaces

- Canvas and world are full-bleed; no rounded hero container.
- Project detail uses a sharp-edged right rail with one brass rule, not a glass card.
- Content sections continue on deep navy and bone-white editorial bands rather than a repeated
  card grid.
- Brick edges have a small real bevel; plastic roofs use controlled clearcoat; stone stays
  rougher with subtle color variation; brass and water provide specular contrast.

### Motion

- Skiff: low-frequency pitch/roll plus visible wake.
- Water: slow vertex and highlight motion, capped by quality tier.
- Landmark lights: subtle warm flicker only.
- UI: 180–260 ms editorial slides/fades; no bouncing or ornamental looping.
- `prefers-reduced-motion` disables camera travel, ambient loops and smooth scrolling.

## Component inventory

- `HarborHero`: DOM lockup, HUD, experience controls and state announcement.
- `HarborRoot`: WebGL lifecycle, quality selection, poster cross-fade and context recovery.
- `harborScene`: renderer, world, player controllers, camera, picking and capture seam.
- `harborModels`: img2threejs-derived castle gate, lighthouse and skiff factories.
- `HarborMap`: semantic landmark navigator and current-state indicator.
- Existing `GamesSection`, `GameDetail`, `AiLab`, `Prompts`, `StackStrip` and `Footer`, reskinned
  into the same editorial system without losing data or actions.

## Quality targets

- One obvious playable route and one clear dock within the first viewport.
- All 14 works remain reachable without WebGL and by keyboard.
- Desktop target: 60 fps high/balanced, 30 fps low; DPR and pixel count capped.
- Mobile target: cinematic route with fewer instances, 30 fps; fallback avoids loading Three.js.
- No clipped primary copy at 1440×900, 1280×720, 390×844 or 360×800.
- No uncaught console errors, missing textures, inert primary controls or focus traps.
