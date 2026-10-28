# =============================================================================
# File    : Week03-DigitRecognition/web_version/server.py
# Created : 2026-09-23 10:00 (KST, UTC+09:00)
# Updated : 2026-10-28 12:50 (KST, UTC+09:00) - folder renamed to Week03-DigitRecognition
# Purpose : Local web server for the web version of the digit recognizer
# =============================================================================
"""Local web server for the handwritten digit recognition web app.

What it does
------------
* Serves ``index.html``, ``style.css`` and ``app.js`` with Python's
  built-in ``http.server`` (no Flask needed).
* Trains a small neural network (scikit-learn ``MLPClassifier``,
  784 -> 128 -> 10) on MNIST in a background thread and exports the
  weights to ``model.js``. The browser downloads these weights once and
  runs preprocessing and prediction entirely in JavaScript (``app.js``).
* ``model.js`` is cached, so the second start is instant. It is plain
  JavaScript, so index.html also works when opened directly as a file.

Endpoints
---------
    GET /              -> index.html
    GET /style.css     -> stylesheet
    GET /app.js        -> front-end logic
    GET /api/status    -> {"state": "training|ready|error", ...}
    GET /api/model     -> model weights (503 while training)
    POST /api/predict  -> {"pixels": [784 values 0-1]} ->
                          {"digit", "confidence", "probabilities",
                           "percentages", "top"}

Usage
-----
    python server.py                  # http://localhost:8000
    python server.py --port 5000      # choose another port
    python server.py --no-browser     # do not open the browser
    python server.py --retrain        # ignore model.js and train again
"""

import argparse
import json
import os
import sys
import threading
import time
import warnings
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

warnings.filterwarnings("ignore")

# -----------------------------------------------------------------------------
# Constants
# -----------------------------------------------------------------------------
WEB_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(WEB_DIR, "model.js")
# model.js = the model JSON wrapped in one line of JavaScript. The server
# reads the JSON part; a page opened as a file loads it with <script>.
JS_PREFIX = b"window.MNIST_MODEL = "
JS_SUFFIX = b";\n"

STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/model.js": ("model.js", "text/javascript; charset=utf-8"),
}

DEFAULT_PORT = 8000
PORT_TRIES = 10          # try 8000, 8001, ... if the port is busy
TRAIN_SAMPLES = 60000    # standard MNIST split: 60,000 train / 10,000 test
HIDDEN_UNITS = 128
EPOCHS = 12
RANDOM_SEED = 42
MODEL_FORMAT = "mlp-dense-v2"   # bump to retrain an old model.js
WEIGHT_DECIMALS = 5      # rounding keeps model.js small (~1-2 MB)


# -----------------------------------------------------------------------------
# Shared training state (read by HTTP threads, written by the trainer)
# -----------------------------------------------------------------------------
class ModelState:
    """Thread-safe container for training progress and the model JSON."""

    def __init__(self):
        self._lock = threading.Lock()
        self.state = "training"
        self.message = "Starting..."
        self.progress = 0
        self.test_accuracy = None
        self.model_bytes = None

    def update(self, **fields):
        with self._lock:
            for key, value in fields.items():
                setattr(self, key, value)

    def snapshot(self):
        with self._lock:
            return {
                "state": self.state,
                "message": self.message,
                "progress": self.progress,
                "test_accuracy": self.test_accuracy,
            }

    def get_model_bytes(self):
        with self._lock:
            return self.model_bytes


STATE = ModelState()


# -----------------------------------------------------------------------------
# Training and export
# -----------------------------------------------------------------------------
def load_mnist():
    """Download MNIST from OpenML (scikit-learn caches it after the 1st run).

    Returns (X, y) with X scaled to 0.0-1.0 and integer labels y.
    """
    from sklearn.datasets import fetch_openml

    try:
        mnist = fetch_openml("mnist_784", version=1, as_frame=False,
                             parser="pandas")
    except ImportError:
        mnist = fetch_openml("mnist_784", version=1, as_frame=False,
                             parser="liac-arff")
    features = mnist.data.astype(np.float32) / 255.0
    labels = mnist.target.astype(np.int64)
    return features, labels


def distort_images(images, rng, chunk=5000):
    """Distort all images in chunks so memory use stays small (~100 MB)."""
    return np.concatenate([distort_chunk(images[start:start + chunk], rng)
                           for start in range(0, len(images), chunk)])


