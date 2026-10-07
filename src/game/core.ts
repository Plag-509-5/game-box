/* Core rules for the Box Game (dots & boxes lattice) */

export const H = 0;
export const V = 1;

export interface Edge {
  t: 0 | 1; // 0 = horizontal, 1 = vertical
  r: number;
  c: number;
}

export interface Board {
  cols: number; // boxes across
  rows: number; // boxes down
  h: Uint8Array; // (rows+1) * cols  -> 0 empty, 1 p1, 2 p2
  v: Uint8Array; // rows * (cols+1)
  owner: Uint8Array; // rows*cols -> 0 none, 1 p1, 2 p2
  filled: number; // boxes owned
}

export function createBoard(cols: number, rows: number): Board {
  return {
    cols,
    rows,
    h: new Uint8Array((rows + 1) * cols),
    v: new Uint8Array(rows * (cols + 1)),
    owner: new Uint8Array(rows * cols),
    filled: 0,
  };
}

export function edgeIndex(b: Board, e: Edge): number {
  return e.t === H ? e.r * b.cols + e.c : e.r * (b.cols + 1) + e.c;
}

export function getEdge(b: Board, e: Edge): number {
  return e.t === H ? b.h[e.r * b.cols + e.c] : b.v[e.r * (b.cols + 1) + e.c];
}

export function setEdge(b: Board, e: Edge, val: number) {
  if (e.t === H) b.h[e.r * b.cols + e.c] = val;
  else b.v[e.r * (b.cols + 1) + e.c] = val;
}

export function validEdge(b: Board, e: Edge): boolean {
  if (e.t === H) return e.r >= 0 && e.r <= b.rows && e.c >= 0 && e.c < b.cols;
  return e.r >= 0 && e.r < b.rows && e.c >= 0 && e.c <= b.cols;
}

export function boxSides(b: Board, r: number, c: number): number {
  let n = 0;
  if (b.h[r * b.cols + c]) n++;
  if (b.h[(r + 1) * b.cols + c]) n++;
  if (b.v[r * (b.cols + 1) + c]) n++;
  if (b.v[r * (b.cols + 1) + c + 1]) n++;
  return n;
}

/** Boxes touching an edge */
export function edgeBoxes(b: Board, e: Edge): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (e.t === H) {
    if (e.r - 1 >= 0) out.push([e.r - 1, e.c]);
    if (e.r < b.rows) out.push([e.r, e.c]);
  } else {
    if (e.c - 1 >= 0) out.push([e.r, e.c - 1]);
    if (e.c < b.cols) out.push([e.r, e.c]);
  }
  return out;
}

/** Place an edge for player. Returns the boxes that got completed. */
export function place(b: Board, e: Edge, player: number): Array<[number, number]> {
  setEdge(b, e, player);
  const done: Array<[number, number]> = [];
  for (const [r, c] of edgeBoxes(b, e)) {
    if (!b.owner[r * b.cols + c] && boxSides(b, r, c) === 4) {
      b.owner[r * b.cols + c] = player;
      b.filled++;
      done.push([r, c]);
    }
  }
  return done;
}

export function allEdges(b: Board): Edge[] {
  const out: Edge[] = [];
  for (let r = 0; r <= b.rows; r++) for (let c = 0; c < b.cols; c++) out.push({ t: H, r, c });
  for (let r = 0; r < b.rows; r++) for (let c = 0; c <= b.cols; c++) out.push({ t: V, r, c });
  return out;
}

export function freeEdges(b: Board): Edge[] {
  return allEdges(b).filter((e) => !getEdge(b, e));
}

export function boardComplete(b: Board): boolean {
  return b.filled >= b.rows * b.cols;
}

/* ------------------------------------------------------------------ */
/* CPU opponent                                                        */
/* ------------------------------------------------------------------ */

function edgesOfBox(r: number, c: number): Edge[] {
  return [
    { t: H as 0, r, c },
    { t: H as 0, r: r + 1, c },
    { t: V as 1, r, c },
    { t: V as 1, r, c: c + 1 },
  ];
}

/** rough size of the chain that would be handed over by playing e */
function sacrificeSize(b: Board, e: Edge): number {
  const clone: Board = {
    ...b,
    h: Uint8Array.from(b.h),
    v: Uint8Array.from(b.v),
    owner: Uint8Array.from(b.owner),
  };
  setEdge(clone, e, 3);
  // greedily let opponent harvest
  let harvested = 0;
  let guard = 0;
  while (guard++ < 400) {
    let found = false;
    for (let r = 0; r < clone.rows && !found; r++) {
      for (let c = 0; c < clone.cols && !found; c++) {
        if (!clone.owner[r * clone.cols + c] && boxSides(clone, r, c) === 3) {
          for (const ed of edgesOfBox(r, c)) {
            if (!getEdge(clone, ed)) setEdge(clone, ed, 3);
          }
          clone.owner[r * clone.cols + c] = 3;
          harvested++;
          found = true;
        }
      }
    }
    if (!found) break;
  }
  return harvested;
}

export function cpuMove(b: Board, difficulty: 'chill' | 'sharp' | 'ruthless'): Edge | null {
  const free = freeEdges(b);
  if (!free.length) return null;
  const pick = <T,>(arr: T[]) => arr[(Math.random() * arr.length) | 0];

  // 1. take any free box
  const capture = free.filter((e) =>
    edgeBoxes(b, e).some(([r, c]) => !b.owner[r * b.cols + c] && boxSides(b, r, c) === 3),
  );
  if (capture.length) {
    if (difficulty === 'chill' && Math.random() < 0.18) return pick(free);
    return pick(capture);
  }

  if (difficulty === 'chill') {
    if (Math.random() < 0.45) return pick(free);
  }

  // 2. safe moves: don't create a 3-sided box
  const safe = free.filter(
    (e) => !edgeBoxes(b, e).some(([r, c]) => !b.owner[r * b.cols + c] && boxSides(b, r, c) === 2),
  );
  if (safe.length) return pick(safe);

  // 3. all moves give something away — give away the least
  if (difficulty === 'chill') return pick(free);
  let best: Edge[] = [];
  let bestVal = Infinity;
  for (const e of free) {
    const v = sacrificeSize(b, e);
    if (v < bestVal) {
      bestVal = v;
      best = [e];
    } else if (v === bestVal) best.push(e);
  }
  return pick(best.length ? best : free);
}
