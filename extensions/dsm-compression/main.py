# DSM compression: the Direct Strength Method column strength Pn = min(Pne, Pnl, Pnd) from the
# engine's signature curve and first yield. Every number comes from a capability or an input;
# this file holds only the DSM equations, each cited where it is used.
#
# Units are the app's: N, mm, MPa. Forces are reported in kN.
import json, math, civilkit

CODES = {
    "AISI S100-16": {
        "std": "AISI S100", "year": "2016", "P": "P",
        "global": "§E2", "local": "§E3", "dist": "§E4",
        "old": "S100-04 App. 1 Eq. 1.2.1-",
    },
    "AS/NZS 4600:2018": {
        "std": "AS/NZS 4600", "year": "2018", "P": "N",
        "global": "7.2.1.2", "local": "7.2.1.3", "dist": "7.2.1.4",
        "old": None,
    },
}
KINDS = ["G", "D", "L", "O"]
LAST = {"curve": [], "minima": []}      # the last run's curve, drawn by build_ui


def num(inputs, key, default):
    v = inputs.get(key)
    if v is None or v == "":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        raise ValueError("%s must be a number, not %r" % (key, v))


def sig(v):
    # five significant figures, for display; the 0.1 % worked-example tolerance is far coarser
    return float("%.5g" % v) if v else v


def kn(v):
    return sig(v / 1000.0)


def call(name, arg=None):
    f = getattr(civilkit, name)
    return json.loads(f(json.dumps(arg)) if arg is not None else f())


def logspace(a, b, n):
    la, lb = math.log10(a), math.log10(b)
    return [10 ** (la + (lb - la) * k / (n - 1)) for k in range(n)]


def lengths_for(model, le):
    ls = list((model.get("analysis") or {}).get("lengths") or [])
    if len(ls) < 2:
        # CUFSM's own default (templatecalc.m): 50 lengths from big/10 to 1000 big, big = the
        # section's largest dimension
        xs = [n["x"] for n in model["nodes"]]
        zs = [n["z"] for n in model["nodes"]]
        big = max(max(xs) - min(xs), max(zs) - min(zs))
        ls = logspace(big / 10, big * 1000, 50)
    if le > 0:
        ls.append(le)
    return sorted(set(ls))


def pick(minima, k, what):
    if k < 1:
        return None
    k = int(k)
    if k > len(minima):
        raise ValueError("%s minimum %d asked for, but the curve has %d minima" % (what, k, len(minima)))
    return minima[k - 1]


