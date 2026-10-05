"""The Python console's full runtime (Pyodide): runs one script and hands its figures to the page.

js/py/pyodide-runner.js installs this file as _ckb_console beside the cufsm_rs package and calls
run(source) once per script. A run gets fresh globals (__name__ == "__main__"), the script is
compiled as "<stdin>" (so a traceback names the script's own lines, as the MicroPython runner's
do) and its traceback is CPython's, without this module's frame.

matplotlib draws on the console's backend (py/pyodide/mpl_backend.py, MPLBACKEND=
module://_ckb_backend): the Agg canvas, with plt.show() handing every open figure to the page as SVG, in the output where the
script showed it; figures still open when the script ends are handed over then. Each figure goes
with a text alternative read from it (its titles, axis labels and what it holds). Nothing is
drawn by this module: the figures are matplotlib's.
"""

import builtins
import io
import linecache
import os
import sys
import traceback
import warnings

import _ckb_host

os.environ["MPLBACKEND"] = "module://_ckb_backend"
# matplotlib 3.10's mathtext (log-axis tick labels) trips its own deprecation of float sizes in
# FT2Image, once per label; it is matplotlib's internals, not the script's, and 3.11 (pip's today)
# has no such warning, so the console leaves it out of the output
warnings.filterwarnings("ignore", message=r"The (width|height|x|y) parameter as float was deprecated in Matplotlib 3\.10")
FIGURES_MAX = 50


# --- figures ---------------------------------------------------------------------------------

def show(*args, **kwargs):
    """plt.show(): every open figure goes to the output, in order, and is closed."""
    _flush_figures()


_shown = [0]


def _text(t):
    return t.get_text().strip() if t is not None else ""


def _alt(fig):
    """The figure's text alternative: what it shows, read from the figure itself."""
    parts = []
    sup = _text(getattr(fig, "_suptitle", None))
    if sup:
        parts.append(sup)
    axes = [a for a in fig.get_axes() if a.get_visible()]
    for a in axes:
        bits = []
        title = " ".join(t for t in (_text(a.title), a.get_title("left"), a.get_title("right")) if t)
        if title:
            bits.append(title)
        x, y = a.get_xlabel(), a.get_ylabel()
        if x or y:
            bits.append("%s against %s" % (y or "y", x or "x"))
        scales = [s for s in (a.get_xscale(), a.get_yscale()) if s != "linear"]
        if scales:
            bits.append("%s scale" % "/".join(sorted(set(scales))))
        held = []
        if a.lines:
            held.append("%d line%s" % (len(a.lines), "" if len(a.lines) == 1 else "s"))
        if a.collections:
            held.append("%d marker or patch set%s" % (len(a.collections), "" if len(a.collections) == 1 else "s"))
        if a.patches:
            held.append("%d shape%s" % (len(a.patches), "" if len(a.patches) == 1 else "s"))
        if held:
            bits.append(", ".join(held))
        leg = a.get_legend()
        if leg is not None:
            labels = [_text(t) for t in leg.get_texts() if _text(t)]
            if labels:
                bits.append("legend: " + "; ".join(labels[:12]) + ("; ..." if len(labels) > 12 else ""))
        if bits:
            parts.append(", ".join(bits))
    n = len(axes)
    head = "matplotlib figure" + (", %d axes" % n if n > 1 else "")
    return head + (": " + ". ".join(parts) if parts else "") + "."


def _flush_figures():
    if "matplotlib.pyplot" not in sys.modules:
        return
    import matplotlib.pyplot as plt
    for num in plt.get_fignums():
        fig = plt.figure(num)
        sys.stdout.flush()
        if _shown[0] >= FIGURES_MAX:
            plt.close(fig)
            raise RuntimeError("the console shows at most %d figures in one run" % FIGURES_MAX)
        buf = io.StringIO()
        fig.savefig(buf, format="svg", bbox_inches="tight")
        _shown[0] += 1
        _ckb_host.image(buf.getvalue(), _alt(fig))
        plt.close(fig)


# --- one run ---------------------------------------------------------------------------------

def _reset():
    _shown[0] = 0
    if "matplotlib.pyplot" in sys.modules:
        import matplotlib
        import matplotlib.pyplot as plt
        plt.close("all")
        matplotlib.rcdefaults()


def run(source):
    """Runs a script; returns None, or its traceback's text (CPython's, from the script's frame)."""
    _reset()
    linecache.cache["<stdin>"] = (len(source), None, source.splitlines(True), "<stdin>")
    g = {"__name__": "__main__", "__builtins__": builtins}
    err = None
    try:
        exec(compile(source, "<stdin>", "exec"), g)
    except SystemExit as e:
        if e.code not in (None, 0):
            err = "SystemExit: %s" % (e.code,)
    except BaseException as e:  # noqa: BLE001 - the script's error is the result
        tb = e.__traceback__.tb_next if e.__traceback__ is not None else None
        err = "".join(traceback.format_exception(type(e), e, tb))
    try:
        _flush_figures()                 # what the script drew and did not show
    except BaseException as e:  # noqa: BLE001
        if err is None:
            err = "".join(traceback.format_exception_only(type(e), e))
    sys.stdout.flush()
    sys.stderr.flush()
    return err
