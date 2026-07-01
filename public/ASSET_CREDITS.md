# THE HOLLOW WARD — Asset Credits

- `public/assets/hdri/creepy_bathroom_1k.hdr`: "Creepy Bathroom" HDRI by Sergej Majboroda, [Poly Haven](https://polyhaven.com/a/creepy_bathroom), CC0 (public domain, no attribution required — credited here anyway). Used for subtle environment reflections (IBL) on wet floor/metal surfaces; not displayed directly.
- `public/assets/textures/floor/*`, `public/assets/textures/wall/*`, `public/assets/textures/metal/*`: PBR texture sets (diffuse/normal/roughness, 1k) from [Poly Haven](https://polyhaven.com/textures), CC0 (public domain, no attribution required — credited here anyway): `concrete_floor_damaged_01`, `cracked_concrete_wall`, `rust_coarse_01`.
- `public/assets/favicon-32.png`, `public/assets/favicon-64.png`, `public/assets/apple-touch-icon.png`, `public/assets/emblem.png`, `public/assets/og.jpg`: Project-local procedural artwork generated with a Python/Pillow script for this site.
- Runtime dependencies: Three.js (MIT) and SparkJS `@sparkjsdev/spark` (Apache-2.0) are installed through npm. The in-game dust/fog atmosphere is built procedurally at runtime via SparkJS Gaussian splats — no external `.spz`/`.ply` splat file is used.
- Fonts: Space Grotesk and Cormorant Garamond are loaded from Google Fonts.
- All maze geometry, props (lockers, case files, exit sign), and the monster ("The Warden") are procedurally generated Three.js geometry/materials — no external 3D models are used.
