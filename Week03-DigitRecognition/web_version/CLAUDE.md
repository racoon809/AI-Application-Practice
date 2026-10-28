<!-- Created: 2026-09-23 10:00 (KST, UTC+09:00) | Updated: 2026-10-28 12:50 (KST, UTC+09:00) - parity test with the desktop pipeline (preprocess.py) -->
# Web Version - Handwritten Digit Recognition

Web tech stack, commands and development guide for the browser version.
The common rules in `../CLAUDE.md` (project root) also apply here.

## Project Overview
A web page that runs through the local server (http://localhost:8000) or
by simply double-clicking `index.html`. A white card on a purple
background with the title "Handwritten Digit Recognition" has two panels:

- Left: white 280x280 canvas (black 20 px pen), [Recognize] and [Clear]
  buttons (same names and order as the desktop window, lecture p46), a
  "Live prediction" switch and the keyboard shortcuts
- Right: the 28x28 model input, a large predicted digit,
  `Predicted Digit: X` / `Confidence: XX.XX%` and the probability of every
  digit 0-9 as a bar with its percentage (2 decimals, best row highlighted)

## Main Features
- Drawing with the mouse, a pen or a finger (Pointer Events)
- [Recognize] (or Enter) predicts; [Clear] (or Esc) resets everything
- Live prediction after every stroke (switch on by default)
- MNIST preprocessing in the browser: strokes redrawn at a fixed size,
  invert to white-on-black, crop, scale to 20x20, centre in 28x28 by center
  of mass, values 0.0-1.0; the result is shown as the 28x28 preview
- Neural network 784 -> 128 (ReLU) -> 10 (Softmax), trained on MNIST by
  `server.py`, run in the browser
- Prediction API on the server (`POST /api/predict`) with the same weights
- Loading banner with a progress bar while the server trains; the MNIST
  test accuracy is shown in the footer

## Folder Structure
```
web_version/
├── CLAUDE.md            <- this file (web rules and guide)
├── index.html           <- page layout (card, two panels)
├── style.css            <- purple background, white card, responsive
├── app.js               <- drawing, preprocessing, prediction, UI
├── server.py            <- local server, training, prediction API
├── run_web_server.bat   <- double-click launcher (server + browser)
├── requirements.txt     <- numpy, scikit-learn, pandas
└── model.js             <- trained weights (committed, ~2 MB, see below)
```

## Commands
- Install: `pip install -r requirements.txt`
  (`run_web_server.bat` does this by itself when a library is missing)
- Run without a server: double-click `index.html` (uses `model.js`)
- Run with the server: double-click `run_web_server.bat`, or
  `python server.py`
- Open: http://localhost:8000 (the browser opens by itself; if 8000 is busy
  the next free port is used and printed)
- Options: `--port 5000`, `--no-browser`, `--retrain`
- Stop: Ctrl+C in the command prompt

## Tech Stack
- Front end: HTML5 Canvas, CSS, JavaScript (no frameworks, no CDN)
- Back end: Python `http.server` (`ThreadingHTTPServer`), NumPy
- Model: scikit-learn `MLPClassifier` (784 -> 128 ReLU -> 10) trained on
  MNIST; weights exported to `model.js`
- Why not TensorFlow / TensorFlow.js: TensorFlow does not install on the
  newest Python versions and TF.js needs a CDN or a large bundle; the small
  dense network runs in plain JavaScript and NumPy with the same results

## API
| Method | Path | Result |
|---|---|---|
| GET | `/api/status` | `{state, message, progress, test_accuracy}` |
| GET | `/api/model` | weights as JSON (HTTP 503 while training) |
| POST | `/api/predict` | body `{"pixels": [784 values 0-1]}` -> `{digit, confidence, probabilities, percentages, top}` |

`/api/predict` returns HTTP 400 for a wrong body (not 784 finite numbers,
over 64 KB) and 503 while the model is training.

## Two Ways to Run (why `model.js`)
Browsers block `fetch()` for pages opened as `file://`, so a page opened by
double-clicking cannot call `/api/model`. The weights are therefore stored
as `model.js` - one line `window.MNIST_MODEL = {...};` under a header
comment - which a `<script>` tag may load from the same folder.
- `file://` -> `loadModelFromFile()` adds `<script src="model.js">`
- `http://` -> `pollStatus()` / `loadModel()` use `/api/status` and
  `/api/model` (the server reads and writes the same `model.js`)
- `http://` without `/api` (`python -m http.server`, GitHub Pages) ->
  `/api/status` returns 404 or HTML, so `pollStatus()` falls back to
  `loadModelFromFile()`; a network error (server.py still starting) retries
- `model.js` is committed (not in `.gitignore`); without it the page tells
  the user to run `python server.py` once

## Architecture
- `server.py`
  - `train_model()` - background thread; every epoch sees randomly rotated,
    zoomed, slanted and shifted images (`distort_images`, in chunks of 5,000)
  - `read_model_file()` / `write_model_file()` - JSON inside `model.js`
  - `prepare_model()` - loads `model.js`, or trains when it is missing
    or its `MODEL_FORMAT` is old
  - `predict_pixels()` - NumPy forward pass for `/api/predict`
- `app.js`
  1. Drawing: `onPointerDown/Move/Up`, `drawDot`, `drawLine`; every stroke
     is also stored as a list of points (`strokes`)
  2. Preprocessing: `redrawAtFixedSize()` (digit 190 px, so small
     handwriting keeps MNIST-like line thickness) -> `preprocessCanvas()`
     (invert, crop, `downscale` to 20x20 in half steps, 28x28, center of
     mass) -> `drawPreview()`
  3. Network: `dense`, `relu`, `softmax`, `predict`
  4. UI: `buildProbabilityList`, `showProbabilities`, `runPrediction`,
     `clearAll`, `resetResults`
  5. Model loading: `pollStatus` -> `loadModel` (server) or
     `loadModelFromFile` (file://) -> `useModel` -> `buildModel`

## Code Style
- JavaScript: camelCase, `const`/`let`, `"use strict"`
- Python: snake_case, docstrings, English comments
- Every file starts with a header comment: file name, Created / Updated
  date and time (KST) and purpose; update the Updated line on every change

## Development Guide
- The page works both from the server and as a file; test both after
  changing `app.js` (the API, `/api/predict`, needs the server)
- Keep the labels identical to the desktop window: `Recognize`, `Clear`,
  `Predicted Digit: X`, `Confidence: XX.XX%`
- Keep `preprocessCanvas()` identical to the desktop pipeline
  (`../desktop_version/preprocess.py`, `image_to_mnist`) and run
  `python -m pytest -q` in `Week03-DigitRecognition` afterwards -
  `tests/test_parity.py` draws the same strokes in headless Chromium and in
  Python and compares the two 28x28 inputs
- After changing training or the network, bump `MODEL_FORMAT` so old
  `model.js` files are retrained automatically; commit the new `model.js`
- The shipped `model.js` is loaded at once; `--retrain` (or deleting it)
  downloads MNIST and trains again (about 1-2 minutes)

## Measured Results (real MNIST files)
- Model test accuracy 98.14% (10,000 test images)
- Strokes drawn in the browser (300 digits each): large 100%, small
  50-90 px 99.0%, tiny 30-50 px 92.7%, tilted 25 deg 99.0%, shaky 95.7%
- `/api/predict` gives the same digit as the browser for the same input
