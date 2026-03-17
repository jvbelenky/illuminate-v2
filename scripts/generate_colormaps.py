"""Generate TypeScript colormap data by sampling matplotlib colormaps.

Run:  python scripts/generate_colormaps.py
Output: ui/src/lib/utils/colormapData.ts
"""

import json
import numpy as np

# We only need matplotlib.cm, avoid pulling in pyplot
from matplotlib import colormaps

SAMPLE_POINTS = 16

# Organized by category for the UI optgroups
COLORMAP_CATEGORIES: dict[str, list[str]] = {
    "Perceptually Uniform": [
        "viridis", "plasma", "inferno", "magma", "cividis",
    ],
    "Sequential": [
        "Greys", "Purples", "Blues", "Greens", "Oranges", "Reds",
        "YlOrBr", "YlOrRd", "OrRd", "PuRd", "RdPu", "BuPu",
        "GnBu", "PuBu", "YlGnBu", "PuBuGn", "BuGn", "YlGn",
        "binary", "gist_yarg", "gist_gray", "gray", "bone", "pink",
        "spring", "summer", "autumn", "winter", "cool", "Wistia",
        "hot", "afmhot", "gist_heat", "copper",
    ],
    "Miscellaneous": [
        "ocean", "gist_earth", "terrain", "gist_stern",
        "gnuplot", "gnuplot2", "CMRmap", "cubehelix", "brg",
        "gist_rainbow", "rainbow", "jet", "turbo", "nipy_spectral",
        "gist_ncar",
    ],
}


def sample_colormap(name: str, n: int = SAMPLE_POINTS) -> list[list[float]]:
    """Sample a matplotlib colormap at n evenly spaced points.

    Returns list of [position, r, g, b] with 3 decimal places.
    """
    cmap = colormaps[name]
    positions = np.linspace(0, 1, n)
    stops = []
    for t in positions:
        r, g, b, _a = cmap(float(t))
        stops.append([
            round(float(t), 3),
            round(float(r), 3),
            round(float(g), 3),
            round(float(b), 3),
        ])
    return stops


def main():
    all_names: list[str] = []
    all_data: dict[str, list[list[float]]] = {}

    for names in COLORMAP_CATEGORIES.values():
        for name in names:
            all_names.append(name)
            all_data[name] = sample_colormap(name)

    # Build TypeScript source
    lines: list[str] = []
    lines.append("/**")
    lines.append(" * Auto-generated colormap data sampled from matplotlib.")
    lines.append(" * Do not edit by hand — regenerate with: python scripts/generate_colormaps.py")
    lines.append(" */")
    lines.append("")
    lines.append("export type ColormapData = [number, number, number, number][];")
    lines.append("")

    # Categories for UI grouping
    ts_categories: dict[str, list[str]] = {}
    for category, names in COLORMAP_CATEGORIES.items():
        ts_categories[category] = names

    lines.append(
        f"export const COLORMAP_CATEGORIES: Record<string, string[]> = {json.dumps(ts_categories, indent=2)};"
    )
    lines.append("")

    # Colormap data
    lines.append("export const COLORMAP_DATA: Record<string, ColormapData> = {")
    for name in all_names:
        stops = all_data[name]
        # Format compactly: one stop per element on same line
        stops_str = json.dumps(stops)
        lines.append(f"  {json.dumps(name)}: {stops_str},")
    lines.append("};")
    lines.append("")

    output_path = "ui/src/lib/utils/colormapData.ts"
    with open(output_path, "w") as f:
        f.write("\n".join(lines))

    print(f"Generated {output_path} with {len(all_names)} colormaps ({SAMPLE_POINTS} samples each)")


if __name__ == "__main__":
    main()
