# dsm: the lipped C builder and the Direct Strength Method column strength the example scripts
# share (the DSM lip study, the lightest section search and the catalogue check).
#
# Not a script on its own: `import dsm` from one. The console installs this file so an example can
# import it; under CPython (pip install cufsm-rs-py) keep it next to the script that imports it.
#
# The DSM equations and the rule that picks the local and distortional minima are ported from the
# DSM compression module (extensions/dsm-compression/main.py), clause by clause; every buckling
# load comes from the engine (cufsm_rs). Nothing here is a design choice except where a comment
# says so. One step goes past the module: where the curve has no distinct distortional minimum
# (short lips, deep thin webs), the module asks for Pcrd by hand; here it comes from a constrained
# cFSM analysis restricted to the distortional space (strip(..., spaces="D")), see column().
#
# Units: N, mm, MPa. Steel: E = 200000 MPa, nu = 0.3.
import math
import cufsm_rs

E, NU = 200000.0, 0.3
KINDS = "GDLO"
PHI_C = 0.85            # φc for a pre-qualified column (DSM Design Guide 8.1-4, as the module says)
STEEL_DENSITY = 7.85e-6  # kg/mm³ (7850 kg/m³): mass per metre = A × 7.85e-3 kg/m, for reporting


def lipped_c(D, B, d, t, n_web=8, n_flange=4, n_lip=2):
    """A lipped C on its centreline, square corners, from out-to-out D, B, d and thickness t.
    The nodes run lip tip, bottom flange, web, top flange, other lip tip."""
    h, b, c = D - t, B - t, d - t / 2         # centreline web, flange and lip
    pts = [(b, c)]

    def seg(x1, z1, n):                       # n equal elements from the last point to (x1, z1)
        x0, z0 = pts[-1]
        for k in range(1, n + 1):
            pts.append((x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n))
    seg(b, 0, n_lip)
    seg(0, 0, n_flange)
    seg(0, h, n_web)
    seg(b, h, n_flange)
    seg(b, h - c, n_lip)
    prop = [[1, E, E, NU, NU, E / (2 * (1 + NU))]]
    node = [[i + 1, x, z, 1, 1, 1, 1, 1.0] for i, (x, z) in enumerate(pts)]
    elem = [[i + 1, i + 1, i + 2, t, 1] for i in range(len(pts) - 1)]
    return cufsm_rs.Model(prop=prop, node=node, elem=elem)


PREQ_NOTE = ("Note: the DSM pre-qualified limits used here (AISI S100-16 Table B4.1-1) are\n"
             "UNVERIFIED: written from recollection, not checked against the standard.")


def prequalified(D, B, d, t, fy):
    """The reasons a lipped C is outside the DSM pre-qualified column limits, [] when it is inside:
    AISI S100-16 Table B4.1-1 (S100-04 App. 1 Table 1.1.1-1), lipped C, all out-to-out:
    h0/t < 472, b0/t < 159, 4 < D/t < 33, 0.7 < h0/b0 < 5.0, 0.05 < D/b0 < 0.41, θ = 90°
    (the builder's square lips), E/Fy > 340. φc = 0.85 holds only inside them. The DSM module
    says "check the section qualifies" but holds no table.
    UNVERIFIED: these limits were written from recollection of that table, not checked against
    a copy of the standard (see PREQ_NOTE); check them before relying on a pass."""
    out = []
    if not D / t < 472:
        out.append("h0/t = %.0f, not < 472" % (D / t))
    if not B / t < 159:
        out.append("b0/t = %.0f, not < 159" % (B / t))
    if not 4 < d / t < 33:
        out.append("D/t = %.1f, not in (4, 33)" % (d / t))
    if not 0.7 < D / B < 5.0:
        out.append("h0/b0 = %.2f, not in (0.7, 5.0)" % (D / B))
    if not 0.05 < d / B < 0.41:
        out.append("D/b0 = %.3f, not in (0.05, 0.41)" % (d / B))
    if not E / fy > 340:
        out.append("E/Fy = %.0f, not > 340" % (E / fy))
    return out


def logspace(a, b, n):
    return [10 ** (math.log10(a) + (math.log10(b) - math.log10(a)) * k / (n - 1)) for k in range(n)]


def grid_minima(L, f):
    """The curve's minima as the page and the DSM module find them: every interior local minimum,
    a still-falling last point, and for a curve with neither, its lowest point."""
    out = [i for i in range(1, len(f) - 1) if f[i] <= f[i - 1] and f[i] < f[i + 1]]
    if len(f) > 1 and f[-1] < f[-2]:
        out.append(len(f) - 1)
    if not out:
        out = [f.index(min(f))]
    return [(L[i], f[i]) for i in out]


