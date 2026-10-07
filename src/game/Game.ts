import {
  Board,
  Edge,
  H,
  V,
  boardComplete,
  boxSides,
  createBoard,
  cpuMove,
  freeEdges,
  getEdge,
  place,
} from './core';
import { FX } from './fx';
import { sfx } from './audio';
import type { PlayerCfg } from './players';

export type Status = 'menu' | 'playing' | 'paused' | 'over';
export type Difficulty = 'chill' | 'sharp' | 'ruthless';

export interface MatchConfig {
  players: PlayerCfg[];
  size: number; // boxes per side
  turnLimit: number; // seconds per turn, 0 = no timer
  difficulty: Difficulty;
  online?: boolean;
  localSlot?: number; // index of the player controlled on this device
  isHost?: boolean;
}

export interface Hud {
  status: Status;
  players: PlayerCfg[];
  scores: number[];
  turn: number; // index in players
  streak: number;
  turnTime: number;
  turnLimit: number;
  boxesLeft: number;
  total: number;
  lastMsg: string;
  online: boolean;
  localSlot: number;
  myTurn: boolean;
}

export interface MatchResult {
  players: PlayerCfg[];
  scores: number[];
  winners: number[]; // indices
  size: number;
  date: number;
}

export class Game {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  fx = new FX();

  status: Status = 'menu';
  players: PlayerCfg[] = [];
  scores: number[] = [];
  turn = 0;
  streak = 0;
  turnTime = 0;
  turnLimit = 0;
  difficulty: Difficulty = 'sharp';
  size = 5;
  lastMsg = '';
  online = false;
  localSlot = 0;
  isHost = true;
  /** fired whenever a move originates from this device (for the network layer) */
  onLocalMove: (e: Edge, slot: number) => void = () => {};

  board: Board = createBoard(5, 5);
  private hAge = new Float32Array(0);
  private vAge = new Float32Array(0);
  private boxAge = new Float32Array(0);

  private t = 0;
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private ox = 0;
  private oy = 0;
  private cell = 60;
  private hover: Edge | null = null;
  private cursor = { r: 0, c: 0 };
  private showCursor = false;
  private cpuTimer = 0;
  private lastTick = 99;
  private bgGrad: CanvasGradient | null = null;
  private ro: ResizeObserver | null = null;
  private hudSig = '';
  private demoTimer = 0.5;
  private demoPlayer = 1;
  private turnPulse = 0;

  onHud: (h: Hud) => void = () => {};
  onOver: (r: MatchResult) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    if (canvas.parentElement) this.ro.observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('keydown', this.onKeyDown);
    this.newBoard(5);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  /* ------------------------------ setup ------------------------------ */

  private newBoard(size: number) {
    this.board = createBoard(size, size);
    this.hAge = new Float32Array((size + 1) * size).fill(-99);
    this.vAge = new Float32Array(size * (size + 1)).fill(-99);
    this.boxAge = new Float32Array(size * size).fill(-99);
    this.cursor = { r: (size / 2) | 0, c: (size / 2) | 0 };
    this.hover = null;
    this.layout();
  }

  start(cfg: MatchConfig) {
    this.players = cfg.players;
    this.scores = cfg.players.map(() => 0);
    this.online = !!cfg.online;
    this.localSlot = cfg.localSlot ?? 0;
    this.isHost = cfg.isHost ?? true;
    this.size = cfg.size;
    this.turnLimit = cfg.turnLimit;
    this.turnTime = cfg.turnLimit;
    this.difficulty = cfg.difficulty;
    this.turn = 0;
    this.streak = 0;
    this.lastMsg = `${cfg.players[0].name} commence`;
    this.cpuTimer = 0.6;
    this.lastTick = 99;
    this.turnPulse = 1;
    this.fx.reset();
    this.newBoard(cfg.size);
    this.status = 'playing';
    this.fx.addFlash(0.22, this.current.color);
    this.pushHud(true);
  }

  get current(): PlayerCfg {
    return (
      this.players[this.turn] ?? {
        id: 1,
        name: '',
        badge: '',
        color: '#22d3ee',
        glow: 'rgba(34,211,238,0.6)',
        cpu: false,
      }
    );
  }

