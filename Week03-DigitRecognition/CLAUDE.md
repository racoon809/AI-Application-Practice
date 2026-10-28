<!-- Created: 2026-09-23 10:00 (KST, UTC+09:00) | Updated: 2026-10-28 12:50 (KST, UTC+09:00) - folder renamed to Week03-DigitRecognition, desktop code split into preprocess/model/gui -->
# Week03-DigitRecognition - Handwritten Digit Recognition

Handwritten digit recognition project for lecture 3 of the AI Practice
course, split into a desktop version and a web version (lecture p66-71).

## Project Overview
Users draw a digit (0-9) with the mouse in black on a white canvas. While
they draw, a neural network trained on MNIST (70,000 images, 28x28 pixels)
recognizes the digit in real time and shows the predicted digit, its
confidence and the probability of every digit 0-9 as bars. Both versions
use the lecture's labels ([Recognize], [Clear], `Predicted Digit`,
`Confidence`); the desktop window follows lecture p45-46.

## Commands
- Install libraries: `pip install -r requirements.txt`
  (desktop only: double-click `desktop_version/install_requirements.bat`)
- Desktop: double-click `desktop_version/run_digit_recognition.bat`
  or `cd desktop_version` -> `python digit_recognition.py`
- All tests: `python -m pytest -q` from this folder (`pytest.ini`):
  desktop pipeline/network (43) + desktop-vs-web parity (7, needs
  `pip install playwright` and `python -m playwright install chromium`,
  skipped otherwise)
- Desktop tests only: `cd desktop_version` -> `python -m pytest -q`
- Web without a server: double-click `web_version/index.html`
- Web: double-click `web_version/run_web_server.bat`
  or `cd web_version` -> `python server.py` -> http://localhost:8000
  (the browser opens by itself)

## Tech Stack
- Python 3.10+ on Windows (reference environment)
- Desktop: Tkinter, NumPy, Pillow (NumPy neural network)
- Web: HTML5 Canvas, CSS, JavaScript, Python `http.server`; scikit-learn
  trains the model in `server.py`

## Folder Structure
```
Week03-DigitRecognition/
├── CLAUDE.md                        <- common rules (this file)
├── requirements.txt                 <- libraries for both versions
├── pytest.ini                       <- runs both test folders
├── .gitignore                       <- generated caches are not committed
├── tests/test_parity.py             <- desktop vs web preprocessing parity
├── desktop_version/
│   ├── CLAUDE.md                    <- architecture, threading rules, ADRs
│   ├── digit_recognition.py         <- entry point (argparse + main)
│   ├── preprocess.py                <- strokes -> 28x28 (no tkinter)
│   ├── model.py                     <- MNIST cache, NumPy MLP, training
│   ├── gui.py                       <- Tkinter components (only Tk import)
│   ├── run_digit_recognition.bat    <- double-click launcher
│   ├── install_requirements.bat     <- installs the desktop libraries
│   ├── requirements.txt             <- desktop libraries
│   └── tests/test_preprocess.py     <- pytest suite (43 tests, headless)
└── web_version/
    ├── CLAUDE.md                    <- web rules
    ├── index.html                   <- page layout
    ├── style.css                    <- styling
    ├── app.js                       <- drawing, preprocessing, prediction
    ├── server.py                    <- local server + model training
    ├── run_web_server.bat           <- double-click: start server + browser
    ├── model.js                     <- trained weights (index.html uses it)
    └── requirements.txt             <- web libraries
```

Shared pipeline (both versions):
1. Train a neural network (784 -> 128 -> 10) on MNIST without freezing the UI,
   with random rotation / zoom / slant / shift of the training images
2. Draw in black on a 280x280 white canvas with a 20px round pen
3. Redraw the strokes so the digit is 190px tall/wide (same line thickness
   ratio for small and large handwriting)
4. Invert to white-on-black, crop the ink, scale to 20x20, place in 28x28 by
   center of mass, values 0.0-1.0
5. Recognize in real time (about 0.12 s after the pen stops moving; the
   Recognize button also works) and show `Predicted Digit: X`,
   `Confidence: XX.XX%` and the probabilities

## Common Rules
- All code and comments are written in English
- Every file starts with a comment giving the file name, the date and time it
  was created (KST) and its purpose; every later change also updates the
  `Updated` date and time with a few words on what changed
- Folder and file names use English letters, numbers, `_` and `-` only
- Keep the preprocessing the same in both versions; `tests/test_parity.py`
  checks it (centroid within 0.5 px, mean pixel difference < 0.04, same
  predicted digit)

## Why two training pipelines
The desktop app trains its own NumPy network so it runs with only NumPy +
Pillow and stores weights without pickle (desktop ADR-1); the web version
trains with scikit-learn on the server and exports the weights to
`model.js`, so the page can predict with no install and no server (GitHub
Pages). Both feed the network the same 28x28 input, which the parity test
verifies.
- Update the matching CLAUDE.md when a feature, command or setting changes

## Memory
- 앞으로 만드는 모든 파일은 날짜와 시간을 주석으로 표시해 줘.
- 파일을 수정할 때도 맨 위 주석의 Updated 날짜와 시간을 함께 바꿔 줘.
