"""Runs tests/fixtures/pyparity/cases.json on CPython with the pinned cufsm-rs-py and writes
expected.json next to it: the reference the page's transport and its MicroPython lite layer are
tested against (tests/py-transport.test.mjs, tests/py-lite.test.mjs).

    python3.12 -m venv tools/pyparity/.venv
    tools/pyparity/.venv/bin/pip install cufsm-rs-py==0.1.0
    node tools/pyparity/cases.mjs && tools/pyparity/.venv/bin/python tools/pyparity/gen.py

Operations call the package's native module (cufsm_rs._native, the .pyi's 8 functions) directly;
scripts run whole, as a user would run them, and the listed expressions are captured. Floats are
written with Python's repr (exact); NaN and infinities as the strings "NaN", "Infinity",
"-Infinity". The ".venv" directory is git-ignored.
"""

import contextlib
import io
import json
import math
import os
import sys
from importlib.metadata import version

import numpy as np

import cufsm_rs
from cufsm_rs import _native

PIN = "0.1.0"
HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "..", "..", "tests", "fixtures", "pyparity")


def plain(x):
    if isinstance(x, np.ndarray):
        return plain(x.tolist())
    if isinstance(x, (list, tuple)):
        return [plain(v) for v in x]
    if isinstance(x, dict):
        return {str(k): plain(v) for k, v in x.items()}
    if isinstance(x, (bool, np.bool_)):
        return bool(x)
    if isinstance(x, (int, np.integer)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        f = float(x)
        return f if math.isfinite(f) else ("NaN" if math.isnan(f) else ("Infinity" if f > 0 else "-Infinity"))
    if isinstance(x, str):
        return x
    if hasattr(x, "as_dict"):
        return plain(x.as_dict())
    raise TypeError(f"cannot capture a {type(x).__name__}")


def unmark(x):
    if isinstance(x, list):
        return [unmark(v) for v in x]
    if isinstance(x, dict):
        return {k: unmark(v) for k, v in x.items()}
    if x in ("NaN", "Infinity", "-Infinity"):
        return float(x.replace("Infinity", "inf").replace("NaN", "nan"))
    return x


def arrays_of(case, models):
    if case.get("arrays") is not None:
        return tuple(unmark(case["arrays"]))
    m = models[case["model"]]
    return (m["prop"], m["node"], m["elem"], m["constraints"], m["springs"])


def run_op(case, models, done):
    args = dict(unmark(case["args"]))
    if case["op"] == "template":
        return getattr(_native, "template")(**args)
    arrays = arrays_of(case, models)
    if case["op"] == "classify" and "from" in case:
        args["results"] = done[case["from"]]
    elif case["op"] == "classify":
        args["results"] = [tuple(r) for r in args["results"]]  # the .pyi's rows are tuples
    return getattr(_native, case["op"])(arrays, **args)


def main():
    if version("cufsm-rs-py") != PIN:
        sys.exit(f"cufsm-rs-py {version('cufsm-rs-py')} is installed; the fixtures pin {PIN}")
    with open(os.path.join(FIX, "cases.json")) as f:
        cases = json.load(f)
    models = cases["models"]
    ops, done = {}, {}
    for c in cases["ops"]:
        try:
            v = run_op(c, models, done)
            done[c["id"]] = v
            ops[c["id"]] = {"value": plain(v)}
        except Exception as e:  # noqa: BLE001 - for an error case the error is the expectation
            if not c.get("error") and not c.get("either"):
                raise RuntimeError(f"{c['id']}: {e}") from e
            ops[c["id"]] = {"error": {"type": type(e).__name__, "message": str(e)}}
        if c.get("error") and "error" not in ops[c["id"]]:
            sys.exit(f"{c['id']}: expected an error, got a value")
    scripts = {}
    for s in cases["scripts"]:
        g = {"__name__": "__main__"}
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            exec(compile(s["source"], s["id"], "exec"), g)
        caps = {expr: plain(eval(expr, g)) for expr in s["captures"]}
        exec(s.get("setup", ""), g)
        errors = {}
        for stmt in s.get("errors", []):
            try:
                exec(stmt, g)
            except Exception as e:  # noqa: BLE001 - the error is the expectation
                errors[stmt] = {"type": type(e).__name__, "message": str(e)}
            else:
                sys.exit(f"{s['id']}: {stmt} did not raise")
        for stmt in s.get("numpy", []):
            exec(stmt, g)  # numpy answers it
        scripts[s["id"]] = {"captures": caps, "stdout": buf.getvalue(), "errors": errors}
    out = {"generator": "tools/pyparity/gen.py", "cufsm_rs_py": version("cufsm-rs-py"),
           "numpy": np.__version__, "python": sys.version.split()[0], "ops": ops, "scripts": scripts}
    with open(os.path.join(FIX, "expected.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"), allow_nan=False)
        f.write("\n")
    print(f"{len(ops)} operations, {len(scripts)} scripts on cufsm-rs-py {out['cufsm_rs_py']}")


if __name__ == "__main__":
    main()
