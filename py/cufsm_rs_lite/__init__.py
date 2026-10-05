"""cufsm_rs lite: the cufsm-rs-py API for MicroPython, in the page's Python console.

The same names and call signatures as the published package (pip install cufsm-rs-py, import
cufsm_rs) for everything a script needs without numpy: Model, section_properties, first_yield,
stress, stress_to_action, signature, strip, classify, StripResult, ModeShape and the result
objects, with the same reprs. Numbers come from the same Rust engine, compiled to WebAssembly,
through the page's transport (js/py/transport.js), so they match the package's.

Where the package returns a numpy array this module returns an Array: nested lists with the same
shape and indexing (a[i], a[i][j], len, iteration, slicing, .shape, .tolist()). Anything that
needs numpy (a[i, j], a[:, k], arithmetic on whole arrays, .min() and the other array methods)
raises an error that names the full runtime, never a different answer. Everything else the
package's native layer does runs on the engine here too: strip with any term lists and cFSM
spaces, classify with every option, and the templates (template, lipped_c, lipped_z, plain_c).
cufsm_rs.plot (plot.py) draws the package's three plots in the console's output instead of with
matplotlib.

The console writes this package to MicroPython's /lib/cufsm_rs (js/py/lite.js) and registers
the transport as the JS module _cufsm_native. Ported from cufsm-rs-py 0.1.0's own Python layer
(python/cufsm_rs/__init__.py): the minima and classify_minima, the result stacking and the
mode-shape reconstruction are that code with lists for arrays.
"""

import array
import json
import math
from collections import namedtuple

import _cufsm_native

__version__ = "0.1.0"
__lite__ = True

MODE_CLASSES = ("G", "D", "L", "O")

_FULL = "the full Python runtime (Pyodide, or CPython with pip install cufsm-rs-py), which has numpy"


class MechanismError(ValueError):
    """The elastic stiffness is not positive definite: the section has a mechanism at this length."""


def _needs_numpy(what):
    return NotImplementedError(what + " needs numpy: run this script on " + _FULL)


# --- the transport: JSON with every float bit for bit -------------------------------------

def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _f64(nums):
    # the doubles' little-endian 32-bit halves: exact both ways (see js/py/transport.js)
    return '{"$f64":[' + ",".join([str(u) for u in array.array("I", bytes(array.array("d", nums)))]) + "]}"


