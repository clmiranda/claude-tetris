"use strict";

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  "#4dd0e1", // I - cyan
  "#ffd54f", // O - yellow
  "#ba68c8", // T - purple
  "#81c784", // S - green
  "#e57373", // Z - red
  "#90caf9", // J - pale blue
  "#ffb74d", // L - orange
  "#b0bec5", // N (tuerca) - steel gray
];

const PIECES = [
  null,
  [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ], // I
  [
    [2, 2],
    [2, 2],
  ], // O
  [
    [0, 3, 0],
    [3, 3, 3],
    [0, 0, 0],
  ], // T
  [
    [0, 4, 4],
    [4, 4, 0],
    [0, 0, 0],
  ], // S
  [
    [5, 5, 0],
    [0, 5, 5],
    [0, 0, 0],
  ], // Z
  [
    [6, 0, 0],
    [6, 6, 6],
    [0, 0, 0],
  ], // J
  [
    [0, 0, 7],
    [7, 7, 7],
    [0, 0, 0],
  ], // L
  [
    [8, 8, 8],
    [8, 0, 8],
    [8, 8, 8],
  ], // N (tuerca)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const SLIDE_TAU = 35; // ms, smoothing time constant for the row-to-row slide
const HARD_DROP_MS = 120; // duration of the hard drop fall animation
const TRAIL_COPIES = 4; // fading copies drawn behind a hard-dropping piece

const SPECIAL_EVERY = 5; // lines between special (powerup) pieces
const FREEZE_MS = 5000; // how long the freeze powerup pauses gravity
const BLOCK_CLEAR_SCORE = 10; // points per block destroyed by a powerup (× level)
const FLASH_MS = 250; // fade-out of the flash over cells hit by a powerup
const SPECIALS = {
  bomb: { icon: "💣", color: "#ef5350" },
  bolt: { icon: "⚡", color: "#fff176" },
  tint: { icon: "🎨", color: "#f48fb1" },
  gravity: { icon: "⬇", color: "#7986cb" },
  freeze: { icon: "❄", color: "#80deea" },
};

const COMBO_MAX = 5; // cap for the consecutive-clear score multiplier
const TSPIN_SCORES = [400, 800, 1200, 1600]; // T-spin with 0..3 lines (× level)
const B2B_MULT = 1.5; // back-to-back Tetris / T-spin multiplier
const PERFECT_CLEAR_SCORE = 3000; // bonus for emptying the board (× level)
const POPUP_MS = 1000; // lifetime of floating score text
const CLEAR_NAMES = ["", "SINGLE", "DOUBLE", "TRIPLE", "TETRIS"];
const SOUND_STORAGE_KEY = "tetris-sound";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const nextCanvas = document.getElementById("next-canvas");
const nextCtx = nextCanvas.getContext("2d");
const scoreEl = document.getElementById("score");
const linesEl = document.getElementById("lines");
const levelEl = document.getElementById("level");
const powerEl = document.getElementById("power");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayScore = document.getElementById("overlay-score");
const restartBtn = document.getElementById("restart-btn");
const themeToggleBtn = document.getElementById("theme-toggle");
const soundToggleBtn = document.getElementById("sound-toggle");

const THEME_STORAGE_KEY = "tetris-theme";

function applyTheme(theme) {
  const isLight = theme === "light";
  document.body.classList.toggle("light-theme", isLight);
  themeToggleBtn.setAttribute("aria-pressed", String(isLight));
}

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(saved === "light" ? "light" : "dark");
}

themeToggleBtn.addEventListener("click", () => {
  const isLight = document.body.classList.contains("light-theme");
  const nextTheme = isLight ? "dark" : "light";
  applyTheme(nextTheme);
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
});

initTheme();

// ---- Sound (synthesized with Web Audio, no asset files) ----
let soundOn = localStorage.getItem(SOUND_STORAGE_KEY) !== "off";
let audioCtx = null;

function applySound() {
  soundToggleBtn.textContent = soundOn ? "🔊" : "🔇";
  soundToggleBtn.setAttribute("aria-pressed", String(soundOn));
}

soundToggleBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  applySound();
  localStorage.setItem(SOUND_STORAGE_KEY, soundOn ? "on" : "off");
  // drop focus so Space (hard drop) doesn't re-trigger the button
  soundToggleBtn.blur();
});

applySound();

