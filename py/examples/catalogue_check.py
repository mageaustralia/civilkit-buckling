# Catalogue check: a list of lipped C sections against one design load, lightest first.
#
# Twelve lipped Cs, each given by its geometry, are checked as continuously braced columns (Le = 0)
# against N* = 60 kN. For each one the script runs the signature curve on the engine, picks the
# local and distortional minima with cFSM and works the Direct Strength Method strength (AISI
# S100-16 Ch. E): the DSM lip study's builder and DSM port, in dsm.py (ported from the DSM
# compression module, extensions/dsm-compression/main.py). A section whose curve has no distinct
# distortional minimum takes Pcrd from a constrained cFSM run restricted to the distortional space
# (dsm.d_only), and the table says so. It prints a pass/fail table sorted by mass and draws the
# signature curve of the lightest section that passes.
#
# The sections are generic: plausible sizes with names in the common "depth, thickness" style
# (C15015 = 150 deep, 1.5 thick). They are not any manufacturer's catalogue; put your supplier's
# dimensions in SECTIONS to check theirs.
#
# Units: N, mm, MPa (forces printed in kN, mass in kg/m). Steel: E = 200000 MPa, nu = 0.3.
from cufsm_rs.plot import plot_signature
import dsm

N_STAR = 60e3                                   # N: the design axial load
FY = 450.0                                      # MPa
LENGTHS = dsm.logspace(10, 3000, 70)            # half-wavelengths, mm: the lip study's grid

# name: (D, B, lip, t), out-to-out, mm
SECTIONS = {
    "C10010": (100, 50, 12, 1.0),
    "C10015": (100, 50, 13, 1.5),
    "C10019": (100, 50, 14, 1.9),
    "C15012": (150, 64, 14, 1.2),
    "C15015": (150, 64, 15, 1.5),
    "C15019": (150, 64, 16, 1.9),
    "C15024": (150, 64, 18, 2.4),
    "C20015": (200, 76, 16, 1.5),
    "C20019": (200, 76, 18, 1.9),
    "C20024": (200, 76, 20, 2.4),
    "C25019": (250, 76, 19, 1.9),
    "C25024": (250, 89, 24, 2.4),
}

# The output is kept to about 60 characters a line, to fit the console beside the editor
print("Lipped C sections against N* = %.0f kN," % (N_STAR / 1e3))
print("continuously braced, fy = %g MPa." % FY)
rows = []
for nm in SECTIONS:
    D, B, d, t = SECTIONS[nm]
    r = dsm.column(dsm.lipped_c(D, B, d, t), FY, LENGTHS)
    r["name"], r["kg"] = nm, r["A"] * dsm.STEEL_DENSITY * 1000    # kg per metre
    r["outside"] = dsm.prequalified(D, B, d, t, FY)
    if r["Pn"] is None:
        # no local minimum, or no distortional one even on the D-only curve: reported, not guessed
        r["status"] = "no Pcr"
    elif r["outside"]:
        # φc = 0.85 holds only for pre-qualified columns: no design strength is given (a choice;
        # the section may still be checked by test or rational analysis)
        r["status"] = "not prequal."
    else:
        r["phiPn"] = dsm.PHI_C * r["Pn"]
        r["util"] = N_STAR / r["phiPn"]
        r["status"] = "PASS" if r["util"] <= 1 else "fail"
    rows.append(r)

# lightest first; the name breaks a tie, so every Python prints the same order
rows.sort(key=lambda r: (r["kg"], r["name"]))
print()
print("util. = N*/φc Pn")
print("  section  kg/m   Pnl   Pnd  φcPn util. governs")
print("                   kN    kN    kN")
for r in rows:
    if r["status"] == "no Pcr":
        print("  %-7s %5.2f  no local or distortional minimum: unchecked" % (r["name"], r["kg"]))
        continue
    phi = "%5.1f" % (r["phiPn"] / 1e3) if "phiPn" in r else "    -"
    util = "%5.2f" % r["util"] if "util" in r else "    -"
    print("  %-7s %5.2f %5.1f %5.1f %s %s %-12s %s" % (
        r["name"], r["kg"], r["Pnl"] / 1e3, r["Pnd"] / 1e3, phi, util, r["governs"], r["status"]))
    if r["dist_src"] == "cFSM D-only":
        print("    no distortional minimum on the curve: Pcrd from")
        print("    cFSM D-only, %.3f Py at %.0f mm" % (r["dist"][1], r["dist"][0]))
    if r["outside"]:
        print("    outside the pre-qualified limits: %s" % "; ".join(r["outside"]))

passing = [r for r in rows if r["status"] == "PASS"]
print()
print("%d of %d sections pass." % (len(passing), len(rows)))
if passing:
    w = passing[0]
    print("Lightest that passes: %s, %.2f kg/m," % (w["name"], w["kg"]))
    print("  φc Pn = %.1f kN, utilisation %.2f, %s governs." % (w["phiPn"] / 1e3, w["util"], w["governs"]))
    print("Its signature curve, the minima classified:")
    plot_signature(w["sig"], classify=True)

print()
print(dsm.PREQ_NOTE)
