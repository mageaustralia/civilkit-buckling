# DSM lip study: how deep should the lips of a lipped channel be?
#
# A 150 x 64 x 1.5 mm lipped C column, continuously braced (Le = 0), is analysed with the lip
# depth swept from 8 to 24 mm. For each lip depth the script builds the section in Python,
# runs the signature curve on the engine, picks the local and distortional minima with cFSM
# classification, and works the Direct Strength Method column strength (AISI S100-16 Ch. E,
# the same equations and picking rule as the DSM compression module, ported in dsm.py, which
# the other design examples share). It then reports the lip whose strength per unit of steel
# area is highest, and draws its signature curve with the minima classified (cufsm_rs.plot).
#
# Units: N, mm, MPa (forces printed in kN). Steel: E = 200000 MPa, nu = 0.3, fy = 450 MPa.
from cufsm_rs.plot import plot_signature
from dsm import lipped_c, logspace, column     # the section builder and the DSM (dsm.py)

FY = 450.0
D, B, T = 150.0, 64.0, 1.5
LENGTHS = logspace(10, 3000, 70)                          # half-wavelengths, mm
print("Lipped C %g x %g x %g mm, fy = %g MPa," % (D, B, T, FY))
print("continuously braced, so Pne = Py (AISI S100-16 §E2).")
rows = []
for d in [8, 10, 12, 14, 16, 18, 20, 22, 24]:
    r = column(lipped_c(D, B, d, T), FY, LENGTHS)
    if r["Pn"] is None:
        print("lip %d mm: no local and distortional pair on the curve" % d)
        continue
    r["d"], r["eff"] = d, r["Pn"] / r["A"]                # strength per unit of steel area
    rows.append(r)

print()
# Pn/A against lip depth would be a general x-y chart: matplotlib draws one under CPython, while
# the console draws cufsm_rs.plot's own three (section, signature curve, mode shape)
print("Elastic buckling, from the engine's signature curve")
print("  lip   d/B     A     Py   Lcrl Pcrl/Py   Lcrd Pcrd/Py")
print("   mm         mm²     kN     mm             mm")
for r in rows:
    lo, di = r["local"], r["dist"]
    print("  %3d  %.3f %5.0f %6.1f %6.0f %7.3f %6.0f %7.3f" % (
        r["d"], r["d"] / B, r["A"], r["Py"] / 1e3, lo[0], lo[1], di[0], di[1]))
print()
print("DSM strength, AISI S100-16 §E3 (local), §E4 (distortional)")
print("  lip    Pnl    Pnd     Pn   Pn/A  governs")
print("   mm     kN     kN     kN    MPa")
for r in rows:
    print("  %3d %6.1f %6.1f %6.1f %6.1f  %s" % (
        r["d"], r["Pnl"] / 1e3, r["Pnd"] / 1e3, r["Pn"] / 1e3, r["eff"], r["governs"]))

# A longer lip always adds strength but also steel. Report the shortest lip that comes within
# 0.5 % of the best strength per unit area: past it, extra lip buys almost nothing.
top = max([r["eff"] for r in rows])
r = [r for r in rows if r["eff"] >= 0.995 * top][0]
print()
print("Best lip: d = %g mm, d/B = %.3f." % (r["d"], r["d"] / B))
print("  Pn = %.1f kN, Pn/A = %.1f MPa (the best is %.1f MPa);" % (r["Pn"] / 1e3, r["eff"], top))
print("  %s governs. cFSM classes, G/D/L/O %%:" % r["governs"])
print("  local %s, distortional %s." % (
    "/".join(["%.0f" % v for v in r["local"][2]]), "/".join(["%.0f" % v for v in r["dist"][2]])))
print("Design: φc Pn = 0.85 × %.1f = %.1f kN" % (r["Pn"] / 1e3, 0.85 * r["Pn"] / 1e3))
print("  (φc for a pre-qualified column: check it qualifies).")
print()
print("The best lip's signature curve, its minima classified:")
plot_signature(r["sig"], classify=True)
