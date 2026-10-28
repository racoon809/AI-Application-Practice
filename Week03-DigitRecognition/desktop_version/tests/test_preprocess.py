# =============================================================================
# File    : Week03-DigitRecognition/desktop_version/tests/test_preprocess.py
# Created : 2026-09-23 11:48 (KST, UTC+09:00)
# Updated : 2026-10-28 12:10 (KST, UTC+09:00) - import preprocess / model
#           instead of digit_recognition (no tkinter needed); headless test
# Purpose : pytest unit tests for the image pipeline (color inversion,
#           cropping, 20x20 scaling, centering, empty canvas) and the
#           NumPy engine (probabilities sum to 1)
# Run     : cd desktop_version  ->  python -m pytest -q
# =============================================================================
"""Unit tests for rasterization, inversion, centering and the 28x28 frame.

Only pure functions and the NumPy network are exercised, so no window is
opened and no dataset download is needed.
"""

import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import model as nn  # noqa: E402  (path set up above)
import preprocess as dr  # noqa: E402


# -----------------------------------------------------------------------------
# helpers
# -----------------------------------------------------------------------------
def vertical_bar(x=140, top=40, bottom=240):
    """A single straight stroke, like a hand-drawn '1'."""
    return [[(x, y) for y in range(top, bottom + 1, 10)]]


def centroid(frame):
    return dr.center_of_mass(frame)


