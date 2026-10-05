# Inside the distortional mode, and what a sheathing spring does to it.
#
# Part 1 takes a 150 x 64 x 15 x 1.5 mm lipped C column at its distortional minimum and opens
# up the mode shape with mode_shape(...).at(): which node moves most, and how the flange and
# lip rotate about the web-flange corner (the signature of distortional buckling).
# Part 2 adds a continuous rotational spring at both flange-web corners, as sheathing screwed
# to both flanges of a wall stud gives, and sweeps its stiffness to show distortional buckling
# being restrained until another mode takes over. cufsm_rs.plot draws the section, the curve
# and the mode shape, and the curve once the spring has removed the distortional minimum.
#
# Units: N, mm, MPa (loads printed in kN). Steel: E = 200000 MPa, nu = 0.3, fy = 450 MPa.
# The rotational spring kphi is per unit length of member: N.mm/rad per mm, so N/rad.
import math
import cufsm_rs
from cufsm_rs.plot import plot_mode, plot_section, plot_signature

E, NU, FY = 200000.0, 0.3, 450.0
N_WEB, N_FLANGE, N_LIP = 8, 4, 2


def lipped_c(D, B, d, t, springs=None):
    """A lipped C on its centreline, square corners, from out-to-out D, B, d and thickness t."""
    h, b, c = D - t, B - t, d - t / 2
    pts = [(b, c)]

    def seg(x1, z1, n):
        x0, z0 = pts[-1]
        for k in range(1, n + 1):
            pts.append((x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n))
    seg(b, 0, N_LIP)
    seg(0, 0, N_FLANGE)
    seg(0, h, N_WEB)
    seg(b, h, N_FLANGE)
    seg(b, h - c, N_LIP)
    return cufsm_rs.Model(prop=[[1, E, E, NU, NU, E / (2 * (1 + NU))]],
                          node=[[i + 1, x, z, 1, 1, 1, 1, 1.0] for i, (x, z) in enumerate(pts)],
                          elem=[[i + 1, i + 1, i + 2, t, 1] for i in range(len(pts) - 1)],
                          springs=springs)


# node indices (0-based) of the bottom corners, from the order the builder lays the nodes; the
# top ones mirror them from the other end (node count - 1 - index)
LIP_TIP, LIP_FLANGE, FLANGE_WEB = 0, N_LIP, N_LIP + N_FLANGE
NNODES = 2 * (N_LIP + N_FLANGE) + N_WEB + 1


def part(i):
    """Where node i (0-based) is: a corner by name, or the plate it lies on."""
    side = "bottom" if i < NNODES / 2 else "top"
    j = min(i, NNODES - 1 - i)                          # its mirror index on the bottom side
    names = {LIP_TIP: "lip tip", LIP_FLANGE: "lip-flange corner", FLANGE_WEB: "flange-web corner"}
    if j in names:
        return side + " " + names[j]
    return "web" if j > FLANGE_WEB else side + (" lip" if j < LIP_FLANGE else " flange")

LENGTHS = [10 ** (1 + 2.6 * k / 69) for k in range(70)]     # 10 to 4000 mm


def distortional(model):
    """Py, the reference model, the signature curve and the minimum cFSM calls most distortional,
    as (length, Pcr/Py, [G, D, L, O]), or None when no minimum is mostly distortional (the spring
    has suppressed it)."""
    Py = cufsm_rs.first_yield(model, FY).Py
    ref = cufsm_rs.stress(model, P=Py)
    sig = cufsm_rs.signature(ref, LENGTHS)
    best = None
    for (L, lf), c in zip(sig.minima, sig.classify_minima()):
        c = list(c)
        if c[1] == max(c) and (best is None or c[1] > best[2][1]):
            best = (L, lf, c)
    return Py, ref, sig, best


