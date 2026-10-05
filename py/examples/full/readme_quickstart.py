# The cufsm-rs-py README quickstart, verbatim: numpy, the analyses and the matplotlib plots.
#
# This needs full Python (the console downloads Pyodide the first time, once you agree): it is the
# same script as on your own machine after pip install cufsm-rs-py[plot], with the same numbers,
# from the same engine. The README's code is below as published (cufsm-rs-py 0.1.0), from
# "import numpy as np" down to plot_mode; after it, a few print() lines show the values its
# comments describe, and plt.show() puts the three figures in the output.
#
# Units: CUFSM's tutorial C is in inches and ksi; lipped_c is in mm (MPa for E).
import numpy as np
import cufsm_rs as fsm

# CUFSM's tutorial C: 9 x 5 x 1 in, t = 0.1 in (inches and ksi)
xz = [(5, 1), (5, 0), (2.5, 0), (0, 0), (0, 3), (0, 6), (0, 9), (2.5, 9), (5, 9), (5, 8)]
m = fsm.Model(
    prop=[[100, 29500, 29500, 0.3, 0.3, 11346.15]],
    node=[[i + 1, x, z, 1, 1, 1, 1, 0] for i, (x, z) in enumerate(xz)],
    elem=[[i + 1, i + 1, i + 2, 0.1, 100] for i in range(9)],
)

p = fsm.section_properties(m)          # p.A, p.Ixx, p.J, p.Cw, p.xs, ... (also p["Ixx"])
y = fsm.first_yield(m, fy=50)          # y.Py = 105, y.Mxx = 324.64 (element faces, as CUFSM)

mc = fsm.stress(m, P=y.Py)             # a new Model with the reference stresses set
sig = fsm.signature(mc, np.logspace(0, 3, 80))
sig                                    # StripResult(signature, bc=S-S, 80 lengths 1 to 1000, neigs=1, 2 minima)
sig.minima                             # [[7.27, 0.353], [43.9, 0.544]]: [half-wavelength, load factor]
sig.classify_minima()                  # [G, D, L, O] percent of each minimum's mode: L 98%, D 94%

r = fsm.strip(mc, [7.27, 43.9], neigs=3)   # any lengths, several modes
r.load_factors                             # (2, 3)
shape = r.mode_shape(0)                    # the lowest mode at the first length
shape.u, shape.v, shape.w, shape.theta     # each (terms, nodes)
shape.dofs                                 # the raw vector, CUFSM's DOF order
shape.at()                                 # displacements summed over terms at mid-length

dist = fsm.strip(mc, [43.9], spaces="D", neigs=1)                  # pure distortional (cFSM)
cc = fsm.strip(mc, [100.0, 200.0], m_all=10, bc="C-C", neigs=2)    # general end conditions
cc.classify()                                                       # (2, 2, 4): G, D, L, O percent

lc = fsm.lipped_c(200, 76, 15, 1.9, ri=3)    # mm; 37 nodes

from cufsm_rs.plot import plot_section, plot_signature, plot_mode

plot_section(mc, node_numbers=True)     # elements to thickness, nodes, stress bands
plot_signature(sig, classify=True)      # log-x curve, minima labelled with G/D/L/O
plot_mode(sig, i_length=20)             # deformed over undeformed cross-section

# --- not in the README: the values its comments describe, printed ---------------------------
import matplotlib.pyplot as plt

print(sig)
print("minima [half-wavelength, load factor]:")
print(sig.minima)
print("[G, D, L, O] % of each minimum's mode:")
print(np.round(sig.classify_minima(), 2))
print("y.Py = %.4g, y.Mxx = %.5g" % (y.Py, y.Mxx))
print("r.load_factors.shape =", r.load_factors.shape, " cc.classify().shape =", cc.classify().shape)
print("pure distortional at 43.9:", dist.load_factors[0, 0])
print(lc)
plt.show()
