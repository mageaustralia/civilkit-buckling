# DSM compression

A CivilKit Buckling module (`buckling.tool`) for the Direct Strength Method column strength,
Pn = min(Pne, Pnl, Pnd), from the section's signature curve and first yield.

- **Py** is the engine's first yield (`firstYield`), so A = Py / fy.
- **The signature curve** is solved with the reference stress set to uniform compression at Py
  (`stress` with P = Py), so each load factor is Pcr / Py.
- **Local and distortional minima:** local is the shortest-wavelength minimum, and distortional is the
  next one. Minima that cFSM calls mostly global (G above 50 %) are skipped. Each minimum's cFSM
  split is shown in the calc lines. You can pick other minima, or enter Pcrl / Py and Pcrd / Py
  yourself. You need to when a section has no distinct distortional minimum, as with the
  Design Guide's C (see below).
- **Global:**
  - **Le = 0** means continuously braced: Pne = Py.
  - **Fcre > 0** gives Pcre = A Fcre, for example a closed-form strong-axis Fe.
  - **Otherwise** Pcre is the curve's load factor at L = Le times Py. That is valid only where
    the curve at Le is global.
- **Units:** N, mm and MPa, the app's units. Forces are reported in kN.

The equations are the same in both codes. Only the clause references in the calc lines change:

| | AISI S100-16 | AS/NZS 4600:2018 | AISI S100-04 Appendix 1 (as the Design Guide prints them) |
|---|---|---|---|
| Global, Pne | §E2 | 7.2.1.2 | Eq. 1.2.1-1 to 1.2.1-3 |
| Local, Pnl | §E3 | 7.2.1.3 | Eq. 1.2.1-5 to 1.2.1-7 |
| Distortional, Pnd | §E4 | 7.2.1.4 | Eq. 1.2.1-8 to 1.2.1-10 |

φc = 0.85 applies to pre-qualified columns (Design Guide 8.1-4). Check that your section
qualifies.

## Worked examples (`tests/worked-examples.json`)

All three come from the **AISI *Direct Strength Method Design Guide*** (CF06-1, January 2006). The
models are the guide's own CUFSM files, shipped with CUFSM in `examples/2006_dsm_design_guide` (MIT)
and extracted into cufsm-rs `tests/fixtures/dsm_guide_2006.json`:
- `cwlip_P.mat`: 9CS2.5x059;
- `zwlip_P.mat`: 8ZS2.25x059.

They are converted to this app's units:
- 1 in = 25.4 mm;
- 1 ksi = 6.894757293 MPa;
- 1 kip = 4.448221615 kN.

So fy = 55 ksi = 379.2117 MPa.

**Why the expected numbers carry more digits than the guide.** The guide prints 2 to 4 significant
figures, and the Verified tolerance is 0.1 %. So each expected value is the guide's own equations
worked from the guide's own inputs, to more digits. The working is below. Every result agrees with
what the guide prints at the precision it prints.

**Pcr from the engine against the guide.** Before writing the expected values, Pcr was checked
against the guide's CUFSM curves:
- **The Z.** The signature curve's minima match the guide's file to 1e-6: local 0.157494 at
  5.9 in, distortional 0.287045 at 22.1 in. The guide prints them as 0.16 and 0.29. So example 3
  reads Pcrl and Pcrd off the engine's curve.
- **The C.** Its first-mode curve has a local minimum at 6.6 in, at 0.124235 against the guide's
  printed 0.12, but **no distortional minimum**. The curve rises steadily from 0.124 to 0.50, and
  the guide's 0.27 is a reading off its figure, not a minimum. So examples 1 and 2 take the guide's
  printed Pcrl / Py = 0.12 and Pcrd / Py = 0.27 as inputs. This is the plan's fallback: "the module
  takes Pcr as inputs".

### Hand calc 1: Example 8.1-4, 9CS2.5x059, continuously braced

The inputs, as the guide prints them: Py = 48.42 kip, Pcrl = 0.12 Py, Pcrd = 0.27 Py, and
Pne = Py (braced).

