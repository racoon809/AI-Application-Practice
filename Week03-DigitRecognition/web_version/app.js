/*
 * File    : Week03-DigitRecognition/web_version/app.js
 * Created : 2026-09-23 10:00 (KST, UTC+09:00)
 * Updated : 2026-10-28 12:50 (KST, UTC+09:00) - folder renamed to Week03-DigitRecognition
 * Updated : 2026-10-28 10:00 (KST, UTC+09:00) - static servers (python -m
 *           http.server, GitHub Pages) fall back to model.js when /api/status
 *           is missing (404 or not JSON)
 * Purpose : Canvas drawing, MNIST-style preprocessing and in-browser
 *           prediction for the web version of the digit recognizer
 *
 * Flow:
 *   1. Through server.py (http://): poll /api/status until the model is
 *      ready, then download the weights from /api/model.
 *      Opened as a file (file://): load the weights from model.js with a
 *      <script> tag (fetch() is blocked for local files).
 *   2. The weights are an MLP 784-128-10 in JSON form.
 *   3. User draws on the 280x280 canvas (mouse, pen or touch).
 *   4. preprocessCanvas() redraws the strokes so the digit is 190 px, then
 *        converts it to a 28x28 MNIST input:
 *        invert -> crop ink -> fit 20x20 -> paste in 28x28 -> center of mass
 *   5. predict() runs the neural network in JavaScript and the UI shows
 *        "Predicted Digit: X", "Confidence: XX.XX%" and all 10 probabilities.
 */
"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CANVAS_SIZE = 280;     // drawing canvas size (pixels)
const MODEL_SIZE = 28;       // MNIST image size
const DIGIT_BOX = 20;        // MNIST digits fit inside a 20x20 box
const BRUSH_WIDTH = 20;      // pen width on the 280x280 canvas
const INK_THRESHOLD = 30;    // 0-255 value treated as ink
const DIGIT_SPAN = 190;      // digit size (px) the strokes are redrawn at
const STATUS_POLL_MS = 1500; // model status polling interval

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const drawCanvas = document.getElementById("draw-canvas");
const drawCtx = drawCanvas.getContext("2d", { willReadFrequently: true });
const previewCanvas = document.getElementById("preview-canvas");
const previewCtx = previewCanvas.getContext("2d");

const clearBtn = document.getElementById("clear-btn");
const predictBtn = document.getElementById("predict-btn");
const liveToggle = document.getElementById("live-toggle");

const statusBox = document.getElementById("model-status");
const statusText = document.getElementById("model-status-text");
const statusProgress = document.getElementById("model-progress");
const statusFill = document.getElementById("model-progress-fill");

const bigDigit = document.getElementById("big-digit");
const predictedText = document.getElementById("predicted-text");
const confidenceText = document.getElementById("confidence-text");
const probList = document.getElementById("prob-list");
const messageText = document.getElementById("message");
const accuracyText = document.getElementById("accuracy-text");

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------
let model = null;        // { layers: [{ inputs, outputs, activation, W, b }] }
let isDrawing = false;
let lastPoint = null;
let hasInk = false;
let strokes = [];        // every stroke as a list of {x, y} points

// ===========================================================================
// 1. Drawing canvas
// ===========================================================================
function resetCanvas() {
  drawCtx.fillStyle = "#ffffff";
  drawCtx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  drawCtx.strokeStyle = "#000000";
  drawCtx.fillStyle = "#000000";
  drawCtx.lineWidth = BRUSH_WIDTH;
  drawCtx.lineCap = "round";
  drawCtx.lineJoin = "round";
  hasInk = false;
  strokes = [];
}

/** Convert a pointer event to canvas coordinates (canvas may be CSS-scaled). */
function getCanvasPoint(event) {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * CANVAS_SIZE) / rect.width,
    y: ((event.clientY - rect.top) * CANVAS_SIZE) / rect.height,
  };
}

function drawDot(point) {
  drawCtx.beginPath();
  drawCtx.arc(point.x, point.y, BRUSH_WIDTH / 2, 0, Math.PI * 2);
  drawCtx.fill();
}

function drawLine(from, to) {
  drawCtx.beginPath();
  drawCtx.moveTo(from.x, from.y);
  drawCtx.lineTo(to.x, to.y);
  drawCtx.stroke();
}

function onPointerDown(event) {
  event.preventDefault();
  drawCanvas.setPointerCapture(event.pointerId);
  isDrawing = true;
  lastPoint = getCanvasPoint(event);
  strokes.push([lastPoint]);
  drawDot(lastPoint);
  hasInk = true;
}

function onPointerMove(event) {
  if (!isDrawing) return;
  event.preventDefault();
  const point = getCanvasPoint(event);
  strokes[strokes.length - 1].push(point);
  drawLine(lastPoint, point);
  lastPoint = point;
}

