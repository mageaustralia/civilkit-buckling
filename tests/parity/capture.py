import array as _parity_array
import json as _parity_json


def _parity_plain(x):
    # numbers as their doubles' 32-bit halves (exact on CPython, Pyodide and MicroPython alike);
    # numpy arrays and scalars, and the lite layer's Array, by tolist(); result objects by as_dict()
    if hasattr(x, "tolist"):
        return _parity_plain(x.tolist())
    if hasattr(x, "as_dict"):
        return _parity_plain(x.as_dict())
    if isinstance(x, dict):
        return {str(k): _parity_plain(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_parity_plain(v) for v in x]
    if x is None or isinstance(x, (bool, str)):
        return x
    if isinstance(x, int):
        return x
    if isinstance(x, float):
        return {"$f": list(_parity_array.array("I", bytes(_parity_array.array("d", [x]))))}
    raise TypeError("cannot capture a " + type(x).__name__)


def _parity_capture(exprs, g):
    return _parity_json.dumps({e: _parity_plain(eval(e, g)) for e in exprs})
