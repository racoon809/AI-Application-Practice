<!-- Created: 2026-09-23 10:00 (KST, UTC+09:00) | Updated: 2026-10-28 12:50 (KST, UTC+09:00) - split into preprocess/model/gui (ADR-12) -->
# Desktop Version - Handwritten Digit Recognition

Desktop-only rules for the Tkinter app. The common rules in `../CLAUDE.md`
(project root) also apply here.

## Project Overview
Python/Tkinter development guide for the desktop version. The window follows
the lecture example (p45-46): a white drawing area, [Clear] and [Recognize]
buttons, `Predicted Digit: X` / `Confidence: XX.XX%` and the guide text. The
result is updated in real time while the user draws. Below
the result it adds an [Undo] button (also Ctrl+Z), the 28x28 model input and a
custom 0-9 probability chart. A NumPy neural network trained on MNIST does
the recognition; the console shows the training log as in lecture p53.

## Folder Structure
```
desktop_version/
├── CLAUDE.md                  <- this file (rules, architecture, ADRs)
├── digit_recognition.py       <- entry point: argparse + main()
├── preprocess.py              <- image pipeline, pure functions (no tkinter)
├── model.py                   <- MNIST cache, augmentation, MnistMlp, training
├── gui.py                     <- ModelLoader, StrokePad, ProbabilityChart,
│                                 RecognizerWindow (only module importing tk)
├── run_digit_recognition.bat  <- Windows Explorer launcher (lecture p51)
├── install_requirements.bat   <- installs requirements.txt (lecture p51)
├── requirements.txt           <- numpy, pillow, pytest
├── tests/
│   └── test_preprocess.py     <- pytest suite (43 tests, runs without tkinter)
├── mnist.npz                  <- generated: compressed MNIST cache
└── mnist_mlp_weights.npz      <- generated: trained network weights
```
The two `.npz` files are created on the first run and are not committed.

## Commands
- Install: double-click `install_requirements.bat`
  (or `pip install -r requirements.txt`; scikit-learn is NOT needed)
- Run: `python digit_recognition.py`
- Retrain (ignore stored weights): `python digit_recognition.py --retrain`
- Longer training: `python digit_recognition.py --epochs 15`
- Double-click launcher: `run_digit_recognition.bat`
- Tests: `pip install pytest` then `python -m pytest -q` (from this folder;
  works on headless machines with no tkinter)

## Tech Stack
- Python 3.10+, Tkinter + ttk (`clam` theme)
- NumPy - training (mini-batch Adam) and inference (forward pass)
- Pillow - stroke rasterization (`ImageDraw`), inversion (`ImageOps`),
  resizing, `ImageTk.PhotoImage`
- Optional: scikit-learn, used only as a fallback MNIST source (OpenML)

## Architecture
Five independent components spread over three modules
(`model.py`: `MnistMlp`; `gui.py`: the other four):

| Component | Base | Responsibility |
|---|---|---|
| `MnistMlp` | plain class | 784 -> 128 (ReLU) -> 10 (Softmax) forward pass in NumPy; `classify`, `accuracy`, `.npz` save/load |
| `ModelLoader` | owns a `threading.Thread` | loads or trains the network off the UI thread; reports through `queue.Queue`; `LoaderState` enum; `_drain_queue` every 100 ms |
| `StrokePad` | `tk.Canvas` | white pad; strokes kept as a stack of point lists; one line item per stroke; Ctrl+Z `undo`; `on_change` callback on every pen movement |
| `ProbabilityChart` | `tk.Canvas` | custom ten-bar chart drawn with canvas rectangles, created once and updated with `coords`/`itemconfigure` |
| `RecognizerWindow` | orchestrator | lecture-style layout, real-time recognition (`_schedule_live`), result labels, Undo button, preview, shortcuts |

Image pipeline in `preprocess.py` (pure functions, unit tested, no Tk needed):
`normalize_strokes` (190 px) -> `render_strokes` (black on white) ->
`to_white_on_black` -> `ink_bounds` ->
`fit_to_box` (20x20) -> `center_of_mass` / `compose_mnist_frame` (28x28)
-> `image_to_mnist` (`strokes_to_mnist` runs the whole chain). Also
`load_mnist_arrays`, `train_network`, `distort_batch`.

