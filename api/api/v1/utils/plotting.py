"""Plotting utilities for converting matplotlib figures to various formats."""

import io
import base64

import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for server use
import matplotlib.pyplot as plt


# Canonical theme definitions.  Every plotting endpoint should use these
# instead of defining its own color constants.
THEME_COLORS = {
    'light': {
        'bg_color': '#ffffff',
        'text_color': '#1f2328',
        'grid_color': '#c0c0c0',
    },
    'dark': {
        'bg_color': '#16213e',
        'text_color': '#eaeaea',
        'grid_color': '#4a5568',
    },
}


def get_theme_colors(theme: str) -> dict:
    """Return bg_color, text_color, grid_color for the given theme."""
    return THEME_COLORS.get(theme, THEME_COLORS['dark'])


def apply_theme(fig, theme: str, *, grid: bool = False):
    """Apply theme colors to a matplotlib figure and all its axes.

    Args:
        fig: matplotlib Figure object
        theme: 'light' or 'dark'
        grid: If True, add a styled grid to each axis (default: False)
    """
    colors = get_theme_colors(theme)
    bg = colors['bg_color']
    text = colors['text_color']
    grid_color = colors['grid_color']

    fig.patch.set_facecolor(bg)
    for ax in fig.get_axes():
        ax.set_facecolor(bg)
        ax.tick_params(colors=text, labelcolor=text)
        ax.xaxis.label.set_color(text)
        ax.yaxis.label.set_color(text)
        if hasattr(ax, 'title') and ax.title:
            ax.title.set_color(text)
        for spine in ax.spines.values():
            spine.set_color(grid_color if grid else text)
        if grid:
            ax.grid(color=grid_color, alpha=0.5)
        legend = ax.get_legend()
        if legend:
            legend.get_frame().set_facecolor(bg)
            legend.get_frame().set_edgecolor(grid_color)
            for t in legend.get_texts():
                t.set_color(text)


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
