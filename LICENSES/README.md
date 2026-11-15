# Licenses and credits

This folder contains the licenses for the components used by MilkDrop 3 Web.
The application itself (HTML, CSS, JavaScript, integration) is released under the
MIT license. The projectM rendering engine is a separate LGPL 2.1 component loaded
by the browser as a WebAssembly module; its sources and build script are included
in `tools/`.

## Components

| Component | File | License |
| --- | --- | --- |
| Web UI and integration | `LICENSES/app-MIT.txt` | MIT |
| projectM 4.1.8 (engine) | `LICENSES/projectM-LGPL-2.1.txt` | LGPL 2.1 |
| MilkDrop 3 (BeatDrop) | `LICENSES/MilkDrop3-BSD-3-Clause.txt` | BSD 3-Clause |
| MilkDrop 3 presets | pack shipped with MilkDrop 3 | community works, credited to their authors |
| Cream of the Crop presets | `LICENSES/cream-of-the-crop-LICENSE.md` | community works / public domain in practice |
| MilkDrop texture pack | `LICENSES/texture-pack-README.md` | community pack, credited to their authors |
| "Neon Pulse" track | generated for this project | CC0 |

## projectM

The engine is [projectM](https://github.com/projectM-visualizer/projectm), version
4.1.8, compiled to WebAssembly with Emscripten. The C++ wrapper for this adaptation
is in `tools/wasm/wrapper.cpp` and the build script is in `tools/build-wasm.sh`.
In accordance with LGPL 2.1, these sources allow rebuilding and replacing
`assets/wasm/milkdrop.*`.

The complete projectM sources are available upstream:
<https://github.com/projectM-visualizer/projectm>.

## Presets and textures

The 476 presets in the MilkDrop 3 pack (including the 146 double `.milk2` presets)
come from MilkDrop2077's MilkDrop 3 distribution; they are the work of the MilkDrop
community and are credited to their authors.

The *Cream of the Crop* collection is distributed by the projectM project. Its
presets were freely released by their authors over more than twenty years. The
collection license states that they are considered to be in the public domain and
invites any author who wants their work removed to contact the projectM team.

The texture pack gathers the original MilkDrop textures and community textures
used by many presets. Thanks to the authors and maintainers of these collections.

MilkDrop was created by Ryan Geiss / Nullsoft. MilkDrop 3 is developed by
MilkDrop2077, based on BeatDrop by Maxim Volskiy. This project is an unofficial
web port by Antoine Santo aka N0NameN0, not affiliated with Nullsoft, Winamp or the
original authors.

If you are the author of a preset or texture and want a credit change or removal,
please open an issue in the project repository.
