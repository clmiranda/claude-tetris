# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A classic Tetris implementation in vanilla JavaScript, HTML5 Canvas, and CSS. No dependencies, no build process, no package.json.

## Running the game

No install/build step. Either open `index.html` directly, or serve it locally:

```bash
python3 -m http.server 8000
# or
npx serve .
```

There is no test suite, linter, or build tooling in this repo.

## Architecture

Three files, no modules/bundler — `game.js` is loaded directly by `index.html` as a single classic script and relies on global scope.

- **`index.html`** — DOM structure: `<canvas id="board">` (300×600, the 10×20 grid at `BLOCK=30`px/cell), a side panel (`#score`, `#lines`, `#level`, `#next-canvas`), and a shared `#overlay` used for both Pause and Game Over.
- **`style.css`** — dark/retro arcade visual theme only; no layout logic worth tracking here.
- **`game.js`** — all game logic, structured around this state machine:
  - **Board model**: `board` is a `ROWS × COLS` matrix; `0` = empty, `1–8` = a piece color index (indexes into `COLORS`, matching `PIECES`).
  - **Pieces**: the 7 tetrominoes plus the 3×3 "nut" piece (hollow center) are hardcoded square matrices in `PIECES`. Rotation (`rotateCW`) is a matrix transpose+reverse, not per-piece rotation tables.
  - **Collision** (`collide`): bounds + board-overlap check, used for movement, rotation, and drop logic alike.
  - **Wall kicks** (`tryRotate`): after rotating, tries offsets `[0, -1, 1, -2, 2]` until one doesn't collide.
  - **Game loop** (`loop`): driven by `requestAnimationFrame`, accumulates elapsed time in `dropAccum` and advances the piece when it exceeds `dropInterval`.
  - **Locking/clearing** (`lockPiece` → `merge` + `clearLines` + `spawn`): `clearLines` scans bottom-up, splices full rows and unshifts empty ones at the top.
  - **Scoring/leveling**: `LINE_SCORES` table × `level`; level increases every 10 lines; `dropInterval = max(100, 1000 - (level-1)*90)`.
  - **Animation**: rendering is decoupled from logic. `renderY` is the fractional row the current piece is drawn at; each frame it eases exponentially toward the integer `current.y` (`SLIDE_TAU`), so gravity and soft drops slide smoothly. `hardDrop` sets `current.y` to the landing row and starts `hardDropAnim` instead of locking; `loop` animates the fall over `HARD_DROP_MS` (ease-in, with a fading `TRAIL_COPIES` trail), then calls `lockPiece`. Input (except P) and gravity are ignored while `hardDropAnim` is active. `spawn` snaps `renderY` to the new piece.
  - **Powerups**: every `SPECIAL_EVERY` lines `awardLines` sets `pendingSpecial`, so `spawn` generates the next piece with `randomSpecial()` — a 1×1 piece (`shape: [[1]]`) with a `special` key into `SPECIALS` (bomb, bolt, tint, gravity, freeze). Special pieces are never merged: `lockPiece` calls `applySpecial` instead, which edits `board` at the landing cell (using `clearCell`/`compactColumns`), scores destroyed blocks (`BLOCK_CLEAR_SCORE × level`) and sets a fading `flash`; `clearLines` runs afterward as usual. Freeze sets `freezeTimer`, which suspends gravity in `loop`. The `#power` HUD shows the freeze countdown or lines until the next special.
  - **Ghost piece** (`ghostY`): projects the current piece straight down to its landing row; drawn at `globalAlpha = 0.2`.
  - All game state (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, timing vars) lives in module-level `let` bindings reset by `init()` — there is no encapsulating object/class.

Tunable constants live at the top of `game.js` (`COLS`, `ROWS`, `BLOCK`, `COLORS`, `LINE_SCORES`, `SLIDE_TAU`, `HARD_DROP_MS`, `TRAIL_COPIES`, `SPECIAL_EVERY`, `FREEZE_MS`, `BLOCK_CLEAR_SCORE`, `FLASH_MS`, `SPECIALS`, initial `dropInterval`). If `COLS`/`ROWS`/`BLOCK` change, the `#board` canvas `width`/`height` in `index.html` must be updated to match (`COLS×BLOCK` and `ROWS×BLOCK`).