function onPointerUp(event) {
  if (!isDrawing) return;
  isDrawing = false;
  lastPoint = null;
  if (drawCanvas.hasPointerCapture(event.pointerId)) {
    drawCanvas.releasePointerCapture(event.pointerId);
  }
  // Real-time mode: predict as soon as a stroke is finished
  if (liveToggle.checked && model) {
    runPrediction();
  } else {
    updatePreviewOnly();
  }
}

// ===========================================================================
// 2. MNIST-style preprocessing
// ===========================================================================

/**
 * Downscale an image in several half-size steps for smooth anti-aliasing
 * (a single big drawImage() step can look blocky in some browsers).
 */
function downscale(source, sx, sy, sw, sh, targetW, targetH) {
  let canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  let ctx = canvas.getContext("2d");
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);

  let width = sw;
  let height = sh;
  while (width / 2 >= targetW && height / 2 >= targetH) {
    const nextW = Math.max(targetW, Math.floor(width / 2));
    const nextH = Math.max(targetH, Math.floor(height / 2));
    const next = document.createElement("canvas");
    next.width = nextW;
    next.height = nextH;
    const nextCtx = next.getContext("2d");
    nextCtx.imageSmoothingEnabled = true;
    nextCtx.imageSmoothingQuality = "high";
    nextCtx.drawImage(canvas, 0, 0, width, height, 0, 0, nextW, nextH);
    canvas = next;
    width = nextW;
    height = nextH;
  }

  const result = document.createElement("canvas");
  result.width = targetW;
  result.height = targetH;
  ctx = result.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, width, height, 0, 0, targetW, targetH);
  return result;
}

/**
 * Convert the drawing into a Float32Array(784) with values 0.0-1.0
 * (white digit on black background, like MNIST).
 * Returns null when nothing has been drawn.
 */
/**
 * Redraw the recorded strokes on a hidden canvas so the digit is always
 * DIGIT_SPAN px tall/wide. The pen is always 20 px, so a small digit would
 * otherwise have lines far thicker than any MNIST digit and be misread.
 * The visible canvas is not changed.
 */
function redrawAtFixedSize() {
  const sheet = document.createElement("canvas");
  sheet.width = CANVAS_SIZE;
  sheet.height = CANVAS_SIZE;
  const ctx = sheet.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  const points = strokes.flat();
  if (points.length === 0) return ctx;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const extent = Math.max(right - left, bottom - top);
  const zoom = extent < 1 ? 1 : DIGIT_SPAN / extent;   // a dot stays as is
  const midX = extent < 1 ? CANVAS_SIZE / 2 : (left + right) / 2;
  const midY = extent < 1 ? CANVAS_SIZE / 2 : (top + bottom) / 2;
  const place = (p) => ({ x: CANVAS_SIZE / 2 + (p.x - midX) * zoom,
                          y: CANVAS_SIZE / 2 + (p.y - midY) * zoom });

  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#000000";
  ctx.lineWidth = BRUSH_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    const first = place(stroke[0]);
    ctx.beginPath();
    ctx.arc(first.x, first.y, BRUSH_WIDTH / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const p of stroke.slice(1)) {
      const q = place(p);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }
  return ctx;
}

function preprocessCanvas() {
  const src = redrawAtFixedSize()
    .getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;

  // Step 1: invert (black ink on white -> white ink on black) and find the
  // bounding box of the ink.
  const inverted = new ImageData(CANVAS_SIZE, CANVAS_SIZE);
  let minX = CANVAS_SIZE;
  let minY = CANVAS_SIZE;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < CANVAS_SIZE; y++) {
    for (let x = 0; x < CANVAS_SIZE; x++) {
      const i = (y * CANVAS_SIZE + x) * 4;
      const gray = (src[i] + src[i + 1] + src[i + 2]) / 3;
      const ink = 255 - gray;
      inverted.data[i] = ink;
      inverted.data[i + 1] = ink;
      inverted.data[i + 2] = ink;
      inverted.data[i + 3] = 255;
      if (ink > INK_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  const invertedCanvas = document.createElement("canvas");
  invertedCanvas.width = CANVAS_SIZE;
  invertedCanvas.height = CANVAS_SIZE;
  invertedCanvas.getContext("2d").putImageData(inverted, 0, 0);

  // Step 2: crop and fit the digit into a 20x20 box (keep aspect ratio)
  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const scale = DIGIT_BOX / Math.max(boxW, boxH);
  const newW = Math.max(1, Math.round(boxW * scale));
  const newH = Math.max(1, Math.round(boxH * scale));
  const small = downscale(invertedCanvas, minX, minY, boxW, boxH, newW, newH);

  // Step 3: paste into the center of a 28x28 black image
  const square = document.createElement("canvas");
  square.width = MODEL_SIZE;
  square.height = MODEL_SIZE;
  const squareCtx = square.getContext("2d", { willReadFrequently: true });
  squareCtx.fillStyle = "#000000";
  squareCtx.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);
  squareCtx.drawImage(
    small,
    Math.floor((MODEL_SIZE - newW) / 2),
    Math.floor((MODEL_SIZE - newH) / 2)
  );
  const pixels = squareCtx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;

  const gray = new Float32Array(MODEL_SIZE * MODEL_SIZE);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = pixels[i * 4];
  }

  // Step 4: shift so the center of mass is in the middle of the image
  let total = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < MODEL_SIZE; y++) {
    for (let x = 0; x < MODEL_SIZE; x++) {
      const v = gray[y * MODEL_SIZE + x];
      total += v;
      sumX += v * x;
      sumY += v * y;
    }
  }
  const middle = (MODEL_SIZE - 1) / 2;
  const dx = total > 0 ? Math.round(middle - sumX / total) : 0;
  const dy = total > 0 ? Math.round(middle - sumY / total) : 0;

  const input = new Float32Array(MODEL_SIZE * MODEL_SIZE);
  for (let y = 0; y < MODEL_SIZE; y++) {
    for (let x = 0; x < MODEL_SIZE; x++) {
      const srcX = x - dx;
      const srcY = y - dy;
      if (srcX >= 0 && srcX < MODEL_SIZE && srcY >= 0 && srcY < MODEL_SIZE) {
        input[y * MODEL_SIZE + x] = gray[srcY * MODEL_SIZE + srcX] / 255;
      }
    }
  }
  return input;
}

