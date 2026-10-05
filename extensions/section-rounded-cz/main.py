# A lipped (or plain) C or Z section with rounded corners, built node by node the way CUFSM's
# template does (helpers/templatecalc.m, with template_out_to_in.m for outside dimensions), its
# properties from the engine, and proposed to the analysis for the user to accept.
#
# Units: N, mm, MPa. The geometry is this file's; every property comes from sectionProps.
import json, math, civilkit

LAST = {"model": None}


def num(inputs, key, default):
    v = inputs.get(key)
    if v is None or v == "":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        raise ValueError("%s must be a number, not %r" % (key, v))


def sig(v):
    return float("%.6g" % v) if v else v


def out_to_in(H, B1, D1, B2, D2, ri, t):
    # template_out_to_in.m for 90 degree lips: outside dimensions and inside radius to the
    # centreline flats and centreline radius the template takes (tan(q/2) = 1)
    r = ri + t / 2 if ri != 0 else 0
    h = H - t / 2 - r - r - t / 2
    if D1 == 0:
        b1, d1 = B1 - r - t / 2, 0
    else:
        b1, d1 = B1 - r - t / 2 - (r + t / 2), D1 - (r + t / 2)
    if D2 == 0:
        b2, d2 = B2 - r - t / 2, 0
    else:
        b2, d2 = B2 - r - t / 2 - (r + t / 2), D2 - (r + t / 2)
    return h, b1, d1, b2, d2, r


def template(cz, h, b1, b2, d1, d2, r, nh, nb, nd, nr):
    # templatecalc.m, q1 = q2 = 90 degrees and one radius for all four corners. Returns the node
    # coordinates in order around the section, starting at the tip of lip 1.
    q = math.pi / 2
    lipped = not (d1 == 0 and d2 == 0)
    if r == 0:
        if not lipped:
            geom = [(b1, 0), (0, 0), (0, h), (cz * b2, h)]
            n = [nb, nh, nb]
        else:
            geom = [(b1 + d1 * math.cos(q), d1 * math.sin(q)), (b1, 0), (0, 0), (0, h), (cz * b2, h),
                    (cz * (b2 + d2 * math.cos(q)), h - d2 * math.sin(q))]
            n = [nd, nb, nh, nb, nd]
    else:
        if not lipped:
            geom = [(r + b1, 0), (r, 0), (0, r), (0, r + h), (cz * r, r + h + r), (cz * (r + b2), r + h + r)]
            n = [nb, nr, nh, nr, nb]
        else:
            geom = [(r + b1 + r * math.cos(math.pi / 2 - q) + d1 * math.cos(q), r - r * math.sin(math.pi / 2 - q) + d1 * math.sin(q)),
                    (r + b1 + r * math.cos(math.pi / 2 - q), r - r * math.sin(math.pi / 2 - q)),
                    (r + b1, 0), (r, 0), (0, r), (0, r + h), (cz * r, r + h + r), (cz * (r + b2), r + h + r),
                    (cz * (r + b2 + r * math.cos(math.pi / 2 - q)), r + h + r - r + r * math.sin(math.pi / 2 - q)),
                    (cz * (r + b2 + r * math.cos(math.pi / 2 - q) + d2 * math.cos(q)), r + h + r - r + r * math.sin(math.pi / 2 - q) - d2 * math.sin(q))]
            n = [nd, nr, nb, nr, nh, nr, nb, nr, nd]
    straight = [1, 3, 5] if (r != 0 and not lipped) else [1, 3, 5, 7, 9]
    pts = []
    for i in range(1, len(geom)):
        (x0, z0), (x1, z1) = geom[i - 1], geom[i]
        pts.append((x0, z0))
        k = n[i - 1]
        if r == 0 or i in straight:
            for j in range(1, k):
                pts.append((x0 + (x1 - x0) * j / k, z0 + (z1 - z0) * j / k))
            continue
        for j in range(1, k):                      # a corner: points on the arc
            if not lipped:
                if i == 2:
                    xc, zc, q0, dq = r, r, math.pi / 2, math.pi / 2 * j / k
                else:                              # i == 4
                    xc, zc, q0, dq = cz * r, r + h, (math.pi if cz == 1 else 0), cz * math.pi / 2 * j / k
            elif i == 2:
                xc, zc, q0, dq = r + b1, r, math.pi / 2 - q, q * j / k
            elif i == 4:
                xc, zc, q0, dq = r, r, math.pi / 2, math.pi / 2 * j / k
            elif i == 6:
                xc, zc, q0, dq = cz * r, r + h, (math.pi if cz == 1 else 0), cz * math.pi / 2 * j / k
            else:                                  # i == 8
                xc, zc, q0, dq = cz * (r + b2), r + h + r - r, 3 * math.pi / 2, cz * q * j / k
            pts.append((xc + r * math.cos(q0 + dq), zc - r * math.sin(q0 + dq)))
    pts.append(geom[-1])
    return pts


