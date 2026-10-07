import { useState } from 'react';
import { Btn, Field, Panel } from './Screens';
import { Logo, Mark, Signature } from './Brand';
import type { LobbyState } from '../net/protocol';
import type { PresenceStatus, RoomStatus } from '../net/net';
import type { Friend } from '../net/profile';
import { PALETTE, uniqueInitials } from '../game/players';

const STATUS_LABEL: Record<PresenceStatus, string> = {
  off: 'hors ligne',
  connecting: 'connexion…',
  online: 'en ligne',
  taken: 'pseudo pris',
  error: 'erreur réseau',
};
const STATUS_COLOR: Record<PresenceStatus, string> = {
  off: '#64748b',
  connecting: '#ffc857',
  online: '#4ade80',
  taken: '#ff6b81',
  error: '#ff6b81',
};

export function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${pulse ? 'animate-pulse' : ''}`}
      style={{ background: color, boxShadow: `0 0 8px ${color}` }}
    />
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  const { mono, className = '', ...rest } = props;
  return (
    <input
      {...rest}
      className={`hairline w-full rounded-xl bg-black/30 px-3 py-2.5 text-[13px] font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-brand-400/60 focus:bg-black/40 ${
        mono ? 'num text-center text-[17px] font-extrabold tracking-[0.32em]' : ''
      } ${className}`}
    />
  );
}

/* ------------------------------------------------------------------ */

export function ProfileScreen({
  initial,
  status,
  error,
  onSubmit,
  onBack,
}: {
  initial: string;
  status: PresenceStatus;
  error?: string;
  onSubmit: (name: string) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(initial);
  const ok = /^[a-zA-Z0-9_-]{3,14}$/.test(name.trim());
  return (
    <Panel>
      <Logo size="sm" />
      <h2 className="font-display mt-4 text-center text-[22px] font-bold tracking-tight text-white">
        Ton pseudo en ligne
      </h2>
      <p className="mt-1 text-center text-[12px] leading-relaxed text-slate-500">
        C’est ton identifiant : tes amis te trouveront avec.
      </p>

      <div className="mt-4">
        <Input
          autoFocus
          mono
          value={name}
          maxLength={14}
          onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ok) onSubmit(name.trim());
          }}
          placeholder="zoe_92"
        />
        <p className="mt-1.5 text-center text-[10.5px] text-slate-600">
          3 à 14 caractères · lettres, chiffres, − et _
        </p>
      </div>

      {status === 'taken' && (
        <p className="mt-2.5 text-center text-[11.5px] font-semibold text-rose-400">
          Ce pseudo est déjà connecté — choisis-en un autre.
        </p>
      )}
      {error && (
        <p className="mt-2.5 text-center text-[11.5px] font-semibold text-rose-400">{error}</p>
      )}

      <div className="mt-5 space-y-2">
        <Btn onClick={() => ok && onSubmit(name.trim())} disabled={!ok}>
          {status === 'connecting' ? 'Connexion…' : 'Se connecter'}
        </Btn>
        <Btn variant="ghost" onClick={onBack}>
          Retour
        </Btn>
      </div>
      <Signature className="mt-5" />
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

export function OnlineHub({
  username,
  status,
  friends,
  presenceMap,
  busy,
  notice,
  onCreate,
  onJoin,
  onSearch,
  onAddFriend,
  onRemoveFriend,
  onRefresh,
  onChangeName,
  onBack,
}: {
  username: string;
  status: PresenceStatus;
  friends: Friend[];
  presenceMap: Record<string, boolean>;
  busy: string;
  notice: string;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onSearch: (name: string) => Promise<'online' | 'offline' | 'self'>;
  onAddFriend: (name: string) => void;
  onRemoveFriend: (name: string) => void;
  onRefresh: () => void;
  onChangeName: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ name: string; state: 'online' | 'offline' | 'self' } | null>(
    null,
  );
  const [searching, setSearching] = useState(false);

  const doSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setFound(null);
    setFound({ name: q, state: await onSearch(q) });
    setSearching(false);
  };

  return (
    <Panel wide>
      {/* identity bar */}
      <div className="hairline flex items-center gap-2.5 rounded-2xl bg-black/25 px-3 py-2.5">
        <Mark size={20} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold leading-tight text-white">{username}</p>
          <p className="flex items-center gap-1.5 text-[10.5px] font-medium text-slate-500">
            <Dot color={STATUS_COLOR[status]} pulse={status === 'connecting'} />
            {STATUS_LABEL[status]}
          </p>
        </div>
        <button
          onClick={onChangeName}
          className="shrink-0 rounded-lg px-2 py-1 text-[10.5px] font-semibold text-slate-500 transition hover:bg-white/5 hover:text-brand-300"
        >
          changer
        </button>
      </div>

      {notice && (
        <p className="mt-2.5 rounded-xl border border-brand-400/30 bg-brand-400/10 px-3 py-2 text-[11.5px] font-medium text-brand-300">
          {notice}
        </p>
      )}

      {/* rooms */}
      <div className="mt-4 space-y-2">
        <Btn onClick={onCreate} icon="🏠" sub="génère un code d’invitation">
          Créer une salle
        </Btn>
        <div className="flex gap-2">
          <Input
            mono
            value={code}
            maxLength={6}
            onChange={(e) =>
              setCode((e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
            }
            onKeyDown={(e) => e.key === 'Enter' && code.length >= 4 && onJoin(code)}
            placeholder="CODE"
          />
          <button
            onClick={() => code.length >= 4 && onJoin(code)}
            disabled={code.length < 4}
            className="font-display shrink-0 rounded-xl bg-white/[0.07] px-4 text-[13px] font-bold text-white transition hover:bg-brand-400 hover:text-ink-950 active:scale-95 disabled:opacity-35"
          >
            Rejoindre
          </button>
        </div>
      </div>

      {/* friends */}
      <div className="hairline mt-4 rounded-2xl bg-black/25 p-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="eyebrow text-brand-400/80">Amis · {friends.length}</span>
          <button
            onClick={onRefresh}
            className="text-[10px] font-medium text-slate-600 transition hover:text-brand-300"
          >
            {busy === 'refresh' ? 'actualisation…' : 'actualiser'}
          </button>
        </div>

        <div className="flex gap-1.5">
          <Input
            value={query}
            maxLength={14}
            onChange={(e) =>
              setQuery((e.target as HTMLInputElement).value.replace(/[^a-zA-Z0-9_-]/g, ''))
            }
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="chercher un pseudo…"
            className="!py-2 !text-[12.5px]"
          />
          <button
            onClick={doSearch}
            className="shrink-0 rounded-xl bg-white/[0.07] px-3 text-[13px] transition hover:bg-brand-400 hover:text-ink-950 active:scale-95"
          >
            {searching ? '…' : '🔍'}
          </button>
        </div>

        {found && (
          <div className="hairline mt-2 flex items-center gap-2 rounded-xl bg-white/[0.04] px-2.5 py-2">
            <Dot color={found.state === 'online' ? '#4ade80' : '#64748b'} />
            <span className="flex-1 truncate text-[12.5px] font-semibold text-white">
              {found.name}
            </span>
            {found.state === 'self' ? (
              <span className="text-[10.5px] text-slate-500">c’est toi</span>
            ) : (
              <>
                <span className="text-[10.5px] text-slate-500">
                  {found.state === 'online' ? 'en ligne' : 'hors ligne'}
                </span>
                <button
                  onClick={() => {
                    onAddFriend(found.name);
                    setFound(null);
                    setQuery('');
                  }}
                  className="rounded-lg bg-brand-400 px-2 py-1 text-[10.5px] font-bold text-ink-950 active:scale-95"
                >
                  + ami
                </button>
              </>
            )}
          </div>
        )}

        {friends.length === 0 ? (
          <p className="py-3 text-center text-[11.5px] text-slate-500">
            Aucun ami — cherche un pseudo ci-dessus.
          </p>
        ) : (
          <ul className="mt-2 space-y-0.5">
            {friends.map((f) => {
              const on = presenceMap[f.name.toLowerCase()];
              return (
                <li
                  key={f.name}
                  className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-white/[0.04]"
                >
                  <Dot color={on ? '#4ade80' : '#3f4a5f'} />
                  <span className="flex-1 truncate text-[12.5px] font-semibold text-slate-200">
                    {f.name}
                  </span>
                  <span className="text-[10px] text-slate-600">{on ? 'en ligne' : 'absent'}</span>
                  <button
                    onClick={() => onRemoveFriend(f.name)}
                    className="px-1 text-[11px] text-slate-700 transition hover:text-rose-400"
                    aria-label="Retirer"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <Btn variant="ghost" onClick={onBack}>
          Retour au jeu local
        </Btn>
      </div>
      <Signature className="mt-5" />
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

export function RoomLobby({
  lobby,
  isHost,
  status,
  info,
  myCid,
  friends,
  presenceMap,
  inviteState,
  onInvite,
  onOptions,
  onStart,
  onLeave,
}: {
  lobby: LobbyState;
  isHost: boolean;
  status: RoomStatus;
  info: string;
  myCid: string;
  friends: Friend[];
  presenceMap: Record<string, boolean>;
  inviteState: Record<string, 'sending' | 'sent' | 'fail'>;
  onInvite: (name: string) => void;
  onOptions: (size: number, turnLimit: number) => void;
  onStart: () => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const badges = uniqueInitials(lobby.players.map((p) => p.name));
  const ready = lobby.players.filter((p) => p.online).length;
  const canStart = isHost && ready >= 2;

  const share = async () => {
    const url = `${location.origin}${location.pathname}#${lobby.code}`;
    const text = `Rejoins ma partie Box ! Code : ${lobby.code}\n${url}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Box — par Plag', text, url });
      else await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <Panel wide>
      <p className="eyebrow text-center text-slate-600">Code d’invitation</p>
      <button
        onClick={share}
        className="group mx-auto mt-2 flex w-full items-center justify-center gap-3 rounded-2xl border border-brand-400/35 bg-gradient-to-b from-brand-400/15 to-brand-400/[0.04] px-5 py-3 transition hover:border-brand-400/70 active:scale-[0.98]"
      >
        <span className="num text-[30px] font-extrabold leading-none tracking-[0.28em] text-brand-300 sm:text-[36px]">
          {lobby.code || '·····'}
        </span>
        <span className="text-[15px] opacity-60 transition group-hover:opacity-100">⧉</span>
      </button>
      <p className="mt-1.5 text-center text-[10.5px] font-medium text-slate-500">
        {copied ? '✓ copié / partagé' : 'toucher pour partager le lien'}
      </p>
      {status !== 'lobby' && status !== 'playing' && (
        <p className="mt-2 text-center text-[11.5px] font-semibold text-amber-300">
          {info || 'connexion…'}
        </p>
      )}

      {/* slots */}
      <div className="mt-4 space-y-1.5">
        {Array.from({ length: 4 }).map((_, i) => {
          const p = lobby.players[i];
          if (!p)
            return (
              <div
                key={i}
                className="flex items-center gap-2.5 rounded-xl border border-dashed border-white/[0.09] px-3 py-2.5 text-[11.5px] text-slate-600"
              >
                <span className="h-7 w-7 rounded-lg border border-dashed border-white/10" />
                Emplacement libre
              </div>
            );
          const color = PALETTE[i].color;
          return (
            <div
              key={p.cid}
              className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5"
              style={{ borderColor: `${color}44`, background: `${color}0f` }}
            >
              <span
                className="font-display flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold"
                style={{ background: color, color: '#05070f' }}
              >
                {badges[i]}
              </span>
              <span className="flex-1 truncate text-[13.5px] font-semibold text-white">
                {p.name}
                {p.cid === myCid && <span className="ml-1.5 text-[10px] text-slate-400">toi</span>}
              </span>
              {p.cid === lobby.hostCid && (
                <img
                  src="/crown.svg"
                  alt="Propriétaire de la salle"
                  title="Propriétaire de la salle"
                  className="h-[17px] w-[19px] shrink-0 object-contain drop-shadow-[0_2px_4px_rgba(255,200,87,0.35)]"
                />
              )}
              <Dot color={p.online ? '#4ade80' : '#ff6b81'} pulse={!p.online} />
              {p.ping > 0 && <span className="num text-[10px] text-slate-500">{p.ping}ms</span>}
            </div>
          );
        })}
      </div>

      {isHost && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Field label="Grille">
            <OptionRow
              values={[4, 5, 6, 7]}
              value={lobby.size}
              fmt={(v) => `${v}×${v}`}
              onPick={(v) => onOptions(v, lobby.turnLimit)}
            />
          </Field>
          <Field label="Chrono">
            <OptionRow
              values={[0, 10, 15, 20]}
              value={lobby.turnLimit}
              fmt={(v) => (v === 0 ? '∞' : `${v}s`)}
              onPick={(v) => onOptions(lobby.size, v)}
            />
          </Field>
        </div>
      )}

      {friends.length > 0 && (
        <div className="hairline mt-4 rounded-2xl bg-black/25 p-3">
          <p className="eyebrow mb-2 text-brand-400/80">Inviter un ami</p>
          <ul className="space-y-0.5">
            {friends.map((f) => {
              const st = inviteState[f.name.toLowerCase()];
              const inRoom = lobby.players.some(
                (p) => p.name.toLowerCase() === f.name.toLowerCase(),
              );
              return (
                <li key={f.name} className="flex items-center gap-2.5 px-1 py-1">
                  <Dot color={presenceMap[f.name.toLowerCase()] ? '#4ade80' : '#3f4a5f'} />
                  <span className="flex-1 truncate text-[12.5px] font-semibold text-slate-200">
                    {f.name}
                  </span>
                  <button
                    disabled={inRoom || st === 'sending'}
                    onClick={() => onInvite(f.name)}
                    className={`rounded-lg px-2.5 py-1 text-[10.5px] font-bold transition active:scale-95 ${
                      inRoom
                        ? 'text-slate-600'
                        : st === 'sent'
                          ? 'bg-lime-400/15 text-lime-300'
                          : st === 'fail'
                            ? 'bg-rose-400/15 text-rose-300'
                            : 'bg-brand-400 text-ink-950'
                    }`}
                  >
                    {inRoom
                      ? 'déjà là'
                      : st === 'sending'
                        ? '…'
                        : st === 'sent'
                          ? 'envoyé ✓'
                          : st === 'fail'
                            ? 'absent'
                            : 'inviter'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {isHost ? (
          <Btn
            onClick={onStart}
            disabled={!canStart}
            icon="▶"
            sub={canStart ? `${ready} joueurs prêts` : 'il faut au moins 2 joueurs'}
          >
            Lancer la partie
          </Btn>
        ) : (
          <div className="hairline rounded-2xl bg-black/25 px-4 py-3 text-center text-[12px] font-semibold text-slate-400">
            <span className="inline-block animate-[breathe_1.8s_ease-in-out_infinite]">
              En attente de l’hôte…
            </span>
          </div>
        )}
        <Btn variant="ghost" onClick={onLeave}>
          Quitter la salle
        </Btn>
      </div>
      <Signature className="mt-5" />
    </Panel>
  );
}

function OptionRow({
  values,
  value,
  fmt,
  onPick,
}: {
  values: number[];
  value: number;
  fmt: (v: number) => string;
  onPick: (v: number) => void;
}) {
  return (
    <div className="hairline flex gap-0.5 rounded-xl bg-black/30 p-1">
      {values.map((v) => (
        <button
          key={v}
          onClick={() => onPick(v)}
          className={`flex-1 rounded-lg px-1 py-[7px] text-[12px] font-semibold transition ${
            value === v ? 'bg-white text-ink-950' : 'text-slate-400 hover:bg-white/5'
          }`}
        >
          {fmt(v)}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function InviteToast({
  from,
  code,
  onAccept,
  onDismiss,
}: {
  from: string;
  code: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="animate-rise glass pointer-events-auto absolute left-1/2 top-3 z-50 w-[min(92vw,22rem)] -translate-x-1/2 rounded-2xl p-3">
      <div className="flex items-center gap-2.5">
        <span className="text-[17px]">📨</span>
        <p className="flex-1 text-[12px] leading-snug text-slate-200">
          <b className="text-brand-300">{from}</b> t’invite à jouer
          <span className="num ml-1.5 rounded bg-white/[0.07] px-1.5 py-0.5 text-[11px] font-bold tracking-[0.16em]">
            {code}
          </span>
        </p>
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          onClick={onAccept}
          className="font-display flex-1 rounded-xl bg-brand-400 py-2 text-[12.5px] font-bold text-ink-950 active:scale-95"
        >
          Rejoindre
        </button>
        <button
          onClick={onDismiss}
          className="hairline rounded-xl px-3 py-2 text-[12.5px] font-semibold text-slate-400 active:scale-95"
        >
          Plus tard
        </button>
      </div>
    </div>
  );
}

export function NetOverlay({ text, onLeave }: { text: string; onLeave?: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-14 z-30 flex flex-col items-center gap-2">
      <div className="glass rounded-full px-4 py-2 text-[11px] font-semibold tracking-wide text-amber-300">
        {text}
      </div>
      {onLeave && (
        <button
          onClick={onLeave}
          className="hairline pointer-events-auto rounded-full bg-black/50 px-3 py-1 text-[10.5px] font-semibold text-slate-400 backdrop-blur"
        >
          quitter
        </button>
      )}
    </div>
  );
}
