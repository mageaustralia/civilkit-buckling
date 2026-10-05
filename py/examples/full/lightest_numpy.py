# The lightest lipped C for a load, with numpy and scipy: the whole design space at once, a chart
# of mass against capacity, and the exact thickness the winning shape needs.
#
# The search of the Examples menu's "Search: the lightest lipped C for a load" (the same sets,
# the same DSM checks in dsm.py, AISI S100-16 Ch. E), with what full Python adds:
#   - numpy builds the candidate set as arrays: every depth, flange, lip ratio and thickness in one
#     grid, the pre-qualified limits (dsm.prequalified, AISI S100-16 Table B4.1-1) applied as masks,
#     the steel area of each one, and the order the search tries them in, with no loop;
#   - every analysed section's mass and φc Pn go on a scatter chart, the passes against the
#     fails, with the target and the winner marked;
#   - scipy.optimize.brentq finds the thickness at which the winner's shape exactly carries the
#     target (each trial is an engine run and a DSM check): how much of the chosen gauge is margin.
# The buckling loads are the engine's and the strengths the cited DSM clauses'; nothing is fitted.
#
# This needs full Python (numpy, scipy, matplotlib): the console downloads it the first time,
# once you agree. Under CPython: pip install cufsm-rs-py[plot] scipy, with dsm.py beside it.
#
# Units: N, mm, MPa (forces printed in kN, mass in kg/m). Steel: E = 200000 MPa, nu = 0.3.
import time
import numpy as np
import matplotlib.pyplot as plt
from scipy.optimize import brentq
import dsm

TARGET = 80e3                                   # N: the design load φc Pn must reach
FY = 450.0                                      # MPa
THICKNESSES = [1.0, 1.2, 1.5, 1.9, 2.4]         # mm
DEPTHS = [100, 150, 200, 250]                   # mm, out-to-out
FLANGES = [50, 60, 70, 80, 90]                  # mm, out-to-out
LIP_RATIOS = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40]
GRID = list(dsm.logspace(30, 2000, 30))         # the search's grid; the winner is checked on FINE
FINE = list(dsm.logspace(10, 3000, 70))

# --- the design space as arrays -----------------------------------------------------------
t, D, B, r = (a.ravel() for a in np.meshgrid(THICKNESSES, DEPTHS, FLANGES, LIP_RATIOS, indexing="ij"))
d = np.floor(r * B + 0.5)                       # whole-millimetre lips, as the menu's search
# dsm.prequalified's limits, as masks (the same inequalities; see its UNVERIFIED note)
ok = ((D / t < 472) & (B / t < 159) & (d / t > 4) & (d / t < 33) & (D / B > 0.7) & (D / B < 5.0)
      & (d / B > 0.05) & (d / B < 0.41) & (dsm.E / FY > 340))
area = t * ((D - t) + 2 * (B - t) + 2 * (d - t / 2))   # centreline length x t: orders the search only
print("Design space: %d sections, %d inside the pre-qualified limits." % (t.size, ok.sum()))
# the masks agree with dsm.prequalified, section by section
assert all((not dsm.prequalified(*v, FY)) == k for v, k in zip(zip(D, B, d, t), ok))

# --- the search: each thickness lightest first, stopping at its first pass -----------------
t0 = time.time()
done = []                                        # (kg/m, φc Pn kN, passes, dims) of every analysis
winners = []
for tk in THICKNESSES:
    idx = np.flatnonzero(ok & (t == tk))
    idx = idx[np.lexsort((d[idx], B[idx], D[idx], area[idx]))]
    for i in idx:
        res = dsm.column(dsm.lipped_c(D[i], B[i], d[i], tk), FY, GRID)
        if res["Pn"] is None:
            continue
        kg = res["A"] * dsm.STEEL_DENSITY * 1000
        phiPn = dsm.PHI_C * res["Pn"]
        done.append((kg, phiPn / 1e3, phiPn >= TARGET, (D[i], B[i], d[i], tk)))
        if phiPn >= TARGET:
            winners.append((kg, (D[i], B[i], d[i], tk), res))
            break
print("%d analyses in %.1f s." % (len(done), time.time() - t0))

kg, cap, passes = (np.array(c) for c in list(zip(*done))[:3])
w_kg, (wD, wB, wd, wt), w = min(winners, key=lambda x: x[0])
print()
print("Lightest pass at each thickness:")
for k, dims, res in sorted(winners, key=lambda x: x[0]):
    print("  %3d x %2d x %2d x %.1f  %5.2f kg/m  φc Pn = %5.1f kN, %s" % (
        *dims, k, dsm.PHI_C * res["Pn"] / 1e3, res["governs"]))
f = dsm.column(dsm.lipped_c(wD, wB, wd, wt), FY, FINE)
print("Winner: %d x %d x %d x %.1f mm, %.2f kg/m; on the fine grid φc Pn = %.1f kN." % (
    wD, wB, wd, wt, w_kg, dsm.PHI_C * f["Pn"] / 1e3))


# --- scipy: the thickness at which the winner's shape exactly carries the target ------------
def margin(tt):
    return dsm.PHI_C * dsm.column(dsm.lipped_c(wD, wB, wd, tt), FY, GRID)["Pn"] - TARGET


lighter = max([x for x in THICKNESSES if x < wt])
if margin(lighter) < 0 < margin(wt):
    t_exact = brentq(margin, lighter, wt, xtol=1e-4)
    print("The same shape carries exactly %.0f kN at t = %.3f mm (brentq on engine runs):" % (TARGET / 1e3, t_exact))
    print("  %.0f %% of the %.1f mm gauge's steel is needed; the rest is margin." % (100 * t_exact / wt, wt))
print()
print(dsm.PREQ_NOTE)

# --- mass against capacity -----------------------------------------------------------------
fig, ax = plt.subplots(figsize=(7.5, 5))
ax.scatter(kg[~passes], cap[~passes], s=16, c="0.65", label="fails (φc Pn < %.0f kN)" % (TARGET / 1e3))
ax.scatter(kg[passes], cap[passes], s=40, c="C2", edgecolors="k", label="lightest pass at its t")
ax.axhline(TARGET / 1e3, color="C3", lw=1, ls="--", label="target %.0f kN" % (TARGET / 1e3))
ax.annotate("%d x %d x %d x %.1f" % (wD, wB, wd, wt), (w_kg, dsm.PHI_C * w["Pn"] / 1e3),
            xytext=(12, -18), textcoords="offset points", arrowprops={"arrowstyle": "-"})
ax.set_xlabel("mass (kg/m)")
ax.set_ylabel("φc Pn (kN), DSM AISI S100-16 Ch. E")
ax.set_title("Every section the search analysed: mass against capacity")
ax.grid(True, alpha=0.25)
ax.legend(fontsize=8, loc="lower right")
fig.tight_layout()
plt.show()
