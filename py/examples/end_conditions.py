# General end conditions: the same column, five ways of holding its ends.
#
# The signature curve assumes simply supported ends and one half-wave. Real members are fixed,
# free or guided at their ends, and buckle in several half-waves. Here a 150 x 64 x 18 x 2.4 mm
# lipped C column of a few physical lengths is solved with CUFSM's general end conditions
# (S-S, C-C, S-C, C-F, C-G), with enough longitudinal terms to reach local buckling's short
# half-waves. For each case the script prints the critical load, what cFSM says the mode is and
# which longitudinal term carries most of it. It is the heaviest example: 15 coupled solves of
# up to 30 terms each, about 10 to 25 s in the page. It ends with the mode shapes of the weakest
# and strongest ends at the longest length (cufsm_rs.plot), a global and a local mode.
#
# Units: N, mm, MPa (loads printed in kN). Steel: E = 200000 MPa, nu = 0.3, fy = 450 MPa.
import math
import cufsm_rs
from cufsm_rs.plot import plot_mode

E, NU, FY = 200000.0, 0.3, 450.0
BCS = [("S-S", "pinned-pinned"), ("C-C", "fixed-fixed"), ("S-C", "pinned-fixed"),
       ("C-F", "fixed-free"), ("C-G", "fixed-guided")]
LENGTHS = [1000.0, 2000.0, 3000.0]          # physical member lengths, mm


def lipped_c(D, B, d, t, n_web=8, n_flange=4, n_lip=2):
    """A lipped C on its centreline, square corners, from out-to-out D, B, d and thickness t."""
    h, b, c = D - t, B - t, d - t / 2
    pts = [(b, c)]

    def seg(x1, z1, n):
        x0, z0 = pts[-1]
        for k in range(1, n + 1):
            pts.append((x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n))
    seg(b, 0, n_lip)
    seg(0, 0, n_flange)
    seg(0, h, n_web)
    seg(b, h, n_flange)
    seg(b, h - c, n_lip)
    return cufsm_rs.Model(prop=[[1, E, E, NU, NU, E / (2 * (1 + NU))]],
                          node=[[i + 1, x, z, 1, 1, 1, 1, 1.0] for i, (x, z) in enumerate(pts)],
                          elem=[[i + 1, i + 1, i + 2, t, 1] for i in range(len(pts) - 1)])


def dominant_term(shape):
    """The longitudinal term (half-wave count for S-S) carrying most of the mode: the term whose
    nodal displacements have the largest sum of squares."""
    best, bt = -1.0, 0
    for k, m in enumerate(shape.m_terms):
        e = 0.0
        for comp in (shape.u, shape.v, shape.w):
            for a in comp[k]:
                e += a * a
        if e > best:
            best, bt = e, int(m)
    return bt


model = lipped_c(150, 64, 18, 2.4)
Py = cufsm_rs.first_yield(model, FY).Py
ref = cufsm_rs.stress(model, P=Py)                  # uniform compression at Py: load factor = Pcr / Py

# Term m of a member of length L buckles in half-waves of about L / m, so the terms must reach
# L / Lcrl, the local minimum of the signature curve, or local buckling is missed. Take 1..n
# with n = L / Lcrl + 4 at each length.
Lcrl = min([m[0] for m in cufsm_rs.signature(ref, [10 ** (1 + 2.5 * k / 59) for k in range(60)]).minima])
print("Lipped C 150 x 64 x 18 x 2.4 mm, Py = %.1f kN" % (Py / 1e3))
print("(fy = %g MPa)." % FY)
print("The signature curve's local minimum is at %.0f mm." % Lcrl)
print()
ends = [bc + " " + words for bc, words in BCS]
print("Ends: " + ", ".join(ends[:3]) + ",")
print("  " + ", ".join(ends[3:]) + ".")
print("mode: cFSM's largest class and its % (G global,")
print("  D distortional, L local, O other)")
print("m: the longitudinal term carrying most of the mode")

table, results = {}, {}
for L in LENGTHS:
    n = min(40, int(math.ceil(L / Lcrl)) + 4)
    print()
    print("L = %g mm, terms 1..%d" % (L, n))
    print("  ends   Pcr kN  Pcr/Py   mode    m")
    for bc, words in BCS:
        r = cufsm_rs.strip(ref, [L], m_all=n, bc=bc, neigs=1)
        c = list(r.classify()[0][0])
        lf, k, m = r.load_factors[0][0], "GDLO"[c.index(max(c))], dominant_term(r.mode_shape(0))
        table[(bc, L)] = (lf, k)
        results[(bc, L)] = r
        print("  %-4s %8.1f %7.3f  %s %3.0f %4d" % (bc, lf * Py / 1e3, lf, k, max(c), m))

print()
print("Weakest and strongest ends at each length:")
for L in LENGTHS:
    rank = sorted([(table[(bc, L)][0], bc) for bc, w in BCS])
    lo, hi = rank[0], rank[-1]
    print("  %4g mm  %s %5.1f kN (%s)   %s %5.1f kN (%s)" % (
        L, lo[1], lo[0] * Py / 1e3, table[(lo[1], L)][1], hi[1], hi[0] * Py / 1e3, table[(hi[1], L)][1]))

L = LENGTHS[-1]
rank = sorted([(table[(bc, L)][0], bc) for bc, w in BCS])
print()
print("Mode shapes at %g mm: the weakest ends (%s) and the strongest (%s)." % (L, rank[0][1], rank[-1][1]))
for lf, bc in (rank[0], rank[-1]):
    plot_mode(results[(bc, L)], 0)
