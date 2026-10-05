"""cufsm_rs._native for the console's full runtime (Pyodide): the 8 functions of cufsm-rs-py's
compiled module (python/cufsm_rs/_native.pyi in that package), over the page's engine.

The console installs the published package's own Python layer unchanged (cufsm_rs/__init__.py,
_display.py and plot.py at the pinned tag, py/cufsm-rs-py/) and this file in place of its
compiled _native, so every class, repr, numpy array and matplotlib plot is the package's. The
numbers come from the same cufsm.wasm the page runs, through the same transport the MicroPython
lite layer uses (js/py/transport.js: call(op, json) -> json), registered by the console as the JS
module _cufsm_native.

Only strings cross the JS bridge: the arguments go as JSON with every float packed bit for bit
(each double as its two little-endian 32-bit halves, {"$f64": [...]} for a list and {"$f": [lo,
hi]} for one number, the transport's format), and the reply comes back the same way. So a double
crosses exactly, NaN and infinities included, and the reply's numbers are Python floats whatever
their value (a JS number handed over the bridge would arrive as an int when it is whole).

Nothing here does mechanics: it converts arguments and replies, and raises the transport's errors
as the package's types (ValueError, MechanismError, MemoryError, RuntimeError where the package
raises PanicException).
"""

import array
import json
import operator

import _cufsm_native


class MechanismError(ValueError):
    """The elastic stiffness is not positive definite: the section has a mechanism at this length."""


def _halves(nums):
    return array.array("I", array.array("d", nums).tobytes()).tolist()


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _pack(v):
    # numpy scalars and anything else with __index__ / __float__ become plain numbers first
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return {"$f": _halves([v])}
    if isinstance(v, dict):
        return {str(k): _pack(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        if v and all(_is_num(x) for x in v):
            return {"$f64": _halves([float(x) for x in v])}
        return [_pack(x) for x in v]
    if hasattr(v, "tolist"):
        return _pack(v.tolist())
    if hasattr(v, "__index__"):
        return operator.index(v)
    if hasattr(v, "__float__"):
        return _pack(float(v))
    raise TypeError("cannot send a " + type(v).__name__ + " to the engine")


def _unpack(v):
    if isinstance(v, list):
        return [_unpack(x) for x in v]
    if isinstance(v, dict):
        if "$f64" in v:
            return array.array("d", array.array("I", v["$f64"]).tobytes()).tolist()
        if "$f" in v:
            return array.array("d", array.array("I", v["$f"]).tobytes())[0]
        return {k: _unpack(x) for k, x in v.items()}
    return v


_ERRORS = {"ValueError": ValueError, "MechanismError": MechanismError, "TypeError": TypeError,
           "MemoryError": MemoryError, "RuntimeError": RuntimeError, "NotImplementedError": NotImplementedError}


def _call(op, **args):
    r = json.loads(_cufsm_native.call(op, json.dumps(_pack(args))))
    if "error" in r:
        e = r["error"]
        raise _ERRORS.get(e["type"], ValueError)(e["message"])
    return _unpack(r["ok"])


def _tuples(rows):
    # the .pyi's rows are tuples (length, m_terms, lfs, modes)
    return [tuple(r) for r in rows]


def section_properties(arrays):
    return _call("section_properties", arrays=list(arrays))


def stress(arrays, p, mxx, mzz, m11, m22, b, unsymmetric):
    return _call("stress", arrays=list(arrays), p=float(p), mxx=float(mxx), mzz=float(mzz), m11=float(m11),
                 m22=float(m22), b=float(b), unsymmetric=bool(unsymmetric))


def first_yield(arrays, fy, unsymmetric, extreme_fibre):
    return _call("first_yield", arrays=list(arrays), fy=float(fy), unsymmetric=bool(unsymmetric),
                 extreme_fibre=bool(extreme_fibre))


def stress_to_action(arrays):
    return _call("stress_to_action", arrays=list(arrays))


def strip(arrays, lengths, m_all, bc, neigs, spaces=None):
    return _tuples(_call("strip", arrays=list(arrays), lengths=lengths, m_all=m_all, bc=bc, neigs=neigs, spaces=spaces))


def signature(arrays, lengths, neigs):
    rows, minima = _call("signature", arrays=list(arrays), lengths=lengths, neigs=neigs)
    return _tuples(rows), [tuple(m) for m in minima]


def classify(arrays, results, bc, orth, norm, ospace):
    out = _call("classify", arrays=list(arrays), results=[list(r) for r in results], bc=bc, orth=orth, norm=norm,
                ospace=ospace)
    return [[tuple(c) for c in per] for per in out]


def template(shape, h, b1, b2, d1, d2, r1, r2, r3, r4, q1, q2, t, nh, nb1, nb2, nd1, nd2, nr1, nr2, nr3, nr4,
             centerline):
    node, elem = _call("template", shape=shape, h=h, b1=b1, b2=b2, d1=d1, d2=d2, r1=r1, r2=r2, r3=r3, r4=r4,
                       q1=q1, q2=q2, t=t, nh=nh, nb1=nb1, nb2=nb2, nd1=nd1, nd2=nd2, nr1=nr1, nr2=nr2, nr3=nr3,
                       nr4=nr4, centerline=bool(centerline))
    return node, elem
