import type { Edge } from '../game/core';

export const APP = 'ccl1'; // namespace for peer ids (change to reset the directory)
export const PRESENCE_PREFIX = `${APP}-u-`;
export const ROOM_PREFIX = `${APP}-r-`;

export const userPeerId = (username: string) =>
  PRESENCE_PREFIX + username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
export const roomPeerId = (code: string) => ROOM_PREFIX + code.trim().toUpperCase();

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 confusion
export function makeRoomCode(len = 5) {
  let s = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

export interface NetPlayer {
  cid: string; // client id (peer id of that user, or 'host')
  name: string;
  slot: number; // 0..3
  ready: boolean;
  online: boolean;
  ping: number;
}

export interface LobbyState {
  code: string;
  hostCid: string;
  players: NetPlayer[];
  size: number;
  turnLimit: number;
  started: boolean;
}

/* ---- messages ---- */
export type Msg =
  | { k: 'hello'; cid: string; name: string }
  | { k: 'welcome'; slot: number; lobby: LobbyState }
  | { k: 'full' }
  | { k: 'lobby'; lobby: LobbyState }
  | { k: 'ready'; ready: boolean }
  | { k: 'start'; lobby: LobbyState }
  | { k: 'move'; seq: number; slot: number; e: Edge }
  | { k: 'sync'; state: SyncState }
  | { k: 'rematch' }
  | { k: 'emote'; slot: number; icon: string }
  | { k: 'ping'; t: number }
  | { k: 'pong'; t: number }
  | { k: 'bye' }
  // presence channel
  | { k: 'who'; name: string }
  | { k: 'iam'; name: string }
  | { k: 'invite'; from: string; code: string }
  | { k: 'friend-req'; from: string };

export interface SyncState {
  h: number[];
  v: number[];
  owner: number[];
  scores: number[];
  turn: number;
  streak: number;
  seq: number;
}

export function encode(m: Msg): string {
  return JSON.stringify(m);
}
export function decode(raw: unknown): Msg | null {
  try {
    if (typeof raw === 'string') return JSON.parse(raw) as Msg;
    if (raw && typeof raw === 'object') return raw as Msg;
  } catch {
    /* ignore */
  }
  return null;
}