def _dumps(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return '{"$f":[' + ",".join([str(u) for u in array.array("I", bytes(array.array("d", [v])))]) + "]}"
    if isinstance(v, str):
        return json.dumps(v)
    if isinstance(v, Array):
        v = v.tolist()
    if isinstance(v, dict):
        return "{" + ",".join([json.dumps(str(k)) + ":" + _dumps(x) for k, x in v.items()]) + "}"
    if isinstance(v, (list, tuple)):
        if v and all([_num(x) for x in v]):
            return _f64([float(x) for x in v])
        return "[" + ",".join([_dumps(x) for x in v]) + "]"
    raise TypeError("cannot send a " + type(v).__name__ + " to the engine")


def _unpack(v):
    if isinstance(v, list):
        return [_unpack(x) for x in v]
    if isinstance(v, dict):
        if "$f64" in v:
            return list(array.array("d", bytes(array.array("I", v["$f64"]))))
        if "$f" in v:
            return array.array("d", bytes(array.array("I", v["$f"])))[0]
        return {k: _unpack(x) for k, x in v.items()}
    return v


_ERRORS = {"ValueError": ValueError, "MechanismError": MechanismError,
           "NotImplementedError": NotImplementedError, "TypeError": TypeError, "MemoryError": MemoryError,
           "RuntimeError": RuntimeError}


def _call(op, **args):
    r = json.loads(_cufsm_native.call(op, _dumps(args)))
    if "error" in r:
        e = r["error"]
        raise _ERRORS.get(e["type"], ValueError)(e["message"])
    return _unpack(r["ok"])


# --- arrays without numpy -------------------------------------------------------------------

def _shape_of(a):
    shape = [len(a)]
    while a and isinstance(a[0], list):
        a = a[0]
        shape.append(len(a))
    return tuple(shape)


def _deep(a):
    return [_deep(x) for x in a] if isinstance(a, list) else a


class Array:
    """A numpy-free array: nested lists with the package's shape and indexing.

    a[i] (a row, itself an Array, or a number), a[i][j], negative indices, slices, len(a),
    iteration, a.shape, a.ndim, a.tolist() (plain nested lists) and list(a) all work as they
    do on the package's arrays. Writing a[i] = v or a[i][j] = v writes through. Whole-array
    arithmetic, comparisons, a[i, j] and the array methods need numpy and raise.
    """

    def __init__(self, data, shape=None):
        object.__setattr__(self, "_a", data)
        object.__setattr__(self, "_shape", shape)

    @property
    def shape(self):
        return self._shape if self._shape is not None and not self._a else _shape_of(self._a)

    @property
    def ndim(self):
        return len(self.shape)

    def tolist(self):
        return _deep(self._a)

    def __len__(self):
        return len(self._a)

    def __getitem__(self, k):
        if isinstance(k, tuple):
            raise _needs_numpy("indexing an array with a[i, j] or a[:, k] (use a[i][j])")
        if isinstance(k, slice):
            return Array(self._a[k])
        v = self._a[k]
        return Array(v) if isinstance(v, list) else v

    def __setitem__(self, k, v):
        if isinstance(k, (tuple, slice)):
            raise _needs_numpy("assigning to a[i, j], a[:, k] or a slice")
        old = self._a[k]
        if isinstance(old, list):
            new = v.tolist() if isinstance(v, Array) else list(v)
            if _shape_of(new) != _shape_of(old):
                raise ValueError("a row of shape " + str(_shape_of(old)) + " cannot take a value of shape " + str(_shape_of(new)))
            old[:] = _deep(new)
        else:
            self._a[k] = float(v)

    def __iter__(self):
        for v in self._a:
            yield Array(v) if isinstance(v, list) else v

    def __contains__(self, x):
        return x in self._a

    def __bool__(self):
        if len(self._a) > 1:
            raise ValueError("The truth value of an array with more than one element is ambiguous")
        return bool(self._a) and bool(self[0])

    def __repr__(self):
        return "Array(" + repr(self._a) + ")"

    def __getattr__(self, name):
        raise AttributeError("Array has no " + repr(name) + ": array methods need numpy; run this script on " + _FULL)

    def __setattr__(self, name, v):
        raise AttributeError("Array has no attribute " + repr(name) + " to set")

    def _arith(self, *a):
        raise _needs_numpy("arithmetic or comparison on a whole array (use a loop or a list comprehension)")

    __add__ = __radd__ = __sub__ = __rsub__ = __mul__ = __rmul__ = _arith
    __truediv__ = __rtruediv__ = __floordiv__ = __rfloordiv__ = __pow__ = __rpow__ = _arith
    __mod__ = __matmul__ = __rmatmul__ = __neg__ = __pos__ = __abs__ = _arith
    __eq__ = __ne__ = __lt__ = __le__ = __gt__ = __ge__ = _arith
    __iadd__ = __isub__ = __imul__ = __itruediv__ = _arith


class _Column:
    """A writable view of one table column (the package's Model.x, z and stress)."""

    def __init__(self, table, k):
        self._t = table
        self._k = k

    def tolist(self):
        return [r[self._k] for r in self._t._a]

    @property
    def shape(self):
        return (len(self._t._a),)

    def __len__(self):
        return len(self._t._a)

    def __getitem__(self, i):
        if isinstance(i, (tuple, slice)):
            raise _needs_numpy("slicing a column view")
        return self._t._a[i][self._k]

    def __setitem__(self, i, v):
        if isinstance(i, (tuple, slice)):
            raise _needs_numpy("assigning to a slice of a column view")
        self._t._a[i][self._k] = float(v)

    def __iter__(self):
        for r in self._t._a:
            yield r[self._k]

    def __repr__(self):
        return "Array(" + repr(self.tolist()) + ")"

    def __getattr__(self, name):
        raise AttributeError("Array has no " + repr(name) + ": array methods need numpy; run this script on " + _FULL)

    _arith = Array._arith
    __add__ = __radd__ = __sub__ = __rsub__ = __mul__ = __rmul__ = _arith
    __truediv__ = __rtruediv__ = __floordiv__ = __rfloordiv__ = __pow__ = __rpow__ = _arith
    __mod__ = __matmul__ = __rmatmul__ = __neg__ = __pos__ = __abs__ = _arith
    __eq__ = __ne__ = __lt__ = __le__ = __gt__ = __ge__ = _arith
    __iadd__ = __isub__ = __imul__ = __itruediv__ = _arith


def _plain(a):
    """Nested Python lists of numbers from lists, tuples, Arrays, column views or a number."""
    if isinstance(a, (Array, _Column)):
        return a.tolist()
    if isinstance(a, (list, tuple)):
        return [_plain(x) for x in a]
    if _num(a) or isinstance(a, bool):
        return float(a)
    if isinstance(a, str):
        return float(a)
    raise TypeError("expected numbers or lists of numbers, got " + type(a).__name__)


def _flat(a):
    """np.asarray(a, dtype=float).ravel().tolist()."""
    p = _plain(a)
    if not isinstance(p, list):
        return [p]
    out = []

    def walk(x):
        for v in x:
            if isinstance(v, list):
                walk(v)
            else:
                out.append(v)

    walk(p)
    return out


def _shape_str(shape):
    return "(" + ", ".join([str(s) for s in shape]) + ("," if len(shape) == 1 else "") + ")"


def _rows(a, ncols, name):
    if a is None:
        return Array([], (0, ncols[-1]))
    rows = _plain(a)
    if not isinstance(rows, list):
        rows = [rows]
    if not rows:
        return Array([], (0, ncols[-1]))
    if not isinstance(rows[0], list):
        if any([isinstance(r, list) for r in rows]):
            raise ValueError("setting an array element with a sequence: " + name + " is ragged")
        rows = [rows]
    shapes = [_shape_of(r) if isinstance(r, list) else () for r in rows]
    if any([s != shapes[0] for s in shapes]):
        raise ValueError("setting an array element with a sequence: " + name + " is ragged")
    shape = (len(rows),) + shapes[0]
    if len(shape) != 2 or shape[1] not in ncols:
        raise ValueError(name + " must be a 2-D array with " + " or ".join([str(c) for c in ncols])
                         + " columns, got shape " + _shape_str(shape))
    if shape[1] == 0:
        return Array([], (0, ncols[-1]))
    return Array(rows)


class Model:
    """A cross-section model held as CUFSM tables (Arrays, editable in place: m.node[i][7] = s).

    prop [mat#, Ex, Ey, vx, vy, G]; node [node#, x, z, xdof, zdof, ydof, qdof, stress];
    elem [elem#, nodei, nodej, t, mat#]; constraints [node#e, dofe, coeff, node#k, dofk];
    springs [#, nodei, nodej, ku, kv, kw, kq, local, discrete, ys]. Unit-agnostic.
    """

    def __init__(self, prop, node, elem, constraints=None, springs=None):
        self.prop = _rows(prop, (6,), "prop")
        self.node = _rows(node, (8,), "node")
        self.elem = _rows(elem, (4, 5), "elem")
        self.constraints = _rows(constraints, (5,), "constraints")
        self.springs = _rows(springs, (10,), "springs")
        if len(self.prop) == 0 or len(self.node) == 0 or len(self.elem) == 0:
            raise ValueError("prop, node and elem must each have at least one row")
        if len(self.elem[0]) == 4:
            # CUFSM's elem has 5 columns; a 4-column table means every element is the first material
            first = self.prop._a[0][0]
            self.elem = Array([r + [first] for r in self.elem._a])

    @classmethod
    def from_dicts(cls, nodes, elements, materials=None, E=None, nu=0.3, constraints=(), springs=()):
        """A model from lists of dicts, with 0-based node, element and material indices."""
        if materials is None:
            if E is None:
                raise ValueError("give materials or E")
            materials = [{"E": E, "nu": nu}]
        prop = []
        for k, m in enumerate(materials):
            if "E" in m:
                e, v = float(m["E"]), float(m.get("nu", 0.3))
                prop.append([k + 1, e, e, v, v, e / (2 * (1 + v))])
            else:
                prop.append([k + 1, m["Ex"], m["Ey"], m["vx"], m["vy"], m["G"]])
        node = []
        for k, n in enumerate(nodes):
            f = tuple(n.get("free", (1, 1, 1, 1)))
            if len(f) != 4:
                raise ValueError("nodes[" + str(k) + "]['free'] needs 4 flags (x, z, y, theta)")
            node.append([k + 1, n["x"], n["z"]] + [1.0 if b else 0.0 for b in f] + [n.get("stress", 1.0)])
        elem = [[k + 1, e["i"] + 1, e["j"] + 1, e["t"], e.get("mat", 0) + 1] for k, e in enumerate(elements)]
        dofs = {"x": 1, "z": 2, "y": 3, "q": 4, "theta": 4}

        def d(v):
            return dofs[v] if isinstance(v, str) else int(v)

        cons = [[c["node_e"] + 1, d(c["dof_e"]), c.get("coeff", 1.0), c["node_k"] + 1, d(c["dof_k"])]
                for c in constraints]
        sprs = [[k + 1, s["i"] + 1, 0 if s.get("j") is None else s["j"] + 1,
                 s.get("ku", 0.0), s.get("kv", 0.0), s.get("kw", 0.0), s.get("kq", 0.0),
                 float(bool(s.get("local", False))), float(bool(s.get("discrete", False))), s.get("ys", 0.0)]
                for k, s in enumerate(springs)]
        return cls(prop, node, elem, cons, sprs)

    @property
    def x(self):
        """Node x coordinates (node column 2), a writable view."""
        return _Column(self.node, 1)

    @property
    def z(self):
        """Node z coordinates (node column 3), a writable view."""
        return _Column(self.node, 2)

    @property
    def stress(self):
        """Nodal reference stresses (node column 8), a writable view; positive = compression."""
        return _Column(self.node, 7)

    def copy(self):
        """A deep copy."""
        return Model(self.prop.tolist(), self.node.tolist(), self.elem.tolist(),
                     self.constraints.tolist() or None, self.springs.tolist() or None)

    def with_stress(self, s):
        """A copy with the reference stresses replaced by s (one value per node)."""
        m = self.copy()
        p = _plain(s)
        shape = _shape_of(p) if isinstance(p, list) else ()
        if shape != (len(m.node),):
            raise ValueError("stress needs one value per node (" + str(len(m.node)) + "), got shape " + _shape_str(shape))
        for r, v in zip(m.node._a, p):
            r[7] = v
        return m

    def _arrays(self):
        t = [self.prop, self.node, self.elem, self.constraints, self.springs]
        return [_plain(a) for a in t]

    def __repr__(self):
        return ("Model(" + str(len(self.node)) + " nodes, " + str(len(self.elem)) + " elements, "
                + str(len(self.prop)) + " materials, " + str(len(self.constraints)) + " constraints, "
                + str(len(self.springs)) + " springs)")

    def section_properties(self):
        return section_properties(self)

    def first_yield(self, fy, restrained=False, extreme_fibre=True):
        return first_yield(self, fy, restrained=restrained, extreme_fibre=extreme_fibre)

    def signature(self, lengths=None, neigs=1):
        return signature(self, lengths, neigs=neigs)

    def strip(self, lengths, m_all=None, bc="S-S", neigs=20, spaces=None):
        return strip(self, lengths, m_all=m_all, bc=bc, neigs=neigs, spaces=spaces)


# --- results ----------------------------------------------------------------------------------

class _DictLike:
    """A frozen record readable as attributes or as a mapping (p.A, p["A"], p.keys())."""

    _fields = ()
    _norepr = ()

    def __init__(self, **kw):
        for k in self._fields:
            object.__setattr__(self, k, kw[k])

    def __setattr__(self, k, v):
        raise AttributeError("cannot assign to field " + repr(k))

    def __getitem__(self, k):
        return getattr(self, k)

    def keys(self):
        return list(self._fields)

    def as_dict(self):
        return {k: getattr(self, k) for k in self.keys()}

    def __repr__(self):
        return (type(self).__name__ + "("
                + ", ".join([k + "=" + repr(getattr(self, k)) for k in self._fields if k not in self._norepr]) + ")")


class SectionProperties(_DictLike):
    """Gross (grosprop) and thin-walled (cutwp_prop2) section properties, in the model's units.

    A, xcg, zcg, Ixx, Izz, Ixz, thetap (degrees), I11, I22, J, xs, zs, Cw, B1, B2, and wn (the
    normalised unit warping at each node, an Array).
    """

    _fields = ("A", "xcg", "zcg", "Ixx", "Izz", "Ixz", "thetap", "I11", "I22", "J", "xs", "zs",
               "Cw", "B1", "B2", "wn")
    _norepr = ("wn",)


class YieldActions(_DictLike):
    """First-yield actions: fy, Py, Mxx, Mzz, M11, M22, B."""

    _fields = ("fy", "Py", "Mxx", "Mzz", "M11", "M22", "B")


class StressActions(_DictLike):
    """Actions fitted by least squares to a model's nodal stresses: P, M11, M22, B, err."""

    _fields = ("P", "M11", "M22", "B", "err")


Displacements = namedtuple("Displacements", ["y", "u", "v", "w", "theta"])


def _ym(bc, m, y, a):
    """CUFSM Ym_at_ys: the longitudinal shape function of each term in m at y."""
    x = math.pi * y / a
    if bc == "S-S":
        return [math.sin(t * x) for t in m]
    if bc == "C-C":
        return [math.sin(t * x) * math.sin(x) for t in m]
    if bc in ("S-C", "C-S"):
        return [math.sin((t + 1) * x) + (t + 1) / t * math.sin(t * x) for t in m]
    if bc in ("C-F", "F-C"):
        return [1 - math.cos((t - 0.5) * x) for t in m]
    if bc in ("C-G", "G-C"):
        return [math.sin((t - 0.5) * x) * math.sin(x / 2) for t in m]
    raise ValueError("boundary condition " + repr(bc) + " is not one of S-S, C-C, S-C, C-F, C-G")


def _ymprime(bc, m, y, a):
    """CUFSM Ymprime_at_ys: dYm/dy."""
    p = math.pi
    if bc == "S-S":
        return [p * t * math.cos(p * t * y / a) / a for t in m]
    if bc == "C-C":
        return [(p * math.cos(p * y / a) * math.sin(p * t * y / a) + p * t * math.sin(p * y / a) * math.cos(p * t * y / a)) / a
                for t in m]
    if bc in ("S-C", "C-S"):
        return [(p * math.cos(p * y * (t + 1) / a) * (t + 1) + p * math.cos(p * t * y / a) * (t + 1)) / a for t in m]
    if bc in ("C-F", "F-C"):
        return [p * math.sin(p * y * (t - 0.5) / a) * (t - 0.5) / a for t in m]
    if bc in ("C-G", "G-C"):
        return [p * math.sin(p * y * (t - 0.5) / a) * math.cos(p * y / (2 * a)) / (2 * a)
                + p * math.cos(p * y * (t - 0.5) / a) * math.sin(p * y / (2 * a)) * (t - 0.5) / a for t in m]
    raise ValueError("boundary condition " + repr(bc) + " is not one of S-S, C-C, S-C, C-F, C-G")


def _dot(c, rows):
    """c @ rows: sum over terms of c[t] * rows[t][i], for every node i."""
    out = [0.0] * len(rows[0])
    for ct, r in zip(c, rows):
        for i in range(len(r)):
            out[i] += ct * r[i]
    return out


class ModeShape:
    """One buckling mode, split into per-node displacement amplitudes.

    length, load_factor, bc, m_terms (nterms,), x and z (nnodes,), and u, v, w, theta, each
    (nterms, nnodes), from the raw vector dofs (4 * nnodes * nterms,) in CUFSM's DOF order:
    for term block t and node i, with n nodes and o = 4 n t, u = dofs[o + 2i],
    v = dofs[o + 2i + 1], w = dofs[o + 2n + 2i], theta = dofs[o + 2n + 2i + 1].
    """

    _fields = ("length", "load_factor", "bc", "m_terms", "x", "z", "u", "v", "w", "theta", "dofs")

    def __init__(self, length, load_factor, bc, m_terms, x, z, u, v, w, theta, dofs):
        for k, val in zip(self._fields, (length, load_factor, bc, m_terms, x, z, u, v, w, theta, dofs)):
            object.__setattr__(self, k, val)

    def __setattr__(self, k, v):
        raise AttributeError("cannot assign to field " + repr(k))

    @classmethod
    def _from_dofs(cls, dofs, length, load_factor, bc, m_terms, x, z):
        n, nt = len(x), len(m_terms)
        d = [float(v) for v in dofs]
        u, v, w, th = [], [], [], []
        for t in range(nt):
            o = 4 * n * t
            u.append([d[o + 2 * i] for i in range(n)])
            v.append([d[o + 2 * i + 1] for i in range(n)])
            w.append([d[o + 2 * n + 2 * i] for i in range(n)])
            th.append([d[o + 2 * n + 2 * i + 1] for i in range(n)])
        return cls(float(length), float(load_factor), bc, Array([float(t) for t in m_terms]),
                   Array(list(x)), Array(list(z)), Array(u), Array(v), Array(w), Array(th), Array(d))

    def at(self, y=None):
        """The nodal displacements at y along the member (0 to length), summed over terms.

        With y=None, the position where the in-plane displacement (u, w) is largest, which is
        mid-length for a one-term S-S mode.
        """
        bc = self.bc.upper()
        mt = self.m_terms._a
        u, w = self.u._a, self.w._a
        if y is None:
            step = self.length / 200
            best, by = None, 0.0
            for i in range(1, 200):
                yy = i * step
                ym = _ym(bc, mt, yy, self.length)
                uu, ww = _dot(ym, u), _dot(ym, w)
                mag = max([math.sqrt(a * a + b * b) for a, b in zip(uu, ww)])
                if best is None or mag > best:
                    best, by = mag, yy
            y = by
        ym = _ym(bc, mt, y, self.length)
        yp = _ymprime(bc, mt, y, self.length)
        yv = [yp[k] * self.length / (mt[k] * math.pi) for k in range(len(mt))]
        return Displacements(float(y), Array(_dot(ym, u)), Array(_dot(yv, self.v._a)),
                             Array(_dot(ym, w)), Array(_dot(ym, self.theta._a)))

    def __repr__(self):
        return ("ModeShape(" + ", ".join([k + "=" + repr(getattr(self, k)) for k in self._fields if k != "dofs"]) + ")")


def _stack(rows):
    """(lengths, m_terms list, load factors [nl][neigs] NaN-padded, modes [nl][neigs][ndof])."""
    lengths = [float(r[0]) for r in rows]
    m_terms = [Array([float(t) for t in r[1]]) for r in rows]
    ne = max([len(r[2]) for r in rows]) if rows else 0
    ndof = max([len(m) for r in rows for m in r[3]]) if rows and any([r[3] for r in rows]) else 0
    nan = float("nan")
    lf, modes = [], []
    for r in rows:
        lf.append(list(r[2]) + [nan] * (ne - len(r[2])))
        ms = []
        for q in range(ne):
            md = list(r[3][q]) if q < len(r[3]) else []
            ms.append(md + [nan] * (ndof - len(md)))
        modes.append(ms)
    return (Array(lengths), m_terms, Array(lf, (len(rows), ne)), Array(modes, (len(rows), ne, ndof)))


class StripResult:
    """The result of strip() or signature().

    model, bc, kind ("signature" or "strip"), lengths (nlengths,), m_terms (one Array per
    length), load_factors (nlengths, neigs) smallest first and NaN-padded, modes (nlengths,
    neigs, ndof), minima (nminima, 2) of [length, load factor] (signature only).
    """

    def __init__(self, model, bc, lengths, m_terms, load_factors, modes, minima=None, kind="strip"):
        self.model = model
        self.bc = bc
        self.lengths = lengths
        self.m_terms = m_terms
        self.load_factors = load_factors
        self.modes = modes
        self.minima = minima if minima is not None else Array([], (0, 2))
        self.kind = kind

    @property
    def curve(self):
        """The lowest load factor at each length, load_factors[:, 0]."""
        return Array([r[0] for r in self.load_factors._a])

    @property
    def neigs(self):
        """The number of load factor columns."""
        return int(self.load_factors.shape[1])

    def mode_shape(self, i_length, k_mode=0):
        """Mode k_mode (0 = lowest) at lengths[i_length] as per-node displacement arrays."""
        nl = len(self.lengths)
        if not -nl <= i_length < nl:
            raise IndexError("i_length " + str(i_length) + " is out of range for " + str(nl) + " lengths")
        lfs = self.load_factors._a[i_length]
        if not 0 <= k_mode < self.neigs or math.isnan(lfs[k_mode]):
            found = len([v for v in lfs if not math.isnan(v)])
            raise IndexError("k_mode " + str(k_mode) + ": only " + str(found) + " modes were found at this length")
        mt = self.m_terms[i_length]
        n = len(self.model.node)
        dofs = self.modes._a[i_length][k_mode][: 4 * n * len(mt)]
        return ModeShape._from_dofs(dofs, self.lengths._a[i_length], lfs[k_mode], self.bc, mt._a,
                                    self.model.x.tolist(), self.model.z.tolist())

    def _rows(self):
        out = []
        for i, L in enumerate(self.lengths._a):
            lf = self.load_factors._a[i]
            n = len([v for v in lf if not math.isnan(v)])
            nd = 4 * len(self.model.node) * len(self.m_terms[i])
            out.append([float(L), self.m_terms[i].tolist(), lf[:n], [m[:nd] for m in self.modes._a[i][:n]]])
        return out

    def classify(self, orth="axial", norm="vector", ospace="st"):
        """See classify(): (nlengths, neigs, 4) percentages [G, D, L, O]."""
        return classify(self, orth=orth, norm=norm, ospace=ospace)

    def classify_minima(self):
        """[G, D, L, O] percentages of the lowest mode at each of minima, shape (nminima, 4).

        Each minimum's length is solved again (S-S, one term) and classified with CUFSM's
        defaults (axial, vector, ST).
        """
        if len(self.minima) == 0:
            return Array([], (0, 4))
        at = strip(self.model, [r[0] for r in self.minima._a], bc="S-S", neigs=1)
        return Array([per[0] for per in at.classify()._a])

    def __repr__(self):
        L = self.lengths._a
        rng = "{:.4g} to {:.4g}".format(min(L), max(L)) if len(L) else "none"
        s = ("StripResult(" + self.kind + ", bc=" + self.bc + ", " + str(len(L)) + " lengths " + rng
             + ", neigs=" + str(self.neigs))
        if self.kind == "signature":
            s += ", " + str(len(self.minima)) + " minima"
        return s + ")"


# --- functions ------------------------------------------------------------------------------

def _model(m):
    if not isinstance(m, Model):
        raise TypeError("expected a cufsm_rs.Model, got " + type(m).__name__)
    return m


def section_properties(model):
    """Gross and thin-walled section properties (CUFSM grosprop and cutwp_prop2)."""
    d = _call("section_properties", arrays=_model(model)._arrays())
    d["wn"] = Array(d["wn"])
    return SectionProperties(**d)


def stress(model, P=0.0, Mxx=0.0, Mzz=0.0, M11=0.0, M22=0.0, B=0.0, restrained=False, as_array=False):
    """Reference stresses from member actions (stresgen, plus warp_stress for a bimoment).

    Returns a new Model with the stress column set, or the stresses (an Array) if as_array.
    """
    s = _call("stress", arrays=_model(model)._arrays(), p=float(P), mxx=float(Mxx), mzz=float(Mzz),
              m11=float(M11), m22=float(M22), b=float(B), unsymmetric=not restrained)
    return Array(s) if as_array else model.with_stress(s)


def first_yield(model, fy, restrained=False, extreme_fibre=True):
    """First-yield actions for yield stress fy (extreme_fibre: element faces, as current CUFSM)."""
    if not (math.isfinite(fy) and fy > 0):
        raise ValueError("fy = " + str(fy) + " must be positive")
    return YieldActions(**_call("first_yield", arrays=_model(model)._arrays(), fy=float(fy),
                                unsymmetric=not restrained, extreme_fibre=bool(extreme_fibre)))


def stress_to_action(model):
    """The P, M11, M22 and B whose stresses best fit the model's nodal stresses (least squares)."""
    return StressActions(**_call("stress_to_action", arrays=_model(model)._arrays()))


def signature(model, lengths=None, neigs=1):
    """The signature curve: S-S, one half-wave at each half-wavelength (None: CUFSM's 100)."""
    ls = None if lengths is None else _flat(lengths)
    rows, minima = _call("signature", arrays=_model(model)._arrays(), lengths=ls, neigs=int(neigs))
    L, mt, lf, modes = _stack(rows)
    return StripResult(model, "S-S", L, mt, lf, modes, Array([list(m) for m in minima], (0, 2)), "signature")


def strip(model, lengths, m_all=None, bc="S-S", neigs=20, spaces=None):
    """CUFSM stripmain: load factors and modes at each length.

    m_all: longitudinal terms per length; a list of lists, a single list used for every length,
    an int n for 1..n, or None for [1].
    """
    ls = _flat(lengths)
    if m_all is None:
        ma = [[1.0]] * len(ls)
    elif isinstance(m_all, int):
        ma = [[float(k) for k in range(1, int(m_all) + 1)]] * len(ls)
    else:
        seq = list(m_all)
        if seq and all([_num(v) or isinstance(v, (bool, str)) for v in seq]):
            ma = [[float(v) for v in seq]] * len(ls)
        else:
            ma = [_flat(v) for v in seq]
    if len(ma) != len(ls):
        raise ValueError(str(len(ls)) + " lengths but " + str(len(ma)) + " sets of longitudinal terms")
    rows = _call("strip", arrays=_model(model)._arrays(), lengths=ls, m_all=ma, bc=bc, neigs=int(neigs), spaces=spaces)
    L, mt, lf, modes = _stack(rows)
    return StripResult(model, bc.upper(), L, mt, lf, modes)


def classify(result, orth="axial", norm="vector", ospace="st"):
    """cFSM modal classification: (nlengths, neigs, 4) percentages [G, D, L, O], NaN-padded."""
    out = _call("classify", arrays=result.model._arrays(), results=result._rows(), bc=result.bc,
                orth=orth, norm=norm, ospace=ospace)
    nl, ne = result.load_factors.shape[0], result.neigs
    nan = float("nan")
    arr = []
    for i in range(nl):
        per = out[i] if i < len(out) else []
        arr.append([list(per[q]) if q < len(per) else [nan] * 4 for q in range(ne)])
    return Array(arr, (nl, ne, 4))


def _prop(E, nu):
    return [[1, E, E, nu, nu, E / (2 * (1 + nu))]]


def template(shape="C", h=9.0, b1=5.0, b2=None, d1=1.0, d2=None, r1=0.0, r2=None, r3=None, r4=None,
             q1=90.0, q2=None, t=0.1, nh=4, nb1=2, nb2=None, nd1=None, nd2=None, nr1=None, nr2=None,
             nr3=None, nr4=None, centerline=True, E=29500.0, nu=0.3):
    """CUFSM's C/Z template (templatecalc)."""
    b2 = b1 if b2 is None else b2
    d2 = d1 if d2 is None else d2
    r2 = r1 if r2 is None else r2
    r3 = r1 if r3 is None else r3
    r4 = r1 if r4 is None else r4
    q2 = q1 if q2 is None else q2
    nb2 = nb1 if nb2 is None else nb2

    def dflt(n, v):
        return (2 if v > 0 else 0) if n is None else n

    node, elem = _call("template", shape=shape, h=h, b1=b1, b2=b2, d1=d1, d2=d2, r1=r1, r2=r2, r3=r3,
                       r4=r4, q1=q1, q2=q2, t=t, nh=nh, nb1=nb1, nb2=nb2, nd1=dflt(nd1, d1),
                       nd2=dflt(nd2, d2), nr1=dflt(nr1, r1), nr2=dflt(nr2, r2), nr3=dflt(nr3, r3),
                       nr4=dflt(nr4, r4), centerline=centerline)
    return Model(_prop(E, nu), node, elem)


def _outside(shape, depth, flange, lip, t, ri, mesh, E, nu):
    nr = 2 if ri > 0 else 0
    nd = 2 if lip > 0 else 0
    return template(shape, depth, flange, flange, lip, lip, ri, ri, ri, ri, 90.0, 90.0, t,
                    max(mesh, 2), max(mesh // 2, 2), max(mesh // 2, 2), nd, nd, nr, nr, nr, nr,
                    centerline=False, E=E, nu=nu)


def lipped_c(depth, flange, lip, t, ri=0.0, mesh=12, E=203000.0, nu=0.3):
    """A lipped channel from outside dimensions and inside radius."""
    return _outside("C", depth, flange, lip, t, ri, mesh, E, nu)


def lipped_z(depth, flange, lip, t, ri=0.0, mesh=12, E=203000.0, nu=0.3):
    """A lipped Z from outside dimensions and inside radius."""
    return _outside("Z", depth, flange, lip, t, ri, mesh, E, nu)


def plain_c(depth, flange, t, ri=0.0, mesh=12, E=203000.0, nu=0.3):
    """A plain (unlipped) channel from outside dimensions and inside radius."""
    return _outside("C", depth, flange, 0.0, t, ri, mesh, E, nu)


def __getattr__(name):
    # cufsm_rs.plot is imported on first use, as the package does (here it draws in the console)
    if name == "plot":
        import sys
        __import__("cufsm_rs.plot")
        return sys.modules["cufsm_rs.plot"]
    raise AttributeError("module 'cufsm_rs' has no attribute " + repr(name))
