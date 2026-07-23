# RELIC ROAD — Style Bible

**Baseline tone:** photoreal toy-brick studio  
**World line:** “A brandless toy-brick adventure set, shot under soft studio lights.”

## Locked phrases (use in prompts / reviews)

- photoreal toy-brick studio lighting
- brandless ABS plastic, blank studs only
- no logos, no printed faces, no text, no watermark
- smooth blank studs / no minifigure proportions as product UI chrome
- green baseplate + sand path + purple portal / shrine gems

## Adopted assets (`public/assets/quest/`)

| File | Role |
|---|---|
| `title-hero.webp` | Title full-bleed background |
| `board-plate.webp` | Board canvas tile underlay |
| `card-back.webp` | Deck / opponent hand back |
| `card-frame.webp` | Card face frame texture |
| `class-portraits.webp` | Knight · Mage · Rogue · Cleric (L→R strip) |
| `combat-stage.webp` | Combat panel stage |
| `relic-gem.webp` | Active relic gem / winner motif |
| `audio/*.ogg` | CC0 SFX + optional overworld loop |

## Regeneration rules

1. **Smooth blank studs only** — no logos, no LEGO wordmark, no face prints.
2. **No minifigure proportions** on UI chrome (buttons, panels, frames stay block/plate language).
3. **No logos / no text / no watermark** on any generated plate.
4. Keep studio softbox lighting and ABS plastic sheen consistent with the cover `relic-road-brick.webp`.
5. Prefer fewer shared assets over per-card or per-monster art.

## Class color canon

| Class | Hex |
|---|---|
| Knight | `#c91a09` |
| Mage | `#0055bf` |
| Rogue | `#4b9f4a` |
| Cleric | `#f2cd37` |
| Mystic / relic | `#7a5fd0` |

## Motion

Transitions only (transform / box-shadow / opacity, ≤180ms). No continuous rAF or looping CSS animation. Honor `prefers-reduced-motion: reduce`.
