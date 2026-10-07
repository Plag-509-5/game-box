import type { MatchResult } from './Game';

export interface PlayerStat {
  name: string;
  wins: number;
  games: number;
  boxes: number;
  best: number;
  color: string;
}

export interface MatchRow {
  date: number;
  size: number;
  names: string[];
  colors: string[];
  scores: number[];
  winners: number[];
}

const STATS_KEY = 'box.stats.v2';
const HIST_KEY = 'box.history.v2';
const SETUP_KEY = 'box.setup.v2';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function loadStats(): PlayerStat[] {
  const s = read<PlayerStat[]>(STATS_KEY, []);
  return Array.isArray(s) ? s : [];
}

export function loadHistory(): MatchRow[] {
  const h = read<MatchRow[]>(HIST_KEY, []);
  return Array.isArray(h) ? h.slice(0, 10) : [];
}

export function recordMatch(r: MatchResult): { stats: PlayerStat[]; history: MatchRow[] } {
  const stats = loadStats();
  r.players.forEach((p, i) => {
    const key = p.name.trim().toLowerCase();
    let row = stats.find((s) => s.name.trim().toLowerCase() === key);
    if (!row) {
      row = { name: p.name, wins: 0, games: 0, boxes: 0, best: 0, color: p.color };
      stats.push(row);
    }
    row.color = p.color;
    row.games += 1;
    row.boxes += r.scores[i];
    row.best = Math.max(row.best, r.scores[i]);
    if (r.winners.includes(i) && r.winners.length === 1) row.wins += 1;
  });
  stats.sort((a, b) => b.wins - a.wins || b.boxes - a.boxes);
  const trimmedStats = stats.slice(0, 12);
  write(STATS_KEY, trimmedStats);

  const history = loadHistory();
  history.unshift({
    date: r.date,
    size: r.size,
    names: r.players.map((p) => p.name),
    colors: r.players.map((p) => p.color),
    scores: [...r.scores],
    winners: [...r.winners],
  });
  const trimmedHist = history.slice(0, 10);
  write(HIST_KEY, trimmedHist);
  return { stats: trimmedStats, history: trimmedHist };
}

export function resetAll() {
  write(STATS_KEY, []);
  write(HIST_KEY, []);
}

export interface SavedSetup {
  count: number;
  names: string[];
  cpus: boolean[];
  size: number;
  turnLimit: number;
  difficulty: 'chill' | 'sharp' | 'ruthless';
}

export function loadSetup(): SavedSetup | null {
  const s = read<SavedSetup | null>(SETUP_KEY, null);
  if (!s || !Array.isArray(s.names)) return null;
  return s;
}
export function saveSetup(s: SavedSetup) {
  write(SETUP_KEY, s);
}
