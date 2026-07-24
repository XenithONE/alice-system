# Harbor Portfolio — Design QA

## Scope and evidence

- Desktop target: 1280 × 720 native browser viewport.
- Mobile target: 390 × 844 viewport, rendered inside the QA frame without changing the app's responsive layout.
- Accepted concept: `docs/design/harbor-desktop-concept.png`.
- Latest desktop render: `docs/design/qa/harbor-desktop-render.jpg`.
- Desktop comparison: `docs/design/qa/harbor-desktop-comparison.png`.
- Walk-mode comparison: `docs/design/qa/harbor-walk-comparison.png`.
- Mobile comparison: `docs/design/qa/harbor-mobile-comparison.png`.
- Skiff reference comparison: `docs/design/qa/skiff-comparison-current.png`.

## Visual comparison

1. The full-bleed golden-hour toy-brick harbor, blue/teal water, blue roofs, ivory towers, and lighthouse preserve the accepted concept's palette and visual hierarchy.
2. The wordmark, four-item navigation, Japanese display headline, and underlined voyage CTA retain the concept's placement and editorial typography.
3. The landing screen uses the high-detail generated harbor key art; activating the CTA dissolves into the playable Three.js harbor. This deliberately keeps the first impression at concept quality while making the next state genuinely interactive.
4. Walk mode keeps the concept's third-person figure, waterfront project frames, bottom-left controls, and dark right-hand project rail. The verified dynamic item is HuntContract rather than the concept's illustrative Relic Road.
5. Mobile keeps the portrait harbor camera, right-side landmark route, pause control, brass divider, and dark editorial project sheet. Camera distance and FOV were widened so the complete skiff remains visible on a 390 px viewport.

## Typography, layout, and imagery

- No first-viewport headline, navigation, or project-rail clipping remains.
- HuntContract fits on one line on desktop and mobile.
- The real generated harbor image and real project covers are used; there are no placeholder image boxes, emoji illustrations, or hand-drawn SVG substitutes.
- The project rail, map panel, modal, and downstream sections use the navy/bone/brass token system consistently.
- Fourteen work cards, AI Lab, Prompt Archive, stack, next-title section, and footer remain present.

## Interaction verification

- Voyage CTA enters sailing mode and fades the key art into the live 3D world.
- Desktop sailing exposes movement, steering, map, and dock states.
- The deterministic QA journey verified dock arrival, enabled/disabled dock controls, disembark, walking state, active project detection, project rail, project modal open/close, and map open/close.
- WORKS navigation resolves to `#games` and aligns the section at the top of the viewport.
- Mobile verified cinematic playback, pause, landmark selection, active route state, and the project sheet.
- Reduced-motion / constrained-device mode keeps the high-quality image fallback and does not initialize the live scene.

## Accessibility and resilience

- Core controls are semantic buttons/links with accessible names.
- Map and modal controls expose close labels; the mode change is announced through an `aria-live` region.
- Focus-visible treatment, minimum mobile tap targets, reduced-motion behavior, and meaningful image alternatives are present.
- The final clean browser launch and navigation produced no console warnings or errors.

## Performance and build

- Three.js and the harbor scene are dynamically loaded after the HTML/React shell.
- Final build: main portfolio chunk 46.58 kB (15.67 kB gzip), harbor scene 35.55 kB (13.18 kB gzip), shared Three.js 575.49 kB (147.08 kB gzip).
- Device-pixel-ratio caps, 30/60 fps quality tiers, geometry tiers, low-power poster fallback, texture reuse, and explicit WebGL cleanup are implemented.
- `npm run typecheck` and `npm run build` pass.

## Deliberate deviations

- The accepted desktop concept previewed the boat and HUD in the first still. The implementation delays those elements until the voyage CTA so the generated hero art remains uncluttered, then provides the real controllable skiff.
- The real-time harbor uses a lighter procedural brick count than the generated concept. The isolated skiff passes production readability at gameplay scale but intentionally remains below img2threejs' strict close-up, one-to-one silhouette gate; it is not presented as a close-up hero asset.
- The mobile concept's illustrative Relic Road project is replaced with the first real portfolio item, HuntContract.

final result: passed
