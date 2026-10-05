# Rounded C / Z section

A CivilKit Buckling module (`buckling.tool`) that builds a lipped or plain C or Z section with
rounded corners, node by node, the way CUFSM's template does. It shows the section's properties
from the engine (`sectionProps`) and offers the section to the analysis (`proposeModel`). The app
then asks you: **Preview**, **Use it** (undoable) or **Dismiss**. Untick "Offer it to the analysis"
to see the properties only.

## The geometry

The node layout is a port of CUFSM's `helpers/templatecalc.m`, with both lips at 90°, one radius r
for all four corners, and these element counts:
- `nh` in the web;
- `nb` per flange;
- `nd` per lip;
- `nr` per corner.

The section has no node at an arc's midpoint unless `nr` makes one, exactly as in CUFSM. The
dimensions come in one of two forms:

- **centreline flats, centreline radius:** CUFSM's template with `center = 1`. The flats h, b and d
  are the straight lengths between the corners, so the overall centreline width is b + 2r.
- **outside, inside radius:** CUFSM's `template_out_to_in.m` converts them first:
  - r = ri + t/2;
  - h = H − t − 2r;
  - b = B − r − t/2 − (r + t/2);
  - d = D − (r + t/2).

The module computes no property itself. A, the I's, the principal angle and the centroid all come
from the engine. A product of inertia below 1e-9 of the larger I is shown as 0 (for a symmetric C
the engine returns rounding noise there).

## Worked examples (`tests/worked-examples.json`)

Both are **CUFSM's own template, run in Octave by the cufsm-rs oracle**. The source is the cases
in cufsm-rs `oracle/cases.py`, run on CUFSM at commit d16e281. The recorded `props` and node lists
are in cufsm-rs `tests/fixtures/cufsm_octave.json`. The expected values are those recorded numbers
unchanged. If this file's geometry reproduces CUFSM's node for node, the engine's properties match
them:

| Example | Oracle case | Template call | Expected |
|---|---|---|---|
| `cufsm-template-lipped-c-rounded` | `lipped-c rounded compression` | `template(1, 200, 75, 75, 20, 20, 3.0, 1.5, nh=6, nb=3, nd=2, nr=2)`, centreline | 25 nodes, A = 612.553, Ixx = 4 160 691.6, Izz = 584 392.08 |
| `cufsm-template-lipped-z-outside` | `outside-dims lipped-z compression` | `template(2, 200, 76, 70, 15, 15, 3.0, 1.9, nh=8, nb=4, nd=2, nr=2)`, outside dimensions (`center = 0`) | 29 nodes, A = 685.873, Ixx = 4 192 154.2, Izz = 690 341.78, Ixz = −1 250 769.96, I11 = 4 593 014.2, I22 = 289 481.72 |

All values are in mm² and mm⁴. Before these examples were written, the engine's `props` on the
oracle's own node lists were checked against the recorded `props`. They agree to 1e-15
relatively, so the examples test this module's geometry and nothing else.

## Try it

```
node tools/ckext.mjs test extensions/section-rounded-cz
```