# --- the Direct Strength Method, ported from the DSM compression module (main.py) -----------

def dsm_pne(Py, Pcre=None):
    """AISI S100-16 §E2 (S100-04 App. 1 Eq. 1.2.1-1 to 3); continuously braced: Pne = Py."""
    if Pcre is None:
        return Py
    lc = math.sqrt(Py / Pcre)
    return 0.658 ** (lc * lc) * Py if lc <= 1.5 else 0.877 / (lc * lc) * Py


def dsm_pnl(Pne, Pcrl):
    """AISI S100-16 §E3 (S100-04 App. 1 Eq. 1.2.1-5 to 7): local, interacting with global."""
    ll = math.sqrt(Pne / Pcrl)
    if ll <= 0.776:
        return Pne
    r = (Pcrl / Pne) ** 0.4
    return (1 - 0.15 * r) * r * Pne


def dsm_pnd(Py, Pcrd):
    """AISI S100-16 §E4 (S100-04 App. 1 Eq. 1.2.1-8 to 10): distortional, with yield."""
    ld = math.sqrt(Py / Pcrd)
    if ld <= 0.561:
        return Py
    r = (Pcrd / Py) ** 0.6
    return (1 - 0.25 * r) * r * Py


def column(model, fy, lengths):
    """Py, the local and distortional minima and the DSM strengths of a braced column."""
    Py = cufsm_rs.first_yield(model, fy).Py
    ref = cufsm_rs.stress(model, P=Py)                    # uniform compression at Py: load factor = Pcr / Py
    sig = cufsm_rs.signature(ref, lengths)
    mins = grid_minima(list(sig.lengths), list(sig.curve))
    cls = cufsm_rs.strip(ref, [m[0] for m in mins], neigs=1).classify()
    found = [(L, lf, list(cls[i][0])) for i, (L, lf) in enumerate(mins)]
    # local: the shortest-wavelength minimum cFSM does not call mostly global (G < 50 %);
    # distortional: the next one (the DSM module's rule)
    cand = [m for m in found if m[2][0] < 50]
    local = cand[0] if cand else None
    dist = cand[1] if len(cand) > 1 else None
    dist_src = "curve" if dist else None
    if dist is None:
        dist = d_only(ref, lengths)
        dist_src = "cFSM D-only" if dist else None
    Pne = dsm_pne(Py)
    Pnl = dsm_pnl(Pne, local[1] * Py) if local else None
    Pnd = dsm_pnd(Py, dist[1] * Py) if dist else None
    Pn = min(Pne, Pnl, Pnd) if Pnl is not None and Pnd is not None else None
    gov = None
    if Pn is not None:
        gov = "yield" if Pn == Py else "local" if Pn == Pnl else "distortional"
    return {"Py": Py, "A": Py / fy, "local": local, "dist": dist, "dist_src": dist_src, "sig": sig, "ref": ref,
            "Pnl": Pnl, "Pnd": Pnd, "Pn": Pn, "governs": gov}


def d_only(ref, lengths):
    """Pcrd where the curve has no distinct distortional minimum: the lowest minimum of the curve
    restricted to the distortional space by constrained cFSM (strip with spaces="D", S-S, one
    half-wave, at the same half-wavelengths), as (L, Pcrd/Py, [G, D, L, O]); None if it has none.
    AISI's DSM allows this constrained (pure distortional) analysis for Pcrd when the free curve
    shows no distinct distortional minimum (S100-16 commentary on Appendix 2, as recalled: the
    clause reference is not checked against the text). The mode is distortional by construction,
    so its classification is [0, 100, 0, 0] (not a cFSM classification of a free mode)."""
    d = cufsm_rs.strip(ref, lengths, spaces="D", neigs=1)
    L = list(d.lengths)
    f = [row[0] for row in d.load_factors]
    pts = [(L[i], f[i]) for i in range(1, len(f) - 1) if f[i] <= f[i - 1] and f[i] < f[i + 1]]
    if not pts:
        return None
    Lm, lf = min(pts, key=lambda p: p[1])
    return (Lm, lf, [0.0, 100.0, 0.0, 0.0])


def kind(m):
    """A minimum's mode by cFSM: the class with the largest share."""
    c = m[2]
    return KINDS[c.index(max(c))]
