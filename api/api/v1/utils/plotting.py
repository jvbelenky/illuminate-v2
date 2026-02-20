"""Plotting utilities for converting matplotlib figures to various formats."""

import io
import base64

import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for server use
import matplotlib.pyplot as plt


def fig_to_base64(fig, dpi: int = 100, facecolor: str = 'white',
                  bbox_inches=None, pad_inches=0.1) -> str:
    """Convert matplotlib figure to base64-encoded PNG.

    Args:
        fig: matplotlib Figure object
        dpi: Resolution in dots per inch (default: 100)
        facecolor: Background color for the figure (default: 'white')
        bbox_inches: Bounding box option (e.g. 'tight' to crop whitespace)
        pad_inches: Padding when bbox_inches='tight' (default: 0.1)

    Returns:
        Base64-encoded PNG string
    """
    buf = io.BytesIO()
    save_kwargs = dict(format='png', dpi=dpi,
                       facecolor=facecolor, edgecolor='none')
    if bbox_inches is not None:
        save_kwargs['bbox_inches'] = bbox_inches
        save_kwargs['pad_inches'] = pad_inches
    fig.savefig(buf, **save_kwargs)
    buf.seek(0)
    plt.close(fig)
    return base64.b64encode(buf.read()).decode('utf-8')