def build(inputs):
    g = lambda k, d: num(inputs, k, d)
    shape = inputs.get("shape") or "C"
    dims = inputs.get("dims") or "centreline"
    h, b1, b2, d1, d2, r, t = g("h", 200), g("b1", 75), g("b2", 75), g("d1", 20), g("d2", 20), g("r", 3), g("t", 1.5)
    nh, nb, nd, nr = int(g("nh", 6)), int(g("nb", 3)), int(g("nd", 2)), int(g("nr", 2))
    E, nu = g("E", 203000), g("nu", 0.3)
    if not (t > 0 and h > 0 and b1 > 0 and b2 > 0 and min(d1, d2, r) >= 0):
        raise ValueError("h, b1, b2 and t must be above zero, and d1, d2 and r at least zero")
    if min(nh, nb) < 1 or (min(d1, d2) > 0 and nd < 1) or (r > 0 and nr < 1):
        raise ValueError("Each flat and corner needs at least one element")
    if (d1 == 0) != (d2 == 0):
        raise ValueError("Give both lips, or neither (the template makes a lipped or a plain section)")
    if dims == "outside":
        h, b1, d1, b2, d2, r = out_to_in(h, b1, d1, b2, d2, r, t)
        if min(h, b1, b2) <= 0 or min(d1, d2) < 0:
            raise ValueError("The outside dimensions are too small for this thickness and radius")
    pts = template(-1 if shape == "Z" else 1, h, b1, b2, d1, d2, r, nh, nb, nd, nr)
    g_ = E / (2 * (1 + nu))
    return {
        "mats": [{"id": 100, "ex": E, "ey": E, "vx": nu, "vy": nu, "g": g_}],
        "nodes": [{"x": x, "z": z, "free": [1, 1, 1, 1], "stress": 1.0} for x, z in pts],
        "elems": [{"i": k, "j": k + 1, "t": t, "mat": 100} for k in range(len(pts) - 1)],
        "springs": [], "constraints": [],
    }


def check(inputs):
    m = build(inputs)
    LAST["model"] = m
    p = json.loads(civilkit.sectionProps(json.dumps({"model": m})))
    # a symmetric C's product of inertia and principal angle come back as rounding noise: show 0
    if abs(p["Ixz"]) < 1e-9 * max(abs(p["Ixx"]), abs(p["Izz"])):
        p["Ixz"], p["thetap"] = 0.0, 0.0
    size = max(max(abs(n["x"]) for n in m["nodes"]), max(abs(n["z"]) for n in m["nodes"]))
    for k in ("xcg", "zcg"):
        if abs(p[k]) < 1e-9 * size:
            p[k] = 0.0
    rows = [
        {"label": "Nodes", "value": len(m["nodes"])},
        {"label": "A", "value": sig(p["A"]), "unit": "mm²"},
        {"label": "Ixx", "value": sig(p["Ixx"]), "unit": "mm⁴"},
        {"label": "Izz", "value": sig(p["Izz"]), "unit": "mm⁴"},
        {"label": "Ixz", "value": sig(p["Ixz"]), "unit": "mm⁴"},
        {"label": "I11", "value": sig(p["I11"]), "unit": "mm⁴"},
        {"label": "I22", "value": sig(p["I22"]), "unit": "mm⁴"},
        {"label": "θp", "value": sig(p["thetap"]), "unit": "°"},
        {"label": "xcg", "value": sig(p["xcg"]), "unit": "mm"},
        {"label": "zcg", "value": sig(p["zcg"]), "unit": "mm"},
    ]
    if inputs.get("propose", True) not in (False, "false", 0):
        civilkit.proposeModel(json.dumps(m))
    return {"result": rows, "calcLines": []}


def build_ui(inputs, result, calcLines):
    g = inputs.get

    def f(id, label, d, typ="number"):
        return {"type": "field", "id": id, "label": label, "inputType": typ, "default": g(id, d)}

    kids = [
        {"type": "text", "value": "A C or Z section with rounded corners, meshed as CUFSM's template does. "
                                  "Units: mm and MPa. Each run offers the section to the analysis: use it or dismiss it."},
        {"type": "row", "children": [
            {"type": "field", "id": "shape", "label": "Shape", "inputType": "enum", "options": ["C", "Z"], "default": g("shape", "C")},
            {"type": "field", "id": "dims", "label": "Dimensions", "inputType": "enum",
             "options": [{"value": "centreline", "label": "centreline flats, centreline radius"},
                         {"value": "outside", "label": "outside, inside radius"}], "default": g("dims", "centreline")},
        ]},
        {"type": "row", "children": [f("h", "h (mm)", 200), f("t", "t (mm)", 1.5), f("r", "r (mm)", 3)]},
        {"type": "row", "children": [f("b1", "b1 (mm)", 75), f("b2", "b2 (mm)", 75)]},
        {"type": "row", "children": [f("d1", "d1 (mm), 0: no lips", 20), f("d2", "d2 (mm)", 20)]},
        {"type": "section", "title": "Mesh and material", "collapsed": True, "children": [
            {"type": "row", "children": [f("nh", "web elements", 6, "integer"), f("nb", "per flange", 3, "integer"),
                                         f("nd", "per lip", 2, "integer"), f("nr", "per corner", 2, "integer")]},
            {"type": "row", "children": [f("E", "E (MPa)", 203000), f("nu", "ν", 0.3)]},
        ]},
        f("propose", "Offer it to the analysis", True, "boolean"),
        {"type": "button", "id": "run", "label": "Use this section", "action": "run-check"},
    ]
    if result:
        kids.append({"type": "result", "items": result})
    if LAST["model"]:
        kids.append({"type": "buckling.section", "title": "The generated section", "model": LAST["model"]})
    return {"type": "panel", "title": "Rounded C / Z section", "children": kids}
