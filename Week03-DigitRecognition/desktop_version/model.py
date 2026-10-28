# =============================================================================
# File    : Week03-DigitRecognition/desktop_version/model.py
# Created : 2026-10-28 12:10 (KST, UTC+09:00) - split out of digit_recognition.py
# Purpose : NumPy neural network (784 -> 128 -> 10), MNIST download/cache,
#           augmentation and the Adam training loop. No tkinter import.
# =============================================================================
"""MNIST data, augmentation, the NumPy MLP and its training loop."""

from __future__ import annotations

import io
import os
import threading
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from preprocess import GRID

APP_DIR = Path(__file__).resolve().parent
DATASET_FILE = APP_DIR / "mnist.npz"                  # compressed dataset cache
WEIGHTS_FILE = APP_DIR / "mnist_mlp_weights.npz"      # trained network cache
MNIST_MIRROR = ("https://storage.googleapis.com/tensorflow/"
                "tf-keras-datasets/mnist.npz")
WEIGHTS_SCHEMA = 3           # bump when the network or training changes
VALIDATION_SIZE = 5000       # images held out of training for monitoring


@dataclass(frozen=True)
class TrainingPlan:
    """Hyper-parameters for the NumPy training run."""

    hidden_units: int = 128
    epochs: int = 10
    batch_size: int = 128
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4
    max_shift: float = 2.0       # augmentation: random shift (+- px)
    max_rotation: float = 15.0   # augmentation: random rotation (+- deg)
    max_zoom: float = 0.15       # augmentation: scale 0.85 - 1.15
    max_shear: float = 0.2       # augmentation: horizontal shear (slant)
    seed: int = 7


class TrainingCancelled(Exception):
    """Raised inside the worker when the window closes mid-training."""


ProgressSink = Callable[[str, int], None]


# =============================================================================
# Dataset: one-time download, then compressed local cache (mnist.npz)
# =============================================================================
def _download_mirror() -> dict[str, np.ndarray]:
    """Fetch the 11 MB Keras MNIST archive and return its four arrays."""
    with urllib.request.urlopen(MNIST_MIRROR, timeout=60) as response:
        payload = response.read()
    with np.load(io.BytesIO(payload)) as archive:
        return {key: archive[key] for key in
                ("x_train", "y_train", "x_test", "y_test")}


def _download_openml() -> dict[str, np.ndarray]:
    """Fallback source: OpenML through scikit-learn (only if installed)."""
    from sklearn.datasets import fetch_openml  # optional dependency

    # OpenML dataset 554 is "mnist_784": 70,000 rows of 784 pixel columns
    rows, digits = fetch_openml(data_id=554, return_X_y=True,
                                as_frame=False, parser="liac-arff")
    images = np.asarray(rows, dtype=np.uint8).reshape(-1, GRID, GRID)
    labels = np.asarray(digits).astype(np.uint8)
    return {"x_train": images[:60000], "y_train": labels[:60000],
            "x_test": images[60000:], "y_test": labels[60000:]}


def load_mnist_arrays(report: ProgressSink) -> dict[str, np.ndarray]:
    """Return MNIST as uint8 arrays, downloading only on the very first run.

    The arrays are stored in ``mnist.npz`` with ``np.savez_compressed`` so
    every later start reads ~11 MB from disk instead of the network.
    """
    if DATASET_FILE.exists():
        try:
            with np.load(DATASET_FILE) as archive:
                arrays = {key: archive[key] for key in archive.files}
            if {"x_train", "y_train", "x_test", "y_test"} <= arrays.keys():
                report("Loading MNIST dataset... (local copy mnist.npz)", 5)
                return arrays
        except (OSError, ValueError):
            pass  # damaged cache -> download again below

    report("Loading MNIST dataset... (first run downloads it once)", 2)
    try:
        arrays = _download_mirror()
    except Exception as mirror_error:  # network blocked, proxy, ...
        report("Primary mirror unreachable, trying OpenML...", 3)
        try:
            arrays = _download_openml()
        except Exception as openml_error:
            raise RuntimeError(
                "MNIST could not be downloaded.\n"
                f"mirror: {mirror_error}\nOpenML: {openml_error}"
            ) from openml_error

    partial = DATASET_FILE.with_suffix(".partial")
    with open(partial, "wb") as handle:
        np.savez_compressed(handle, **arrays)
    os.replace(partial, DATASET_FILE)
    report("MNIST dataset saved as mnist.npz for the next start", 5)
    return arrays


