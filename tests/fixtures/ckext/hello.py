import json, civilkit

def build_ui(inputs, result, calcLines):
    return {"type": "panel", "title": "Hello", "children": [
        {"type": "field", "id": "fy", "label": "fy (MPa)", "inputType": "number", "default": inputs.get("fy", 450)},
        {"type": "button", "id": "run", "label": "Run", "action": "run-check"},
        {"type": "result", "items": result},
    ]}

def check(inputs):
    y = json.loads(civilkit.firstYield(json.dumps({"fy": inputs.get("fy", 450)})))
    return {"result": [{"label": "Py", "value": y["Py"], "unit": "N"}], "calcLines": []}
