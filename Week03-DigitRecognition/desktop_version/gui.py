# =============================================================================
# File    : Week03-DigitRecognition/desktop_version/gui.py
# Created : 2026-10-28 12:10 (KST, UTC+09:00) - split out of digit_recognition.py
# Purpose : Tkinter layer: background model loader, stroke pad, probability
#           chart and the lecture-style window. The only module that
#           imports tkinter.
# =============================================================================
"""Tkinter components of the desktop version.

    ModelLoader       worker thread + queue.Queue, LoaderState enum
    StrokePad         tk.Canvas that keeps strokes as point lists (undo)
    ProbabilityChart  tk.Canvas with ten reusable bars
    RecognizerWindow  orchestrator: layout, shortcuts, live recognition
"""

from __future__ import annotations

import queue
import threading
import time
from enum import Enum, auto
from typing import Callable, Sequence

import numpy as np
from PIL import Image, ImageTk

import tkinter as tk
from tkinter import messagebox

from model import (WEIGHTS_FILE, MnistMlp, TrainingCancelled, TrainingPlan,
                   load_mnist_arrays, train_network)
from preprocess import GRID, PAD_PIXELS, PEN_WIDTH, Point, render_strokes, \
    strokes_to_mnist

LIVE_DELAY_MS = 120          # real-time recognition: wait after the last move

PALETTE = {
    "pad": "#ffffff", "ink": "#000000", "panel": "#f3f4f8",
    "pad_border": "#c3c8d4",
    "accent": "#3b5bdb", "accent_soft": "#c5d0fa", "text": "#1b1e28",
    "muted": "#6a7085", "track": "#e2e5ee", "danger": "#c92a2a",
}



# =============================================================================
# Component 2 - ModelLoader: worker thread + queue + state enum
# =============================================================================
class LoaderState(Enum):
    LOADING = auto()
    READY = auto()
    FAILED = auto()


class ModelLoader:
    """Prepares the network off the UI thread and reports through a queue.

    The worker thread never touches Tk. It only ``put``s messages into
    ``queue.Queue``; the Tk thread drains that queue every 100 ms in
    ``_drain_queue`` and forwards each message to the matching callback.
    Polling stops as soon as the state leaves ``LOADING``.
    """

    POLL_MS = 100

    def __init__(self, tk_root: tk.Misc, plan: TrainingPlan, retrain: bool,
                 on_progress: Callable[[str, int], None],
                 on_ready: Callable[[MnistMlp, dict[str, float]], None],
                 on_failed: Callable[[BaseException], None]):
        self._root = tk_root
        self._plan = plan
        self._retrain = retrain
        self._handlers = {"progress": on_progress, "ready": on_ready,
                          "failed": on_failed}
        self._inbox: queue.Queue[tuple[str, tuple]] = queue.Queue()
        self._cancelled = threading.Event()
        self._worker = threading.Thread(target=self._run, daemon=True,
                                        name="neural-engine-loader")
        self.state = LoaderState.LOADING

    # -- public API (Tk thread) ------------------------------------------------
    def start(self) -> None:
        self._worker.start()
        self._root.after(self.POLL_MS, self._drain_queue)

    def cancel(self) -> None:
        self._cancelled.set()

    # -- worker thread ---------------------------------------------------------
    def _post(self, kind: str, *payload) -> None:
        self._inbox.put((kind, payload))

    def _run(self) -> None:
        try:
            network, info = self._obtain_network()
            self._post("ready", network, info)
        except TrainingCancelled:
            pass
        except Exception as error:  # reported to the user on the Tk thread
            self._post("failed", error)

    def _obtain_network(self) -> tuple[MnistMlp, dict[str, float]]:
        progress = lambda text, percent: self._post("progress", text, percent)
        if not self._retrain and WEIGHTS_FILE.exists():
            try:
                progress("Loading the trained model (mnist_mlp_weights.npz)...",
                         60)
                return MnistMlp.load(WEIGHTS_FILE)
            except (OSError, KeyError, ValueError):
                progress("Stored weights are unusable - retraining", 5)

        data = load_mnist_arrays(progress)
        started = time.perf_counter()
        network = train_network(data, self._plan, progress, self._cancelled)
        info = {
            "test_accuracy": network.accuracy(data["x_test"],
                                              data["y_test"].astype(np.int64)),
            "train_seconds": time.perf_counter() - started,
            "epochs": float(self._plan.epochs),
        }
        network.save(WEIGHTS_FILE, **info)
        return network, info

    # -- Tk thread ---------------------------------------------------------------
    def _drain_queue(self) -> None:
        while True:
            try:
                kind, payload = self._inbox.get_nowait()
            except queue.Empty:
                break
            if kind == "ready":
                self.state = LoaderState.READY
            elif kind == "failed":
                self.state = LoaderState.FAILED
            self._handlers[kind](*payload)
        if self.state is LoaderState.LOADING and not self._cancelled.is_set():
            self._root.after(self.POLL_MS, self._drain_queue)


