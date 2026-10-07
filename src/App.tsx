import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth/AuthContext';
import { Game, type Hud, type MatchResult } from './game/Game';
import { isMuted, setMuted, sfx, unlockAudio } from './game/audio';
import { DEFAULT_NAMES, makePlayers } from './game/players';
import {
  loadHistory,
  loadSetup,
  loadStats,
  recordMatch,
  resetAll,
  saveSetup,
  type MatchRow,
  type PlayerStat,
} from './game/scores';
import { Presence, Room, type PresenceStatus, type RoomStatus } from './net/net';
import type { LobbyState } from './net/protocol';
import type { Friend } from './net/profile';
import { TopBar } from './ui/Hud';
import { MenuScreen, OverScreen, PauseScreen, type SetupState } from './ui/Screens';
import { InviteToast, NetOverlay, OnlineHub, RoomLobby } from './ui/OnlineScreens';
import { AuthScreen, UserDashboard } from './ui/AccountScreens';

type View = 'game' | 'auth' | 'dashboard' | 'hub' | 'lobby';

const EMPTY_HUD: Hud = {
  status: 'menu',
  players: [],
  scores: [],
  turn: 0,
  streak: 0,
  turnTime: 0,
  turnLimit: 0,
  boxesLeft: 25,
  total: 25,
  lastMsg: '',
  online: false,
  localSlot: 0,
  myTurn: true,
};

const DEFAULT_SETUP: SetupState = {
  count: 2,
  names: [...DEFAULT_NAMES],
  cpus: [false, false, false, false],
  size: 5,
  turnLimit: 10,
  difficulty: 'sharp',
};

const EMPTY_LOBBY: LobbyState = {
  code: '',
  hostCid: '',
  players: [],
  size: 5,
  turnLimit: 10,
  started: false,
};

