#!/usr/bin/env bash
# Builds the projectM-based MilkDrop engine for the web.
# Requires Docker. The compiled files are copied to assets/wasm/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$ROOT/.build/wasm"
EMSDK_IMAGE="${EMSDK_IMAGE:-emscripten/emsdk:3.1.53}"
PROJECTM_VERSION="${PROJECTM_VERSION:-v4.1.8}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker est requis pour compiler le moteur WebAssembly." >&2
  exit 1
fi

mkdir -p "$BUILD" "$ROOT/assets/wasm"
cp "$ROOT/tools/wasm/wrapper.cpp" "$BUILD/wrapper.cpp"
rm -rf "$BUILD/textures"
cp -R "$ROOT/textures" "$BUILD/textures"

if [ ! -d "$BUILD/build/projectm" ]; then
  echo "→ Cloning projectM $PROJECTM_VERSION…"
  git clone --depth 1 --branch "$PROJECTM_VERSION" --recurse-submodules \
    https://github.com/projectM-visualizer/projectm.git "$BUILD/build/projectm"
fi

echo "→ Building in $EMSDK_IMAGE…"
docker run --rm --platform linux/amd64 -v "$BUILD":/src -w /src "$EMSDK_IMAGE" bash -lc '
  set -euo pipefail
  if [ ! -d build/projectm-build ]; then
    emcmake cmake -G "Unix Makefiles" -S build/projectm -B build/projectm-build \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/src/build/install \
      -DBUILD_SHARED_LIBS=OFF \
      -DBUILD_TESTING=NO \
      -DENABLE_PLAYLIST=NO
  fi
  emmake cmake --build build/projectm-build --parallel
  emmake cmake --install build/projectm-build

  mkdir -p dist
  em++ -O3 wrapper.cpp \
    -Ibuild/install/include \
    build/projectm-build/src/libprojectM/libprojectM-4.a \
    build/projectm-build/vendor/projectm-eval/projectm-eval/libprojectM_eval.a \
    -o dist/milkdrop.js \
    -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 -sFULL_ES3=1 \
    -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=5MB -sMODULARIZE=1 -sEXPORT_NAME=MilkDropWasm \
    -sEXPORTED_RUNTIME_METHODS=cwrap,ccall,UTF8ToString \
    -sEXPORTED_FUNCTIONS=_malloc,_free,_mdw_init,_mdw_load_preset,_mdw_add_pcm,_mdw_render,_mdw_resize,_mdw_set_soft_cut,_mdw_set_fps,_mdw_set_mesh,_mdw_set_aspect_correction,_mdw_set_beat_sensitivity,_mdw_version,_mdw_destroy \
    -sFORCE_FILESYSTEM=1 \
    --preload-file /src/textures@/textures
'

# Files built in the container are owned by root: make them
# removable by the local user before copying the artifacts.
docker run --rm -v "$BUILD":/b alpine chown -R "$(id -u):$(id -g)" /b

cp "$BUILD"/dist/milkdrop.js "$BUILD"/dist/milkdrop.wasm "$BUILD"/dist/milkdrop.data "$ROOT/assets/wasm/"
echo "✓ Engine copied to assets/wasm/"
ls -lh "$ROOT/assets/wasm"
