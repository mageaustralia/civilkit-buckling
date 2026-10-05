# Thickness study: how local and distortional buckling of the current section change with the sheet
# thickness, and the thinnest thickness that meets a target. A showcase of what a module can do:
# read the model, call the engine (first yield, stress, signature curve, cFSM mode classes), draw
# log-scale charts and the section, show tables and cited calc lines, and propose a section back to
# the analysis. Every number comes from a capability or an input; this file only orchestrates.
#
# Units are the app's: N, mm, MPa.
import json, math, civilkit

KINDS = ["G", "D", "L", "O"]
LAST = {"study": [], "curves": [], "pick": None, "model": None, "target": None}


def call(name, arg=None):
    f = getattr(civilkit, name)
    return json.loads(f(json.dumps(arg)) if arg is not None else f())


def num(inputs, key, default):
    v = inputs.get(key)
    if v is None or v == "":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        raise ValueError("%s must be a number, not %r" % (key, v))


def sig(v):
    return float("%.4g" % v) if v else v


def logspace(a, b, n):
    la, lb = math.log10(a), math.log10(b)
    return [10 ** (la + (lb - la) * k / (n - 1)) for k in range(n)]


def at_thickness(model, t, tref):
    # every element scaled by t / tref, so a section with one thickness gets exactly t
    m = dict(model)
    m["elems"] = [dict(e, t=e["t"] * t / tref) for e in model["elems"]]
    return m


def buckling(model, fy, lengths):
    # Py from the engine; reference stress uniform compression at Py, so a load factor is Pcr / Py
    Py = call("firstYield", {"model": model, "fy": fy})["Py"]
    st = call("stress", {"model": model, "P": Py})["stress"]
    ref = dict(model)
    ref["nodes"] = [dict(n, stress=s) for n, s in zip(model["nodes"], st)]
    s = call("signature", {"model": ref, "bc": "S-S", "terms": 1, "lengths": lengths})
    minima = []
    for mn in s["minima"]:
        md = call("modes", {"model": ref, "bc": "S-S", "terms": 1, "length": mn["length"], "n": 1})["modes"][0]
        mn["cls"] = md["cls"]
        mn["kind"] = KINDS[md["cls"].index(max(md["cls"]))]
        minima.append(mn)
    # local: the shortest-wavelength minimum cFSM does not call mostly global; distortional: the next
    cand = [mn for mn in minima if mn["cls"][0] < 50]
    local = cand[0] if cand else None
    dist = cand[1] if len(cand) > 1 else None
    return {"Py": Py, "A": Py / fy, "curve": s["curve"], "minima": minima, "local": local, "dist": dist, "ref": ref}