# -----------------------------------------------------------------------------
# 28x28 rasterization (render_strokes)
# -----------------------------------------------------------------------------
class TestRenderStrokes:
    def test_blank_input_gives_white_sheet(self):
        sheet = dr.render_strokes([])
        assert sheet.size == (dr.PAD_PIXELS, dr.PAD_PIXELS)
        assert sheet.mode == "L"
        assert np.asarray(sheet).min() == 255      # white paper everywhere

    def test_stroke_is_black_with_pen_width(self):
        pixels = np.asarray(dr.render_strokes(vertical_bar()))
        row = pixels[140]                     # a row through the middle
        inked = np.flatnonzero(row < 128)     # dark pixels = ink
        assert inked.size == pytest.approx(dr.PEN_WIDTH, abs=2)
        assert inked.min() <= 140 <= inked.max()
        assert row.min() == 0

    def test_single_click_leaves_round_dot(self):
        pixels = np.asarray(dr.render_strokes([[(50, 60)]]))
        assert pixels[60, 50] == 0
        radius = dr.PEN_WIDTH // 2
        assert pixels[60, 50 + radius + 3] == 255

    def test_end_caps_are_round(self):
        pixels = np.asarray(dr.render_strokes(vertical_bar()))
        # the cap extends above the first point by about half the pen width
        assert pixels[40 - dr.PEN_WIDTH // 2 + 2, 140] < 255


# -----------------------------------------------------------------------------
# color inversion (white pad -> MNIST polarity)
# -----------------------------------------------------------------------------
class TestInversion:
    def test_white_paper_becomes_black(self):
        flipped = np.asarray(dr.to_white_on_black(dr.render_strokes([])))
        assert flipped.max() == 0

    def test_black_ink_becomes_white(self):
        sheet = dr.render_strokes(vertical_bar())
        flipped = np.asarray(dr.to_white_on_black(sheet))
        original = np.asarray(sheet)
        np.testing.assert_array_equal(flipped, 255 - original)
        assert flipped[140, 140] == 255

    def test_rgb_input_is_accepted(self):
        sheet = dr.render_strokes(vertical_bar()).convert("RGB")
        flipped = dr.to_white_on_black(sheet)
        assert flipped.mode == "L"

    def test_frame_has_mnist_polarity(self):
        frame = dr.image_to_mnist(dr.render_strokes(vertical_bar()))
        assert frame[0, 0] == 0.0          # background is black
        assert frame.max() > 0.9           # the digit is bright


# -----------------------------------------------------------------------------
# ink detection and scaling
# -----------------------------------------------------------------------------
class TestInkBoundsAndFit:
    def test_bounds_are_exclusive_on_right_and_bottom(self):
        pixels = np.zeros((10, 10), np.uint8)
        pixels[2:5, 3:7] = 255
        assert dr.ink_bounds(pixels) == (3, 2, 7, 5)

    def test_crop_finds_the_stroke(self):
        flipped = np.asarray(dr.to_white_on_black(
            dr.render_strokes(vertical_bar(x=100, top=50, bottom=200))))
        left, top, right, bottom = dr.ink_bounds(flipped)
        half = dr.PEN_WIDTH // 2
        assert left == pytest.approx(100 - half, abs=1)
        assert right == pytest.approx(100 + half + 1, abs=1)
        assert top == pytest.approx(50 - half, abs=1)
        assert bottom == pytest.approx(200 + half + 1, abs=1)

    def test_faint_noise_below_threshold_is_ignored(self):
        pixels = np.full((10, 10), dr.INK_LEVEL, np.uint8)
        assert dr.ink_bounds(pixels) is None

    def test_hairline_glyph_keeps_at_least_one_pixel(self):
        glyph = dr.fit_to_box(Image.new("L", (1, 90), 255))
        assert glyph.size == (1, dr.GLYPH_BOX)

    @pytest.mark.parametrize("size", [(200, 50), (50, 200), (7, 7), (120, 30)])
    def test_longer_side_becomes_glyph_box(self, size):
        glyph = dr.fit_to_box(Image.new("L", size, 255))
        assert max(glyph.size) == dr.GLYPH_BOX
        original_ratio = size[0] / size[1]
        new_ratio = glyph.size[0] / glyph.size[1]
        assert new_ratio == pytest.approx(original_ratio, rel=0.35)


# -----------------------------------------------------------------------------
# centre-of-mass alignment
# -----------------------------------------------------------------------------
class TestCenterOfMass:
    def test_single_pixel_centroid(self):
        pixels = np.zeros((28, 28), np.float32)
        pixels[5, 20] = 1.0
        assert centroid(pixels) == pytest.approx((20.0, 5.0))

    def test_empty_array_returns_geometric_centre(self):
        assert centroid(np.zeros((28, 28))) == pytest.approx((13.5, 13.5))

    def test_weighted_centroid(self):
        pixels = np.zeros((4, 4), np.float32)
        pixels[0, 0] = 1.0
        pixels[0, 3] = 3.0
        assert centroid(pixels) == pytest.approx((2.25, 0.0))

    @pytest.mark.parametrize("corner", [(0, 0), (0, 15), (15, 0), (15, 15)])
    def test_frame_centroid_lands_near_centre(self, corner):
        glyph = np.zeros((20, 20), np.float32)
        top, left = corner
        glyph[top:top + 5, left:left + 5] = 1.0   # ink crowded in one corner
        frame = dr.compose_mnist_frame(glyph)
        cx, cy = centroid(frame)
        # plain centring of the 20x20 box would put the ink here:
        naive_x, naive_y = left + 2 + 4, top + 2 + 4
        # clipping may stop the glyph early, but it must never end up
        # further from the centre than naive centring
        assert abs(cx - 13.5) <= abs(naive_x - 13.5)
        assert abs(cy - 13.5) <= abs(naive_y - 13.5)
        assert frame.sum() == pytest.approx(glyph.sum())

    def test_balanced_glyph_is_centred_within_half_pixel(self):
        glyph = np.zeros((20, 12), np.float32)
        glyph[:, 2:6] = 1.0
        frame = dr.compose_mnist_frame(glyph)
        cx, cy = centroid(frame)
        assert cx == pytest.approx(13.5, abs=0.5)
        assert cy == pytest.approx(13.5, abs=0.5)

    def test_no_ink_is_lost_when_composing(self):
        rng = np.random.default_rng(0)
        glyph = rng.random((20, 20)).astype(np.float32)
        frame = dr.compose_mnist_frame(glyph)
        assert frame.sum() == pytest.approx(glyph.sum(), rel=1e-5)


# -----------------------------------------------------------------------------
# full pipeline: stroke image -> 28x28 frame
# -----------------------------------------------------------------------------
class TestImageToMnist:
    def test_blank_canvas_returns_none(self):
        assert dr.image_to_mnist(dr.render_strokes([])) is None

    def test_undo_to_empty_canvas_returns_none(self):
        strokes = vertical_bar()
        strokes.pop()                         # same as undoing the only stroke
        assert dr.image_to_mnist(dr.render_strokes(strokes)) is None

    def test_output_shape_type_and_range(self):
        frame = dr.image_to_mnist(dr.render_strokes(vertical_bar()))
        assert frame.shape == (28, 28)
        assert frame.dtype == np.float32
        assert 0.0 <= frame.min() and frame.max() <= 1.0
        assert frame.max() > 0.9

    def test_digit_height_matches_mnist_box(self):
        frame = dr.image_to_mnist(dr.render_strokes(vertical_bar()))
        rows = np.flatnonzero((frame > 0.1).any(axis=1))
        assert rows[-1] - rows[0] + 1 == pytest.approx(dr.GLYPH_BOX, abs=1)

    def test_4px_margin_like_mnist(self):
        frame = dr.image_to_mnist(dr.render_strokes(vertical_bar()))
        assert frame[:3].max() == 0 and frame[-3:].max() == 0

    def test_position_on_canvas_does_not_matter(self):
        left = dr.image_to_mnist(dr.render_strokes(vertical_bar(x=40)))
        right = dr.image_to_mnist(dr.render_strokes(vertical_bar(x=230)))
        np.testing.assert_allclose(left, right, atol=1e-6)

    def test_result_is_centred(self):
        strokes = [[(60, 60), (200, 60), (110, 230)]]   # a "7"
        frame = dr.image_to_mnist(dr.render_strokes(strokes))
        cx, cy = centroid(frame)
        assert cx == pytest.approx(13.5, abs=0.5)
        assert cy == pytest.approx(13.5, abs=0.5)


# -----------------------------------------------------------------------------
# augmentation and the NumPy engine
# -----------------------------------------------------------------------------
class TestSizeNormalization:
    """A digit drawn small or large must reach the model the same way."""

    def test_small_and_large_drawings_give_the_same_frame(self):
        small = [[(130, 120), (130, 160)]]            # 40 px tall "1"
        large = [[(140, 40), (140, 240)]]             # 200 px tall "1"
        a = dr.strokes_to_mnist(small)
        b = dr.strokes_to_mnist(large)
        np.testing.assert_allclose(a, b, atol=0.02)

    def test_normalized_digit_spans_the_target_size(self):
        strokes = dr.normalize_strokes([[(10, 10), (40, 70)]])
        xs = [x for x, _ in strokes[0]]
        ys = [y for _, y in strokes[0]]
        assert max(ys) - min(ys) == pytest.approx(dr.STROKE_SPAN)
        assert (max(xs) + min(xs)) / 2 == pytest.approx(dr.PAD_PIXELS / 2)
        assert (max(ys) + min(ys)) / 2 == pytest.approx(dr.PAD_PIXELS / 2)

    def test_empty_and_dot_are_left_alone(self):
        assert dr.normalize_strokes([]) == []
        assert dr.normalize_strokes([[(50, 60)]]) == [[(50, 60)]]
        assert dr.strokes_to_mnist([]) is None
        assert dr.strokes_to_mnist([[(50, 60)]]) is not None


# -----------------------------------------------------------------------------
# augmentation and the NumPy engine
# -----------------------------------------------------------------------------
class TestAugmentationAndEngine:
    def test_distort_keeps_shape_and_type(self):
        batch = np.zeros((8, 28, 28), np.uint8)
        batch[:, 8:20, 12:16] = 255
        out = nn.distort_batch(batch, np.random.default_rng(1),
                               nn.TrainingPlan())
        assert out.shape == batch.shape and out.dtype == np.uint8
        assert (out > 0).any(axis=(1, 2)).all()      # no digit vanishes

    def test_distort_without_change_is_identity(self):
        plan = nn.TrainingPlan(max_shift=0, max_rotation=0, max_zoom=0,
                               max_shear=0)
        batch = np.random.default_rng(2).integers(0, 256, (4, 28, 28),
                                                  dtype=np.uint8)
        out = nn.distort_batch(batch, np.random.default_rng(3), plan)
        np.testing.assert_array_equal(out, batch)

    def test_probabilities_sum_to_one_for_a_batch(self):
        net = nn.MnistMlp.with_random_weights(32, np.random.default_rng(5))
        batch = np.random.default_rng(6).random((16, 784)).astype(np.float32)
        probs = net.forward(batch)
        assert probs.shape == (16, 10)
        np.testing.assert_allclose(probs.sum(axis=1), 1.0, atol=1e-5)
        assert (probs >= 0).all()

    def test_softmax_rows_sum_to_one_and_are_stable(self):
        probs = nn.MnistMlp.softmax(np.array([[1000.0, 1000.0, -1000.0]]))
        assert probs.sum() == pytest.approx(1.0)
        assert probs[0, 0] == pytest.approx(0.5)

    def test_relu_clears_negatives(self):
        np.testing.assert_array_equal(nn.MnistMlp.relu(np.array([-2.0, 0, 3])),
                                      [0.0, 0.0, 3.0])

    def test_classify_returns_valid_distribution(self):
        net = nn.MnistMlp.with_random_weights(32, np.random.default_rng(3))
        frame = dr.image_to_mnist(dr.render_strokes(vertical_bar()))
        digit, confidence, probs = net.classify(frame)
        assert 0 <= digit <= 9
        assert probs.shape == (10,)
        assert probs.sum() == pytest.approx(1.0, abs=1e-5)
        assert confidence == pytest.approx(probs.max())

    def test_weights_round_trip(self, tmp_path):
        net = nn.MnistMlp.with_random_weights(16, np.random.default_rng(4))
        target = tmp_path / "weights.npz"
        net.save(target, test_accuracy=0.5)
        restored, meta = nn.MnistMlp.load(target)
        np.testing.assert_array_equal(restored.w_hidden, net.w_hidden)
        assert meta["test_accuracy"] == pytest.approx(0.5)


# -----------------------------------------------------------------------------
# headless guarantee: the tested modules must not pull in tkinter
# -----------------------------------------------------------------------------
def test_core_modules_do_not_import_tkinter():
    """preprocess/model/digit_recognition import cleanly without a GUI."""
    import subprocess

    code = ("import sys; import preprocess, model, digit_recognition; "
            "sys.exit(1 if 'tkinter' in sys.modules else 0)")
    folder = Path(__file__).resolve().parents[1]
    result = subprocess.run([sys.executable, "-c", code], cwd=folder)
    assert result.returncode == 0, "tkinter was imported by a core module"