## Threading Rules
1. Only the Tk main thread may touch widgets, `StringVar`s or the canvas.
2. The loader's worker thread communicates only by
   `queue.Queue.put(("progress" | "ready" | "failed", payload))`.
3. `ModelLoader._drain_queue` runs on the Tk thread every 100 ms
   (`root.after`), empties the queue and calls the matching callback.
4. Polling stops as soon as `LoaderState` leaves `LOADING`.
5. Closing the window sets a `threading.Event`; the training loop checks it
   every batch and stops (`TrainingCancelled`).
6. The worker is a daemon thread, so it never keeps the process alive.
7. [Recognize] stays disabled until the state is `READY`; real-time
   recognition is only scheduled once the network exists.
8. Real-time recognition uses `root.after` on the Tk thread (no extra
   thread); one pending job at most, cancelled on Clear, Undo and close.

## Architectural Decisions

### ADR-1: Inference in pure NumPy instead of scikit-learn
- Context: pickling an `MLPClassifier` ties the cache to one scikit-learn
  version, and a sklearn install is heavy for a small app.
- Decision: implement the network as two matrix products + ReLU + stable
  softmax (`MnistMlp.forward`) and train it with a hand-written Adam loop
  (`train_network`). Weights are plain arrays in `mnist_mlp_weights.npz`
  with a `schema` number.
- Consequences: runtime needs only NumPy + Pillow; loading weights is safe
  (no pickle) and took about 0.1 s in testing; one inference takes about
  1 ms. Tests cover softmax, ReLU, probability sums and the save/load round
  trip.

### ADR-2: Queue-based concurrency with an explicit state machine
- Context: Tkinter is single-threaded. Calling `root.after` from a worker
  thread spreads UI logic across threads and is hard to reason about.
- Decision: see Threading Rules above - worker posts messages, Tk thread
  drains them every 100 ms, `LoaderState` (LOADING / READY / FAILED) decides
  whether polling continues, a `threading.Event` cancels training.
- Consequences: all widget access stays on the Tk thread; errors reach the
  user as a dialog instead of disappearing inside the thread.

### ADR-3: Vector strokes on a stack, rasterized on demand
- Context: drawing into a bitmap on every mouse event makes undo impossible
  and creates hundreds of canvas items per stroke.
- Decision: `StrokePad` stores `list[list[(x, y)]]` used as a stack and keeps
  exactly one canvas line item per stroke (extended with `coords()`). The
  bitmap is built only when needed by `render_strokes`.
- Consequences: Ctrl+Z undo is a `pop` + one `delete`; canvas item count
  equals stroke count; rasterization is a pure, testable function.

### ADR-4: Leak-free preview and custom chart
- Decision: one `ImageTk.PhotoImage` is created for the session and refreshed
  with `paste()`; `ProbabilityChart` draws its 40 canvas items once.
- Consequences: repeated predictions allocate no new Tk images and no new
  canvas items.

### ADR-5: MNIST cached as compressed NumPy (`mnist.npz`)
- Decision: download once (Keras mirror, OpenML fallback), save with
  `np.savez_compressed`, write atomically (`.partial` + `os.replace`).
- Consequences: later loads took about 0.4 s in testing instead of
  downloading and parsing again.

### ADR-6: MNIST-faithful preprocessing
- Decision: crop ink -> scale the longer side to 20 px -> place on a 28x28
  frame in one step so the centroid lands on (13.5, 13.5), with the offset
  clipped so no ink leaves the frame.
- Consequences: output matches the MNIST layout (20x20 glyph, 4 px margin,
  centred by mass); position on the pad does not change the result.

### ADR-7: White pad, inversion as an explicit pipeline step
- Context: users expect paper-like black ink on white, but MNIST digits are
  white on black.
- Decision: `render_strokes` reproduces the screen (black on white) and
  `to_white_on_black` (`ImageOps.invert`) converts it before cropping.
- Consequences: what is rasterized matches what is shown; the polarity
  change lives in one small function covered by its own tests.

### ADR-8: Lecture-style window on top of the component design
- Context: the course grades against the lecture example (p45-46, p53), but
  the code must also be well structured and clearly our own work.