def check(inputs):
    code = inputs.get("code") or "AISI S100-16"
    C = CODES.get(code) or CODES["AISI S100-16"]
    P = C["P"]

    def line(clause, label, eq, old=None):
        if C["old"] and old:
            clause = "%s (%s%s)" % (clause, C["old"], old)
        return {"standard": C["std"], "year": C["year"], "clause": clause, "label": label, "eq": eq}

    model = call("getModel")
    if not model.get("nodes"):
        raise ValueError("There is no model to check.")
    fy = num(inputs, "fy", model.get("fy") or 0)
    if not fy > 0:
        raise ValueError("Enter fy (MPa): the model has none.")
    le = num(inputs, "Le", 0)
    fcre = num(inputs, "Fcre", 0)
    rl_in = num(inputs, "pcrl_py", 0)
    rd_in = num(inputs, "pcrd_py", 0)

    y = call("firstYield", {"fy": fy})
    Py = y["Py"]
    A = Py / fy
    lines = [line("", "Squash load (first yield, from the engine)",
                  "%sy = A fy = %.6g mm² × %.6g MPa = %.6g kN" % (P, A, fy, Py / 1000))]
    rows = [{"label": "Py", "value": kn(Py), "unit": "kN"}]

    # The signature curve, with the reference stress uniform compression at Py, so a load factor
    # is Pcr / Py. Run only when something is read off it.
    need = rl_in <= 0 or rd_in <= 0 or (fcre <= 0 and le > 0)
    minima, curve, local, dist = [], [], None, None
    if need:
        st = call("stress", {"P": Py})["stress"]
        ref = dict(model)
        ref["nodes"] = [dict(n, stress=s) for n, s in zip(model["nodes"], st)]
        s = call("signature", {"model": ref, "bc": "S-S", "terms": 1, "lengths": lengths_for(model, le if fcre <= 0 else 0)})
        curve = s["curve"]
        for mn in s["minima"]:
            md = call("modes", {"model": ref, "bc": "S-S", "terms": 1, "length": mn["length"], "n": 1})["modes"][0]
            mn["cls"] = md["cls"]
            mn["kind"] = KINDS[md["cls"].index(max(md["cls"]))]
            minima.append(mn)
        # Local is the shortest-wavelength minimum and distortional the next, skipping minima
        # cFSM calls mostly global (G above 50 %); or the minima the user picked.
        cand = [mn for mn in minima if mn["cls"][0] < 50]
        local = pick(minima, num(inputs, "local_pick", 0), "The local") or (cand[0] if cand else None)
        dist = pick(minima, num(inputs, "dist_pick", 0), "The distortional") or (cand[1] if len(cand) > 1 else None)
        lines.append(line("", "Signature curve (S-S, one term, reference stress fy: λ = Pcr / %sy)" % P,
                          "%d lengths, %d minima: %s" % (len(curve), len(minima), "; ".join(
                              "L = %.5g mm, λ = %.5g (cFSM G %.1f %%, D %.1f %%, L %.1f %%, O %.1f %%)" % (
                                  mn["length"], mn["lf"], mn["cls"][0], mn["cls"][1], mn["cls"][2], mn["cls"][3])
                              for mn in minima))))
    LAST["curve"] = curve
    LAST["minima"] = [{"index": mn["index"], "length": mn["length"], "lf": mn["lf"], "kind": mn["kind"]} for mn in minima]

    # Global: braced, a given Fcre, or the curve at L = Le
    if fcre > 0:
        Pcre = A * fcre
        lines.append(line(C["global"], "Global buckling load (Fcre given)", "%scre = A Fcre = %.6g × %.6g = %.6g kN" % (P, A, fcre, Pcre / 1000)))
    elif le > 0:
        lf = [p[1] for p in curve if abs(p[0] - le) <= 1e-9 * le][0]
        Pcre = lf * Py
        lines.append(line(C["global"], "Global buckling load from the curve at L = Le (valid where the curve there is global)",
                          "%scre = λ(%.6g mm) %sy = %.6g × %.6g = %.6g kN" % (P, le, P, lf, Py / 1000, Pcre / 1000)))
    else:
        Pcre = None
    if Pcre is None:
        Pne = Py
        lines.append(line(C["global"], "Continuously braced (Le = 0): global buckling is prevented", "%sne = %sy = %.6g kN" % (P, P, Pne / 1000)))
    else:
        lc = math.sqrt(Py / Pcre)
        if lc <= 1.5:
            Pne = 0.658 ** (lc * lc) * Py
            eq = "λc = √(%sy/%scre) = %.4f ≤ 1.5: %sne = 0.658^(λc²) %sy = %.6g kN" % (P, P, lc, P, P, Pne / 1000)
        else:
            Pne = 0.877 / (lc * lc) * Py
            eq = "λc = √(%sy/%scre) = %.4f > 1.5: %sne = (0.877/λc²) %sy = %.6g kN" % (P, P, lc, P, P, Pne / 1000)
        lines.append(line(C["global"], "Global (flexural, torsional or flexural-torsional) strength", eq, "1 to 3"))
        rows.append({"label": "Pcre", "value": kn(Pcre), "unit": "kN"})
    rows.append({"label": "Pne", "value": kn(Pne), "unit": "kN"})

    # Local, interacting with global
    if rl_in > 0:
        rl, src = rl_in, "given"
    elif local:
        rl, src = local["lf"], "the curve's minimum at L = %.5g mm" % local["length"]
        rows.append({"label": "Lcrl", "value": sig(local["length"]), "unit": "mm"})
    else:
        rl, src = None, None
    Pnl = None
    if rl:
        Pcrl = rl * Py
        ll = math.sqrt(Pne / Pcrl)
        if ll <= 0.776:
            Pnl = Pne
            eq = "λl = √(%sne/%scrl) = %.4f ≤ 0.776: %snl = %sne = %.6g kN" % (P, P, ll, P, P, Pnl / 1000)
        else:
            r = (Pcrl / Pne) ** 0.4
            Pnl = (1 - 0.15 * r) * r * Pne
            eq = "λl = √(%sne/%scrl) = %.4f > 0.776: %snl = [1 − 0.15 (%scrl/%sne)^0.4] (%scrl/%sne)^0.4 %sne = %.6g kN" % (
                P, P, ll, P, P, P, P, P, P, Pnl / 1000)
        lines.append(line(C["local"], "Local buckling: %scrl/%sy = %.5g (%s), %scrl = %.6g kN" % (P, P, rl, src, P, Pcrl / 1000), eq, "5 to 7"))
        rows += [{"label": "Pcrl/Py", "value": sig(rl)}, {"label": "Pcrl", "value": kn(Pcrl), "unit": "kN"},
                 {"label": "Pnl", "value": kn(Pnl), "unit": "kN"}]
    else:
        rows.append({"label": "Pnl", "value": "no local minimum: enter Pcrl/Py", "status": "warn"})

    # Distortional, with yield (not with global)
    if rd_in > 0:
        rd, src = rd_in, "given"
    elif dist:
        rd, src = dist["lf"], "the curve's minimum at L = %.5g mm" % dist["length"]
        rows.append({"label": "Lcrd", "value": sig(dist["length"]), "unit": "mm"})
    else:
        rd, src = None, None
    Pnd = None
    if rd:
        Pcrd = rd * Py
        ld = math.sqrt(Py / Pcrd)
        if ld <= 0.561:
            Pnd = Py
            eq = "λd = √(%sy/%scrd) = %.4f ≤ 0.561: %snd = %sy = %.6g kN" % (P, P, ld, P, P, Pnd / 1000)
        else:
            r = (Pcrd / Py) ** 0.6
            Pnd = (1 - 0.25 * r) * r * Py
            eq = "λd = √(%sy/%scrd) = %.4f > 0.561: %snd = [1 − 0.25 (%scrd/%sy)^0.6] (%scrd/%sy)^0.6 %sy = %.6g kN" % (
                P, P, ld, P, P, P, P, P, P, Pnd / 1000)
        lines.append(line(C["dist"], "Distortional buckling: %scrd/%sy = %.5g (%s), %scrd = %.6g kN" % (P, P, rd, src, P, Pcrd / 1000), eq, "8 to 10"))
        rows += [{"label": "Pcrd/Py", "value": sig(rd)}, {"label": "Pcrd", "value": kn(Pcrd), "unit": "kN"},
                 {"label": "Pnd", "value": kn(Pnd), "unit": "kN"}]
    else:
        rows.append({"label": "Pnd", "value": "no distortional minimum: enter Pcrd/Py", "status": "warn"})

    if Pnl is not None and Pnd is not None:
        Pn = min(Pne, Pnl, Pnd)
        gov = "global" if Pn == Pne and Pne < Py else "yield" if Pn == Py else "local" if Pn == Pnl else "distortional"
        lines.append(line("", "Nominal strength", "%sn = min(%sne, %snl, %snd) = %.6g kN (%s governs)" % (P, P, P, P, Pn / 1000, gov)))
        lines.append(line("", "Design strength: φc = 0.85 for a pre-qualified column (DSM Design Guide 8.1-4; check the section qualifies)",
                          "φc %sn = 0.85 × %.6g = %.6g kN" % (P, Pn / 1000, 0.85 * Pn / 1000)))
        rows += [{"label": "Pn", "value": kn(Pn), "unit": "kN", "status": "ok"},
                 {"label": "φcPn", "value": kn(0.85 * Pn), "unit": "kN"},
                 {"label": "Governs", "value": gov}]
    return {"result": rows, "calcLines": lines}


