# =============================================================================
# File    : Week03-DigitRecognition/desktop_version/preprocess.py
# Created : 2026-10-28 12:10 (KST, UTC+09:00) - split out of digit_recognition.py
# Purpose : Image pipeline from pen strokes to the 28x28 MNIST model input.
#           Pure functions on NumPy arrays and Pillow images; it never
#           imports tkinter, so the tests also run on headless machines.
# =============================================================================
"""Stroke -> 28x28 MNIST frame pipeline (no GUI dependency).

    normalize_strokes (fixed size) -> render_strokes (black on white)
    -> to_white_on_black -> ink_bounds -> fit_to_box -> compose_mnist_frame

``strokes_to_mnist`` runs the whole chain. Covered by
``tests/test_preprocess.py``; the web version (``../web_version/app.js``)
implements the same steps and is compared against this module in
``../tests/test_parity.py``.
"""

from __future__ import annotations

from typing import Iterable, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageOps

PAD_PIXELS = 280             # stroke pad edge length
PEN_WIDTH = 20               # pen diameter on the stroke pad
STROKE_SPAN = 190            # digit size (px) the strokes are redrawn at
GRID = 28                    # MNIST frame edge length
GLYPH_BOX = 20               # MNIST digits are scaled into a 20x20 box
INK_LEVEL = 30               # 0-255 threshold separating ink from paper

Point = tuple[int, int]


def render_strokes(strokes: Iterable[Sequence[Point]],
                   size: int = PAD_PIXELS,
                   pen: int = PEN_WIDTH) -> Image.Image:
    """Rasterize vector strokes exactly as the user sees them:
    black ink (0) on white paper (255)."""
    sheet = Image.new("L", (size, size), 255)
    brush = ImageDraw.Draw(sheet)
    radius = pen / 2
    for stroke in strokes:
        if not stroke:
            continue
        if len(stroke) > 1:
            brush.line(list(stroke), fill=0, width=pen, joint="curve")
        for x, y in (stroke[0], stroke[-1]):        # round end caps
            brush.ellipse((x - radius, y - radius, x + radius, y + radius),
                          fill=0)
    return sheet


def to_white_on_black(sheet: Image.Image) -> Image.Image:
    """Flip the pad colors into MNIST polarity (white digit, black ground).

    The pad shows black ink on white paper, but every MNIST training image
    is the opposite, so the model must receive the inverted picture.
    """
    return ImageOps.invert(sheet.convert("L"))


def ink_bounds(pixels: np.ndarray,
               level: int = INK_LEVEL) -> tuple[int, int, int, int] | None:
    """Return (left, top, right, bottom) of the inked area, or None if blank.

    ``right`` and ``bottom`` are exclusive so the tuple can go straight into
    ``Image.crop``.
    """
    mask = pixels > level
    rows = np.flatnonzero(mask.any(axis=1))
    cols = np.flatnonzero(mask.any(axis=0))
    if rows.size == 0:
        return None
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1


def fit_to_box(glyph: Image.Image, box: int = GLYPH_BOX) -> Image.Image:
    """Scale the glyph so its longer side equals ``box`` (aspect preserved)."""
    width, height = glyph.size
    ratio = box / max(width, height)
    target = (max(1, round(width * ratio)), max(1, round(height * ratio)))
    return glyph.resize(target, Image.Resampling.LANCZOS)


def center_of_mass(pixels: np.ndarray) -> tuple[float, float]:
    """Intensity-weighted centroid (x, y); geometric centre if empty."""
    total = float(pixels.sum())
    if total == 0.0:
        return (pixels.shape[1] - 1) / 2, (pixels.shape[0] - 1) / 2
    ys, xs = np.indices(pixels.shape)
    return float((xs * pixels).sum() / total), float((ys * pixels).sum() / total)


def compose_mnist_frame(glyph: np.ndarray, grid: int = GRID) -> np.ndarray:
    """Place ``glyph`` on a blank grid so its centroid sits on the centre.

    The glyph is positioned in a single step (no paste-then-shift) and the
    offset is clipped so no ink is ever pushed outside the frame.
    """
    glyph_h, glyph_w = glyph.shape
    cx, cy = center_of_mass(glyph)
    middle = (grid - 1) / 2
    left = int(np.clip(np.floor(middle - cx + 0.5), 0, grid - glyph_w))
    top = int(np.clip(np.floor(middle - cy + 0.5), 0, grid - glyph_h))
    frame = np.zeros((grid, grid), dtype=np.float32)
    frame[top:top + glyph_h, left:left + glyph_w] = glyph
    return frame


def image_to_mnist(sheet: Image.Image) -> np.ndarray | None:
    """Full pipeline: pad image (black on white) -> 28x28 float32 frame in
    [0, 1] with MNIST polarity (white digit on black)."""
    gray = to_white_on_black(sheet)
    bounds = ink_bounds(np.asarray(gray))
    if bounds is None:
        return None
    glyph = fit_to_box(gray.crop(bounds))
    return compose_mnist_frame(np.asarray(glyph, dtype=np.float32) / 255.0)


def normalize_strokes(strokes: Sequence[Sequence[Point]],
                      span: float = STROKE_SPAN,
                      size: int = PAD_PIXELS) -> list[list[tuple[float, float]]]:
    """Rescale and recentre the strokes so the digit is ``span`` px tall/wide.

    The pen is always 20 px, so a digit drawn small on the pad ends up with
    much thicker lines (relative to its size) than any MNIST digit. Redrawing
    the strokes at one fixed size keeps the line thickness ratio the same no
    matter how large the user wrote. A single dot is returned unchanged.
    """
    points = [point for stroke in strokes for point in stroke]
    if not points:
        return [list(stroke) for stroke in strokes]
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    extent = max(max(xs) - min(xs), max(ys) - min(ys))
    if extent < 1:
        return [list(stroke) for stroke in strokes]
    zoom = span / extent
    mid_x, mid_y = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    return [[(size / 2 + (x - mid_x) * zoom, size / 2 + (y - mid_y) * zoom)
             for x, y in stroke] for stroke in strokes]


def strokes_to_mnist(strokes: Sequence[Sequence[Point]]) -> np.ndarray | None:
    """Strokes -> fixed-size redraw -> 28x28 model input (None if blank)."""
    return image_to_mnist(render_strokes(normalize_strokes(strokes)))
