# The lightest lipped C that carries a design load: hundreds of analyses, each one checked to DSM.
#
# A continuously braced column (Le = 0, so no global buckling) must carry φc Pn >= TARGET. The
# script tries lipped Cs over sets of depth, flange, lip and thickness, keeps those inside the
# DSM pre-qualified limits (AISI S100-16 Table B4.1-1, where φc = 0.85 holds), and for each one
# runs the signature curve on the engine, picks the local and distortional minima with cFSM and
# works the Direct Strength Method strength (AISI S100-16 Ch. E); where the curve has no distinct
# distortional minimum, Pcrd comes from a constrained cFSM run restricted to the distortional space
# (dsm.d_only). The DSM port, the minima rule and the section builder are the DSM lip study's, in
# dsm.py (ported from the DSM compression module, extensions/dsm-compression/main.py).
#
# This is what a script does that the GUI can't: a few hundred analyses in a loop, each one
# feeding a design check, in seconds. Change TARGET, FY or the sets and run it again.
#
# Units: N, mm, MPa (forces printed in kN, mass in kg/m). Steel: E = 200000 MPa, nu = 0.3.
import time
import cufsm_rs
from cufsm_rs.plot import plot_section, plot_signature
import dsm

TARGET = 80e3                                   # N: the design load φc Pn must reach
FY = 450.0                                      # MPa
THICKNESSES = [1.0, 1.2, 1.5, 1.9, 2.4]         # mm
DEPTHS = [100, 150, 200, 250]                   # mm, out-to-out
FLANGES = [50, 60, 70, 80, 90]                  # mm, out-to-out
LIP_RATIOS = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40]   # lip / flange, inside 0.05 < D/b0 < 0.41
# The half-wavelength grid (a choice, not a code rule): 30 lengths from 30 to 2000 mm, against
# the lip study's 70 from 10 to 3000, in 40 % of the time. Measured over all 559 sections of
# these sets: Pn within -0.13 % and +0.40 % of the fine grid's, and 2 sections lose their
# distortional minimum on it. The winner is checked again on the fine grid at the end.
GRID = dsm.logspace(30, 2000, 30)
FINE = dsm.logspace(10, 3000, 70)


def candidates(t):
    """The thickness-t sections inside the pre-qualified limits, lightest first. The area here only
    orders them: the model's centreline length times t (square corners), which is what the engine
    integrates; every area printed is the engine's."""
    out = []
    for D in DEPTHS:
        for B in FLANGES:
            for r in LIP_RATIOS:
                d = int(r * B + 0.5)            # whole millimetres
                if not dsm.prequalified(D, B, d, t, FY):
                    out.append((t * ((D - t) + 2 * (B - t) + 2 * (d - t / 2)), D, B, d))
    out.sort()                                  # by area, then D, B, lip: the same order on every Python
    return out


def now():                                      # seconds: MicroPython's time.time() is whole seconds
    return time.ticks_ms() / 1000 if hasattr(time, "ticks_ms") else time.time()


def name(D, B, d, t):
    return "%d x %d x %d x %.1f" % (D, B, d, t)


# The output is kept to about 60 characters a line, to fit the console beside the editor
print("Lightest lipped C with φc Pn >= %.0f kN," % (TARGET / 1e3))
print("continuously braced, fy = %g MPa." % FY)
print("Sets: depth %d-%d mm, flange %d-%d mm," % (DEPTHS[0], DEPTHS[-1], FLANGES[0], FLANGES[-1]))
print("lip %.2f-%.2f of the flange, t %s mm" % (
    LIP_RATIOS[0], LIP_RATIOS[-1], ", ".join(["%g" % t for t in THICKNESSES])))