def distort_chunk(images, rng):
    """Randomly rotate (+-15 deg), zoom (0.85-1.15), slant and shift (+-2 px)
    every 28x28 image, using bilinear interpolation.

    Hand-drawn digits are often tilted, slanted or a bit off-size; training
    on such variants makes the model robust to them. ``images`` is an
    (n, 784) array with values 0-1; the result has the same shape.
    """
    count = len(images)
    grid = np.arange(28, dtype=np.float32) - 13.5
    out_y, out_x = np.meshgrid(grid, grid, indexing="ij")
    angle = np.radians(rng.uniform(-15, 15, count))
    zoom = rng.uniform(0.85, 1.15, count)
    slant = rng.uniform(-0.2, 0.2, count)
    move_x, move_y = rng.uniform(-2, 2, count), rng.uniform(-2, 2, count)
    cos = (np.cos(angle) / zoom)[:, None, None]
    sin = (np.sin(angle) / zoom)[:, None, None]
    src_x = (cos * out_x + (sin + slant[:, None, None] * cos) * out_y
             + 13.5 - move_x[:, None, None])
    src_y = -sin * out_x + cos * out_y + 13.5 - move_y[:, None, None]

    x0, y0 = np.floor(src_x).astype(int), np.floor(src_y).astype(int)
    fx, fy = src_x - x0, src_y - y0
    pictures = images.reshape(count, 28, 28)
    index = np.arange(count)[:, None, None]
    warped = np.zeros((count, 28, 28), dtype=np.float32)
    for dy, dx, share in ((0, 0, (1 - fx) * (1 - fy)), (0, 1, fx * (1 - fy)),
                          (1, 0, (1 - fx) * fy), (1, 1, fx * fy)):
        xs, ys = x0 + dx, y0 + dy
        valid = (xs >= 0) & (xs < 28) & (ys >= 0) & (ys < 28)
        warped += np.where(valid, pictures[index, ys.clip(0, 27),
                                           xs.clip(0, 27)], 0.0) * share
    return warped.clip(0.0, 1.0).reshape(count, 784)


def export_model(model, test_accuracy):
    """Convert a trained MLPClassifier into the JSON format used by app.js.

    Each layer stores a flat, row-major weight matrix of shape
    (inputs, outputs): weight[i * outputs + j] connects input i to output j.
    """
    activations = ["relu"] * (len(model.coefs_) - 1) + ["softmax"]
    layers = []
    for weights, bias, activation in zip(model.coefs_, model.intercepts_,
                                         activations):
        layers.append({
            "inputs": int(weights.shape[0]),
            "outputs": int(weights.shape[1]),
            "activation": activation,
            "weights": np.round(weights, WEIGHT_DECIMALS).ravel().tolist(),
            "bias": np.round(bias, WEIGHT_DECIMALS).tolist(),
        })
    return {
        "format": MODEL_FORMAT,
        "created": time.strftime("%Y-%m-%d %H:%M:%S"),
        "input_size": 784,
        "input_scale": "0-1 (pixel / 255), white digit on black, 28x28",
        "classes": list(range(10)),
        "test_accuracy": test_accuracy,
        "layers": layers,
    }


def train_model():
    """Train the MLP on MNIST and return the exported JSON dictionary."""
    from sklearn.neural_network import MLPClassifier

    STATE.update(message="Downloading MNIST dataset (first run: 1-2 min)...",
                 progress=2)
    print("[model] Downloading MNIST (cached after the first run)...")
    features, labels = load_mnist()

    x_train, y_train = features[:TRAIN_SAMPLES], labels[:TRAIN_SAMPLES]
    x_test, y_test = features[TRAIN_SAMPLES:], labels[TRAIN_SAMPLES:]

    model = MLPClassifier(hidden_layer_sizes=(HIDDEN_UNITS,),
                          activation="relu", solver="adam", alpha=1e-4,
                          batch_size=128, learning_rate_init=1e-3,
                          random_state=RANDOM_SEED)

    rng = np.random.default_rng(RANDOM_SEED)
    classes = np.arange(10)
    for epoch in range(1, EPOCHS + 1):
        order = rng.permutation(len(x_train))
        batch = distort_images(x_train[order], rng)
        model.partial_fit(batch, y_train[order], classes=classes)
        message = f"Training model... epoch {epoch}/{EPOCHS}"
        STATE.update(message=message, progress=5 + int(90 * epoch / EPOCHS))
        print(f"[model] {message}")

    accuracy = float(model.score(x_test, y_test))
    print(f"[model] Test accuracy: {accuracy * 100:.2f}%")
    return export_model(model, accuracy)