/** Draw the 28x28 model input on the preview canvas (CSS enlarges it). */
function drawPreview(input) {
  const image = previewCtx.createImageData(MODEL_SIZE, MODEL_SIZE);
  for (let i = 0; i < input.length; i++) {
    const value = Math.round(input[i] * 255);
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  previewCtx.putImageData(image, 0, 0);
}

function clearPreview() {
  previewCtx.fillStyle = "#000000";
  previewCtx.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);
}

// ===========================================================================
// 3. Neural network inference (MLP exported by server.py)
// ===========================================================================

/** Fully connected layer: out[j] = b[j] + sum_i in[i] * W[i][j] */
function dense(input, layer) {
  const out = Float32Array.from(layer.b);
  const outputs = layer.outputs;
  const W = layer.W;
  for (let i = 0; i < layer.inputs; i++) {
    const v = input[i];
    if (v === 0) continue; // MNIST input is mostly zeros -> skip for speed
    const offset = i * outputs;
    for (let j = 0; j < outputs; j++) {
      out[j] += v * W[offset + j];
    }
  }
  return out;
}

function relu(values) {
  for (let i = 0; i < values.length; i++) {
    if (values[i] < 0) values[i] = 0;
  }
  return values;
}

function softmax(values) {
  let max = -Infinity;
  for (const v of values) max = Math.max(max, v);
  let sum = 0;
  const result = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    result[i] = Math.exp(values[i] - max);
    sum += result[i];
  }
  for (let i = 0; i < result.length; i++) result[i] /= sum;
  return result;
}

/** Return an array of 10 probabilities for a 784-value input. */
function predict(input) {
  let activations = input;
  for (const layer of model.layers) {
    activations = dense(activations, layer);
    activations =
      layer.activation === "relu" ? relu(activations) : softmax(activations);
  }
  return Array.from(activations);
}

// ===========================================================================
// 4. UI updates
// ===========================================================================
function buildProbabilityList() {
  probList.innerHTML = "";
  for (let digit = 0; digit < 10; digit++) {
    const item = document.createElement("li");
    item.className = "prob-item";
    item.id = `prob-${digit}`;
    item.innerHTML =
      `<span class="prob-digit">${digit}</span>` +
      `<div class="prob-bar"><div class="prob-fill"></div></div>` +
      `<span class="prob-value">0.00%</span>`;
    probList.appendChild(item);
  }
}

function showProbabilities(probabilities, bestDigit) {
  probabilities.forEach((p, digit) => {
    const item = document.getElementById(`prob-${digit}`);
    item.classList.toggle("top", digit === bestDigit);
    item.querySelector(".prob-fill").style.width = `${(p * 100).toFixed(2)}%`;
    item.querySelector(".prob-value").textContent = `${(p * 100).toFixed(2)}%`;
  });
}

function resetResults() {
  bigDigit.textContent = "?";
  predictedText.textContent = "Predicted Digit: -";
  confidenceText.textContent = "Confidence: -";
  showProbabilities(new Array(10).fill(0), -1);
  clearPreview();
}

/** Update only the preview (used while the model is still loading). */
function updatePreviewOnly() {
  const input = preprocessCanvas();
  if (input) drawPreview(input);
}