def build_ui(inputs, result, calcLines):
    g = inputs.get
    kids = [
        {"type": "text", "value": "Direct Strength Method column strength from this section's signature curve. "
                                  "Units: N, mm, MPa; forces in kN. Leave a buckling input at 0 to read it off the curve."},
        {"type": "section", "title": "Member", "children": [
            {"type": "field", "id": "code", "label": "Code", "inputType": "enum",
             "options": list(CODES.keys()), "default": g("code", "AISI S100-16")},
            {"type": "field", "id": "fy", "label": "fy (MPa), blank: the analysis's", "inputType": "number", "default": g("fy", "")},
            {"type": "field", "id": "Le", "label": "Le (mm), 0: continuously braced", "inputType": "number", "default": g("Le", 0)},
        ]},
        {"type": "section", "title": "Elastic buckling (0: from the signature curve)", "collapsed": True, "children": [
            {"type": "field", "id": "Fcre", "label": "Fcre (MPa), e.g. a closed-form strong-axis Fe", "inputType": "number", "default": g("Fcre", 0)},
            {"type": "field", "id": "pcrl_py", "label": "Pcrl / Py", "inputType": "number", "default": g("pcrl_py", 0)},
            {"type": "field", "id": "pcrd_py", "label": "Pcrd / Py", "inputType": "number", "default": g("pcrd_py", 0)},
            {"type": "field", "id": "local_pick", "label": "Local: minimum no. (0: the first)", "inputType": "integer", "default": g("local_pick", 0)},
            {"type": "field", "id": "dist_pick", "label": "Distortional: minimum no. (0: the next)", "inputType": "integer", "default": g("dist_pick", 0)},
        ]},
        {"type": "button", "id": "run", "label": "Run", "action": "run-check"},
    ]
    if result:
        kids.append({"type": "result", "items": result})
    if LAST["curve"]:
        kids.append({"type": "buckling.signature", "title": "Signature curve",
                     "curve": LAST["curve"], "minima": LAST["minima"], "xlabel": "half-wavelength (mm)", "ylabel": "Pcr / Py"})
    if calcLines:
        kids.append({"type": "calc", "lines": calcLines})
    return {"type": "panel", "title": "DSM compression", "children": kids}