# =============================================================================
# Component 3 - StrokePad: vector strokes, undo, on-demand rasterization
# =============================================================================
class StrokePad(tk.Canvas):
    """White drawing surface that keeps every stroke as a list of points.

    ``strokes`` works as a stack: a new stroke is pushed on mouse press and
    Ctrl+Z pops the latest one. Each stroke owns exactly one canvas line
    item whose coordinates grow with ``coords()``; nothing new is allocated
    per mouse event, and undo removes a single item.
    """

    def __init__(self, master: tk.Misc, size: int = PAD_PIXELS,
                 pen: int = PEN_WIDTH,
                 on_change: Callable[[], None] | None = None):
        super().__init__(master, width=size, height=size,
                         bg=PALETTE["pad"], highlightthickness=1,
                         highlightbackground=PALETTE["pad_border"],
                         cursor="pencil")
        self.size, self.pen = size, pen
        self.strokes: list[list[Point]] = []
        self._line_items: list[int] = []
        self._on_change = on_change        # called whenever the ink changes
        self.bind("<ButtonPress-1>", self._begin_stroke)
        self.bind("<B1-Motion>", self._extend_stroke)
        self.bind("<ButtonRelease-1>", self._end_stroke)

    @property
    def is_blank(self) -> bool:
        return not self.strokes

    def _clamp(self, event: tk.Event) -> Point:
        limit = self.size - 1
        return min(max(event.x, 0), limit), min(max(event.y, 0), limit)

    def _begin_stroke(self, event: tk.Event) -> None:
        x, y = self._clamp(event)
        self.strokes.append([(x, y)])
        self._line_items.append(self.create_line(
            x, y, x + 1, y, fill=PALETTE["ink"], width=self.pen,
            capstyle=tk.ROUND, joinstyle=tk.ROUND))
        self._notify()

    def _extend_stroke(self, event: tk.Event) -> None:
        if not self.strokes:
            return
        point = self._clamp(event)
        stroke = self.strokes[-1]
        if point == stroke[-1]:
            return
        stroke.append(point)
        self.coords(self._line_items[-1],
                    *[value for xy in stroke for value in xy])
        self._notify()

    def _end_stroke(self, _event: tk.Event) -> None:
        self._notify()

    def _notify(self) -> None:
        if self._on_change is not None:
            self._on_change()

    def undo(self) -> bool:
        """Remove the most recent stroke. Returns False if nothing to undo."""
        if not self.strokes:
            return False
        self.strokes.pop()
        self.delete(self._line_items.pop())
        return True

    def wipe(self) -> None:
        self.delete("all")
        self.strokes.clear()
        self._line_items.clear()

    def rasterize(self) -> Image.Image:
        return render_strokes(self.strokes, self.size, self.pen)


