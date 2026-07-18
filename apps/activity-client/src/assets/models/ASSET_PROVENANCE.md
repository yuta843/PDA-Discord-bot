# Tripo character STL

- Imported: 2026-07-18
- Source supplied by the user: `tripo_model_7636149e-0a6e-498d-a5ad-f1b82dc816c8.stl`
- Source SHA-256: `7aee194ef7e467dbd3a6e01a433d2cbe43b12fadb130d035e291539497d58aa3`
- Source size: 95,152,334 bytes; 1,903,045 triangles
- Source retention: the original remains outside this repository in the user's Downloads folder
- Derived asset: `tripo-character.stl`
- Derived SHA-256: `49f81ed0e7f12b784cf1e791b5311ee567643d0c581d59910447e27111ffca92`
- Derived size: 2,000,084 bytes; 40,000 triangles
- Processing: `scripts/prepare-stl.py`, using versions pinned in `scripts/requirements-stl.txt`
- Coordinate assumption: Y-up; dimensions are normalized at runtime
- Asset license: MIT License for the derived asset included in this project

The source model was generated locally by the repository owner using owner-provided source material. The repository owner permits redistribution of this derived asset as part of this project.

## Front-projection texture

- Source supplied by the user: `file_00000000e0c87206b6d2a3c39a543d5b.jpg`
- Source SHA-256: `2cb26dedd1e8f57cb21b6bd6950db7a9e5ffff64d0839f56b5776ef10861a5c3`
- Derived asset: `tripo-front-projection.webp`
- Derived SHA-256: `605981c4a4f361e8a9fdc131073a655bbcc2600c7a2e4255a5e098311e53ac4c`
- Crop from 941x1672 source: left 224, top 24, width 512, height 1624
- Processing: `scripts/prepare-projection-texture.mjs`; resized to at most 1024px high and encoded as WebP quality 88
- Mapping: runtime planar XY projection; this is intentionally front-view-only and is not a full UV unwrap
- Calibration: horizontal UV scale `0.972` compensates for the source-crop/STL XY aspect difference; texture `flipY=true`; model faces the camera without mirroring
