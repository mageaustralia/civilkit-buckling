# Thickness study

A showcase CivilKit Buckling module. For each thickness in a range it scales the current section, asks the
engine for the squash load (first yield), the reference stresses at that load, a full signature curve and the
cFSM class of every minimum, and reads off local (Pcrl / Py) and distortional (Pcrd / Py) buckling. It shows:

- a **log-scale chart** of Pcrl / Py and Pcrd / Py against t, with the target line and the chosen t marked;
- the thinnest, middle and thickest **signature curves** overlaid on log axes;
- a **table** of every thickness (A, Py, Lcrl, Pcrl / Py, Lcrd, Pcrd / Py, whether it meets the target);
- the thinnest passing section **drawn with its stress** at yield;
- **calc lines** (the method, and the Direct Strength Method limits for no local or distortional reduction:
  Pcrl / Py ≥ 1 / 0.776² = 1.661, Pcrd / Py ≥ 1 / 0.561² = 3.177, AISI S100-16 §E3.2 and §E4.2);
- optionally, the thinnest passing section **offered to the analysis**, which you accept or dismiss.

Every number comes from the engine; the module only orchestrates. Units: N, mm, MPa.

## Worked example

`tests/worked-examples.json` checks the geometry and yield at both ends of the range by hand: the default
lipped C's centreline is 150 + 2 × 60 + 2 × 40 = 350 mm, so A = 350 t; at t = 0.75 mm, A = 262.5 mm², and at
t = 3 mm, Py = 1050 mm² × 450 MPa = 472.5 kN. The buckling values themselves are the engine's (cufsm-rs,
regression-tested against CUFSM) and are not re-derived here.
