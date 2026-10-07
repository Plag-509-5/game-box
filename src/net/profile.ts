export interface Friend {
  name: string;
  added: number;
  lastSeen: number;
}

const U_KEY = 'box.username';
const F_KEY = 'box.friends';

export function loadUsername(): string {
  try {
    return localStorage.getItem(U_KEY) || '';
  } catch {
    return '';
  }
}
export function saveUsername(n: string) {
  try {
    localStorage.setItem(U_KEY, n);
  } catch {
    /* ignore */
  }
}

export function validUsername(n: string) {
  return /^[a-zA-Z0-9_-]{3,14}$/.test(n.trim());
}

export function loadFriends(): Friend[] {
  try {
    const raw = localStorage.getItem(F_KEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
export function saveFriends(f: Friend[]) {
  try {
    localStorage.setItem(F_KEY, JSON.stringify(f.slice(0, 40)));
  } catch {
    /* ignore */
  }
}

export function addFriend(list: Friend[], name: string): Friend[] {
  const key = name.trim().toLowerCase();
  if (!key || list.some((f) => f.name.toLowerCase() === key)) return list;
  const next = [...list, { name: name.trim(), added: Date.now(), lastSeen: 0 }];
  saveFriends(next);
  return next;
}

export function removeFriend(list: Friend[], name: string): Friend[] {
  const next = list.filter((f) => f.name.toLowerCase() !== name.trim().toLowerCase());
  saveFriends(next);
  return next;
}
