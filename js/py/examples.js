/* The Python console's scripts from elsewhere: the example scripts it ships (py/examples/) and a
   file the user opens or drops. Pure of the DOM, so the Node tests check the same code the
   console (js/py/console-ui.js) runs. */

/* The example scripts, in the order the menu lists them: py/examples/<file>. Each runs on today's
   MicroPython lite layer (tests/py-examples.test.mjs runs every one). The first two show what
   a script adds to the GUI: hundreds of analyses in a loop, each feeding a design check. The DSM
   ones import py/examples/dsm.py, which the console installs (js/py/lite.js LIB_FILES). */
export const EXAMPLES = [
  { file: 'lightest_section.py', label: 'Search: the lightest lipped C for a load' },
  { file: 'catalogue_check.py', label: 'Catalogue check: 12 sections against a load' },
  { file: 'dsm_lip_study.py', label: 'DSM design study: lip depth' },
  { file: 'end_conditions.py', label: 'End conditions: S-S, C-C, S-C, C-F, C-G' },
  { file: 'distortional_mode.py', label: 'Distortional mode and sheathing springs' },
];
/* The full-Python examples (py/examples/full/): what a script adds with numpy, scipy and matplotlib,
   the GUI can't. They run on the full runtime (Pyodide), downloaded once the user agrees; the menu
   labels them so. tests/parity/ runs each against CPython and pip. */
export const FULL_EXAMPLES = [
  { file: 'full/readme_quickstart.py', label: 'cufsm-rs-py README quickstart, verbatim (numpy, plots)', full: true },
  { file: 'full/lip_study_plots.py', label: 'Lip study, plotted: curves overlaid, Pn/A against lip', full: true },
  { file: 'full/lightest_numpy.py', label: 'Lightest section: numpy design space, scipy, mass vs capacity', full: true },
];
export const exampleUrl = (file) => new URL(`../../py/examples/${file}`, import.meta.url);
export const DEFAULT_NAME = 'buckling-script.py';
export const OPEN_MAX = 1 << 20;                        // bytes: a script, not a data file

/* the name a script is saved under: the opened file's, as .py */
export const scriptName = (name) => String(name || 'buckling-script').replace(/\.(py|txt)$/i, '') + '.py';

/* A file the user picked or dropped, checked before it reaches the editor: a .py or .txt (or a
   text/* type), at most OPEN_MAX bytes, valid UTF-8 with no NUL. Resolves to its text; rejects
   with a message for the user. */
export async function readScriptFile(file) {
  const name = file?.name || 'the file';
  const ext = /\.(py|txt)$/i.test(name);
  if (!ext && !/^text\//.test(file?.type || '')) throw new Error(`“${name}” was not opened: the console opens Python (.py) and text (.txt) files.`);
  if (file.size > OPEN_MAX) throw new Error(`“${name}” was not opened: it is ${(file.size / 1048576).toFixed(1)} MB, and the console opens files up to 1 MB.`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); } catch { text = null; }
  if (text == null || text.includes('\0')) throw new Error(`“${name}” was not opened: it is not a text file.`);
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}
