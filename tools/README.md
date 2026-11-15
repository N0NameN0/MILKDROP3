# Tools

This folder contains the sources needed to reproduce the project's generated
artifacts.

## `build-wasm.sh`

Compiles projectM 4.1.8 plus the wrapper in `wasm/wrapper.cpp` to WebAssembly and
copies `milkdrop.js`, `milkdrop.wasm` and `milkdrop.data` into `assets/wasm/`.

Requirements: Docker. The script pulls the `emscripten/emsdk:3.1.53` image and
clones projectM into `.build/wasm/` (not versioned).

```bash
./tools/build-wasm.sh
```

Options: `PROJECTM_VERSION` (projectM tag, default `v4.1.8`), `EMSDK_IMAGE`.

The textures embedded in the WASM come from `textures/` (MilkDrop pack). The
wrapper also exposes `mdw_set_mesh`, `mdw_set_fps`, `mdw_set_aspect_correction`,
`mdw_set_beat_sensitivity`, `mdw_set_soft_cut` and `mdw_version`.

## `gen-manifest.mjs`

Scans `presets/` (`.milk` and `.milk2` files) and rewrites `manifest.json`:

```bash
node tools/gen-manifest.mjs
```

The manifest format consumed by `js/library.js`:

```json
{
  "count": 10271,
  "categories": [{ "id": "Dancer", "count": 1351 }],
  "presets": [
    {
      "i": 0,
      "n": "author - title",
      "a": "author",
      "t": "title",
      "c": "Dancer",
      "s": "subcategory",
      "p": "Dancer/.../file.milk",
      "z": 12345
    },
    {
      "i": 5159,
      "n": "000",
      "t": "000",
      "c": "MilkDrop 3",
      "p": "MilkDrop%203/000.milk2",
      "z": 35545,
      "k": "milk2",
      "d": ["First preset", "Second preset"],
      "bp": "cercle"
    }
  ]
}
```