- Decision: keep the lecture's window title, layout, button names, result
  texts, guide text and console messages ("Initializing Handwritten Digit
  Recognition System...", "Loading MNIST dataset...", "Building neural
  network model...", "Training model...", "Epoch n/10"). Extras are placed
  below the result in a compact row (Undo, model input, chart). Unlike the
  lecture the window opens immediately and shows the training progress in
  the result line, because training runs in the background loader.
- Consequences: the program looks and behaves like the lecture example while
  the five components, tests and ADRs stay unchanged.

### ADR-9: Redraw the strokes at a fixed size before preprocessing
- Context: the pen is always 20 px. A digit written 50 px tall has lines
  about 40% of its height; after scaling to 20x20 it looks like a blob, so
  small handwriting was often misread (stress test: 71.8% for 50-90 px
  digits, 33% for 30-50 px).
- Decision: `normalize_strokes` scales and centres the stored strokes so
  the digit is 190 px tall/wide, then `render_strokes` draws it with the
  normal 20 px pen. The screen is not changed; only the model input is.
- Consequences: line thickness relative to the digit is the same for every
  size (small 100%, tiny 93.8% in the same test). Only possible because the
  strokes are stored as vectors (ADR-3).

### ADR-10: Rotation / zoom / slant / shift augmentation
- Context: people write tilted, slanted and slightly off-size digits; a
  network trained on plain MNIST was unsure on those (shaky 88%).
- Decision: `distort_batch` applies a random inverse affine warp to every
  training batch (rotation +-15 deg, zoom 0.85-1.15, shear +-0.2,
  shift +-2 px, bilinear, vectorised). `WEIGHTS_SCHEMA` was raised to 3 so
  weights from the old version are retrained automatically.
- Consequences: MNIST test accuracy 97.87% (unchanged), tilted 25 deg
  99.0%, shaky 97.5%; training takes about 40 s instead of 11 s.

### ADR-11: Real-time recognition with a debounce timer
- Context: the assignment asks for recognition "in real time" while the
  user draws. Running the network on every `<B1-Motion>` event (up to ~100
  per second) would waste work and could make drawing feel sluggish.
- Decision: `StrokePad` calls `on_change` on press, every movement and
  release; `RecognizerWindow._schedule_live` restarts one `root.after`
  timer (`LIVE_DELAY_MS` = 120 ms) each time, so `recognize` runs once the
  pen pauses. [Recognize] and Enter still run it on demand.
- Consequences: the result follows the drawing; in the GUI test 36 pen
  movements caused only 2 predictions. One prediction takes about 1 ms
  plus rendering, so the window stays responsive.

### ADR-12: Split by responsibility so tests never need tkinter
- Context: everything lived in one 933-line `digit_recognition.py` that
  imported `tkinter` and `PIL.ImageTk` at the top, so even the pure
  pipeline tests failed during collection on machines without Tk
  (headless CI, Linux servers).
- Decision: `preprocess.py` (pipeline, NumPy + Pillow), `model.py` (data,
  augmentation, `MnistMlp`, training), `gui.py` (all Tk code) and a thin
  `digit_recognition.py` entry point that imports `gui` only inside
  `main()`. Dependencies point one way: gui -> model -> preprocess.
- Consequences: `tests/test_preprocess.py` imports `preprocess` and `model`
  only; `test_core_modules_do_not_import_tkinter` guards the rule. The
  launcher and command line are unchanged.

## Code Style
- English code, comments and UI text; type hints on public functions
- snake_case functions, PascalCase classes, UPPER_CASE constants
- Header comment with file, Created / Updated date and time (KST) and
  purpose at the top of every file
- Lecture labels stay as specified: [Clear], [Recognize],
  `Predicted Digit:`, `Confidence:`, "Draw a digit and click 'Recognize'"
  (the button stays even though recognition also runs in real time)

## Development Notes
- After changing the network layout, bump `WEIGHTS_SCHEMA` (old weights are
  then retrained automatically)
- After changing preprocessing, run the tests and use `--retrain`
- Default training (10 epochs with rotate/zoom/slant/shift augmentation)
  took about 40 s on a 2-core CPU with the real MNIST data
- Shortcuts: Ctrl+Z undo, Enter recognize, Esc clear
- Measured with the real MNIST files: 97.87% on the 10,000 test images.
  Pen-stroke stress test (400 digits each): large 100%, medium 100%,
  small 50-90 px 100%, tiny 30-50 px 93.8%, tilted 25 deg 99.0%,
  shaky 97.5%