  pause() {
    if (this.status === 'playing') {
      this.status = 'paused';
      this.pushHud(true);
    }
  }
  resume() {
    if (this.status === 'paused') {
      this.status = 'playing';
      this.last = performance.now();
      this.pushHud(true);
    }
  }
  toMenu() {
    this.status = 'menu';
    this.demoPlayer = 1;
    this.newBoard(5);
    this.pushHud(true);
  }

  /* ------------------------------ layout ------------------------------ */

  private resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this.w = Math.max(200, rect.width);
    this.h = Math.max(200, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const g = this.ctx.createLinearGradient(0, 0, this.w, this.h);
    g.addColorStop(0, '#070b18');
    g.addColorStop(0.5, '#05070f');
    g.addColorStop(1, '#090713');
    this.bgGrad = g;
    this.layout();
  }

  private layout() {
    const pad = Math.max(24, Math.min(this.w, this.h) * 0.08);
    this.cell = Math.min((this.w - pad * 2) / this.board.cols, (this.h - pad * 2) / this.board.rows);
    this.ox = (this.w - this.cell * this.board.cols) / 2;
    this.oy = (this.h - this.cell * this.board.rows) / 2;
  }

  private dotX(c: number) {
    return this.ox + c * this.cell;
  }
  private dotY(r: number) {
    return this.oy + r * this.cell;
  }
  private edgeMid(e: Edge): [number, number] {
    return e.t === H
      ? [this.dotX(e.c) + this.cell / 2, this.dotY(e.r)]
      : [this.dotX(e.c), this.dotY(e.r) + this.cell / 2];
  }
  private boxCenter(r: number, c: number): [number, number] {
    return [this.dotX(c) + this.cell / 2, this.dotY(r) + this.cell / 2];
  }

  /* ------------------------------ input ------------------------------ */

