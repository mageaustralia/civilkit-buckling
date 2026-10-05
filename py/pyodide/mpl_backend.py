"""The console's matplotlib backend (MPLBACKEND=module://_ckb_backend): matplotlib's own Agg canvas,
with plt.show() handing every open figure to the page (_ckb_console.show). pyplot imports this
module when it picks the backend, so a script without plots never loads matplotlib."""

from matplotlib.backend_bases import FigureManagerBase
from matplotlib.backends.backend_agg import FigureCanvasAgg

import _ckb_console

FigureCanvas = FigureCanvasAgg
FigureManager = FigureManagerBase


def show(*args, **kwargs):
    _ckb_console.show(*args, **kwargs)