def check(inputs):
    model = call("getModel")
    if not model.get("nodes"):
        raise ValueError("There is no model to study.")
    fy = num(inputs, "fy", model.get("fy") or 0)
    if not fy > 0:
        raise ValueError("Enter fy (MPa): the model has none.")
    tref = max(e["t"] for e in model["elems"])
    t0, t1 = num(inputs, "t_min", round(tref * 0.5, 3)), num(inputs, "t_max", round(tref * 3, 3))
    n = int(num(inputs, "steps", 7))
    target = num(inputs, "target", 0.5)
    if not (0 < t0 < t1):
        raise ValueError("t min must be positive and below t max.")
    if not 2 <= n <= 15:
        raise ValueError("Steps must be 2 to 15 (each is a full signature curve).")
    xs = [nd["x"] for nd in model["nodes"]]
    zs = [nd["z"] for nd in model["nodes"]]
    big = max(max(xs) - min(xs), max(zs) - min(zs))
    lengths = logspace(big / 10, big * 100, 40)

    ts = [t0 + (t1 - t0) * k / (n - 1) for k in range(n)]
    study, curves = [], []
    for t in ts:
        b = buckling(at_thickness(model, t, tref), fy, lengths)
        rl = b["local"]["lf"] if b["local"] else None
        rd = b["dist"]["lf"] if b["dist"] else None
        worst = min(v for v in (rl, rd) if v is not None) if (rl or rd) else None
        study.append({"t": t, "A": b["A"], "Py": b["Py"], "rl": rl, "rd": rd, "worst": worst,
                      "Ll": b["local"]["length"] if b["local"] else None,
                      "Ld": b["dist"]["length"] if b["dist"] else None})
        curves.append((t, b["curve"]))

    ok = [r for r in study if r["worst"] is not None and r["worst"] >= target]
    pick = ok[0] if ok else None
    LAST.update(study=study, target=target, pick=pick,
                curves=[c for i, c in enumerate(curves) if i in (0, n // 2, n - 1)])

    lines = [
        {"label": "Method", "eq": "For each t: Py = A fy from the engine's first yield; the reference stress is "
                                  "uniform compression at Py, so each signature-curve load factor is Pcr / Py. "
                                  "Local = the shortest-wavelength minimum cFSM does not class as mostly global; "
                                  "distortional = the next. %d thicknesses, %d half-wavelengths each, S-S, one term." % (n, len(lengths))},
        {"label": "Target", "eq": "the smaller of Pcrl/Py and Pcrd/Py at least %.4g. For reference, the Direct "
                                  "Strength Method gives no local reduction when Pcrl/Py ≥ 1/0.776² = 1.661 and no "
                                  "distortional reduction when Pcrd/Py ≥ 1/0.561² = 3.177" % target,
         "standard": "AISI S100", "year": "2016", "clause": "§E3.2, §E4.2"},
    ]
    no_d = [r["t"] for r in study if r["rd"] is None]
    if no_d:
        lines.append({"label": "Where the curve has no distortional minimum",
                      "eq": "at t = %s mm the signature curve shows no distinct distortional minimum (local and "
                            "global meet), so the target there is checked on local buckling alone; a distortional "
                            "load would need constrained FSM (the cFSM tab) or a general boundary condition solve" % (
                                ", ".join("%.3g" % t for t in no_d))})
    rows = [{"label": "Thicknesses studied", "value": "%d, %.4g to %.4g mm" % (n, t0, t1)},
            {"label": "Area at t min", "value": sig(study[0]["A"]), "unit": "mm²"},
            {"label": "Py at t max", "value": sig(study[-1]["Py"] / 1000), "unit": "kN"}]
    if pick:
        cur = [r for r in study if abs(r["t"] - tref) < 1e-9]
        lines.append({"label": "Thinnest that meets the target",
                      "eq": "t = %.4g mm: Pcrl/Py = %s, Pcrd/Py = %s, A = %.5g mm², Py = %.5g kN" % (
                          pick["t"], "%.4g" % pick["rl"] if pick["rl"] else "n/a", "%.4g" % pick["rd"] if pick["rd"] else "n/a",
                          pick["A"], pick["Py"] / 1000)})
        rows += [{"label": "Thinnest meeting the target", "value": sig(pick["t"]), "unit": "mm", "status": "ok"},
                 {"label": "Its area", "value": sig(pick["A"]), "unit": "mm²"},
                 {"label": "Area vs now (t = %.4g mm)" % tref, "value": "%+.1f %%" % (100 * (pick["t"] / tref - 1))}]
        m = at_thickness(model, pick["t"], tref)
        LAST["model"] = buckling(m, fy, [lengths[0], lengths[-1]])["ref"]   # the picked section, stressed at its Py
        if inputs.get("offer"):
            civilkit.proposeModel(json.dumps(m))
    else:
        LAST["model"] = None
        rows.append({"label": "Thinnest meeting the target", "value": "none in this range: raise t max or lower the target", "status": "warn"})
    return {"result": rows, "calcLines": lines}


def build_ui(inputs, result, calcLines):
    g = inputs.get
    kids = [
        {"type": "text", "value": "How local and distortional buckling of this section change with the sheet thickness, "
                                  "and the thinnest thickness that meets a target. Every value is a full engine solve; "
                                  "units N, mm, MPa."},
        {"type": "section", "title": "Study", "children": [
            {"type": "row", "cols": 2, "children": [
                {"type": "field", "id": "t_min", "label": "t min (mm), blank: half of now", "inputType": "number", "default": g("t_min", "")},
                {"type": "field", "id": "t_max", "label": "t max (mm), blank: three times now", "inputType": "number", "default": g("t_max", "")},
            ]},
            {"type": "row", "cols": 2, "children": [
                {"type": "field", "id": "steps", "label": "Steps", "inputType": "integer", "default": g("steps", 7), "min": 2, "max": 15},
                {"type": "field", "id": "target", "label": "Target: min(Pcrl, Pcrd) / Py", "inputType": "number", "default": g("target", 0.5)},
            ]},
            {"type": "field", "id": "fy", "label": "fy (MPa), blank: the analysis's", "inputType": "number", "default": g("fy", "")},
            {"type": "field", "id": "offer", "label": "Offer the thinnest passing section to the analysis", "inputType": "boolean", "default": g("offer", False)},
        ]},
        {"type": "button", "id": "run", "label": "Run the study", "action": "run-check"},
    ]
    if result:
        kids.append({"type": "result", "items": result})
    st = LAST["study"]
    if st:
        series = [
            {"label": "Pcrl / Py (local)", "points": [{"x": r["t"], "y": r["rl"]} for r in st if r["rl"]]},
            {"label": "Pcrd / Py (distortional)", "points": [{"x": r["t"], "y": r["rd"]} for r in st if r["rd"]]},
        ]
        ann = [{"x": st[0]["t"], "y": LAST["target"], "label": "target %.3g" % LAST["target"]}]
        if LAST["pick"]:
            ann.append({"x": LAST["pick"]["t"], "y": LAST["pick"]["worst"], "label": "t = %.3g mm" % LAST["pick"]["t"]})
        trend = {"type": "chart", "chart": "line", "title": "Buckling vs thickness", "xLabel": "t (mm)", "yLabel": "Pcr / Py",
                 "yScale": "log", "markers": True, "legend": True, "grid": True, "ticks": True, "hover": True,
                 "threshold": LAST["target"], "thresholdLabel": "target", "series": series, "annotations": ann}
        sigs = {"type": "chart", "chart": "line", "title": "Signature curves: thinnest, middle, thickest",
                "xLabel": "half-wavelength (mm)", "yLabel": "Pcr / Py", "xScale": "log", "yScale": "log",
                "legend": True, "grid": True, "ticks": True, "hover": True,
                "series": [{"label": "t = %.3g mm" % t, "points": [{"x": p[0], "y": p[1]} for p in c if p[1] > 0]}
                           for t, c in LAST["curves"]]}
        table = {"type": "table", "columns": [
                    {"key": "t", "label": "t (mm)"}, {"key": "A", "label": "A (mm²)"}, {"key": "Py", "label": "Py (kN)"},
                    {"key": "Ll", "label": "Lcrl (mm)"}, {"key": "rl", "label": "Pcrl/Py"},
                    {"key": "Ld", "label": "Lcrd (mm)"}, {"key": "rd", "label": "Pcrd/Py"}, {"key": "ok", "label": ""}],
                 "rows": [{"t": sig(r["t"]), "A": sig(r["A"]), "Py": sig(r["Py"] / 1000),
                           "Ll": sig(r["Ll"]) if r["Ll"] else "-", "rl": sig(r["rl"]) if r["rl"] else "-",
                           "Ld": sig(r["Ld"]) if r["Ld"] else "-", "rd": sig(r["rd"]) if r["rd"] else "-",
                           "ok": "meets" if r["worst"] is not None and r["worst"] >= LAST["target"] else ""} for r in st]}
        views = [{"type": "tab", "label": "Charts", "children": [trend, sigs]},
                 {"type": "tab", "label": "Table", "children": [table]}]
        if LAST["model"]:
            views.append({"type": "tab", "label": "The thinnest passing section",
                          "children": [{"type": "buckling.section", "title": "t = %.4g mm, stressed at its Py" % LAST["pick"]["t"],
                                        "model": LAST["model"], "stress": True}]})
        kids.append({"type": "tabs", "children": views})
    if calcLines:
        kids.append({"type": "calc", "lines": calcLines})
    return {"type": "panel", "title": "Thickness study", "children": kids}
