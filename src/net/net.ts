import Peer, { type DataConnection } from 'peerjs';
import {
  decode,
  makeRoomCode,
  roomPeerId,
  userPeerId,
  type LobbyState,
  type Msg,
  type SyncState,
} from './protocol';
import type { Edge } from '../game/core';

const PEER_OPTS = { debug: 0 as const };

/* ==================================================================== */
/* Presence: always-on peer named after the user, used for friend       */
/* lookup + invitations.                                                */
/* ==================================================================== */

export type PresenceStatus = 'off' | 'connecting' | 'online' | 'taken' | 'error';

export class Presence {
  peer: Peer | null = null;
  username = '';
  status: PresenceStatus = 'off';
  onStatus: (s: PresenceStatus) => void = () => {};
  onInvite: (from: string, code: string) => void = () => {};
  onFriendReq: (from: string) => void = () => {};
  private retry = 0;
  private destroyed = false;

  connect(username: string) {
    this.destroy(false);
    this.destroyed = false;
    this.username = username;
    this.set('connecting');
    this.open();
  }

  private set(s: PresenceStatus) {
    this.status = s;
    this.onStatus(s);
  }

  private open() {
    if (this.destroyed) return;
    const id = userPeerId(this.username);
    const peer = new Peer(id, PEER_OPTS);
    this.peer = peer;
    peer.on('open', () => {
      this.retry = 0;
      this.set('online');
    });
    peer.on('connection', (conn) => this.handle(conn));
    peer.on('disconnected', () => {
      if (this.destroyed) return;
      this.set('connecting');
      try {
        peer.reconnect();
      } catch {
        /* ignore */
      }
    });
    peer.on('error', (err: any) => {
      const t = err?.type;
      if (t === 'unavailable-id') {
        this.set('taken');
        return;
      }
      if (t === 'peer-unavailable') return; // probe misses, ignore
      if (t === 'network' || t === 'server-error' || t === 'socket-error') {
        if (this.destroyed) return;
        this.set('connecting');
        const wait = Math.min(12000, 800 * Math.pow(2, this.retry++));
        setTimeout(() => {
          if (this.destroyed) return;
          try {
            peer.destroy();
          } catch {
            /* ignore */
          }
          this.open();
        }, wait);
      }
    });
  }

  private handle(conn: DataConnection) {
    conn.on('data', (raw) => {
      const m = decode(raw);
      if (!m) return;
      if (m.k === 'who') {
        conn.send({ k: 'iam', name: this.username } satisfies Msg);
      } else if (m.k === 'invite') {
        this.onInvite(m.from, m.code);
        conn.send({ k: 'iam', name: this.username } satisfies Msg);
      } else if (m.k === 'friend-req') {
        this.onFriendReq(m.from);
      }
    });
  }

  /** Open a short-lived connection to another user. */
  private dial(name: string, timeout = 5000): Promise<DataConnection | null> {
    return new Promise((resolve) => {
      const peer = this.peer;
      if (!peer || peer.destroyed || this.status !== 'online') return resolve(null);
      let done = false;
      let conn: DataConnection;
      try {
        conn = peer.connect(userPeerId(name), { reliable: true });
      } catch {
        return resolve(null);
      }
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.off('error', onErr);
        if (!ok) {
          try {
            conn.close();
          } catch {
            /* ignore */
          }
        }
        resolve(ok ? conn : null);
      };
      const onErr = (err: any) => {
        if (err?.type === 'peer-unavailable') finish(false);
      };
      const timer = setTimeout(() => finish(false), timeout);
      peer.on('error', onErr);
      conn.on('open', () => finish(true));
      conn.on('error', () => finish(false));
    });
  }

  /** Is this username currently online? */
  async lookup(name: string): Promise<boolean> {
    if (name.trim().toLowerCase() === this.username.trim().toLowerCase()) return false;
    const conn = await this.dial(name, 4500);
    if (!conn) return false;
    setTimeout(() => {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
    }, 400);
    return true;
  }

  async sendInvite(name: string, code: string): Promise<boolean> {
    const conn = await this.dial(name, 5000);
    if (!conn) return false;
    conn.send({ k: 'invite', from: this.username, code } satisfies Msg);
    setTimeout(() => {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
    }, 800);
    return true;
  }

  async sendFriendRequest(name: string): Promise<boolean> {
    const conn = await this.dial(name, 5000);
    if (!conn) return false;
    conn.send({ k: 'friend-req', from: this.username } satisfies Msg);
    setTimeout(() => {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
    }, 800);
    return true;
  }

  destroy(markOff = true) {
    this.destroyed = true;
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.peer = null;
    if (markOff) this.set('off');
  }
}

