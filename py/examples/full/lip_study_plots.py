# DSM lip study, plotted: every lip's signature curve on one chart, and strength against lip depth.
#
# The DSM lip study (the Examples menu's "DSM design study: lip depth") with what the console's
# own figures can't draw: matplotlib charts of your own. A 150 x 64 x 1.5 mm lipped C column,
# continuously braced (Le = 0), has its lip swept from 8 to 24 mm. For each lip the engine runs the
# signature curve, cFSM classifies its minima, and dsm.py works the Direct Strength Method column
# strength (AISI S100-16 Ch. E: §E2 Pne = Py when braced, §E3 local, §E4 distortional; the same
# equations and picking rule as the DSM compression module). Then:
#   1. all nine signature curves on one log-x axes, each lip's local and distortional minima marked;
#   2. Pn/A (strength per unit of steel) and Pn against lip depth, the governing mode marked, and
#      the best lip by the lip study's rule (the shortest within 0.5 % of the top Pn/A).
# Every number plotted comes from the engine or the cited DSM clauses; nothing is fitted.
#
# This needs full Python (numpy and matplotlib): the console downloads it the first time, once
# you agree. Under CPython: pip install cufsm-rs-py[plot], with dsm.py beside this script.
#
# Units: N, mm, MPa (forces printed in kN). Steel: E = 200000 MPa, nu = 0.3, fy = 450 MPa.
import numpy as np
import matplotlib.pyplot as plt
from dsm import lipped_c, column

FY = 450.0
D, B, T = 150.0, 64.0, 1.5
LIPS = [8, 10, 12, 14, 16, 18, 20, 22, 24]
LENGTHS = np.logspace(1, np.log10(3000), 70)              # half-wavelengths, mm (the lip study's grid)

print("Lipped C %g x %g x %g mm, fy = %g MPa, continuously braced:" % (D, B, T, FY))
print("Pne = Py (AISI S100-16 §E2).")
rows = []
for d in LIPS:
    r = column(lipped_c(D, B, d, T), FY, list(LENGTHS))
    if r["Pn"] is None:
        print("lip %d mm: no local and distortional pair on the curve" % d)
        continue
    r["d"] = d
    rows.append(r)

lip = np.array([r["d"] for r in rows], dtype=float)
Pn = np.array([r["Pn"] for r in rows]) / 1e3                  # kN
A = np.array([r["A"] for r in rows])                          # mm², the engine's
eff = Pn * 1e3 / A                                            # Pn/A, MPa
gov = [r["governs"] for r in rows]

print()
print("  lip    A     Pcrl/Py  Pcrd/Py    Pn    Pn/A  governs")
print("   mm   mm²                       kN    MPa")
for r, e in zip(rows, eff):
    print("  %3d %6.0f %8.3f %8.3f %6.1f %6.1f  %s%s" % (r["d"], r["A"], r["local"][1], r["dist"][1],
          r["Pn"] / 1e3, e, r["governs"], " (Pcrd D-only)" if r["dist_src"] == "cFSM D-only" else ""))

# the lip study's rule: the shortest lip within 0.5 % of the best Pn/A (past it, extra lip buys
# almost nothing)
best = int(np.flatnonzero(eff >= 0.995 * eff.max())[0])
print()
print("Best lip: d = %d mm (d/B = %.3f), %.1f MPa, Pn = %.1f kN, %s governs." % (
    lip[best], lip[best] / B, eff[best], Pn[best], gov[best]))
print("φc Pn = 0.85 × %.1f = %.1f kN (φc for a pre-qualified column: check it qualifies)." % (
    Pn[best], 0.85 * Pn[best]))
if any(r["dist_src"] == "cFSM D-only" for r in rows):
    print("Pcrd marked D-only comes from a constrained cFSM run (dsm.d_only): the DSM")
    print("commentary reference for that is recalled, UNVERIFIED against the text.")

# 1. every lip's signature curve, one colour per lip, its two minima marked
fig, ax = plt.subplots(figsize=(7.5, 5))
colours = plt.cm.viridis(np.linspace(0, 0.9, len(rows)))
for r, c in zip(rows, colours):
    sig = r["sig"]
    ax.semilogx(sig.lengths, sig.curve, color=c, lw=1.4, label="lip %d mm" % r["d"])
    ax.plot(*r["local"][:2], "o", color=c, ms=5)
    ax.plot(*r["dist"][:2], "s", color=c, ms=5, mfc="white" if r["dist_src"] != "curve" else c)
ax.set_ylim(0, 1.6)
ax.set_xlabel("half-wavelength (mm)")
ax.set_ylabel("Pcr / Py")
ax.set_title("Signature curves by lip depth: o local, ■ distortional minimum")
ax.grid(True, which="both", alpha=0.25)
ax.legend(fontsize=8, ncol=3, loc="upper right")
fig.tight_layout()
plt.show()

# 2. strength per unit of steel, and strength, against lip depth
fig, ax1 = plt.subplots(figsize=(7.5, 4.5))
ax1.plot(lip, eff, "-", color="0.3", lw=1.5, zorder=1)
for g, mk in (("local", "o"), ("distortional", "s"), ("yield", "^")):
    k = np.array([x == g for x in gov])
    if k.any():
        ax1.plot(lip[k], eff[k], mk, ms=8, color="C0" if g == "local" else "C3" if g == "distortional" else "C2",
                 label="%s governs" % g, zorder=2)
ax1.annotate("best lip (within 0.5 % of the top Pn/A)", (lip[best], eff[best]), xytext=(0, -26), textcoords="offset points", ha="center",
             arrowprops={"arrowstyle": "-", "color": "0.4"})
ax1.set_xlabel("lip depth d (mm)")
ax1.set_ylabel("Pn / A (MPa)")
ax2 = ax1.twinx()
ax2.plot(lip, Pn, "--", color="C1", lw=1.2, label="Pn (kN), right axis")
ax2.set_ylabel("Pn (kN)", color="C1")
ax1.set_title("DSM column strength against lip depth (AISI S100-16 §E2-E4)")
ax1.grid(True, alpha=0.25)
h1, l1 = ax1.get_legend_handles_labels()
h2, l2 = ax2.get_legend_handles_labels()
ax1.legend(h1 + h2, l1 + l2, fontsize=8, loc="lower right")
fig.tight_layout()
plt.show()