// the context is created lazily: sounds only play after a keypress, which
// satisfies the browser autoplay policy
function getAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function tone(ac, freq, start, dur, type = "square", gain = 0.06) {
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function sfx(kind, comboLevel = 1) {
  if (!soundOn) return;
  const ac = getAudio();
  if (!ac) return;
  const arpeggio = (notes, step, type) =>
    notes.forEach((f, i) => tone(ac, f, i * step, 0.18, type, 0.07));
  switch (kind) {
    case "clear":
      // one whole tone higher per combo step, so chaining is audible
      tone(ac, 330 * 2 ** (((comboLevel - 1) * 2) / 12), 0, 0.15);
      break;
    case "tetris":
    case "tspin":
      arpeggio([523, 659, 784], 0.06, "triangle");
      break;
    case "b2b":
      arpeggio([523, 659, 784, 1047], 0.06, "triangle");
      break;
    case "perfect":
      arpeggio([523, 659, 784, 1047], 0.11, "square");
      break;
  }
}

let board,
  current,
  next,
  score,
  lines,
  level,
  paused,
  gameOver,
  lastTime,
  dropAccum,
  dropInterval,
  animId,
  renderY, // visual (fractional) row of the current piece; logic uses current.y
  hardDropAnim, // { fromY, toY, elapsed } while a hard drop is animating, else null
  nextSpecialAt, // line count at which the next special piece is queued
  pendingSpecial, // true when the next generated piece must be special
  freezeTimer, // ms of gravity pause left from the freeze powerup
  flash, // { cells: [[r, c]...], elapsed } while a powerup flash is fading, else null
  combo, // consecutive line-clearing locks, capped at COMBO_MAX (score multiplier)
  b2bActive, // last line clear was "difficult" (Tetris or T-spin)
  lastMoveRotate, // last successful action on the current piece was a rotation
  popups; // floating score texts: [{ lines: [text], y, elapsed }]

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map((row) => [...row]);
  return {
    type,
    shape,
    x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
    y: 0,
  };
}

function randomSpecial() {
  const keys = Object.keys(SPECIALS);
  return {
    type: 0,
    special: keys[Math.floor(Math.random() * keys.length)],
    shape: [[1]],
    x: Math.floor(COLS / 2),
    y: 0,
  };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length,
    cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      lastMoveRotate = true;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every((v) => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  return cleared;
}

// line/level progress only; points are computed in scoreLock
function awardLines(n) {
  lines += n;
  level = Math.floor(lines / 10) + 1;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  while (lines >= nextSpecialAt) {
    pendingSpecial = true;
    nextSpecialAt += SPECIAL_EVERY;
  }
  updateHUD();
}

function clearCell(r, c, hit) {
  if (!board[r][c]) return;
  board[r][c] = 0;
  hit.push([r, c]);
}

// drop every block in the given columns to the bottom, closing gaps
function compactColumns(cols) {
  for (const c of cols) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!board[r][c]) continue;
      const v = board[r][c];
      board[r][c] = 0;
      board[write--][c] = v;
    }
  }
}

function mostFrequentColor() {
  const counts = {};
  let best = 0;
  for (const row of board)
    for (const v of row)
      if (v && (counts[v] = (counts[v] || 0) + 1) > (counts[best] || 0))
        best = v;
  return best;
}

// returns the number of lines removed directly by the effect (bolt row)
function applySpecial() {
  const { x, y } = current;
  const hit = [];
  let removedLines = 0;
  let flashCells = [];
  switch (current.special) {
    case "bomb":
      for (let r = y - 1; r <= y + 1; r++)
        for (let c = x - 1; c <= x + 1; c++) {
          if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
          clearCell(r, c, hit);
          flashCells.push([r, c]);
        }
      break;
    case "bolt":
      for (let r = 0; r < ROWS; r++) {
        clearCell(r, x, hit);
        flashCells.push([r, x]);
      }
      for (let c = 0; c < COLS; c++) {
        clearCell(y, c, hit);
        flashCells.push([y, c]);
      }
      board.splice(y, 1);
      board.unshift(new Array(COLS).fill(0));
      removedLines = 1;
      break;
    case "tint": {
      const target = board[y + 1]?.[x] || mostFrequentColor();
      if (!target) break;
      const cols = new Set();
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (board[r][c] === target) {
            clearCell(r, c, hit);
            cols.add(c);
          }
      flashCells = hit;
      compactColumns(cols);
      break;
    }
    case "gravity":
      compactColumns(board[0].keys());
      break;
    case "freeze":
      freezeTimer = FREEZE_MS;
      break;
  }
  score += hit.length * BLOCK_CLEAR_SCORE * level;
  if (flashCells.length) flash = { cells: flashCells, elapsed: 0 };
  updateHUD();
  return removedLines;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  if (gy > current.y) lastMoveRotate = false;
  current.y = gy;
  if (gy - renderY < 0.01) {
    lockPiece();
    return;
  }
  // lock is deferred until the fall animation finishes (see loop)
  hardDropAnim = { fromY: renderY, toY: gy, elapsed: 0 };
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    lastMoveRotate = false;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  const special = !!current.special;
  const tspin = isTSpin();
  const row = current.y;
  let cleared = 0;
  if (special) cleared = applySpecial();
  else merge();
  cleared += clearLines();
  scoreLock(cleared, tspin, special, row);
  spawn();
}

