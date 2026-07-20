# AlicE sYsTeM v4 — KINTSUGI（金継のモノリス）Design Spec

**Final direction** — synthesized from a 4-way internal design panel (winner on all 3 judge scorecards),
Codex consultation ("NULL CATHEDRAL") and Grok consultation ("VOID RELIQUARY"). All three converged on:
near-black void · champagne gold · single monumental 3D object · orbital works gallery · chapter-morph scroll.

## Concept

A museum after closing. One object in an infinite black void: an **obsidian monolith, fractured and
repaired with molten champagne gold** — kintsugi (金継ぎ). The metaphor is the studio itself: AI work is
iteration, breakage, repair; the gold seams are where failed prompts were mended into finished works.
Wall text: 「壊れたものを、金で継ぐ。」 The site ends with a vermilion seal (落款).

## Palette

| Role | Hex |
|---|---|
| Void 墨 | `#0a0a0c` |
| Obsidian panel | `#121216` |
| Graphite hairline | `#26262c` |
| Bone text | `#ece7dd` |
| Kintsugi gold | `#cdaa6d` |
| Gold bloom | `#f0d9a6` |
| Vermilion 朱 (2 uses only: Lab axis + seal) | `#fb3516` |
| Cobalt (1 use: Lab axis) | `#164cff` |

Scarcity is the color system: gold is structure, vermilion/cobalt appear exactly at the Lab A/B axis and the footer seal.

## Typography

- Display EN: Cormorant Garamond Italic, clamp(64px, 11vw, 170px), tracking -0.02em, bone
- Display JP: 明朝 system stack (Yu Mincho / Hiragino Mincho ProN / Noto Serif JP) — wall-text captions, ghost 金継 numerals
- UI/body: Space Grotesk 400/500 15px / 1.8
- Catalog: Space Mono — gold accession numbers 「No.01 / 10」, coordinates, tech tags. Gold never used for body text.

## Persistent 3D world (one lazy GL bundle, vanilla three r184)

Monolith: elongated icosahedron (~30k tris, FBM vertex displacement baked at init),
MeshPhysicalMaterial (clearcoat 1, roughness .35) + authored TubeGeometry crack ribbons (merged,
emissive #f0d9a6 → UnrealBloomPass threshold .85, half-res). ONE shadow spotlight (static) + cool fill +
cursor-orbit rim light. 1,500-instance gold dust (sin-drift in vertex shader). Camera dollies a
CatmullRomCurve3 with per-chapter lookAt targets, dt-scaled lerp.

| Chapter | State |
|---|---|
| HERO | three-quarter monolith right-of-center, spotlight upper-left, title passes partly behind silhouette |
| WORKS | camera wide/low; monolith far-left; largest crack hosts gold PointLight lighting the gallery |
| LAB | monolith bisects along main seam (pre-split halves), left vermilion / right cobalt, 1px gold plane between |
| PROMPTS | halves rejoin; seams breathe (sin emissive 0.8–1.3); DOM rises, 3D quiet |
| FOOTER | camera glides INTO the widest crack → inverted-normal gold inner shell; DOM inverts to obsidian-on-gold |

## Five signature moments

1. **SEAM IGNITION (load)** — gold hairline draws itself (crack u-parameter sweep 1.2s), spotlight snaps on with 2-frame flicker.
2. **CURATOR'S TORCH (cursor)** — pointer drives an orbiting rim light; micro-engraved kanji of work titles legible only under raking light.
3. **CRACK PROJECTION (work hover)** — nearest seam widens (morph 0→0.3 spring); hovered work's cover glows through the gap (monolith as lantern).
4. **THE BISECTION (lab)** — single cubic 1.6s split, 300 gold points hang in the gap, vermilion/cobalt lights fade in (first accent appearance).
5. **落款 THE SEAL (footer)** — all motion stops; vermilion square seal descends with anticipation, stamps with 2px camera shake. 完.

## Works gallery (10 covers)

Vitrine slabs: bent PlaneGeometry glass plates racked in Z-depth; only the focused slab lit by the
crack PointLight, neighbors fall to 4%. Hover: 6° tilt + self-drawing gold border + mono accession number.
Click: slab lerps to viewport, cross-fades to DOM. Each slab tracks a real DOM card
(getBoundingClientRect) — a11y/SEO live in DOM, GL is decoration.

## Static fallback (designed FIRST — the owner's machine is reduced-motion: fallback IS the first impression)

Pure #0a0a0c print catalog. Hero: pre-rendered monolith still (headless-GL capture pipeline),
「金継」mincho ghost at 20vw behind Cormorant italic. An inline-SVG gold seam runs the full scroll as the
page spine, branching hairlines into each section. Works: full-width rows (cover / gold accession /
italic title / mincho one-liner / 1px gold rules). Lab: 2 columns with vermilion/cobalt top borders.
Footer: the seal as inline SVG, always stamped. Nothing feels missing without WebGL.

## Perf budget

Fallback is LCP. GL (~180KB gz) dynamic-imported after WebGL2 probe + !reduced-motion + idle.
~45k tris, ~15 draw calls. Bloom half-res, composer skipped in quiet chapters. DPR ≤1.5.
FPS ladder: <45fps halve dust; <30fps drop bloom; persistent <30fps → permanent DOM fallback.
Mobile: DPR 1, no bloom/shadow, auto-orbit replaces cursor torch.

## Build order

1. Fallback catalog page complete (ship-ready alone)
2. GL boot (lazy import, probe, fade-over)
3. Monolith + seams + SEAM IGNITION
4. Scroll camera spine + vitrine slabs + DOM sync
5. Torch + crack projection
6. Lab bisection + prompts breathing
7. Footer swallow + seal + DOM inversion
8. FPS ladder, mobile pass, hero still + OG capture