/* ==================================================================== */
/* Room: host = authority. Guests predict their own move locally and    */
/* the host reconciles, so perceived input latency is zero.             */
/* ==================================================================== */

export type RoomStatus = 'idle' | 'opening' | 'lobby' | 'playing' | 'closed' | 'error';

export interface RoomEvents {
  onLobby: (l: LobbyState) => void;
  onStatus: (s: RoomStatus, info?: string) => void;
  onStart: (l: LobbyState, mySlot: number) => void;
  onMove: (e: Edge, slot: number) => void;
  onSync: (s: SyncState) => void;
  onRematch: () => void;
  onEmote: (slot: number, icon: string) => void;
  onPeerLeft: (name: string) => void;
}

export class Room {
  peer: Peer | null = null;
  isHost = false;
  code = '';
  cid = '';
  name = '';
  mySlot = 0;
  status: RoomStatus = 'idle';
  lobby: LobbyState = { code: '', hostCid: '', players: [], size: 5, turnLimit: 10, started: false };
  seq = 0;
  ping = 0;

  private conns = new Map<string, DataConnection>();
  private hostConn: DataConnection | null = null;
  private hb: number | null = null;
  private lastPong = new Map<string, number>();
  private reconnectTries = 0;
  private destroyed = false;
  private ev: RoomEvents;

  constructor(ev: RoomEvents) {
    this.ev = ev;
  }

  private set(s: RoomStatus, info?: string) {
    this.status = s;
    this.ev.onStatus(s, info);
  }

  /* -------------------------- host -------------------------- */

  host(name: string, size: number, turnLimit: number, code = makeRoomCode()) {
    this.close(false);
    this.destroyed = false;
    this.isHost = true;
    this.name = name;
    this.cid = name.toLowerCase();
    this.code = code;
    this.mySlot = 0;
    this.lobby = {
      code,
      hostCid: this.cid,
      players: [{ cid: this.cid, name, slot: 0, ready: true, online: true, ping: 0 }],
      size,
      turnLimit,
      started: false,
    };
    this.set('opening');
    const peer = new Peer(roomPeerId(code), PEER_OPTS);
    this.peer = peer;
    peer.on('open', () => {
      this.set('lobby');
      this.ev.onLobby(this.lobby);
      this.startHeartbeat();
    });
    peer.on('connection', (conn) => this.acceptGuest(conn));
    peer.on('disconnected', () => {
      if (!this.destroyed) {
        try {
          peer.reconnect();
        } catch {
          /* ignore */
        }
      }
    });
    peer.on('error', (err: any) => {
      if (err?.type === 'unavailable-id') {
        // code collision — retry with a fresh one
        try {
          peer.destroy();
        } catch {
          /* ignore */
        }
        if (!this.destroyed) this.host(name, size, turnLimit, makeRoomCode());
        return;
      }
      if (err?.type === 'peer-unavailable') return;
      this.set('error', err?.type || 'réseau');
    });
  }

  private acceptGuest(conn: DataConnection) {
    conn.on('open', () => {
      conn.on('data', (raw) => {
        const m = decode(raw);
        if (m) this.onHostMsg(conn, m);
      });
    });
    conn.on('close', () => this.dropGuest(conn));
    conn.on('error', () => this.dropGuest(conn));
  }

  private cidOf(conn: DataConnection): string | null {
    for (const [cid, c] of this.conns) if (c === conn) return cid;
    return null;
  }

  private dropGuest(conn: DataConnection) {
    const cid = this.cidOf(conn);
    if (!cid) return;
    this.conns.delete(cid);
    this.lastPong.delete(cid);
    const p = this.lobby.players.find((x) => x.cid === cid);
    if (p) {
      p.online = false;
      this.ev.onPeerLeft(p.name);
      if (!this.lobby.started) this.lobby.players = this.lobby.players.filter((x) => x.cid !== cid);
      this.reslot();
      this.broadcastLobby();
    }
  }

  private reslot() {
    this.lobby.players.forEach((p, i) => (p.slot = i));
  }