// 3-corner rule: a T locked right after a rotation with ≥3 occupied diagonal corners
function isTSpin() {
  if (current.special || current.type !== 3 || !lastMoveRotate) return false;
  const cx = current.x + 1;
  const cy = current.y + 1;
  let corners = 0;
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = cx + dx;
    const y = cy + dy;
    if (x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y][x])) corners++;
  }
  return corners >= 3;
}

function scoreLock(cleared, tspin, special, row) {
  if (!cleared) {
    if (tspin) {
      const points = TSPIN_SCORES[0] * level;
      score += points;
      popup(["T-SPIN", `+${points.toLocaleString()}`], row);
      sfx("tspin");
      updateHUD();
    }
    // powerups are neutral: only a normal piece that clears nothing breaks the chain
    if (!special) combo = 0;
    return;
  }

  awardLines(cleared);
  const difficult = tspin || cleared === 4;
  const b2b = difficult && b2bActive;
  b2bActive = difficult;
  let points = (tspin ? TSPIN_SCORES[cleared] : LINE_SCORES[cleared]) * level;
  if (b2b) points *= B2B_MULT;
  const perfect = board.every((r) => r.every((v) => !v));
  if (perfect) points += PERFECT_CLEAR_SCORE * level;
  combo = Math.min(combo + 1, COMBO_MAX);
  points = Math.round(points * combo);
  score += points;
  updateHUD();

  const text = [];
  if (difficult)
    text.push(`${b2b ? "B2B " : ""}${tspin ? "T-SPIN " : ""}${CLEAR_NAMES[cleared]}`);
  if (combo >= 2) text.push(`COMBO x${combo}`);
  if (perfect) text.push("PERFECT CLEAR");
  if (text.length) {
    text.push(`+${points.toLocaleString()}`);
    popup(text, row);
  }

  let intensity = combo >= 2 ? 1 + combo : 0;
  if (difficult) intensity = Math.max(intensity, 4);
  if (perfect) intensity = 8;
  if (intensity) shake(intensity);

  if (perfect) sfx("perfect");
  else if (b2b) sfx("b2b");
  else if (difficult) sfx(tspin ? "tspin" : "tetris");
  else sfx("clear", combo);
}

function popup(text, row) {
  popups.push({ lines: text, y: row * BLOCK, elapsed: 0 });
  if (popups.length > 3) popups.shift();
}

function shake(px) {
  canvas.style.setProperty("--shake", `${px}px`);
  canvas.classList.remove("shake");
  void canvas.offsetWidth; // restart the CSS animation
  canvas.classList.add("shake");
}

