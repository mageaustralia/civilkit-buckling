/* The section templates the app ships (the shape picker) and the section a fresh page starts
   with. Each path(p) gives the polylines fromPolylines (js/model.js) meshes. Shared by app.js and
   the tests that run every starter section (tests/py-lite.test.mjs). */
export const SHAPES = {
  c:      { name: 'Lipped channel', fields: ['h', 'b', 'd'],
            path: (p) => [[[p.b, p.d], [p.b, 0], [0, 0], [0, p.h], [p.b, p.h], [p.b, p.h - p.d]]] },
  channel:{ name: 'Channel', fields: ['h', 'b'],
            path: (p) => [[[p.b, 0], [0, 0], [0, p.h], [p.b, p.h]]] },
  z:      { name: 'Z section', fields: ['h', 'b'],
            path: (p) => [[[-p.b, 0], [0, 0], [0, p.h], [p.b, p.h]]] },
  hat:    { name: 'Hat', fields: ['h', 'b'],
            path: (p) => [[[-p.b, 0], [-p.b / 2, 0], [-p.b / 2, p.h], [p.b / 2, p.h], [p.b / 2, 0], [p.b, 0]]] },
  plate:  { name: 'Plate', fields: ['b'],
            path: (p) => [[[0, 0], [p.b, 0]]] },
  tube:   { name: 'Tube', fields: [], tube: true,     // a circular tube: the finite tube method
            path: () => [[[0, 0], [0, 100]]] },
  custom: { name: 'Custom', fields: [],
            path: (p) => [p.custom && p.custom.length >= 2 ? p.custom : [[0, 0], [0, 100]]] },
  // The model edited in Nodes & elements: no template owns it any more, so path() is never used.
  model:  { name: 'Custom (model)', fields: [], path: () => [] },
};

/* The section parameters a fresh page starts with (mm, MPa). */
export const SECTION_DEFAULTS = { h: 150, b: 60, d: 40, t: 1.5, mesh: 4, E: 200000, nu: 0.3, fy: 450 };
