# Maintainer notes

These notes are for publishing the app and for re-vendoring its shared pieces. Nobody needs them
to run, change or test CivilKit Buckling.

## Hosting a copy

The app is static files: host the repository's folder as it is, under any path, on any static
host. There is no build step and no server code. Two things matter:

- **Cache headers.** Serve the app folder with `Cache-Control: max-age=0, must-revalidate` (or
  stamp every internal URL with a content hash, see below), so a browser asks for a new `sw.js`
  on each visit.
- **The full Python runtime is optional.** Without `vendor/pyodide/` the console runs on
  MicroPython only. To offer full Python, run `npm run pyodide` (or
  `node tools/fetch-pyodide.mjs --out DIR` for a deploy folder) and ship that folder too.

If you host a modified copy, give it your own name and icon: see [TRADEMARKS.md](../TRADEMARKS.md).

## Releasing to the live site

The live copy at <https://mageengineering.com.au/apps/buckling/> is published from the website's
own repository, which copies this app in with a sync script. The script stamps every internal URL
with a content hash (`?v=<hash>`), because the site's cache would otherwise serve stale files.

1. Run `npm run precache` after changing any file the page loads, and commit `sw.js` with the
   change. `npm test` fails while `sw.js` is stale. It lists the files the app needs and a version
   made from their contents, so every release that changes a file is a new service worker, and the
   open app offers **Reload** for it.
2. Run the sync and publish the site. The sync must copy every file the page loads: when a new
   file or folder is added here, update the sync's list and its versioning in the same change. It
   must ship:
   - `sw.js` and `manifest.webmanifest` at the app's root, and every file in `icons/`;
   - the `py/` folder (the console's `cufsm_rs` lite package and the full runtime's Python files);
   - `sw.js` exactly as committed: no `?v=` stamp in it or on its URL. The page registers it by the
     relative URL `sw.js` with scope `./`, so it is the app folder's worker, and its version comes
     from its own contents;
   - every path in `sw.js`'s `FILES` (`npm run offline` and the unit tests check that list against
     the app). The worker matches requests without their query, so the `?v=` stamps still find the
     cached files.

## Re-vendoring

- **cufsm.wasm**: `node build-wasm.mjs path/to/cufsm-rs` (see the README).
- **py/cufsm-rs-py/**: `node tools/vendor-cufsm-rs-py.mjs path/to/cufsm-rs-py [tag]` copies the
  package's Python files from a release tag and records their hashes in `VERSION`.
- **vendor/civilkit/**: `node tools/vendor-civilkit.mjs path/to/studio-source` copies
  the shared extension runtime from the CivilKit Studio source, which is not public. See
  [vendor/civilkit/README.md](../vendor/civilkit/README.md).
- **Pyodide**: `node tools/fetch-pyodide.mjs --pin [version]` pins a new release in
  `js/py/pyodide-files.js`; update `THIRD_PARTY_NOTICES` from the new wheels' licence files.

When a bundled third-party file changes, update [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES) in
the same commit.