  private onHostMsg(conn: DataConnection, m: Msg) {
    switch (m.k) {
      case 'hello': {
        const existing = this.lobby.players.find((p) => p.cid === m.cid);
        if (existing) {
          existing.online = true;
          existing.name = m.name;
          this.conns.set(m.cid, conn);
          this.lastPong.set(m.cid, Date.now());
          conn.send({ k: 'welcome', slot: existing.slot, lobby: this.lobby } satisfies Msg);
          if (this.lobby.started) conn.send({ k: 'sync', state: this.pullState() } satisfies Msg);
          this.broadcastLobby();
          return;
        }
        if (this.lobby.started || this.lobby.players.length >= 4) {
          conn.send({ k: 'full' } satisfies Msg);
          setTimeout(() => conn.close(), 400);
          return;
        }
        const slot = this.lobby.players.length;
        this.lobby.players.push({
          cid: m.cid,
          name: m.name,
          slot,
          ready: false,
          online: true,
          ping: 0,
        });
        this.conns.set(m.cid, conn);
        this.lastPong.set(m.cid, Date.now());
        conn.send({ k: 'welcome', slot, lobby: this.lobby } satisfies Msg);
        this.broadcastLobby();
        break;
      }
      case 'ready': {
        const cid = this.cidOf(conn);
        const p = this.lobby.players.find((x) => x.cid === cid);
        if (p) p.ready = m.ready;
        this.broadcastLobby();
        break;
      }
      case 'move': {
        // validated by the game layer through onMove; simply relay
        this.seq = m.seq;
        this.ev.onMove(m.e, m.slot);
        break;
      }
      case 'ping':
        conn.send({ k: 'pong', t: m.t } satisfies Msg);
        break;
      case 'pong': {
        const cid = this.cidOf(conn);
        if (cid) {
          this.lastPong.set(cid, Date.now());
          const p = this.lobby.players.find((x) => x.cid === cid);
          if (p) p.ping = Math.max(1, Math.round(performance.now() - m.t));
        }
        break;
      }
      case 'emote':
        this.ev.onEmote(m.slot, m.icon);
        this.relay({ k: 'emote', slot: m.slot, icon: m.icon }, this.cidOf(conn) || undefined);
        break;
      case 'rematch':
        this.ev.onRematch();
        break;
      case 'bye':
        this.dropGuest(conn);
        break;
      default:
        break;
    }
  }

  /* -------------------------- guest -------------------------- */

  join(name: string, code: string) {
    this.close(false);
    this.destroyed = false;
    this.isHost = false;
    this.name = name;
    this.cid = name.toLowerCase();
    this.code = code.trim().toUpperCase();
    this.set('opening');
    const peer = new Peer(PEER_OPTS);
    this.peer = peer;
    peer.on('open', () => this.dialHost());
    peer.on('disconnected', () => {
      if (!this.destroyed) {
        try {
          peer.reconnect();
        } catch {
          /* ignore */
        }
      }
    });
    peer.on('error', (err: any) => {
      if (err?.type === 'peer-unavailable') {
        this.scheduleRejoin('salle introuvable');
        return;
      }
      if (err?.type === 'network' || err?.type === 'socket-error') this.scheduleRejoin('réseau');
    });
  }

  private dialHost() {
    const peer = this.peer;
    if (!peer || this.destroyed) return;
    const conn = peer.connect(roomPeerId(this.code), { reliable: true });
    this.hostConn = conn;
    conn.on('open', () => {
      this.reconnectTries = 0;
      conn.send({ k: 'hello', cid: this.cid, name: this.name } satisfies Msg);
      this.startHeartbeat();
    });
    conn.on('data', (raw) => {
      const m = decode(raw);
      if (m) this.onGuestMsg(m);
    });
    conn.on('close', () => this.scheduleRejoin('connexion perdue'));
    conn.on('error', () => this.scheduleRejoin('erreur réseau'));
  }

  private scheduleRejoin(reason: string) {
    if (this.destroyed || this.isHost) return;
    if (this.status === 'closed') return;
    this.reconnectTries++;
    if (this.reconnectTries > 8) {
      this.set('error', reason);
      return;
    }
    this.set('opening', `reconnexion… (${this.reconnectTries})`);
    const wait = Math.min(6000, 500 * Math.pow(1.7, this.reconnectTries));
    setTimeout(() => {
      if (this.destroyed) return;
      if (this.peer && this.peer.disconnected && !this.peer.destroyed) {
        try {
          this.peer.reconnect();
        } catch {
          /* ignore */
        }
      }
      this.dialHost();
    }, wait);
  }

  private onGuestMsg(m: Msg) {
    switch (m.k) {
      case 'welcome':
        this.mySlot = m.slot;
        this.lobby = m.lobby;
        this.set(m.lobby.started ? 'playing' : 'lobby');
        this.ev.onLobby(m.lobby);
        if (m.lobby.started) this.ev.onStart(m.lobby, m.slot);
        break;
      case 'full':
        this.set('error', 'salle pleine ou partie en cours');
        break;
      case 'lobby': {
        this.lobby = m.lobby;
        const me = m.lobby.players.find((p) => p.cid === this.cid);
        if (me) this.mySlot = me.slot;
        this.ev.onLobby(m.lobby);
        break;
      }
      case 'start':
        this.lobby = m.lobby;
        this.set('playing');
        this.ev.onStart(m.lobby, this.mySlot);
        break;
      case 'move':
        if (m.slot !== this.mySlot) this.ev.onMove(m.e, m.slot);
        this.seq = m.seq;
        break;
      case 'sync':
        this.ev.onSync(m.state);
        break;
      case 'rematch':
        this.ev.onRematch();
        break;
      case 'emote':
        this.ev.onEmote(m.slot, m.icon);
        break;
      case 'ping':
        this.hostConn?.send({ k: 'pong', t: m.t } satisfies Msg);
        break;
      case 'pong':
        this.ping = Math.max(1, Math.round(performance.now() - m.t));
        break;
      default:
        break;
    }
  }