# --- Part 1: the mode shape at the distortional minimum ---------------------------------------
model = lipped_c(150, 64, 15, 1.5)
Py, ref, sig, (Ld, lfd, cd) = distortional(model)
print("Lipped C 150 x 64 x 15 x 1.5 mm, Py = %.1f kN" % (Py / 1e3))
print("(fy = %g MPa)." % FY)
print("Distortional minimum: half-wavelength %.0f mm," % Ld)
print("  Pcrd = %.3f Py = %.1f kN (cFSM D %.0f %%)" % (lfd, lfd * Py / 1e3, cd[1]))
plot_section(ref)                                       # uniform compression at Py
plot_signature(sig, classify=True)
at_d = cufsm_rs.strip(ref, [Ld], neigs=1)
plot_mode(at_d, 0)                                      # the distortional mode, at mid half-wave
d = at_d.mode_shape(0).at()                             # its displacements there
mag = [math.sqrt(u * u + w * w) for u, w in zip(d.u, d.w)]   # in-plane movement of each node
big = max(mag)
i = mag.index(big)
j = NNODES - 1 - i                                      # its mirror across mid-depth
if abs(mag[j] - big) <= 1e-6 * big:                     # a symmetric mode: both move alike
    i, j = min(i, j), max(i, j)
    print("Nodes that move most: %d and %d," % (i + 1, j + 1))
    print("  the %s and %s" % (part(i), part(j)))
    print("  (the mode is symmetric about mid-depth)")
else:
    print("Node that moves most: node %d, the %s," % (i + 1, part(i)))
    print("  at x = %.1f, z = %.1f mm" % (model.node[i][1], model.node[i][2]))
print()
print("movement: in-plane, largest = 1;")
print("rotation: lip-flange corner = 1")
print("  node  where                     movement  rotation")
th0 = d.theta[LIP_FLANGE]
for k in (LIP_TIP, LIP_FLANGE, FLANGE_WEB):
    print("  %4d  %-24s %9.3f %9.3f" % (k + 1, part(k), mag[k] / big, d.theta[k] / th0))
print()
print("The flange-web corner moves %.0f %% as much as the lip tip," % (100 * mag[FLANGE_WEB] / mag[LIP_TIP]))
print("and the flange's corners rotate within %.0f %% of each other:" % (
    100 * abs(1 - d.theta[FLANGE_WEB] / th0)))
print("the flange and lip swing about the corner nearly as a rigid")
print("plate. That rotation is what sheathing on a flange resists.")
print()

# --- Part 2: rotational springs at both flange-web corners ----------------------------------
# CUFSM spring rows: [#, node i, node j (0 = ground), ku, kv, kw, kq, local, discrete, ys];
# local 0 = global axes, discrete 0 = continuous (a foundation spring, per unit length)
corners = [FLANGE_WEB, NNODES - 1 - FLANGE_WEB]
print("Rotational springs kphi at nodes %d and %d (both flange-web" % (corners[0] + 1, corners[1] + 1))
print("corners), continuous along the member, as sheathing gives")
# Pcrd against kphi would be a general x-y chart, which needs matplotlib (the full runtime)
print("     kphi    Lcrd   Pcrd/Py   Pcrd   D share")
print("    N/rad      mm              kN         %")
gone = None                                             # the first stiffness with no distortional minimum
for k in [0, 100, 200, 400, 700, 1000, 3000]:
    spr = [[q + 1, n + 1, 0, 0, 0, 0, float(k), 0, 0, 0] for q, n in enumerate(corners)] if k else None
    Py, ref, sig, dm = distortional(lipped_c(150, 64, 15, 1.5, springs=spr))
    if dm is None:
        gone = gone or (k, sig)
        print("  %7g   none: the curve only flattens there" % k)
        continue
    print("  %7g  %6.0f  %8.3f  %6.1f  %8.0f" % (k, dm[0], dm[1], dm[1] * Py / 1e3, dm[2][1]))
if gone:
    print("The curve at kphi = %g N/rad: no minimum is mostly distortional." % gone[0])
    plot_signature(gone[1], classify=True)
print()
print("Pcrd/Py feeds the DSM distortional strength (AISI S100-16")
print("§E4): see the DSM design study example. Once the minimum is")
print("gone, Pcrd comes from a constrained (cFSM D-only) analysis,")
print("strip(..., spaces=\"D\"): the lightest-section and catalogue")
print("examples do exactly that (dsm.d_only).")