# =============================================================================
# Component 4 - ProbabilityChart: ten reusable bars
# =============================================================================
class ProbabilityChart(tk.Canvas):
    """Vertical bar chart of the ten class probabilities.

    All shapes are created once; ``show`` only moves coordinates and
    recolours items, so repeated inference never grows the canvas.
    """

    def __init__(self, master: tk.Misc, width: int = 320, height: int = 170,
                 background: str = PALETTE["panel"]):
        super().__init__(master, width=width, height=height,
                         bg=background, highlightthickness=0)
        self._floor = height - 22            # baseline of the bars
        self._ceiling = 18                   # top of a 100 % bar
        slot = width / 10
        self._bars: list[int] = []
        self._values: list[int] = []
        for digit in range(10):
            left = digit * slot + slot * 0.2
            right = (digit + 1) * slot - slot * 0.2
            self.create_rectangle(left, self._ceiling, right, self._floor,
                                  fill=PALETTE["track"], width=0)
            self._bars.append(self.create_rectangle(
                left, self._floor, right, self._floor,
                fill=PALETTE["accent_soft"], width=0))
            self._values.append(self.create_text(
                (left + right) / 2, self._ceiling - 8, text="",
                font=("Segoe UI", 7), fill=PALETTE["muted"]))
            self.create_text((left + right) / 2, self._floor + 11,
                             text=str(digit), font=("Segoe UI", 10, "bold"),
                             fill=PALETTE["text"])

    def show(self, probabilities: Sequence[float]) -> None:
        winner = int(np.argmax(probabilities))
        span = self._floor - self._ceiling
        for digit, (bar, label) in enumerate(zip(self._bars, self._values)):
            share = float(probabilities[digit])
            left, _, right, _ = self.coords(bar)
            self.coords(bar, left, self._floor - span * share, right,
                        self._floor)
            highlight = digit == winner
            self.itemconfigure(bar, fill=PALETTE["accent"] if highlight
                               else PALETTE["accent_soft"])
            self.itemconfigure(label, text=f"{share * 100:.0f}%"
                               if share >= 0.005 else "")

    def reset(self) -> None:
        self.show([0.0] * 10)
        for bar in self._bars:
            self.itemconfigure(bar, fill=PALETTE["accent_soft"])


# =============================================================================
# Component 5 - RecognizerWindow: orchestrator (lecture-style layout)
# =============================================================================
PROMPT = "Draw a digit and click 'Recognize'"
GUIDE = ("Draw a digit (0-9) in the white area above.\n"
         "The prediction updates in real time while you draw\n"
         "('Recognize' runs it once more on demand).\n"
         "Ctrl+Z undoes the last stroke.")