def read_model_file():
    """Return the model JSON bytes stored inside model.js."""
    with open(MODEL_PATH, "rb") as handle:
        text = handle.read()
    start = text.find(JS_PREFIX)          # skip the header comment
    if start >= 0:
        text = text[start + len(JS_PREFIX):]
    return text.strip().rstrip(b";")


def write_model_file(data):
    """Save the model JSON as model.js (atomic: temp file + rename)."""
    stamp = time.strftime("%Y-%m-%d %H:%M", time.localtime())
    header = (
        "// File    : Week03-DigitRecognition/web_version/model.js\n"
        f"// Created : {stamp} (local time) - written by server.py\n"
        "// Purpose : Trained MNIST weights (MLP 784-128-10). Plain JavaScript,\n"
        "//           so index.html can load it even without the server.\n"
    ).encode("utf-8")
    temp_path = MODEL_PATH + ".tmp"
    with open(temp_path, "wb") as handle:
        handle.write(header + JS_PREFIX + data + JS_SUFFIX)
    os.replace(temp_path, MODEL_PATH)


def prepare_model(force_retrain):
    """Load model.js or train a new model (runs in a background thread)."""
    try:
        if not force_retrain and os.path.exists(MODEL_PATH):
            data = read_model_file()
            cached = json.loads(data)
            if cached.get("format") != MODEL_FORMAT:
                print("[model] model.js is from an older version - "
                      "retraining")
                prepare_model(True)
                return
            accuracy = cached.get("test_accuracy")
            STATE.update(state="ready", message="Loaded cached model.",
                         progress=100, test_accuracy=accuracy,
                         model_bytes=data)
            print("[model] Loaded the trained model (model.js)")
            return

        exported = train_model()
        data = json.dumps(exported, separators=(",", ":")).encode("utf-8")

        write_model_file(data)

        STATE.update(state="ready", message="Model ready.", progress=100,
                     test_accuracy=exported["test_accuracy"],
                     model_bytes=data)
        print(f"[model] Saved {os.path.basename(MODEL_PATH)} "
              f"({len(data) / 1e6:.1f} MB)")
    except Exception as error:  # e.g. no internet on the first run
        STATE.update(state="error",
                     message=f"Model preparation failed: "
                             f"{type(error).__name__}: {error}")
        print(f"[model] ERROR: {error}", file=sys.stderr)


# -----------------------------------------------------------------------------
# HTTP handler
# -----------------------------------------------------------------------------
class DigitRequestHandler(BaseHTTPRequestHandler):
    """Serves the three static files and the three JSON API endpoints."""

    server_version = "DigitServer/1.0"

    def do_GET(self):  # noqa: N802 (name required by BaseHTTPRequestHandler)
        path = self.path.split("?", 1)[0]

        if path == "/api/status":
            self._send_json(STATE.snapshot())
        elif path == "/api/model":
            data = STATE.get_model_bytes()
            if data is None:
                self._send_json({"error": "model not ready"},
                                HTTPStatus.SERVICE_UNAVAILABLE)
            else:
                self._send_bytes(data, "application/json; charset=utf-8")
        elif path in STATIC_FILES:
            filename, content_type = STATIC_FILES[path]
            self._send_file(filename, content_type)
        elif path == "/favicon.ico":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
        else:
            self._send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self):  # noqa: N802
        if self.path.split("?", 1)[0] != "/api/predict":
            self._send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = -1
        if not 0 < length <= MAX_BODY_BYTES:
            self._send_json({"error": "missing or too large request body"},
                            HTTPStatus.BAD_REQUEST)
            return
        pixels, problem = read_pixels(self.rfile.read(length))
        if problem:
            self._send_json({"error": problem}, HTTPStatus.BAD_REQUEST)
            return
        model_bytes = STATE.get_model_bytes()
        if model_bytes is None:
            self._send_json({"error": "model not ready"},
                            HTTPStatus.SERVICE_UNAVAILABLE)
            return
        self._send_json(predict_pixels(pixels, model_bytes))

    # -- helpers ----------------------------------------------------------------
    def _send_bytes(self, data, content_type, status=HTTPStatus.OK):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, payload, status=HTTPStatus.OK):
        data = json.dumps(payload).encode("utf-8")
        self._send_bytes(data, "application/json; charset=utf-8", status)

    def _send_file(self, filename, content_type):
        file_path = os.path.join(WEB_DIR, filename)
        try:
            with open(file_path, "rb") as handle:
                data = handle.read()
        except OSError:
            self._send_json({"error": f"{filename} missing"},
                            HTTPStatus.NOT_FOUND)
            return
        self._send_bytes(data, content_type)

    def log_message(self, format, *args):  # noqa: A002 (base class name)
        # Hide the frequent status polling requests to keep the log readable
        if args and "/api/status" in str(args[0]):
            return
        super().log_message(format, *args)


