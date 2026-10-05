"""cufsm_rs.plot in the page's Python console: the package's three plots, drawn inline in the output.

The same names, signatures and defaults as the package's (pip install cufsm-rs-py[plot]):
plot_section(model, ax=None, node_numbers=False, stress=True), plot_signature(result, ax=None,
classify=False) and plot_mode(result, i_length, k_mode=0, ax=None, scale=None, y=None). Each one
packs what it draws (the model's tables, the curve and its minima, the mode's displacements) into
a small figure spec and hands it to the console (_cufsm_native.figure), which draws it with the
page's own drawings (js/draw.js), in the output where the script made it.

What differs from the package:
- ax: matplotlib axes need the full Python runtime; anything but None raises.
- The return value is a Figure, not matplotlib Axes: it says what was drawn, and any Axes method
  on it raises, naming the full runtime.
- The look is the page's: the section's strips are shaded by their reference stress (the package
  draws a band beside each element), the signature chart has a log y axis when every load factor
  is positive, and a mode's strips are drawn straight between their nodes (the package bends
  them with the end rotations).
Every number in a figure is one the script holds: the engine's results, the package's own minima
and classify_minima(), and the mode's displacements from ModeShape.at().
"""

import math

import _cufsm_native

from . import MODE_CLASSES, Model, StripResult, _dumps

__all__ = ["plot_section", "plot_signature", "plot_mode"]

_FULL_PLOT = "the full Python runtime (Pyodide, or CPython with pip install cufsm-rs-py[plot]), which has matplotlib"


class Figure:
    """A figure the console drew in its output: what a plot function returns here.

    The package returns matplotlib Axes; the console draws in the page, so there are none.
    kind ("section", "signature" or "mode") and title say what was drawn.
    """

    def __init__(self, kind, title):
        object.__setattr__(self, "kind", kind)
        object.__setattr__(self, "title", title)

    def __getattr__(self, name):
        raise AttributeError("Figure." + name + ": the console draws its figures in the page, and returns this "
                             "Figure where the package returns matplotlib Axes; Axes need " + _FULL_PLOT)

    def __setattr__(self, k, v):
        raise AttributeError("Figure." + k + ": a console figure cannot be changed after it is drawn")

    def __repr__(self):
        return "<Figure " + self.kind + ": " + self.title + " (drawn in the console output)>"


def _no_ax(fn, ax):
    if ax is not None:
        raise NotImplementedError(fn + "(ax=...): drawing on matplotlib axes needs " + _FULL_PLOT
                                  + ". Leave ax out and the console draws the figure in its output.")


def _model(m, fn):
    if not isinstance(m, Model):
        raise TypeError(fn + " expected a cufsm_rs.Model, got " + type(m).__name__)
    return m


def _result(r, fn):
    if not isinstance(r, StripResult):
        raise TypeError(fn + " expected a cufsm_rs.StripResult (from signature() or strip()), got " + type(r).__name__)
    return r


def _geometry(model):
    """The model's nodes and elements as the drawing takes them: element ends as node rows (0-based)."""
    node = model.node.tolist()
    row = {}
    for k, n in enumerate(node):
        row[int(n[0])] = k
    elems, t = [], []
    for e in model.elem.tolist():
        for end in (e[1], e[2]):
            if int(end) not in row:
                raise ValueError("element " + str(int(e[0])) + " names node " + str(int(end)) + ", which is not in the node table")
        elems.append([row[int(e[1])], row[int(e[2])]])
        t.append(float(e[3]))
    return {"numbers": [int(n[0]) for n in node], "x": [float(n[1]) for n in node],
            "z": [float(n[2]) for n in node], "free": [[float(n[3]), float(n[4])] for n in node],
            "elems": elems, "t": t, "stress": [float(n[7]) for n in node]}


def _size(g):
    span = max(max(g["x"]) - min(g["x"]), max(g["z"]) - min(g["z"]))
    return float(span) if span > 0 else 1.0


