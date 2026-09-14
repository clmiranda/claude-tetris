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
  flash; // { cells: [[r, c]...], elapsed } while a powerup flash is fading, else null

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
  if (cleared) awardLines(cleared);
}

function awardLines(n) {
  lines += n;
  score += (LINE_SCORES[n] || 0) * level;
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

function applySpecial() {
  const { x, y } = current;
  const hit = [];
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
      awardLines(1);
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
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
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
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.special) applySpecial();
  else merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  renderY = current.y;
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
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case "ArrowRight":
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
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