  /* -------------------------- shared -------------------------- */

  private startHeartbeat() {
    if (this.hb !== null) return;
    this.hb = window.setInterval(() => {
      const t = performance.now();
      if (this.isHost) {
        for (const [cid, c] of this.conns) {
          try {
            c.send({ k: 'ping', t } satisfies Msg);
          } catch {
            /* ignore */
          }
          const last = this.lastPong.get(cid) ?? Date.now();
          const p = this.lobby.players.find((x) => x.cid === cid);
          if (p) {
            const stale = Date.now() - last > 9000;
            if (p.online === stale) {
              p.online = !stale;
              this.broadcastLobby();
            }
          }
        }
      } else if (this.hostConn && this.hostConn.open) {
        try {
          this.hostConn.send({ k: 'ping', t } satisfies Msg);
        } catch {
          /* ignore */
        }
      }
    }, 2000);
  }

  broadcastLobby() {
    this.reslot();
    this.ev.onLobby({ ...this.lobby, players: [...this.lobby.players] });
    if (this.isHost) this.relay({ k: 'lobby', lobby: this.lobby });
  }

  setOptions(size: number, turnLimit: number) {
    if (!this.isHost) return;
    this.lobby.size = size;
    this.lobby.turnLimit = turnLimit;
    this.broadcastLobby();
  }

  setReady(ready: boolean) {
    if (this.isHost) {
      const me = this.lobby.players.find((p) => p.cid === this.cid);
      if (me) me.ready = ready;
      this.broadcastLobby();
    } else this.hostConn?.send({ k: 'ready', ready } satisfies Msg);
  }

  startGame() {
    if (!this.isHost) return;
    this.lobby.started = true;
    this.seq = 0;
    this.reslot();
    this.relay({ k: 'start', lobby: this.lobby });
    this.set('playing');
    this.ev.onStart(this.lobby, 0);
  }

  sendMove(e: Edge, slot: number) {
    this.seq++;
    const msg: Msg = { k: 'move', seq: this.seq, slot, e };
    if (this.isHost) this.relay(msg);
    else this.hostConn?.send(msg);
  }

  /** host relays a guest move to everyone else */
  relayMove(e: Edge, slot: number, exceptCid?: string) {
    if (!this.isHost) return;
    this.relay({ k: 'move', seq: ++this.seq, slot, e }, exceptCid);
  }

  sendEmote(icon: string) {
    const msg: Msg = { k: 'emote', slot: this.mySlot, icon };
    if (this.isHost) this.relay(msg);
    else this.hostConn?.send(msg);
  }

  sendRematch() {
    if (this.isHost) this.relay({ k: 'rematch' });
    else this.hostConn?.send({ k: 'rematch' } satisfies Msg);
  }

  pushSync(state: SyncState, cid?: string) {
    if (!this.isHost) return;
    this.relay({ k: 'sync', state }, undefined, cid);
  }

  /** provided by the app so the host can answer late joiners */
  pullState: () => SyncState = () => ({
    h: [],
    v: [],
    owner: [],
    scores: [],
    turn: 0,
    streak: 0,
    seq: 0,
  });

  private relay(m: Msg, exceptCid?: string, onlyCid?: string) {
    for (const [cid, c] of this.conns) {
      if (exceptCid && cid === exceptCid) continue;
      if (onlyCid && cid !== onlyCid) continue;
      try {
        if (c.open) c.send(m);
      } catch {
        /* ignore */
      }
    }
  }

  cidForSlot(slot: number) {
    return this.lobby.players.find((p) => p.slot === slot)?.cid;
  }

  close(markClosed = true) {
    this.destroyed = true;
    if (this.hb !== null) {
      clearInterval(this.hb);
      this.hb = null;
    }
    try {
      if (!this.isHost) this.hostConn?.send({ k: 'bye' } satisfies Msg);
    } catch {
      /* ignore */
    }
    for (const c of this.conns.values()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
    this.hostConn = null;
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.peer = null;
    if (markClosed) this.set('closed');
  }
}