  private nearestFreeEdge(x: number, y: number): Edge | null {
    let best: Edge | null = null;
    let bestD = this.cell * 0.7;
    const b = this.board;
    for (let r = 0; r <= b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        if (b.h[r * b.cols + c]) continue;
        const d = Math.hypot(x - (this.dotX(c) + this.cell / 2), y - this.dotY(r));
        if (d < bestD) {
          bestD = d;
          best = { t: H, r, c };
        }
      }
    }
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c <= b.cols; c++) {
        if (b.v[r * (b.cols + 1) + c]) continue;
        const d = Math.hypot(x - this.dotX(c), y - (this.dotY(r) + this.cell / 2));
        if (d < bestD) {
          bestD = d;
          best = { t: V, r, c };
        }
      }
    }
    return best;
  }

  /** can the human on this device act right now? */
  canPlay() {
    if (this.status !== 'playing' || this.current.cpu) return false;
    if (this.online && this.turn !== this.localSlot) return false;
    return true;
  }

  private onPointerDown = (ev: PointerEvent) => {
    if (this.status !== 'playing') return;
    if (!this.canPlay()) {
      if (this.online) {
        this.fx.addShake(2);
        sfx.blocked();
      }
      return;
    }
    ev.preventDefault();
    this.showCursor = false;
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const e = this.nearestFreeEdge(x, y);
    if (!e) {
      this.fx.sparks(x, y, '#475569', 4);
      sfx.blocked();
      return;
    }
    this.commit(e, this.turn);
  };

  private onPointerMove = (ev: PointerEvent) => {
    if (ev.pointerType !== 'mouse' || !this.canPlay()) return;
    const rect = this.canvas.getBoundingClientRect();
    this.hover = this.nearestFreeEdge(ev.clientX - rect.left, ev.clientY - rect.top);
  };

  private onPointerLeave = () => {
    this.hover = null;
  };

  private onKeyDown = (ev: KeyboardEvent) => {
    if (!this.canPlay()) return;
    const k = ev.key.toLowerCase();
    const nav: Record<string, [number, number]> = {
      arrowup: [-1, 0],
      arrowdown: [1, 0],
      arrowleft: [0, -1],
      arrowright: [0, 1],
    };
    const draw: Record<string, [number, number]> = {
      z: [-1, 0],
      w: [-1, 0],
      s: [1, 0],
      q: [0, -1],
      a: [0, -1],
      d: [0, 1],
    };
    if (k in nav) {
      ev.preventDefault();
      this.showCursor = true;
      const [dr, dc] = nav[k];
      if (ev.shiftKey) this.drawFromCursor(dr, dc);
      else {
        this.cursor.r = Math.max(0, Math.min(this.board.rows, this.cursor.r + dr));
        this.cursor.c = Math.max(0, Math.min(this.board.cols, this.cursor.c + dc));
      }
      return;
    }
    if (k in draw) {
      ev.preventDefault();
      this.showCursor = true;
      const [dr, dc] = draw[k];
      this.drawFromCursor(dr, dc);
    }
  };

  private drawFromCursor(dr: number, dc: number) {
    const { r, c } = this.cursor;
    let e: Edge | null = null;
    if (dr === -1 && r > 0) e = { t: V, r: r - 1, c };
    else if (dr === 1 && r < this.board.rows) e = { t: V, r, c };
    else if (dc === -1 && c > 0) e = { t: H, r, c: c - 1 };
    else if (dc === 1 && c < this.board.cols) e = { t: H, r, c };
    if (!e) return;
    const nr = Math.max(0, Math.min(this.board.rows, r + dr));
    const nc = Math.max(0, Math.min(this.board.cols, c + dc));
    if (getEdge(this.board, e)) {
      this.cursor = { r: nr, c: nc };
      sfx.blocked();
      return;
    }
    this.cursor = { r: nr, c: nc };
    this.commit(e, this.turn);
  }

  /* ------------------------------ moves ------------------------------ */

  /** host-side validation of an incoming move */
  isLegalMove(e: Edge, slot: number) {
    if (this.status !== 'playing') return false;
    if (slot !== this.turn) return false;
    if (!this.players[slot]) return false;
    if (e.t !== 0 && e.t !== 1) return false;
    if (e.t === 0 && (e.r < 0 || e.r > this.board.rows || e.c < 0 || e.c >= this.board.cols))
      return false;
    if (e.t === 1 && (e.r < 0 || e.r >= this.board.rows || e.c < 0 || e.c > this.board.cols))
      return false;
    return !getEdge(this.board, e);
  }

  /** a move received from the network — never echoed back */
  applyNetMove(e: Edge, slot: number) {
    if (this.status !== 'playing') return;
    if (getEdge(this.board, e)) return;
    this.commit(e, slot, true);
  }

  private commit(e: Edge, playerIdx: number, fromNet = false) {
    const b = this.board;
    const p = this.players[playerIdx];
    if (!p || getEdge(b, e)) return;
    if (!fromNet && this.online) this.onLocalMove(e, playerIdx);
    const done = place(b, e, p.id);
    const idx = e.t === H ? e.r * b.cols + e.c : e.r * (b.cols + 1) + e.c;
    if (e.t === H) this.hAge[idx] = this.t;
    else this.vAge[idx] = this.t;
    const [mx, my] = this.edgeMid(e);
    this.hover = null;

    if (done.length) {
      this.scores[playerIdx] += done.length;
      this.streak += done.length;
      for (const [r, c] of done) {
        this.boxAge[r * b.cols + c] = this.t;
        const [bx, by] = this.boxCenter(r, c);
        this.fx.burst(bx, by, p.color, 16 + Math.min(16, this.streak * 2), 0.85);
        this.fx.wave(bx, by, p.color, this.cell * 1.35, 5);
      }
      const [fx0, fy0] = this.boxCenter(done[0][0], done[0][1]);
      const label = done.length > 1 ? `${p.badge} DOUBLE !` : `${p.badge} +1`;
      this.fx.float(fx0, fy0 - this.cell * 0.05, label, p.color, done.length > 1 ? 28 : 24);
      if (this.streak > 1)
        this.fx.float(fx0, fy0 + this.cell * 0.32, `série ×${this.streak}`, '#a3e635', 15);
      this.fx.addShake(4 + done.length * 3 + Math.min(8, this.streak));
      this.fx.addFlash(0.07 + Math.min(0.12, this.streak * 0.015), p.color);
      sfx.box(this.streak);
      this.lastMsg = `${p.name} rejoue !`;
      this.turnTime = this.turnLimit;
      this.turnPulse = 0.6;
      this.cpuTimer = 0.45;
      this.lastTick = 99;
    } else {
      this.streak = 0;
      this.fx.sparks(mx, my, p.color, 6);
      sfx.line();
      this.nextTurn();
    }

    if (boardComplete(b)) this.end();
    this.pushHud(true);
  }

  /** full snapshot used to heal a desync or catch a reconnecting player up */
  exportState() {
    return {
      h: Array.from(this.board.h),
      v: Array.from(this.board.v),
      owner: Array.from(this.board.owner),
      scores: [...this.scores],
      turn: this.turn,
      streak: this.streak,
      seq: 0,
    };
  }

  importState(s: {
    h: number[];
    v: number[];
    owner: number[];
    scores: number[];
    turn: number;
    streak: number;
  }) {
    const b = this.board;
    if (s.h.length !== b.h.length || s.v.length !== b.v.length) return;
    let filled = 0;
    for (let i = 0; i < b.h.length; i++) {
      if (!b.h[i] && s.h[i]) this.hAge[i] = this.t;
      b.h[i] = s.h[i];
    }
    for (let i = 0; i < b.v.length; i++) {
      if (!b.v[i] && s.v[i]) this.vAge[i] = this.t;
      b.v[i] = s.v[i];
    }
    for (let i = 0; i < b.owner.length; i++) {
      if (!b.owner[i] && s.owner[i]) this.boxAge[i] = this.t;
      b.owner[i] = s.owner[i];
      if (s.owner[i]) filled++;
    }
    b.filled = filled;
    this.scores = [...s.scores];
    this.turn = s.turn;
    this.streak = s.streak;
    this.turnTime = this.turnLimit;
    this.turnPulse = 1;
    this.fx.addFlash(0.15, this.current.color);
    if (boardComplete(b) && this.status === 'playing') this.end();
    this.pushHud(true);
  }

  private nextTurn() {
    this.turn = (this.turn + 1) % this.players.length;
    this.turnTime = this.turnLimit;
    this.turnPulse = 1;
    this.cpuTimer = 0.5;
    this.lastTick = 99;
    this.lastMsg = `Au tour de ${this.current.name}`;
  }

  private timeoutMove() {
    const free = freeEdges(this.board);
    if (!free.length) return;
    const e = free[(Math.random() * free.length) | 0];
    const [mx, my] = this.edgeMid(e);
    this.fx.float(mx, my - 18, 'TEMPS !', '#f43f5e', 22);
    this.fx.addShake(9);
    this.fx.addFlash(0.18, '#f43f5e');
    sfx.gameOver();
    this.commit(e, this.turn);
  }

  private end() {
    this.status = 'over';
    const best = Math.max(...this.scores);
    const winners = this.scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
    if (winners.length === 1) {
      const wp = this.players[winners[0]];
      sfx.win();
      this.fx.addShake(16);
      this.fx.addFlash(0.35, wp.color);
      for (let i = 0; i < 14; i++)
        this.fx.burst(
          this.ox + Math.random() * this.cell * this.board.cols,
          this.oy + Math.random() * this.cell * this.board.rows,
          this.players[i % this.players.length].color,
          14,
          1.3,
        );
      this.fx.wave(this.w / 2, this.h / 2, wp.color, Math.max(this.w, this.h) * 0.7, 10, 0.9);
    } else {
      sfx.clear();
    }
    this.onOver({
      players: this.players,
      scores: [...this.scores],
      winners,
      size: this.size,
      date: Date.now(),
    });
    this.pushHud(true);
  }

  /* ------------------------------ loop ------------------------------ */

  private pushHud(force = false) {
    const hud: Hud = {
      status: this.status,
      players: this.players,
      scores: this.scores,
      turn: this.turn,
      streak: this.streak,
      turnTime: Math.max(0, this.turnTime),
      turnLimit: this.turnLimit,
      boxesLeft: this.board.rows * this.board.cols - this.board.filled,
      total: this.board.rows * this.board.cols,
      lastMsg: this.lastMsg,
      online: this.online,
      localSlot: this.localSlot,
      myTurn: !this.online || this.turn === this.localSlot,
    };
    const sig = `${hud.status}|${hud.scores.join(',')}|${hud.turn}|${hud.streak}|${hud.turnTime.toFixed(
      1,
    )}|${hud.boxesLeft}|${hud.lastMsg}`;
    if (force || sig !== this.hudSig) {
      this.hudSig = sig;
      this.onHud(hud);
    }
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 1 / 20) dt = 1 / 20;
    this.t += dt;
    this.turnPulse = Math.max(0, this.turnPulse - dt * 1.6);

    if (this.status === 'menu') {
      this.demoTimer -= dt;
      if (this.demoTimer <= 0) {
        this.demoTimer = 0.42;
        this.demoStep();
      }
    } else if (this.status === 'playing') {
      if (!this.online && this.current.cpu) {
        this.cpuTimer -= dt;
        if (this.cpuTimer <= 0) {
          const mv = cpuMove(this.board, this.difficulty);
          if (mv) this.commit(mv, this.turn);
        }
      } else if (this.turnLimit > 0) {
        this.turnTime -= dt;
        const s = Math.ceil(this.turnTime);
        if (this.turnTime <= 3.01 && this.turnTime > 0 && s !== this.lastTick) {
          this.lastTick = s;
          sfx.tick();
          this.fx.addShake(1.6);
        }
        if (this.turnTime <= 0) {
          this.turnTime = 0;
          // online: only the host decides what happens on a timeout
          if (!this.online || this.isHost) this.timeoutMove();
        }
      }
    }

    this.fx.update(dt);
    this.render();
    this.pushHud();
  };

  /* ------------------------------ demo ------------------------------ */

  private demoStep() {
    const b = this.board;
    const mv = cpuMove(b, 'chill');
    if (!mv) {
      this.fx.addFlash(0.12, '#22d3ee');
      this.newBoard(5);
      return;
    }
    const pid = this.demoPlayer;
    const done = place(b, mv, pid);
    const idx = mv.t === H ? mv.r * b.cols + mv.c : mv.r * (b.cols + 1) + mv.c;
    if (mv.t === H) this.hAge[idx] = this.t;
    else this.vAge[idx] = this.t;
    if (done.length) {
      for (const [r, c] of done) {
        this.boxAge[r * b.cols + c] = this.t;
        const [bx, by] = this.boxCenter(r, c);
        this.fx.burst(bx, by, DEMO_COLORS[pid - 1], 9, 0.55);
        this.fx.wave(bx, by, DEMO_COLORS[pid - 1], this.cell, 3);
      }
    } else {
      this.demoPlayer = pid === 1 ? 2 : 1;
    }
    if (boardComplete(b)) this.demoTimer = 1.2;
  }

  /* ------------------------------ render ------------------------------ */

  private colorOf(val: number) {
    if (this.status === 'menu') return DEMO_COLORS[(val - 1) % DEMO_COLORS.length];
    const p = this.players.find((x) => x.id === val);
    return p ? p.color : '#64748b';
  }
  private initialOfVal(val: number) {
    const p = this.players.find((x) => x.id === val);
    return p ? p.badge : '';
  }

  private render() {
    const ctx = this.ctx;
    const b = this.board;
    const cell = this.cell;
    ctx.save();
    ctx.fillStyle = this.bgGrad || '#080c1c';
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawBackdrop(ctx);
    ctx.translate(this.fx.shakeX, this.fx.shakeY);

    const boardW = cell * b.cols;
    const boardH = cell * b.rows;
    const pad = cell * 0.32;
    const active = this.status === 'playing' ? this.current.color : '#3b82f6';

    // plate: soft drop shadow, glass fill, active-player rim
    const px = this.ox - pad;
    const py = this.oy - pad;
    const pw = boardW + pad * 2;
    const ph = boardH + pad * 2;
    const pr = Math.min(cell * 0.3, 26);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 44;
    ctx.shadowOffsetY = 18;
    roundRect(ctx, px, py, pw, ph, pr);
    ctx.fillStyle = 'rgba(9, 13, 26, 0.9)';
    ctx.fill();
    ctx.restore();

    const plateG = ctx.createLinearGradient(px, py, px, py + ph);
    plateG.addColorStop(0, 'rgba(255,255,255,0.055)');
    plateG.addColorStop(0.5, 'rgba(255,255,255,0.012)');
    plateG.addColorStop(1, 'rgba(0,0,0,0.12)');
    roundRect(ctx, px, py, pw, ph, pr);
    ctx.fillStyle = plateG;
    ctx.fill();

    // inner hairline
    roundRect(ctx, px + 0.5, py + 0.5, pw - 1, ph - 1, pr - 0.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // active rim glow
    roundRect(ctx, px, py, pw, ph, pr);
    ctx.strokeStyle = hexA(active, 0.2 + this.turnPulse * 0.5);
    ctx.lineWidth = 1.5 + this.turnPulse * 2.5;
    ctx.shadowColor = hexA(active, 0.55);
    ctx.shadowBlur = 16 + this.turnPulse * 34;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // boxes
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        const i = r * b.cols + c;
        const owner = b.owner[i];
        const x = this.dotX(c);
        const y = this.dotY(r);
        if (!owner) {
          if (boxSides(b, r, c) === 3 && this.status === 'playing') {
            const pulse = 0.1 + Math.sin(this.t * 7 + i) * 0.05;
            ctx.fillStyle = hexA(active, Math.max(0.04, pulse));
            roundRect(ctx, x + cell * 0.11, y + cell * 0.11, cell * 0.78, cell * 0.78, cell * 0.16);
            ctx.fill();
          }
          continue;
        }
        const col = this.colorOf(owner);
        const age = this.t - this.boxAge[i];
        const k = Math.min(1, Math.max(0, age / 0.42));
        const pop = 1 + 0.46 * Math.sin(Math.PI * k) * (1 - k * 0.35);
        ctx.save();
        ctx.translate(x + cell / 2, y + cell / 2);
        ctx.rotate((1 - k) * 0.3);
        ctx.scale(pop, pop);
        const inset = cell * 0.075;
        const s = cell - inset * 2;
        const rr = cell * 0.17;

        // tinted glass tile
        const tg = ctx.createLinearGradient(0, -s / 2, 0, s / 2);
        tg.addColorStop(0, hexA(col, 0.32 + (1 - k) * 0.4));
        tg.addColorStop(1, hexA(col, 0.12 + (1 - k) * 0.3));
        roundRect(ctx, -s / 2, -s / 2, s, s, rr);
        ctx.fillStyle = tg;
        ctx.fill();

        // top highlight
        roundRect(ctx, -s / 2 + 1, -s / 2 + 1, s - 2, s - 2, rr - 1);
        ctx.strokeStyle = hexA('#ffffff', 0.12);
        ctx.lineWidth = 1;
        ctx.stroke();

        roundRect(ctx, -s / 2, -s / 2, s, s, rr);
        ctx.strokeStyle = hexA(col, 0.7);
        ctx.lineWidth = 1.75;
        ctx.stroke();

        // INITIALE du joueur
        const letter = this.initialOfVal(owner);
        if (letter) {
          const fs = cell * (letter.length > 1 ? 0.34 : 0.46);
          ctx.font = `700 ${fs}px "Space Grotesk", ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const yy = cell * 0.015;
          ctx.shadowColor = hexA(col, 0.95);
          ctx.shadowBlur = 16 + (1 - k) * 28;
          ctx.fillStyle = hexA('#ffffff', 0.94);
          ctx.fillText(letter, 0, yy);
          ctx.shadowBlur = 0;
          ctx.fillStyle = hexA(col, 0.5);
          ctx.fillText(letter, 0, yy);
        }
        ctx.restore();
      }
    }

    // dots
    const dotR = Math.max(1.8, cell * 0.048);
    for (let r = 0; r <= b.rows; r++) {
      for (let c = 0; c <= b.cols; c++) {
        const x = this.dotX(c);
        const y = this.dotY(r);
        ctx.beginPath();
        ctx.arc(x, y, dotR * 2.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(120, 165, 235, 0.06)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(186, 208, 240, 0.7)';
        ctx.fill();
      }
    }

    // hover / cursor
    if (this.status === 'playing' && !this.current.cpu) {
      if (!this.showCursor && this.hover) this.strokeEdge(ctx, this.hover, hexA(active, 0.45), 1, true);
      if (this.showCursor) {
        const x = this.dotX(this.cursor.c);
        const y = this.dotY(this.cursor.r);
        ctx.beginPath();
        ctx.arc(x, y, cell * (0.17 + Math.sin(this.t * 6) * 0.02), 0, Math.PI * 2);
        ctx.strokeStyle = active;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.06, 0, Math.PI * 2);
        ctx.fillStyle = '#eafaff';
        ctx.fill();
      }
    }

    // edges
    for (let r = 0; r <= b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        const val = b.h[r * b.cols + c];
        if (!val) continue;
        const age = this.t - this.hAge[r * b.cols + c];
        this.strokeEdge(ctx, { t: H, r, c }, this.colorOf(val), Math.min(1, age / 0.15));
      }
    }
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c <= b.cols; c++) {
        const val = b.v[r * (b.cols + 1) + c];
        if (!val) continue;
        const age = this.t - this.vAge[r * (b.cols + 1) + c];
        this.strokeEdge(ctx, { t: V, r, c }, this.colorOf(val), Math.min(1, age / 0.15));
      }
    }

    this.fx.draw(ctx);
    ctx.restore();

    if (this.fx.flash > 0.003) {
      ctx.save();
      ctx.globalAlpha = this.fx.flash;
      ctx.fillStyle = this.fx.flashColor;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
    }

    if (this.status === 'playing' && this.turnLimit > 0 && this.turnTime < 3 && !this.current.cpu) {
      const a = (1 - this.turnTime / 3) * (0.25 + Math.sin(this.t * 9) * 0.07);
      const g = ctx.createRadialGradient(
        this.w / 2,
        this.h / 2,
        Math.min(this.w, this.h) * 0.25,
        this.w / 2,
        this.h / 2,
        Math.max(this.w, this.h) * 0.7,
      );
      g.addColorStop(0, 'rgba(244,63,94,0)');
      g.addColorStop(1, `rgba(244,63,94,${Math.max(0, a)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  private strokeEdge(ctx: CanvasRenderingContext2D, e: Edge, color: string, p = 1, dashed = false) {
    const cell = this.cell;
    const lw = Math.max(3, cell * 0.1);
    const inset = cell * 0.075;
    let x1: number, y1: number, x2: number, y2: number;
    if (e.t === H) {
      y1 = y2 = this.dotY(e.r);
      x1 = this.dotX(e.c) + inset;
      x2 = this.dotX(e.c + 1) - inset;
    } else {
      x1 = x2 = this.dotX(e.c);
      y1 = this.dotY(e.r) + inset;
      y2 = this.dotY(e.r + 1) - inset;
    }
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const ease = 1 - Math.pow(1 - p, 3);
    const ax = mx + (x1 - mx) * ease;
    const ay = my + (y1 - my) * ease;
    const bx = mx + (x2 - mx) * ease;
    const by = my + (y2 - my) * ease;
    ctx.lineCap = 'round';
    if (dashed) {
      ctx.setLineDash([cell * 0.12, cell * 0.1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw * 0.85;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    // outer bloom
    ctx.strokeStyle = hexA(color, 0.13 + (1 - p) * 0.45);
    ctx.lineWidth = lw * (2.6 + (1 - p) * 2);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    // core
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    // specular highlight along the top of the stroke
    ctx.strokeStyle = hexA('#ffffff', 0.34);
    ctx.lineWidth = Math.max(1, lw * 0.26);
    ctx.beginPath();
    if (e.t === H) {
      ctx.moveTo(ax + lw * 0.3, ay - lw * 0.24);
      ctx.lineTo(bx - lw * 0.3, by - lw * 0.24);
    } else {
      ctx.moveTo(ax - lw * 0.24, ay + lw * 0.3);
      ctx.lineTo(bx - lw * 0.24, by - lw * 0.3);
    }
    ctx.stroke();
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D) {
    // drifting micro-grid
    const step = 52;
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 170, 255, 0.035)';
    ctx.lineWidth = 1;
    const off = (this.t * 9) % step;
    ctx.beginPath();
    for (let x = -off; x < this.w; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, this.h);
    }
    for (let y = -off; y < this.h; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(this.w, Math.round(y) + 0.5);
    }
    ctx.stroke();

    // soft spotlight tinted by the active player
    const active = this.status === 'playing' ? this.current.color : '#3b82f6';
    const cx = this.w / 2;
    const cy = this.oy + (this.cell * this.board.rows) / 2;
    const rad = Math.max(this.w, this.h) * 0.62;
    const sp = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    sp.addColorStop(0, hexA(active, 0.1 + this.turnPulse * 0.05));
    sp.addColorStop(0.45, hexA(active, 0.03));
    sp.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sp;
    ctx.fillRect(0, 0, this.w, this.h);

    // bottom vignette for depth
    const vg = ctx.createLinearGradient(0, this.h * 0.55, 0, this.h);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, this.h * 0.55, this.w, this.h * 0.45);
    ctx.restore();
  }
}

const DEMO_COLORS = ['#3ce0d6', '#ff6b81', '#ffc857', '#9d8cff'];

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((x) => x + x)
          .join('')
      : h,
    16,
  );
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