# -----------------------------------------------------------------------------
# Server-side prediction (same network and weights as app.js)
# -----------------------------------------------------------------------------
MAX_BODY_BYTES = 64 * 1024     # 784 numbers as JSON fit easily
TOP_K = 3                      # number of entries in the "top" field
_network_cache = {"source": None, "layers": None}
_network_lock = threading.Lock()


def load_layers(model_bytes):
    """Turn the model JSON bytes into NumPy (weights, bias, activation)
    tuples. The result is cached until the model bytes change."""
    with _network_lock:
        if _network_cache["source"] is not model_bytes:
            layers = []
            for layer in json.loads(model_bytes)["layers"]:
                weights = np.asarray(layer["weights"], dtype=np.float32)
                layers.append((weights.reshape(layer["inputs"],
                                               layer["outputs"]),
                               np.asarray(layer["bias"], dtype=np.float32),
                               layer["activation"]))
            _network_cache.update(source=model_bytes, layers=layers)
        return _network_cache["layers"]


def predict_pixels(pixels, model_bytes):
    """Run 784 preprocessed pixels (0-1, white digit on black) through the
    network and return the digit, its confidence and all probabilities."""
    values = np.clip(np.asarray(pixels, dtype=np.float32), 0.0, 1.0)
    for weights, bias, activation in load_layers(model_bytes):
        values = values @ weights + bias
        if activation == "relu":
            values = np.maximum(values, 0.0)
        else:                                     # stable softmax
            values = np.exp(values - values.max())
            values /= values.sum()
    ranked = np.argsort(values)[::-1]
    return {
        "digit": int(ranked[0]),
        "confidence": float(values[ranked[0]]),
        "probabilities": [round(float(v), 6) for v in values],
        "percentages": [round(float(v) * 100, 2) for v in values],
        "top": [{"digit": int(d), "probability": float(values[d])}
                for d in ranked[:TOP_K]],
    }


def read_pixels(raw_body):
    """Validate the request body; return (pixels, error_message)."""
    try:
        pixels = json.loads(raw_body)["pixels"]
    except (ValueError, KeyError, TypeError):
        return None, 'send JSON like {"pixels": [784 numbers]}'
    if not isinstance(pixels, list) or len(pixels) != 784:
        return None, "pixels must be a list of 784 numbers (28x28)"
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool)
               and np.isfinite(v) for v in pixels):
        return None, "pixels must contain only finite numbers (0-1)"
    return pixels, None


# -----------------------------------------------------------------------------
# Entry point
# -----------------------------------------------------------------------------
def create_server(host, port):
    """Bind to the first free port starting at ``port``."""
    last_error = None
    for candidate in range(port, port + PORT_TRIES):
        try:
            server = ThreadingHTTPServer((host, candidate),
                                         DigitRequestHandler)
            server.daemon_threads = True
            return server, candidate
        except OSError as error:
            last_error = error
            print(f"[server] Port {candidate} is busy, trying the next one...")
    raise SystemExit(f"[server] No free port found: {last_error}")


def main():
    parser = argparse.ArgumentParser(
        description="Local web server for handwritten digit recognition")
    parser.add_argument("--host", default="127.0.0.1",
                        help="address to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"port number (default: {DEFAULT_PORT})")
    parser.add_argument("--no-browser", action="store_true",
                        help="do not open the web browser automatically")
    parser.add_argument("--retrain", action="store_true",
                        help="ignore model.js and train a new model")
    args = parser.parse_args()

    server, port = create_server(args.host, args.port)
    url = f"http://localhost:{port}"

    threading.Thread(target=prepare_model, args=(args.retrain,),
                     daemon=True).start()

    print("=" * 60)
    print(" Handwritten Digit Recognition - Web Version")
    print(f" Open in your browser: {url}")
    print(" Press Ctrl+C to stop the server.")
    print("=" * 60)

    if not args.no_browser:
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[server] Stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
