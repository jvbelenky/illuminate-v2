"""Plotting utilities for converting matplotlib figures to various formats."""

import io
import base64

import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for server use
import matplotlib.pyplot as plt


def fig_to_base64(fig, dpi: int = 100, facecolor: str = 'white') -> str:
    """Convert matplotlib figure to base64-encoded PNG.

    Args:
        fig: matplotlib Figure object
        dpi: Resolution in dots per inch (default: 100)
        facecolor: Background color for the figure (default: 'white')

    Returns:
        Base64-encoded PNG string
    """
    buf = io.BytesIO()
    # Don't use bbox_inches='tight' - we want consistent figure sizes
    # so plots with and without colorbars are the same dimensions
    fig.savefig(buf, format='png', dpi=dpi,
                facecolor=facecolor, edgecolor='none')
    buf.seek(0)
    plt.close(fig)
    return base64.b64encode(buf.read()).decode('utf-8')