function spawn() {
  current = next;
  renderY = current.y;
  lastMoveRotate = false;
  next = pendingSpecial ? randomSpecial() : randomPiece();
  pendingSpecial = false;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  powerEl.textContent =
    freezeTimer > 0
      ? `❄ ${(freezeTimer / 1000).toFixed(1)}s`
      : `en ${nextSpecialAt - lines}`;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = "rgba(255,255,255,0.12)";
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawSpecialBlock(context, x, y, special, size, alpha) {
  const { icon, color } = SPECIALS[special];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  context.font = `${Math.floor(size * 0.6)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#000";
  context.fillText(icon, (x + 0.5) * size, (y + 0.5) * size + 1);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = getComputedStyle(document.body)
    .getPropertyValue("--grid-line")
    .trim();
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) drawBlock(ctx, c, r, board[r][c], BLOCK);

  // powerup flash over affected cells
  if (flash) {
    ctx.globalAlpha = 0.5 * (1 - flash.elapsed / FLASH_MS);
    ctx.fillStyle = "#fff";
    for (const [r, c] of flash.cells)
      ctx.fillRect(c * BLOCK, r * BLOCK, BLOCK, BLOCK);
    ctx.globalAlpha = 1;
  }

  // freeze tint
  if (freezeTimer > 0) {
    ctx.fillStyle = "rgba(128,222,234,0.08)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // ghost
  drawPiece(ghostY(), 0.2);

  // hard drop trail: copies between the start row and the piece, fading upward
  if (hardDropAnim) {
    const span = renderY - hardDropAnim.fromY;
    for (let k = 1; k <= TRAIL_COPIES; k++) {
      const f = k / (TRAIL_COPIES + 1);
      drawPiece(renderY - span * f, 0.25 * (1 - f));
    }
  }

  // current piece
  drawPiece(renderY);

  drawPopups();
}

// floating combo/bonus text: rises and fades out over POPUP_MS
function drawPopups() {
  const LINE_H = 18;
  ctx.font = "bold 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  for (const p of popups) {
    const t = p.elapsed / POPUP_MS;
    const height = p.lines.length * LINE_H;
    const top = Math.min(Math.max(p.y - 30 * t, LINE_H), canvas.height - height);
    ctx.globalAlpha = 1 - t * t;
    p.lines.forEach((line, i) => {
      const y = top + i * LINE_H;
      const isPoints = i === p.lines.length - 1;
      ctx.fillStyle = isPoints ? "#ffd54f" : "#ffffff";
      ctx.strokeText(line, canvas.width / 2, y);
      ctx.fillText(line, canvas.width / 2, y);
    });
  }
  ctx.globalAlpha = 1;
}

function drawPiece(y, alpha) {
  if (current.special) {
    drawSpecialBlock(ctx, current.x, y, current.special, BLOCK, alpha);
    return;
  }
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, y + r, current.shape[r][c], BLOCK, alpha);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  if (next.special) {
    // center the single cell in the 4×4 preview
    drawSpecialBlock(nextCtx, 1.5, 1.5, next.special, NB);
    return;
  }
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = "GAME OVER";
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove("hidden");
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = "PAUSA";
    overlayScore.textContent = "";
    overlay.classList.remove("hidden");
  }
}

function loop(ts) {
  if (gameOver || paused) return;
  const dt = ts - lastTime;
  lastTime = ts;
  if (hardDropAnim) {
    hardDropAnim.elapsed += dt;
    const t = Math.min(1, hardDropAnim.elapsed / HARD_DROP_MS);
    // ease-in so the fall accelerates
    renderY = hardDropAnim.fromY + (hardDropAnim.toY - hardDropAnim.fromY) * t * t;
    if (t >= 1) {
      hardDropAnim = null;
      lockPiece();
    }
  } else if (freezeTimer > 0) {
    freezeTimer = Math.max(0, freezeTimer - dt);
    updateHUD();
  } else {
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
        lastMoveRotate = false;
      } else {
        lockPiece();
      }
    }
  }
  if (!hardDropAnim) {
    // frame-rate independent exponential ease toward the logical row
    renderY += (current.y - renderY) * (1 - Math.exp(-dt / SLIDE_TAU));
    if (Math.abs(current.y - renderY) < 0.01) renderY = current.y;
  }
  if (flash && (flash.elapsed += dt) >= FLASH_MS) flash = null;
  for (const p of popups) p.elapsed += dt;
  popups = popups.filter((p) => p.elapsed < POPUP_MS);
  draw();
  // endGame() can't cancel the frame currently running, so stop rescheduling here
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  hardDropAnim = null;
  nextSpecialAt = SPECIAL_EVERY;
  pendingSpecial = false;
  freezeTimer = 0;
  flash = null;
  combo = 0;
  b2bActive = false;
  lastMoveRotate = false;
  popups = [];
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add("hidden");
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener("keydown", (e) => {
  if (e.code === "KeyP") {
    togglePause();
    return;
  }
  if (paused || gameOver || hardDropAnim) return;
  switch (e.code) {
    case "ArrowLeft":
      if (!collide(current.shape, current.x - 1, current.y)) {
        current.x--;
        lastMoveRotate = false;
      }
      break;
    case "ArrowRight":
      if (!collide(current.shape, current.x + 1, current.y)) {
        current.x++;
        lastMoveRotate = false;
      }
      break;
    case "ArrowDown":
      softDrop();
      break;
    case "ArrowUp":
    case "KeyX":
      tryRotate();
      break;
    case "Space":
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener("click", init);

init();