def _show(spec):
    _cufsm_native.figure(_dumps(spec))
    return Figure(spec["kind"], spec["title"])


def plot_section(model, ax=None, node_numbers=False, stress=True):
    """The cross-section: elements drawn to their thickness, nodes, and (stress=True) the reference
    stress, compression and tension in their own colours. node_numbers=True labels the nodes with
    their CUFSM node numbers. Returns a Figure (the package: the Axes)."""
    _no_ax("plot_section", ax)
    g = _geometry(_model(model, "plot_section"))
    smax = max([abs(s) for s in g["stress"]]) if g["stress"] else 0.0
    shade = bool(stress) and smax > 0
    spec = {"kind": "section", "title": "cross-section, " + str(len(g["x"])) + " nodes, " + str(len(g["elems"])) + " elements",
            "show_stress": shade, "node_numbers": bool(node_numbers),
            "legend": ("reference stress (max %.4g)" % smax) if shade else None}
    spec.update(g)
    return _show(spec)


def _class_label(c):
    """The dominant cFSM class, with the runner-up when the mode is mixed: "L 98%", "D 54% L 45%"."""
    order = sorted(range(len(c)), key=lambda k: c[k])[::-1]
    out = "%s %.0f%%" % (MODE_CLASSES[order[0]], c[order[0]])
    if c[order[1]] >= 25:
        out += " %s %.0f%%" % (MODE_CLASSES[order[1]], c[order[1]])
    return out


def plot_signature(result, ax=None, classify=False):
    """Load factor against length on a log x axis, with the minima marked and labelled.

    classify=True also labels each minimum with its dominant cFSM class (G, D, L or O, from
    StripResult.classify_minima()), and the runner-up too when it is 25% or more.
    Returns a Figure (the package: the Axes).
    """
    _no_ax("plot_signature", ax)
    r = _result(result, "plot_signature")
    mins = r.minima.tolist()
    cls = r.classify_minima().tolist() if (classify and len(mins)) else None
    labels = []
    for k, (Lm, lm) in enumerate(mins):
        label = "%.4g at %.4g" % (lm, Lm)
        if cls is not None:
            label = _class_label(cls[k]) + ": " + label
        labels.append(label)
    one_term = all([len(t) == 1 for t in r.m_terms])
    xlabel = "half-wavelength" if r.bc == "S-S" and one_term else "length"
    spec = {"kind": "signature", "title": "signature curve, " + str(len(r.lengths)) + " lengths, "
            + str(len(mins)) + (" minimum" if len(mins) == 1 else " minima"),
            "lengths": [float(v) for v in r.lengths], "curve": [float(v) for v in r.curve],
            "minima": mins, "labels": labels, "classes": cls, "xlabel": xlabel, "ylabel": "load factor"}
    return _show(spec)


def plot_mode(result, i_length, k_mode=0, ax=None, scale=None, y=None):
    """A mode's deformed cross-section (solid) over the undeformed one (dashed).

    The section is cut at y along the member (default: where the in-plane displacement is
    largest, mid-length for one S-S term). scale multiplies the mode's displacements; by default
    the largest in-plane displacement is drawn at 10% of the section size, whatever the units.
    Returns a Figure (the package: the Axes).
    """
    _no_ax("plot_mode", ax)
    r = _result(result, "plot_mode")
    g = _geometry(r.model)
    ms = r.mode_shape(i_length, k_mode)
    disp = ms.at(y)
    u, w = [float(v) for v in disp.u], [float(v) for v in disp.w]
    peak = max([math.sqrt(a * a + b * b) for a, b in zip(u, w)])
    if scale is None:
        scale = 0.1 * _size(g) / peak if peak > 0 else 1.0
    spec = {"kind": "mode", "title": "mode %d: load factor %.4g at length %.4g" % (k_mode + 1, ms.load_factor, ms.length),
            "u": u, "w": w, "scale": float(scale), "y": float(disp.y)}
    spec.update(g)
    return _show(spec)