- **Local:**
  - λl = √(1 / 0.12) = 2.8868, which is above 0.776;
  - (Pcrl / Pne)^0.4 = 0.12^0.4 = 0.42822;
  - Pnl = (1 − 0.15 × 0.42822) × 0.42822 × 48.42 = **19.403 kip** (the guide prints 19.4);
  - × 4.448222 = **86.308 kN**.
- **Distortional:**
  - λd = √(1 / 0.27) = 1.9245, which is above 0.561;
  - 0.27^0.6 = 0.45585;
  - Pnd = (1 − 0.25 × 0.45585) × 0.45585 × 48.42 = **19.557 kip** (the guide prints 19.6), or
    **86.993 kN**.
- **Result:** Pn = min = 19.403 kip, or 86.308 kN, so **local governs** (the guide prints 19.4).
- **Py:** 48.42 kip = **215.38 kN**. The engine gives 215.40 kN from its A of 0.880430 in²
  (the guide prints A = 0.880 for the FSM model).

### Hand calc 2: Example 8.1-5, the same C at Fn = 37.25 ksi

The inputs, as the guide prints them: Fe = 59.12 ksi (from AISI 2002 Example III-1), Py = 48.42
kip, Pcrl = 0.12 Py, Pcrd = 0.27 Py.

- **Global:**
  - A = Py / fy = 48.42 / 55 = 0.88036 in²;
  - Pcre = A Fe = **52.047 kip** (the guide prints 52.05), or **231.52 kN**;
  - λc = √(Py / Pcre) = √(55 / 59.12) = 0.96453, which is at most 1.5;
  - Pne = 0.658^(0.93030) × 48.42 = **32.803 kip** (the guide prints 32.8), or **145.92 kN**.
- **Local:**
  - λl = √(32.803 / 5.8104) = 2.3761;
  - (5.8104 / 32.803)^0.4 = 0.50040;
  - Pnl = (1 − 0.15 × 0.50040) × 0.50040 × 32.803 = **15.183 kip** (the guide prints 15.2 in
    8.1-5 and Pn = 15.18 kip in 8.1-6), or **67.536 kN**.
- **Distortional:** Pnd = 19.557 kip, as in hand calc 1.
- **Result:** Pn = 15.183 kip, or 67.536 kN, so **local governs**.

### Hand calc 3: Example 8.5-3, 8ZS2.25x059, continuously braced, Pcr from the signature curve

The inputs:
- Py = 45.23 kip, as the guide prints it. The engine gives 201.18 kN = 45.228 kip.
- Pcrl / Py = **0.157494** at 5.9 in (149.86 mm) and Pcrd / Py = **0.287045** at 22.1 in
  (561.34 mm). These are the minima of the guide's CUFSM curve in `zwlip_P.mat`, which the guide
  prints as 0.16 and 0.29.
- Pne = Py.

- **Local:**
  - λl = √(1 / 0.157494) = 2.5198;
  - 0.157494^0.4 = 0.47743;
  - Pnl = (1 − 0.15 × 0.47743) × 0.47743 × 45.23 = **20.048 kip**, or **89.176 kN**. With the
    guide's rounded 0.16, the same equation gives its printed 20.16.
- **Distortional:**
  - λd = √(1 / 0.287045) = 1.8665;
  - 0.287045^0.6 = 0.47290;
  - Pnd = (1 − 0.25 × 0.47290) × 0.47290 × 45.23 = **18.861 kip**, or **83.896 kN**. With 0.29,
    it gives the guide's printed 19.
- **Result:** Pn = 18.861 kip, or 83.896 kN, so **distortional governs**, as the guide says.

The arithmetic above was checked with a short script, outside this repo. It evaluates the same
three equations, and nothing else.

## Try it

```
node tools/ckext.mjs test extensions/dsm-compression
```

This prints `verified`, then each example's result, then one run on the first example with its
calc lines.
