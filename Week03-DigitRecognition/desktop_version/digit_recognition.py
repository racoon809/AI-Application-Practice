# =============================================================================
# File    : Week03-DigitRecognition/desktop_version/digit_recognition.py
# Created : 2026-09-23 12:00 (KST, UTC+09:00)
# Updated : 2026-10-28 12:10 (KST, UTC+09:00) - split into preprocess.py,
#           model.py and gui.py; this file is now only the entry point
# Purpose : Handwritten digit recognition program (lecture 3). Starts the
#           Tkinter window; run_digit_recognition.bat calls this file.
# =============================================================================
"""Handwritten Digit Recognition (desktop version) - entry point.

Module map
----------
    preprocess.py   strokes -> 28x28 MNIST frame (pure functions, no Tk)
    model.py        MNIST cache, augmentation, NumPy MLP, Adam training
    gui.py          ModelLoader, StrokePad, ProbabilityChart,
                    RecognizerWindow (the only module importing tkinter)

Only ``main`` imports ``gui``, so ``import digit_recognition`` and the whole
test suite work on machines without tkinter (headless CI, servers).

Run
    python digit_recognition.py                # use cached weights if present
    python digit_recognition.py --retrain      # train a fresh network
    python digit_recognition.py --epochs 15    # longer training run
"""

from __future__ import annotations

import argparse

from model import TrainingPlan


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Handwritten digit recognition (desktop version)")
    parser.add_argument("--retrain", action="store_true",
                        help="ignore mnist_mlp_weights.npz and train again")
    parser.add_argument("--epochs", type=int, default=TrainingPlan.epochs,
                        help="training epochs (default: %(default)s)")
    return parser.parse_args()


def main() -> None:
    options = parse_arguments()
    plan = TrainingPlan(epochs=max(1, options.epochs))
    print("Initializing Handwritten Digit Recognition System...")
    print("This may take a few minutes to train the model...")

    import tkinter as tk                      # GUI only from here on
    from gui import RecognizerWindow

    root = tk.Tk()
    RecognizerWindow(root, plan, retrain=options.retrain)
    root.mainloop()


if __name__ == "__main__":
    main()