def distort_batch(batch: np.ndarray, rng: np.random.Generator,
                  plan: "TrainingPlan") -> np.ndarray:
    """Random rotation, zoom, shear and shift for every 28x28 image.

    Each output pixel looks up its source position through the inverse
    transform and is filled by bilinear interpolation (vectorised, no loop
    over images). Hand-drawn digits are often tilted, slanted or off-size;
    showing the network such variants makes it robust to them.
    """
    count = len(batch)
    axis = np.arange(GRID) - (GRID - 1) / 2
    out_y, out_x = np.meshgrid(axis, axis, indexing="ij")
    angle = np.radians(rng.uniform(-plan.max_rotation, plan.max_rotation, count))
    zoom = rng.uniform(1 - plan.max_zoom, 1 + plan.max_zoom, count)
    shear = rng.uniform(-plan.max_shear, plan.max_shear, count)
    shift_x = rng.uniform(-plan.max_shift, plan.max_shift, count)
    shift_y = rng.uniform(-plan.max_shift, plan.max_shift, count)
    cos = (np.cos(angle) / zoom)[:, None, None]
    sin = (np.sin(angle) / zoom)[:, None, None]
    tilt = shear[:, None, None] * cos
    centre = (GRID - 1) / 2
    src_x = cos * out_x + (sin + tilt) * out_y + centre - shift_x[:, None, None]
    src_y = -sin * out_x + cos * out_y + centre - shift_y[:, None, None]

    left, top = np.floor(src_x).astype(int), np.floor(src_y).astype(int)
    frac_x, frac_y = src_x - left, src_y - top
    images = batch.astype(np.float32)
    which = np.arange(count)[:, None, None]
    result = np.zeros_like(images)
    for dy, dx, weight in ((0, 0, (1 - frac_x) * (1 - frac_y)),
                           (0, 1, frac_x * (1 - frac_y)),
                           (1, 0, (1 - frac_x) * frac_y),
                           (1, 1, frac_x * frac_y)):
        col, row = left + dx, top + dy
        inside = (col >= 0) & (col < GRID) & (row >= 0) & (row < GRID)
        picked = images[which, np.clip(row, 0, GRID - 1),
                        np.clip(col, 0, GRID - 1)]
        result += np.where(inside, picked, 0.0) * weight
    return np.clip(result, 0, 255).astype(batch.dtype)


# =============================================================================
# Component 1 - MnistMlp: NumPy-only neural network
# =============================================================================
class MnistMlp:
    """Multilayer perceptron 784 -> hidden (ReLU) -> 10 (Softmax).

    Inference needs nothing but NumPy: two matrix products, one ReLU and a
    numerically stable softmax. Weights live in an ``.npz`` file, which is
    plain arrays (no pickle), so loading is fast and safe.
    """

    def __init__(self, w_hidden: np.ndarray, b_hidden: np.ndarray,
                 w_out: np.ndarray, b_out: np.ndarray):
        self.w_hidden = np.ascontiguousarray(w_hidden, dtype=np.float32)
        self.b_hidden = np.ascontiguousarray(b_hidden, dtype=np.float32)
        self.w_out = np.ascontiguousarray(w_out, dtype=np.float32)
        self.b_out = np.ascontiguousarray(b_out, dtype=np.float32)

    # -- construction ----------------------------------------------------------
    @classmethod
    def with_random_weights(cls, hidden: int,
                            rng: np.random.Generator) -> "MnistMlp":
        """He-initialised network, ready for training."""
        inputs = GRID * GRID
        return cls(
            rng.normal(0.0, np.sqrt(2.0 / inputs), (inputs, hidden)),
            np.zeros(hidden),
            rng.normal(0.0, np.sqrt(2.0 / hidden), (hidden, 10)),
            np.zeros(10),
        )

    def parameters(self) -> list[np.ndarray]:
        """Mutable parameter arrays (updated in place by the optimiser)."""
        return [self.w_hidden, self.b_hidden, self.w_out, self.b_out]

    # -- math --------------------------------------------------------------------
    @staticmethod
    def relu(values: np.ndarray) -> np.ndarray:
        return np.maximum(values, 0.0)

    @staticmethod
    def softmax(logits: np.ndarray) -> np.ndarray:
        shifted = logits - logits.max(axis=-1, keepdims=True)
        exp = np.exp(shifted)
        return exp / exp.sum(axis=-1, keepdims=True)

    def forward(self, batch: np.ndarray) -> np.ndarray:
        """Class probabilities for inputs shaped (784,), (28, 28) or (N, 784)."""
        flat = np.asarray(batch, dtype=np.float32).reshape(-1, GRID * GRID)
        hidden = self.relu(flat @ self.w_hidden + self.b_hidden)
        return self.softmax(hidden @ self.w_out + self.b_out)

    def classify(self, frame: np.ndarray) -> tuple[int, float, np.ndarray]:
        """Return (digit, confidence 0-1, ten probabilities) for one frame."""
        probabilities = self.forward(frame)[0]
        digit = int(probabilities.argmax())
        return digit, float(probabilities[digit]), probabilities

    def accuracy(self, images: np.ndarray, labels: np.ndarray,
                 chunk: int = 5000) -> float:
        """Share of correctly classified uint8 images (evaluated in chunks)."""
        hits = 0
        for start in range(0, len(images), chunk):
            block = images[start:start + chunk].astype(np.float32) / 255.0
            hits += int((self.forward(block).argmax(axis=1)
                         == labels[start:start + chunk]).sum())
        return hits / len(images)

    # -- persistence -------------------------------------------------------------
    def save(self, path: Path, **metadata: float) -> None:
        partial = path.with_suffix(".partial")
        with open(partial, "wb") as handle:
            np.savez_compressed(handle, schema=WEIGHTS_SCHEMA,
                                w_hidden=self.w_hidden, b_hidden=self.b_hidden,
                                w_out=self.w_out, b_out=self.b_out,
                                **{f"meta_{k}": v for k, v in metadata.items()})
        os.replace(partial, path)

    @classmethod
    def load(cls, path: Path) -> tuple["MnistMlp", dict[str, float]]:
        with np.load(path) as archive:
            if int(archive["schema"]) != WEIGHTS_SCHEMA:
                raise ValueError("weights file uses an outdated layout")
            network = cls(archive["w_hidden"], archive["b_hidden"],
                          archive["w_out"], archive["b_out"])
            metadata = {key[5:]: float(archive[key])
                        for key in archive.files if key.startswith("meta_")}
        return network, metadata


