#!/usr/bin/env node
/* Build the cufsm-rs engine to WebAssembly for this page: cufsm.wasm, next to index.html.
   The C interface is an opt-in cargo feature of cufsm-rs (crates that depend on it keep an
   rlib with no exports). Run from anywhere:  node build-wasm.mjs [path/to/cufsm-rs]
   Default crate path: ../cufsm-rs (a checkout of github.com/mageaustralia/cufsm-rs). */
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const crate = resolve(process.argv[2] || join(here, '..', 'cufsm-rs'));
statSync(join(crate, 'Cargo.toml'));

execFileSync('cargo', ['rustc', '--release', '--target', 'wasm32-unknown-unknown',
                       '--features', 'ffi', '--crate-type', 'cdylib', '--lib'],
             { cwd: crate, stdio: 'inherit' });

const built = join(crate, 'target/wasm32-unknown-unknown/release/cufsm.wasm');
const wasm = readFileSync(built);
const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map((e) => e.name);
const need = ['memory', 'cufsm_alloc', 'cufsm_dealloc', 'cufsm_abi_version', 'cufsm_signature',
              'cufsm_modes', 'cufsm_props', 'cufsm_stresgen', 'cufsm_yield', 'cufsm_stress_to_action',
              'cufsm_ftm', 'cufsm_last_error_ptr', 'cufsm_last_error_len',
              // ABI 2 minor 1: the Python console's exports
              'cufsm_abi_minor', 'cufsm_strip', 'cufsm_classify', 'cufsm_template', 'cufsm_props_wn',
              'cufsm_signature_lengths', 'cufsm_signature_minima'];
const missing = need.filter((n) => !exports.includes(n));
if (missing.length) throw new Error(`missing export(s): ${missing.join(', ')}`);
const stray = exports.filter((n) => n !== 'memory' && !n.startsWith('cufsm_'));
if (stray.length) console.warn(`note: extra exports: ${stray.join(', ')}`);
const { instance } = await WebAssembly.instantiate(wasm, {});
if (instance.exports.cufsm_abi_version() !== 2) throw new Error('cufsm.wasm ABI is not 2');
if (!(instance.exports.cufsm_abi_minor() >= 1)) throw new Error('cufsm.wasm ABI minor is below 1');
const BUDGET_KB = 600;
if (wasm.length / 1024 > BUDGET_KB) console.warn(`warning: cufsm.wasm is over the ${BUDGET_KB} KB budget`);

copyFileSync(built, join(here, 'cufsm.wasm'));
const rev = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: crate }).toString().trim(); } catch { return '?'; } })();
console.log(`cufsm.wasm: ${(wasm.length / 1024).toFixed(0)} KB, from cufsm-rs ${rev}${
  execFileSync('git', ['status', '--porcelain'], { cwd: crate }).toString().trim() ? ' (with uncommitted changes)' : ''}`);
