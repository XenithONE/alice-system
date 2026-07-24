# img2threejs production summary

The harbor's skiff, castle gate, and lighthouse were decomposed into separate
admissible references before procedural modeling. The production skiff was
developed with the `hoainho/img2threejs` v1.3.0 workflow:

- reference admission and 3 × 3 detail inspection;
- macro / meso / micro feature inventory;
- material-family evidence for warm brown hull bricks, ivory sail/gunwale,
  and brass controls;
- a quality-gated blockout with named runtime nodes, sockets, colliders,
  repetition systems, and action pivots;
- browser-render comparison and self-correction.

Source references:

- `docs/design/img2threejs-inputs/skiff-reference.png`
- `docs/design/img2threejs-inputs/castle-gate-reference.png`
- `docs/design/img2threejs-inputs/lighthouse-reference.png`

Production implementation:

- `src/portfolio/gl/harbor/generated/createHarborSkiffModel.ts`

The model exposes steering-wheel, rudder, mast, sail, skipper, camera, dock,
and wake attachment points. It is production-approved at the site's gameplay
scale. The latest close-up comparison is retained at
`docs/design/qa/skiff-comparison-current.png`; it deliberately records that
the lightweight runtime mesh is not a one-to-one substitute for the much
denser generated reference asset.