export default function App() {
  const auth = useAuth();
  const authRef = useRef(auth);
  authRef.current = auth;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);

  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [stats, setStats] = useState<PlayerStat[]>([]);
  const [history, setHistory] = useState<MatchRow[]>([]);
  const [setup, setSetup] = useState<SetupState>(DEFAULT_SETUP);
  const [muted, setMutedState] = useState(false);

  // ---- online state
  const [view, setView] = useState<View>('game');
  const [username, setUsername] = useState('');
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>('off');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [presenceMap, setPresenceMap] = useState<Record<string, boolean>>({});
  const [lobby, setLobby] = useState<LobbyState>(EMPTY_LOBBY);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>('idle');
  const [roomInfo, setRoomInfo] = useState('');
  const [invite, setInvite] = useState<{ from: string; code: string } | null>(null);
  const [inviteState, setInviteState] = useState<Record<string, 'sending' | 'sent' | 'fail'>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [netBanner, setNetBanner] = useState('');

  const [ping, setPing] = useState<number | undefined>(undefined);
  const presenceRef = useRef<Presence | null>(null);
  const roomRef = useRef<Room | null>(null);
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const pendingCodeRef = useRef<string>('');
  const authNextRef = useRef<'game' | 'online'>('game');

  /* ------------------------------------------------ boot */
  useEffect(() => {
    setStats(loadStats());
    setHistory(loadHistory());
    setMutedState(isMuted());
    const saved = loadSetup();
    if (saved) {
      setSetup({
        count: Math.min(4, Math.max(2, saved.count)),
        names: DEFAULT_NAMES.map((d, i) => saved.names[i] || d),
        cpus: [0, 1, 2, 3].map((i) => !!saved.cpus?.[i]),
        size: saved.size || 5,
        turnLimit: saved.turnLimit ?? 10,
        difficulty: saved.difficulty || 'sharp',
      });
    }
    const hash = location.hash.replace('#', '').toUpperCase();
    if (/^[A-Z0-9]{4,6}$/.test(hash)) pendingCodeRef.current = hash;
  }, []);

  // Authenticated identity and preferences come from MongoDB.
  useEffect(() => {
    const user = auth.user;
    if (!user) {
      setFriends([]);
      setUsername('');
      if (view === 'dashboard') setView('game');
      return;
    }
    setUsername(user.username);
    setMuted(!user.preferences.sound);
    setMutedState(!user.preferences.sound);
    document.documentElement.lang = user.preferences.language;
    document.documentElement.dataset.reducedMotion = user.preferences.reducedMotion ? 'true' : 'false';
    const game = user.preferences.game;
    if (game) {
      setSetup((prev) => ({
        ...prev,
        count: game.playerCount,
        size: game.size,
        turnLimit: game.turnLimit,
        difficulty: game.difficulty,
      }));
    }
  }, [auth.user, view]);

  useEffect(() => {
    const remoteFriends: Friend[] = auth.friendships
      .filter((f) => f.status === 'accepted')
      .map((f) => ({ name: f.user.username, added: new Date(f.updatedAt).getTime(), lastSeen: 0 }));
    setFriends(remoteFriends);
  }, [auth.friendships]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const g = new Game(canvasRef.current);
    gameRef.current = g;
    g.onHud = (h) => setHud({ ...h, scores: [...h.scores] });
    g.onOver = (r) => {
      setResult(r);
      const { stats: s, history: h } = recordMatch(r);
      setStats(s);
      setHistory(h);
      const currentAuth = authRef.current;
      if (currentAuth.user) {
        void currentAuth.saveMatch({
          mode: g.online ? 'online' : 'local',
          size: r.size,
          names: r.players.map((p) => p.name),
          scores: r.scores,
          myIndex: g.online ? g.localSlot : 0,
        });
      }
    };
    g.onLocalMove = (e, slot) => {
      const room = roomRef.current;
      if (!room) return;
      // guests send to the host, the host fans out to everyone
      room.sendMove(e, slot);
    };
    return () => {
      g.dispose();
      gameRef.current = null;
    };
  }, []);

  /* ------------------------------------------------ local game */
  const startMatch = useCallback(() => {
    unlockAudio();
    sfx.ui();
    const s = setupRef.current;
    saveSetup(s);
    if (authRef.current.user) {
      void authRef.current.updateProfile({
        preferences: {
          game: {
            size: s.size,
            turnLimit: s.turnLimit,
            difficulty: s.difficulty,
            playerCount: s.count,
          },
        },
      });
    }
    setResult(null);
    setView('game');
    roomRef.current?.close();
    roomRef.current = null;
    gameRef.current?.start({
      players: makePlayers(s.count, s.names, s.cpus),
      size: s.size,
      turnLimit: s.turnLimit,
      difficulty: s.difficulty,
    });
  }, []);

  const toMenu = useCallback(() => {
    sfx.ui();
    setResult(null);
    setView('game');
    gameRef.current?.toMenu();
  }, []);

  /* ------------------------------------------------ presence */
  const connectPresence = useCallback((name: string) => {
    setUsername(name);
    let p = presenceRef.current;
    if (!p) {
      p = new Presence();
      presenceRef.current = p;
      p.onStatus = (s) => setPresenceStatus(s);
      p.onInvite = (from, code) => {
        setInvite({ from, code });
        sfx.ui();
      };
      p.onFriendReq = (from) => {
        setNotice(`${from} t'a ajouté en ami`);
        void authRef.current.refreshSocial();
        setTimeout(() => setNotice(''), 4000);
      };
    }
    p.connect(name);
  }, []);

  const refreshFriends = useCallback(async () => {
    const p = presenceRef.current;
    if (!p || p.status !== 'online') return;
    setBusy('refresh');
    const list = friends;
    const entries = await Promise.all(
      list.map(async (f) => [f.name.toLowerCase(), await p.lookup(f.name)] as const),
    );
    setPresenceMap(Object.fromEntries(entries));
    setBusy('');
  }, [friends]);

  useEffect(() => {
    if (presenceStatus === 'online') void refreshFriends();
  }, [presenceStatus, refreshFriends]);

  // live RTT readout + lobby ping refresh
  useEffect(() => {
    const id = window.setInterval(() => {
      const room = roomRef.current;
      if (!room) {
        setPing(undefined);
        return;
      }
      if (room.isHost) {
        setPing(undefined);
        setLobby((l) => (l.players.length ? { ...l, players: [...room.lobby.players] } : l));
      } else setPing(room.ping || undefined);
    }, 1500);
    return () => clearInterval(id);
  }, []);



  const openOnline = useCallback(() => {
    unlockAudio();
    sfx.ui();
    const user = authRef.current.user;
    if (!user) {
      authNextRef.current = 'online';
      setView('auth');
      return;
    }
    if (presenceStatus === 'off' || !presenceRef.current) connectPresence(user.username);
    setView('hub');
  }, [connectPresence, presenceStatus]);

  /* ------------------------------------------------ room */
  const ensureRoom = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.close(false);
      roomRef.current = null;
    }
    const room = new Room({
      onLobby: (l) => {
        setLobby({ ...l, players: [...l.players] });
        const g = gameRef.current;
        if (g && g.online && g.status === 'playing') {
          const off = l.players.filter((p) => !p.online).map((p) => p.name);
          setNetBanner(off.length ? `${off.join(', ')} — reconnexion…` : '');
        }
      },
      onStatus: (s, i) => {
        setRoomStatus(s);
        setRoomInfo(i || '');
        if (s === 'error') setNetBanner(i || 'connexion perdue');
        if (s === 'lobby' || s === 'playing') setNetBanner('');
      },
      onStart: (l, mySlot) => {
        setResult(null);
        setView('game');
        setNetBanner('');
        sfx.clear();
        gameRef.current?.start({
          players: makePlayers(
            l.players.length,
            l.players.map((p) => p.name),
            l.players.map(() => false),
          ),
          size: l.size,
          turnLimit: l.turnLimit,
          difficulty: 'sharp',
          online: true,
          localSlot: mySlot,
          isHost: room.isHost,
        });
      },
      onMove: (e, slot) => {
        const g = gameRef.current;
        if (!g) return;
        if (room.isHost) {
          // authority: reject anything illegal and heal the guest instead
          const legal = g.isLegalMove(e, slot);
          if (!legal) {
            const cid = room.cidForSlot(slot);
            room.pushSync(g.exportState(), cid);
            return;
          }
          g.applyNetMove(e, slot);
          room.relayMove(e, slot, room.cidForSlot(slot));
        } else {
          g.applyNetMove(e, slot);
        }
      },
      onSync: (s) => gameRef.current?.importState(s),
      onRematch: () => {
        if (room.isHost) return;
        setNetBanner("L'hôte relance la partie…");
        setTimeout(() => setNetBanner(''), 2500);
      },
      onEmote: () => {},
      onPeerLeft: (name) => {
        setNetBanner(`${name} s'est déconnecté`);
        setTimeout(() => setNetBanner(''), 4000);
      },
    });
    room.pullState = () => gameRef.current?.exportState() ?? ({} as never);
    roomRef.current = room;
    return room;
  }, []);

  const createRoom = useCallback(() => {
    sfx.ui();
    const room = ensureRoom();
    setIsHost(true);
    room.host(username, setupRef.current.size, 15);
    setLobby({ ...room.lobby });
    setView('lobby');
  }, [ensureRoom, username]);

  const joinRoom = useCallback(
    (code: string) => {
      sfx.ui();
      const room = ensureRoom();
      setIsHost(false);
      room.join(username, code);
      setLobby({ ...EMPTY_LOBBY, code: code.toUpperCase() });
      setView('lobby');
    },
    [ensureRoom, username],
  );

  const leaveRoom = useCallback(() => {
    sfx.ui();
    roomRef.current?.close();
    roomRef.current = null;
    setLobby(EMPTY_LOBBY);
    setNetBanner('');
    setView('hub');
    gameRef.current?.toMenu();
  }, []);

  // deep link: "#CODE" in the URL joins the room as soon as we have an identity
  useEffect(() => {
    const code = pendingCodeRef.current;
    if (!code) return;
    if (!auth.loading && !auth.user) {
      authNextRef.current = 'online';
      setView('auth');
      return;
    }
    if (!username) return;
    if (presenceStatus === 'off') {
      connectPresence(username);
      return;
    }
    if (presenceStatus === 'online') {
      pendingCodeRef.current = '';
      joinRoom(code);
    }
  }, [username, presenceStatus, joinRoom, connectPresence, auth.loading, auth.user]);

  const startOnlineGame = useCallback(() => {
    const room = roomRef.current;
    if (!room || !room.isHost) return;
    if (room.lobby.players.filter((p) => p.online).length < 2) return;
    sfx.ui();
    room.startGame();
  }, []);

  const rematchOnline = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    if (room.isHost) {
      room.sendRematch();
      room.lobby.started = false;
      room.startGame();
    } else {
      room.sendRematch();
      setNetBanner("Demande de revanche envoyée à l'hôte");
      setTimeout(() => setNetBanner(''), 3000);
    }
  }, []);

  const inviteFriend = useCallback(async (name: string) => {
    const p = presenceRef.current;
    const room = roomRef.current;
    if (!p || !room) return;
    const key = name.toLowerCase();
    setInviteState((s) => ({ ...s, [key]: 'sending' }));
    const ok = await p.sendInvite(name, room.code);
    setInviteState((s) => ({ ...s, [key]: ok ? 'sent' : 'fail' }));
    setPresenceMap((m) => ({ ...m, [key]: ok }));
    setTimeout(() => setInviteState((s) => ({ ...s, [key]: undefined as never })), 3000);
  }, []);

  const searchUser = useCallback(
    async (name: string): Promise<'online' | 'offline' | 'self'> => {
      if (name.trim().toLowerCase() === username.trim().toLowerCase()) return 'self';
      const p = presenceRef.current;
      if (!p) return 'offline';
      const on = await p.lookup(name);
      setPresenceMap((m) => ({ ...m, [name.toLowerCase()]: on }));
      return on ? 'online' : 'offline';
    },
    [username],
  );

  const closeAuth = useCallback(() => {
    const user = authRef.current.user;
    if (user && authNextRef.current === 'online') {
      authNextRef.current = 'game';
      if (!presenceRef.current || presenceRef.current.status === 'off') connectPresence(user.username);
      setView('hub');
    } else {
      authNextRef.current = 'game';
      setView('game');
    }
  }, [connectPresence]);

  const inviteFromDashboard = useCallback(
    async (name: string) => {
      const user = authRef.current.user;
      if (!user) return;
      let presence = presenceRef.current;
      if (!presence || presence.status === 'off') {
        connectPresence(user.username);
        for (let i = 0; i < 20 && presenceRef.current?.status !== 'online'; i++)
          await new Promise((resolve) => setTimeout(resolve, 150));
        presence = presenceRef.current;
      }
      let room = roomRef.current;
      if (!room || !room.isHost || room.status === 'closed') {
        room = ensureRoom();
        room.host(user.username, setupRef.current.size, 15);
        setIsHost(true);
        setLobby({ ...room.lobby });
      }
      setView('lobby');
      if (presence?.status === 'online') {
        const ok = await presence.sendInvite(name, room.code);
        setNotice(ok ? `Invitation envoyée à ${name}` : `${name} n’est pas connecté`);
      }
    },
    [connectPresence, ensureRoom],
  );

  /* ------------------------------------------------ misc */
  const togglePause = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    sfx.ui();
    if (g.online) {
      setView(view === 'lobby' ? 'game' : 'lobby');
      return;
    }
    if (g.status === 'playing') g.pause();
    else if (g.status === 'paused') g.resume();
  }, [view]);

  const toggleMute = useCallback(() => {
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
    if (authRef.current.user)
      void authRef.current.updateProfile({ preferences: { sound: !next } });
  }, []);

  const update = useCallback((patch: Partial<SetupState>) => {
    sfx.ui();
    setSetup((prev) => ({ ...prev, ...patch }));
  }, []);

  const clearStats = useCallback(() => {
    resetAll();
    setStats([]);
    setHistory([]);
    sfx.ui();
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const g = gameRef.current;
      if (!g) return;
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = ev.key.toLowerCase();
      if (k === 'escape' || k === 'p') {
        ev.preventDefault();
        if (g.status === 'playing' || g.status === 'paused') togglePause();
      } else if (k === 'r') {
        if (view !== 'game' || g.online) return;
        ev.preventDefault();
        if (g.status !== 'menu') startMatch();
      } else if (k === 'enter' || k === ' ') {
        if (view !== 'game') return;
        ev.preventDefault();
        unlockAudio();
        if (g.online) return;
        if (g.status === 'menu' || g.status === 'over') startMatch();
        else if (g.status === 'paused') g.resume();
      } else if (k === 'm') toggleMute();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [startMatch, togglePause, toggleMute, view]);

  useEffect(
    () => () => {
      roomRef.current?.close(false);
      presenceRef.current?.destroy(false);
    },
    [],
  );

  const playing = hud.status === 'playing' || hud.status === 'paused';
  const showMenus = view === 'game';
  const waitingForOther = hud.online && hud.status === 'playing' && !hud.myTurn;
  const opponentName = hud.players[hud.turn]?.name ?? '';

  return (
    <div
      className="relative flex h-[100dvh] w-full select-none flex-col overflow-hidden bg-[#070b18] text-white"
      onPointerDown={() => unlockAudio()}
      style={{ touchAction: 'manipulation' }}
    >
      {playing && showMenus && (
        <TopBar
          hud={hud}
          onPause={togglePause}
          muted={muted}
          onToggleMute={toggleMute}
          ping={ping}
        />
      )}

      <div className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />

        {showMenus && hud.status === 'menu' && (
          <MenuScreen
            setup={setup}
            update={update}
            stats={stats}
            history={history}
            onStart={startMatch}
            onReset={clearStats}
            onOnline={openOnline}
            username={username}
            online={presenceStatus === 'online'}
            account={auth.user}
            onAccount={() => {
              authNextRef.current = 'game';
              setView(auth.user ? 'dashboard' : 'auth');
            }}
          />
        )}
        {showMenus && hud.status === 'paused' && (
          <PauseScreen onResume={togglePause} onRestart={startMatch} onMenu={toMenu} />
        )}
        {showMenus && hud.status === 'over' && result && (
          <OverScreen
            result={result}
            stats={stats}
            history={history}
            onRestart={hud.online ? rematchOnline : startMatch}
            onMenu={hud.online ? leaveRoom : toMenu}
            onlineLabels={hud.online ? { restart: 'Revanche en ligne', menu: 'Quitter la salle' } : undefined}
          />
        )}

        {view === 'auth' && <AuthScreen onClose={closeAuth} />}

        {view === 'dashboard' && auth.user && (
          <UserDashboard
            onClose={() => setView('game')}
            onPlayOnline={openOnline}
            onInvite={(name) => void inviteFromDashboard(name)}
          />
        )}

        {view === 'hub' && (
          <OnlineHub
            username={username}
            status={presenceStatus}
            friends={friends}
            presenceMap={presenceMap}
            busy={busy}
            notice={notice}
            onCreate={createRoom}
            onJoin={joinRoom}
            onSearch={searchUser}
            onAddFriend={(n) => {
              void auth.searchUsers(n).then((people) => {
                const person = people.find((p) => p.username.toLowerCase() === n.toLowerCase());
                if (person) void auth.addFriend(person.id);
              });
              void presenceRef.current?.sendFriendRequest(n);
            }}
            onRemoveFriend={(n) => {
              const relation = auth.friendships.find(
                (f) => f.user.username.toLowerCase() === n.toLowerCase(),
              );
              if (relation) void auth.removeFriend(relation.id);
            }}
            onRefresh={() => void refreshFriends()}
            onChangeName={() => setView('dashboard')}
            onBack={() => setView('game')}
          />
        )}

        {view === 'lobby' && (
          <RoomLobby
            lobby={lobby}
            isHost={isHost}
            status={roomStatus}
            info={roomInfo}
            myCid={username.toLowerCase()}
            friends={friends}
            presenceMap={presenceMap}
            inviteState={inviteState}
            onInvite={(n) => void inviteFriend(n)}
            onOptions={(size, turnLimit) => roomRef.current?.setOptions(size, turnLimit)}
            onStart={startOnlineGame}
            onLeave={leaveRoom}
          />
        )}

        {invite && (
          <InviteToast
            from={invite.from}
            code={invite.code}
            onAccept={() => {
              const c = invite.code;
              setInvite(null);
              joinRoom(c);
            }}
            onDismiss={() => setInvite(null)}
          />
        )}

        {showMenus && playing && (netBanner || waitingForOther) && (
          <NetOverlay
            text={netBanner || `Au tour de ${opponentName}…`}
            onLeave={netBanner ? leaveRoom : undefined}
          />
        )}
      </div>

      {playing && showMenus && (
        <div className="pointer-events-none relative z-20 flex items-center justify-center gap-2 pb-2.5 pt-1">
          <span className="text-[10px] font-medium tracking-wide text-slate-600">
            {hud.online
              ? `Salle ${lobby.code} · ferme un carré pour rejouer`
              : 'Ferme un carré : il prend ton initiale et tu rejoues'}
          </span>
          <span className="h-3 w-px bg-white/10" />
          <span className="text-[10px] font-medium tracking-[0.16em] text-slate-700">
            BOX · <span className="font-display font-bold text-slate-600">PLAG</span>
          </span>
        </div>
      )}
    </div>
  );
}
