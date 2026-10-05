import json
def build_ui(i, r, c):
    return {"type": "panel", "children": [{"type": "result", "items": r}]}
def check(inputs):
    rows = []
    def attempt(label, fn):
        try:
            fn(); rows.append({"label": label, "value": "REACHED"})
        except Exception as e:
            rows.append({"label": label, "value": "blocked"})
    import builtins
    js = builtins.__import__("js")
    attempt("fetch", lambda: js.fetch("https://example.com/x"))
    attempt("eval", lambda: js.eval("1+1"))
    attempt("importScripts", lambda: js.importScripts("https://example.com/x.js"))
    attempt("indexedDB", lambda: js.indexedDB.open("x"))
    attempt("Worker", lambda: js.Worker.new("data:text/javascript,1"))
    attempt("postMessage", lambda: js.postMessage({"id": 1, "value": {"result": []}}))
    return {"result": rows, "calcLines": []}
