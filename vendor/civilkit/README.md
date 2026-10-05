# vendor/civilkit

The extension runtime CivilKit Buckling shares with CivilKit Studio, vendored here unchanged so
the app has no build step and no dependency on a package registry.

| File | What it is | From | Licence |
|---|---|---|---|
| `host.js` | The module UI renderer: a module emits a JSON tree, the host builds every DOM node | CivilKit Studio's shared package `@civilkit/moduleui` | Apache-2.0 |
| `registry.js` | Reads, validates and stores `.ckext` bundles (IndexedDB, with a memory fallback) | `@civilkit/moduleui`; its fflate import points at `./fflate.js` | Apache-2.0 |
| `micropython.mjs`, `micropython.wasm` | MicroPython 1.24.1, webassembly port | byte-for-byte the npm package `@micropython/micropython-webassembly-pyscript` 1.24.1 | MIT |
| `fflate.js` | fflate 0.8.2, the zip reader and writer | the esm.sh browser build | MIT |
| `VERSION` | The CivilKit Studio source commit these files were copied from (`upstream <commit>`) | | |

`host.js` and `registry.js` are CivilKit's own code. They were written for CivilKit Studio's
shared packages (`@civilkit/moduleui` and friends) and are published here under the same
Apache License 2.0 as the rest of this repository. They are pinned at the commit in `VERSION`:
change them upstream and re-vendor rather than editing them here, so the two apps keep one
renderer and one bundle format.

MicroPython and fflate keep their own MIT licences; their notices are in
[`THIRD_PARTY_NOTICES`](../../THIRD_PARTY_NOTICES).

## Re-vendoring (maintainers)

`tools/vendor-civilkit.mjs` copies these files from a local checkout of the CivilKit Studio
source, which is not public:

```sh
node tools/vendor-civilkit.mjs path/to/studio-source
```

Without such a checkout the tool stops with a message and changes nothing. Nobody else needs to
run it: the vendored files are complete as committed, and `npm test` checks them.