class RecognizerWindow:
    """Builds the single-column window from the lecture (white box, Clear /
    Recognize buttons, result lines, guide text) and connects the stroke
    pad, the probability chart, the 28x28 preview and the model loader."""

    PREVIEW_PIXELS = GRID * 3          # 28x28 model input shown at 84x84

    def __init__(self, root: tk.Tk, plan: TrainingPlan, retrain: bool):
        self.root = root
        self.network: MnistMlp | None = None
        self._live_job: str | None = None    # pending real-time recognition
        self.result_text = tk.StringVar(value="Training model... please wait")
        self.confidence_text = tk.StringVar(value="")

        root.protocol("WM_DELETE_WINDOW", self._shutdown)
        root.wm_title("Handwritten Digit Recognition")
        root.wm_resizable(width=False, height=False)
        self._compose_layout()
        self._register_shortcuts()

        self.loader = ModelLoader(root, plan, retrain,
                                  on_progress=self._engine_progress,
                                  on_ready=self._engine_online,
                                  on_failed=self._engine_failed)
        self.loader.start()

    # -- layout -----------------------------------------------------------------
    def _compose_layout(self) -> None:
        window_bg = self.root.cget("bg")

        self.pad = StrokePad(self.root, on_change=self._schedule_live)
        self.pad.pack(padx=24, pady=(20, 10))

        buttons = tk.Frame(self.root)
        buttons.pack()
        tk.Button(buttons, text="Clear",
                  command=self.clear_canvas).pack(side=tk.LEFT, padx=3)
        self.recognize_button = tk.Button(buttons, text="Recognize",
                                          command=self.recognize,
                                          state=tk.DISABLED)
        self.recognize_button.pack(side=tk.LEFT, padx=3)
        tk.Button(buttons, text="Undo",
                  command=self.undo_stroke).pack(side=tk.LEFT, padx=3)

        # Two result lines, as in lecture p46
        for variable, size, gap in ((self.result_text, 12, (12, 0)),
                                    (self.confidence_text, 11, 0)):
            line = tk.Label(self.root, textvariable=variable,
                            font=("Arial", size, "bold"))
            line.pack(pady=gap)

        # Details row: what the network sees + probability of every digit
        details = tk.Frame(self.root)
        details.pack(padx=16, pady=(10, 0))
        input_box = tk.Frame(details)
        input_box.pack(side=tk.LEFT, padx=(0, 10))
        tk.Label(input_box, text="Model input",
                 font=("Arial", 8)).pack()
        self.preview = tk.Canvas(input_box, width=self.PREVIEW_PIXELS,
                                 height=self.PREVIEW_PIXELS, bg="black",
                                 highlightthickness=0)
        self.preview.pack()
        # One PhotoImage for the whole session, refreshed with paste():
        # no new Tk image per prediction -> no leak, no GC flicker.
        self._preview_photo = ImageTk.PhotoImage(
            "L", (self.PREVIEW_PIXELS, self.PREVIEW_PIXELS))
        self.preview.create_image(0, 0, anchor="nw",
                                  image=self._preview_photo)
        self.chart = ProbabilityChart(details, width=240, height=110,
                                      background=window_bg)
        self.chart.pack(side=tk.LEFT)

        tk.Label(self.root, text=GUIDE, font=("Arial", 8),
                 justify=tk.CENTER).pack(pady=(10, 18))

    def _register_shortcuts(self) -> None:
        for sequence in ("<Control-z>", "<Control-Z>"):
            self.root.bind(sequence, lambda _e: self.undo_stroke())
        self.root.bind("<Return>", lambda _e: self.recognize())
        self.root.bind("<Escape>", lambda _e: self.clear_canvas())

    # -- loader callbacks (always on the Tk thread) ------------------------------
    def _engine_progress(self, text: str, _percent: int) -> None:
        print(text)                                  # console log, as in p53
        self.result_text.set(text)

    def _engine_online(self, network: MnistMlp, info: dict[str, float]) -> None:
        self.network = network
        accuracy = info.get("test_accuracy")
        if accuracy:
            print(f"Test accuracy: {accuracy:.2%}")
        print("Model ready. The drawing window is waiting for you.")
        self.recognize_button["state"] = tk.NORMAL
        if self.pad.is_blank:
            self._announce(PROMPT)
        else:
            self.recognize()          # the user drew while it was training

    def _engine_failed(self, error: BaseException) -> None:
        self._announce("Model could not be prepared")
        messagebox.showerror(
            "Model error",
            f"{type(error).__name__}: {error}\n\nThe first launch downloads "
            "MNIST once (about 11 MB). Check the internet connection and "
            "start the program again.")

    # -- real-time recognition ----------------------------------------------------
    def _schedule_live(self) -> None:
        """Run ``recognize`` LIVE_DELAY_MS after the latest pen movement.

        Mouse events arrive up to ~100 times per second; restarting one
        timer on each event (debouncing) keeps the result live while
        doing at most a few predictions per second.
        """
        self._cancel_live()
        if self.network is not None:
            self._live_job = self.root.after(LIVE_DELAY_MS, self._run_live)

    def _run_live(self) -> None:
        self._live_job = None
        if not self.pad.is_blank:
            self.recognize()

    def _cancel_live(self) -> None:
        if self._live_job is not None:
            self.root.after_cancel(self._live_job)
            self._live_job = None

    # -- user actions -------------------------------------------------------------
    def clear_canvas(self) -> None:
        self._cancel_live()
        self.pad.wipe()
        self._reset_result()

    def undo_stroke(self) -> None:
        if not self.pad.undo():
            return
        self._cancel_live()
        if self.pad.is_blank:
            self._reset_result()
        elif self.network is not None:
            self.recognize()          # keep the shown result up to date

    def recognize(self) -> None:
        if self.network is None:
            self._announce("Model is still training, please wait...")
            return
        frame = strokes_to_mnist(self.pad.strokes)
        if frame is None:
            self._announce("Please draw a digit first")
            return
        digit, confidence, probabilities = self.network.classify(frame)
        self._announce(f"Predicted Digit: {digit}",
                       f"Confidence: {confidence * 100:.2f}%")
        self.chart.show(probabilities)
        self._refresh_preview(frame)

    # -- helpers ----------------------------------------------------------------
    def _announce(self, headline: str, detail: str = "") -> None:
        """Write the two result lines under the buttons."""
        self.result_text.set(headline)
        self.confidence_text.set(detail)

    def _refresh_preview(self, frame: np.ndarray | None) -> None:
        if frame is None:
            pixels = np.zeros((GRID, GRID), dtype=np.uint8)
        else:
            pixels = (np.clip(frame, 0.0, 1.0) * 255).astype(np.uint8)
        enlarged = Image.fromarray(pixels, "L").resize(
            (self.PREVIEW_PIXELS, self.PREVIEW_PIXELS),
            Image.Resampling.NEAREST)
        self._preview_photo.paste(enlarged)

    def _reset_result(self) -> None:
        self._announce(PROMPT if self.network else
                       "Training model... please wait")
        self.chart.reset()
        self._refresh_preview(None)

    def _shutdown(self) -> None:
        self._cancel_live()
        self.loader.cancel()
        self.root.destroy()
