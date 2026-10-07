export interface PlayerCfg {
  id: number; // 1..4, matches the value stored in the board arrays
  name: string;
  badge: string; // initial drawn inside owned boxes
  color: string;
  glow: string;
  cpu: boolean;
}

export const PALETTE = [
  { color: '#3ce0d6', glow: 'rgba(60,224,214,0.7)', name: 'Turquoise' },
  { color: '#ff6b81', glow: 'rgba(255,107,129,0.7)', name: 'Corail' },
  { color: '#ffc857', glow: 'rgba(255,200,87,0.7)', name: 'Ambre' },
  { color: '#9d8cff', glow: 'rgba(157,140,255,0.7)', name: 'Violet' },
];

export const DEFAULT_NAMES = ['Joueur 1', 'Joueur 2', 'Joueur 3', 'Joueur 4'];

export function initialOf(name: string) {
  const t = name.trim();
  if (!t) return '?';
  return t[0].toUpperCase();
}

/** Ensures every player shows a distinct badge: "A", then "AL" if two names collide. */
export function uniqueInitials(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    const t = n.trim() || '?';
    let cand = t[0].toUpperCase();
    let i = 1;
    while (used.has(cand) && i < t.length) {
      cand = (t[0] + t[i]).toUpperCase();
      i++;
    }
    let k = 2;
    while (used.has(cand)) cand = t[0].toUpperCase() + k++;
    used.add(cand);
    return cand;
  });
}

export function makePlayers(count: number, names?: string[], cpus?: boolean[]): PlayerCfg[] {
  const finalNames = Array.from(
    { length: count },
    (_, i) => names?.[i]?.trim() || DEFAULT_NAMES[i],
  );
  const badges = uniqueInitials(finalNames);
  const out: PlayerCfg[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: i + 1,
      name: finalNames[i],
      badge: badges[i],
      color: PALETTE[i].color,
      glow: PALETTE[i].glow,
      cpu: cpus?.[i] ?? false,
    });
  }
  return out;
}