function runPrediction() {
  if (!model) {
    messageText.textContent = "Please wait, the model is still loading...";
    return;
  }
  const input = hasInk ? preprocessCanvas() : null;
  if (!input) {
    messageText.textContent = "Please draw a digit first.";
    return;
  }

  const started = performance.now();
  drawPreview(input);
  const probabilities = predict(input);
  const elapsed = performance.now() - started;

  let best = 0;
  for (let d = 1; d < 10; d++) {
    if (probabilities[d] > probabilities[best]) best = d;
  }
  const confidence = probabilities[best] * 100;

  bigDigit.textContent = String(best);
  predictedText.textContent = `Predicted Digit: ${best}`;
  confidenceText.textContent = `Confidence: ${confidence.toFixed(2)}%`;
  showProbabilities(probabilities, best);
  messageText.textContent = `Recognized in ${elapsed.toFixed(1)} ms.`;
}

function clearAll() {
  resetCanvas();
  resetResults();
  messageText.textContent = model
    ? "Draw a digit and click 'Recognize'"
    : "Draw a digit. The model is still loading...";
}

// ===========================================================================
// 5. Model loading
// ===========================================================================
function setStatus(message, progress, isError = false) {
  statusText.textContent = message;
  statusBox.classList.toggle("error", isError);
  if (typeof progress === "number") {
    statusFill.style.width = `${progress}%`;
    statusProgress.setAttribute("aria-valuenow", String(progress));
  }
}

/** Convert the JSON layers into typed arrays for fast math. */
function buildModel(json) {
  return {
    testAccuracy: json.test_accuracy,
    layers: json.layers.map((layer) => ({
      inputs: layer.inputs,
      outputs: layer.outputs,
      activation: layer.activation,
      W: Float32Array.from(layer.weights),
      b: Float32Array.from(layer.bias),
    })),
  };
}

/** Put a loaded model to use and enable the page. */
function useModel(json) {
  model = buildModel(json);

  statusBox.classList.add("hidden");
  predictBtn.disabled = false;
  if (model.testAccuracy) {
    accuracyText.textContent =
      `MNIST test accuracy: ${(model.testAccuracy * 100).toFixed(2)}%`;
  }
  messageText.textContent = "Model ready! Draw a digit and click 'Recognize'";
  if (hasInk && liveToggle.checked) runPrediction();
}

async function loadModel() {
  setStatus("Downloading model weights...", 100);
  const response = await fetch("/api/model", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  useModel(await response.json());
}

/**
 * Opened by double-clicking index.html: browsers block fetch() for local
 * files, but a <script> tag may load model.js from the same folder.
 */
function loadModelFromFile() {
  setStatus("Loading model.js...", 50);
  const script = document.createElement("script");
  script.src = "model.js";
  script.onload = () => {
    if (window.MNIST_MODEL) {
      useModel(window.MNIST_MODEL);
    } else {
      setStatus("model.js does not contain a model.", 0, true);
    }
  };
  script.onerror = () => setStatus(
    "model.js is missing. Run 'python server.py' once to train the model, " +
      "then open this page again.", 0, true);
  document.head.appendChild(script);
}

async function pollStatus() {
  if (location.protocol === "file:") {
    loadModelFromFile();
    return;
  }
  let response;
  try {
    response = await fetch("/api/status", { cache: "no-store" });
  } catch (error) {
    // server.py is not reachable yet (starting up or stopped): retry
    setStatus(`Cannot reach the server (${error.message}). Retrying...`, 0, true);
    setTimeout(pollStatus, STATUS_POLL_MS);
    return;
  }
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  if (!response.ok || !isJson) {
    // Static file server (python -m http.server, GitHub Pages): no /api,
    // so use the trained weights saved in model.js instead
    loadModelFromFile();
    return;
  }
  try {
    const status = await response.json();
    if (status.state === "ready") {
      await loadModel();
      return;
    }
    if (status.state === "error") {
      setStatus(status.message, 0, true);
      return;
    }
    setStatus(status.message, status.progress);
  } catch (error) {
    setStatus(`Cannot reach the server (${error.message}). Retrying...`, 0, true);
  }
  setTimeout(pollStatus, STATUS_POLL_MS);
}

// ===========================================================================
// 6. Event wiring and start-up
// ===========================================================================
drawCanvas.addEventListener("pointerdown", onPointerDown);
drawCanvas.addEventListener("pointermove", onPointerMove);
drawCanvas.addEventListener("pointerup", onPointerUp);
drawCanvas.addEventListener("pointercancel", onPointerUp);

clearBtn.addEventListener("click", clearAll);
predictBtn.addEventListener("click", runPrediction);

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !predictBtn.disabled) {
    event.preventDefault();
    runPrediction();
  } else if (event.key === "Escape" || event.key === "Delete") {
    clearAll();
  }
});

resetCanvas();
buildProbabilityList();
resetResults();
pollStatus();