# The pruning rule (a choice, not a code rule): each thickness's sections are tried lightest
# first and the thickness stops at its first pass, which is then its lightest passing section.
# Heavier ones at that thickness can't be lighter, so they are never analysed.
t0 = now()
runs, tried, rows, unchecked, donly = 0, 0, [], [], 0
for t in THICKNESSES:
    cs = candidates(t)
    tried += len(cs)
    found = None
    for A, D, B, d in cs:
        r = dsm.column(dsm.lipped_c(D, B, d, t), FY, GRID)
        runs += 1
        donly += r["dist_src"] == "cFSM D-only"
        if r["Pn"] is None:
            # no local minimum, or no distortional one even on the D-only curve: the section is
            # left unchecked and never counted as a pass (a choice)
            unchecked.append((A, D, B, d, t))
            continue
        if dsm.PHI_C * r["Pn"] >= TARGET:
            r["dims"], r["order"] = (D, B, d, t), A
            r["kg"] = r["A"] * dsm.STEEL_DENSITY * 1000    # kg per metre
            found = r
            break
    s = now() - t0
    if found:
        print("  t = %.1f: %3d analyses, %s passes (%.0f s)" % (t, runs, name(*found["dims"]), s))
        rows.append(found)
    else:
        print("  t = %.1f: %3d analyses, none of %d passes (%.0f s)" % (t, runs, len(cs), s))
secs = now() - t0
print("%d analyses of %d pre-qualified sections in %.1f s." % (runs, tried, secs))
if donly:
    print("%d had no distinct distortional minimum: Pcrd from" % donly)
    print("a cFSM D-only run (dsm.d_only).")
if not rows:
    raise SystemExit("No section in the sets carries %.0f kN: add deeper or thicker ones." % (TARGET / 1e3))
rows.sort(key=lambda r: r["kg"])
print()
print("Top 5 by mass: the lightest pass at each thickness")
print("  D x B x lip x t     kg/m   Pnl   Pnd  φcPn  governs")
print("  mm                          kN    kN    kN")
for r in rows[:5]:
    print("  %-19s %5.2f %5.1f %5.1f %5.1f  %s" % (
        name(*r["dims"]), r["kg"], r["Pnl"] / 1e3, r["Pnd"] / 1e3, dsm.PHI_C * r["Pn"] / 1e3, r["governs"]))

w = rows[0]
D, B, d, t = w["dims"]
print()
print("Winner: %s mm, %.2f kg/m" % (name(D, B, d, t), w["kg"]))
print("  A = %.0f mm² (the model's), Py = %.1f kN" % (w["A"], w["Py"] / 1e3))
print("  local Pcrl = %.3f Py at %.0f mm," % (w["local"][1], w["local"][0]))
print("  distortional Pcrd = %.3f Py at %.0f mm%s" % (w["dist"][1], w["dist"][0],
      " (cFSM D-only)" if w["dist_src"] == "cFSM D-only" else ""))
print("  φc Pn = %.2f × %.1f = %.1f kN >= %.0f kN," % (
    dsm.PHI_C, w["Pn"] / 1e3, dsm.PHI_C * w["Pn"] / 1e3, TARGET / 1e3))
print("  %s governs." % w["governs"])
f = dsm.column(dsm.lipped_c(D, B, d, t), FY, FINE)      # the check on the lip study's grid
if f["Pn"] is None:
    print("  On the fine grid it has no local or distortional minimum.")
else:
    print("  On the fine grid: φc Pn = %.1f kN, %s governs%s." % (dsm.PHI_C * f["Pn"] / 1e3, f["governs"],
          " (Pcrd D-only)" if f["dist_src"] == "cFSM D-only" else ""))
lighter = [u for u in unchecked if u[0] < w["order"]]
if lighter:
    print("  %d lighter sections were left unchecked (no local or" % len(lighter))
    print("  distortional minimum, even on the D-only curve).")
if D == DEPTHS[0] or B == FLANGES[0]:
    print("  It sits at the smallest depth or flange searched: with no")
    print("  global buckling, compact sections win. Widen the")
    print("  sets to look further.")
print()
print("The winner, under uniform compression at Py, and its")
print("signature curve (fine grid), the minima classified:")
plot_section(f["ref"])
plot_signature(f["sig"], classify=True)

print()
print(dsm.PREQ_NOTE)
