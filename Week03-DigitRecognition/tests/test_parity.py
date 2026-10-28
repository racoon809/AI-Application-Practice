# =============================================================================
# File    : Week03-DigitRecognition/tests/test_parity.py
# Created : 2026-10-28 12:30 (KST, UTC+09:00)
# Purpose : Cross-version check - the same pen strokes must give (almost)
#           the same 28x28 model input in the desktop pipeline
#           (desktop_version/preprocess.py) and the web pipeline
#           (web_version/app.js, run in headless Chromium), and the same
#           predicted digit with the shipped weights (web_version/model.js).
# Run     : cd Week03-DigitRecognition  ->  python -m pytest -q
#           Needs:  pip install playwright  &&  python -m playwright install
#           chromium   (skipped automatically when Chromium is missing)
# =============================================================================
"""Desktop (Pillow) vs web (Canvas) preprocessing parity.

The two pipelines use different rasterizers (Pillow vs the browser canvas)
and resamplers (LANCZOS vs stepwise bilinear), so pixel values cannot match
bit for bit. The test therefore checks what matters for the network:

* both produce a 28x28 frame in [0, 1] with MNIST polarity
* the ink mass is centred within 0.5 px of each other (measured <= 0.11)
* the pixel-wise mean absolute difference stays below 0.04 (measured
  <= 0.016 on the shapes below)
* the network in model.js recognizes the intended digit from both inputs
"""

import math
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "desktop_version"))

import preprocess  # noqa: E402  (path set up above)

sync_api = pytest.importorskip("playwright.sync_api")

WEB_PAGE = ROOT / "web_version" / "index.html"


def _ellipse(cx, cy, rx, ry, start=0.0, end=2 * math.pi, steps=48):
    return [(round(cx + rx * math.cos(start + (end - start) * i / steps)),
             round(cy + ry * math.sin(start + (end - start) * i / steps)))
            for i in range(steps + 1)]


# label -> strokes (list of point lists), drawn like a user would
DIGITS = {
    "0": [_ellipse(140, 140, 55, 85)],
    "1": [[(140, y) for y in range(50, 231, 10)]],
    "7": [[(80, 60), (200, 60), (170, 120), (140, 180), (120, 230)]],
    "small 0": [_ellipse(60, 70, 18, 28)],
    "corner 1": [[(230, y) for y in range(180, 261, 8)]],
    "4": [[(170, 40), (80, 170), (210, 170)], [(170, 40), (170, 240)]],
}


@pytest.fixture(scope="module")
def browser_page():
    with sync_api.sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch()
        except Exception as error:      # Chromium not installed
            pytest.skip(f"headless Chromium unavailable: {error}")
        page = browser.new_page()
        page.goto(WEB_PAGE.as_uri())
        page.wait_for_function("typeof model !== 'undefined' && model !== null",
                               timeout=20000)
        yield page
        browser.close()


def web_predict(page, frame):
    """Digit chosen by app.js predict() (weights from model.js)."""
    probabilities = page.evaluate(
        "(f) => predict(Float32Array.from(f))", frame.reshape(-1).tolist())
    return int(np.argmax(probabilities))


def web_frame(page, strokes):
    js_strokes = [[{"x": x, "y": y} for x, y in stroke] for stroke in strokes]
    pixels = page.evaluate(
        "(s) => { strokes = s; return Array.from(preprocessCanvas()); }",
        js_strokes)
    return np.asarray(pixels, dtype=np.float32).reshape(28, 28)


@pytest.mark.parametrize("label", list(DIGITS))
def test_desktop_and_web_inputs_match(browser_page, label):
    strokes = DIGITS[label]
    desktop = preprocess.strokes_to_mnist(strokes)
    web = web_frame(browser_page, strokes)

    assert desktop.shape == web.shape == (28, 28)
    assert 0.0 <= web.min() and web.max() <= 1.0

    desktop_centre = np.array(preprocess.center_of_mass(desktop))
    web_centre = np.array(preprocess.center_of_mass(web))
    assert np.abs(desktop_centre - web_centre).max() <= 0.5, (
        f"{label}: centroids {desktop_centre} vs {web_centre}")

    assert np.abs(desktop - web).mean() < 0.04, f"{label}: frames differ"

    expected = int(label.split()[-1])
    assert web_predict(browser_page, desktop) == expected, f"{label}: desktop"
    assert web_predict(browser_page, web) == expected, f"{label}: web"


def test_blank_canvas_is_none_in_both(browser_page):
    assert preprocess.strokes_to_mnist([]) is None
    assert browser_page.evaluate("strokes = []; preprocessCanvas()") is None