def train_network(data: dict[str, np.ndarray], plan: TrainingPlan,
                  report: ProgressSink,
                  cancelled: threading.Event) -> MnistMlp:
    """Mini-batch training with Adam, L2 decay and distortion augmentation."""
    rng = np.random.default_rng(plan.seed)
    images, labels = data["x_train"], data["y_train"].astype(np.int64)
    order = rng.permutation(len(images))
    val_idx, fit_idx = order[:VALIDATION_SIZE], order[VALIDATION_SIZE:]
    fit_images, fit_labels = images[fit_idx], labels[fit_idx]

    report("Building neural network model...", 6)
    network = MnistMlp.with_random_weights(plan.hidden_units, rng)
    params = network.parameters()
    report("Training model...", 7)
    first_moment = [np.zeros_like(p) for p in params]
    second_moment = [np.zeros_like(p) for p in params]
    beta1, beta2, epsilon, step = 0.9, 0.999, 1e-8, 0

    for epoch in range(1, plan.epochs + 1):
        shuffled = rng.permutation(len(fit_images))
        for start in range(0, len(shuffled), plan.batch_size):
            if cancelled.is_set():
                raise TrainingCancelled
            picks = shuffled[start:start + plan.batch_size]
            batch = distort_batch(fit_images[picks], rng, plan)
            x = batch.reshape(len(picks), -1).astype(np.float32) / 255.0
            y = fit_labels[picks]

            # forward pass (kept explicit to reuse the activations)
            pre_hidden = x @ network.w_hidden + network.b_hidden
            hidden = MnistMlp.relu(pre_hidden)
            probs = MnistMlp.softmax(hidden @ network.w_out + network.b_out)

            # backward pass: softmax + cross-entropy gradient
            delta_out = probs
            delta_out[np.arange(len(y)), y] -= 1.0
            delta_out /= len(y)
            delta_hidden = (delta_out @ network.w_out.T) * (pre_hidden > 0)
            grads = [
                x.T @ delta_hidden + plan.weight_decay * network.w_hidden,
                delta_hidden.sum(axis=0),
                hidden.T @ delta_out + plan.weight_decay * network.w_out,
                delta_out.sum(axis=0),
            ]

            # Adam update, in place
            step += 1
            correction1 = 1.0 - beta1 ** step
            correction2 = 1.0 - beta2 ** step
            for param, grad, m, v in zip(params, grads, first_moment,
                                         second_moment):
                m *= beta1
                m += (1.0 - beta1) * grad
                v *= beta2
                v += (1.0 - beta2) * grad * grad
                param -= (plan.learning_rate * (m / correction1)
                          / (np.sqrt(v / correction2) + epsilon))

        val_score = network.accuracy(images[val_idx], labels[val_idx])
        report(f"Epoch {epoch}/{plan.epochs} - "
               f"validation accuracy: {val_score:.4f}",
               8 + int(88 * epoch / plan.epochs))
    return network
