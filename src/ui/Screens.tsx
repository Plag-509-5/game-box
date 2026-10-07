import type { Difficulty, MatchResult } from '../game/Game';
import type { MatchRow, PlayerStat } from '../game/scores';
import { PALETTE, initialOf } from '../game/players';
import { avatarSrc, type BoxUser } from '../auth/api';
import { Logo, Signature } from './Brand';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export function Panel({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="panel-scroll absolute inset-0 z-30 flex items-start justify-center overflow-y-auto bg-ink-950/75 p-3 backdrop-blur-xl sm:items-center sm:p-5">
      <div
        className={`animate-rise glass my-auto w-full rounded-[26px] p-5 sm:p-7 ${
          wide ? 'max-w-[26rem]' : 'max-w-[21rem]'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = 'primary',
  sub,
  icon,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'ghost' | 'accent';
  sub?: string;
  icon?: string;
  disabled?: boolean;
}) {
  const base =
    'group relative w-full overflow-hidden rounded-2xl px-4 py-3 text-center transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40';
  const skin: Record<string, string> = {
    primary:
      'bg-gradient-to-b from-brand-300 to-brand-500 text-ink-950 shadow-[0_10px_30px_-10px_rgba(56,224,216,0.9),inset_0_1px_0_rgba(255,255,255,0.45)] hover:brightness-[1.06]',
    accent:
      'bg-gradient-to-b from-indigo-400 to-violet-600 text-white shadow-[0_10px_30px_-10px_rgba(129,109,255,0.9),inset_0_1px_0_rgba(255,255,255,0.28)] hover:brightness-110',
    ghost:
      'hairline bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] hover:border-white/15',
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${skin[variant]}`}>
      <span className="font-display flex items-center justify-center gap-2 text-[15px] font-bold tracking-tight">
        {icon && <span className="text-[15px] leading-none">{icon}</span>}
        {children}
      </span>
      {sub && (
        <span className="mt-0.5 block text-[10.5px] font-medium tracking-wide opacity-65">
          {sub}
        </span>
      )}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-1.5 pl-0.5 text-slate-500">{label}</p>
      {children}
    </div>
  );
}

function Seg<T extends string | number>({
  options,
  value,
  onChange,
  fmt,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  fmt?: (v: T) => string;
}) {
  return (
    <div className="hairline flex gap-0.5 rounded-xl bg-black/30 p-1">
      {options.map((o) => {
        const on = value === o;
        return (
          <button
            key={String(o)}
            onClick={() => onChange(o)}
            className={`relative flex-1 rounded-lg px-1 py-[7px] text-[12px] font-semibold transition-all duration-150 ${
              on
                ? 'bg-white text-ink-950 shadow-[0_2px_10px_-2px_rgba(255,255,255,0.4)]'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            {fmt ? fmt(o) : String(o)}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export interface SetupState {
  count: number;
  names: string[];
  cpus: boolean[];
  size: number;
  turnLimit: number;
  difficulty: Difficulty;
}

export function MenuScreen({
  setup,
  update,
  stats,
  history,
  onStart,
  onReset,
  onOnline,
  username,
  online,
  account,
  onAccount,
}: {
  setup: SetupState;
  update: (patch: Partial<SetupState>) => void;
  stats: PlayerStat[];
  history: MatchRow[];
  onStart: () => void;
  onReset: () => void;
  onOnline: () => void;
  username: string;
  online: boolean;
  account: BoxUser | null;
  onAccount: () => void;
}) {
  const anyCpu = setup.cpus.slice(0, setup.count).some(Boolean);
  return (
    <Panel wide>
      <button
        onClick={onAccount}
        className="hairline mb-4 flex w-full items-center gap-2.5 rounded-xl bg-white/[0.025] px-2.5 py-2 text-left transition hover:border-brand-400/30 hover:bg-brand-400/[0.04]"
      >
        <span className="font-display flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-gradient-to-br from-brand-400/25 to-indigo-500/25 text-[12px] font-bold text-brand-300">
          {account?.avatarUrl ? (
            <img
              src={avatarSrc(account.avatarUrl)}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            account?.displayName.slice(0, 1).toUpperCase() || 'B'
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold text-slate-200">
            {account ? account.displayName : 'Compte joueur'}
          </span>
          <span className="block truncate text-[10px] text-slate-600">
            {account ? `@${account.username} · ouvrir le dashboard` : 'connexion ou inscription'}
          </span>
        </span>
        <span className="text-[15px] text-slate-600">›</span>
      </button>
      <Logo />

      <p className="mx-auto mt-3 max-w-[17rem] text-center text-[12.5px] leading-relaxed text-slate-400">
        Chacun son tour, trace une ligne de ta couleur. Ferme un carré : il porte{' '}
        <span className="font-semibold text-slate-200">ton initiale</span>, tu marques et tu{' '}
        <span className="font-semibold text-brand-300">rejoues</span>.
      </p>

      {/* actions */}
      <div className="mt-5 space-y-2">
        <Btn onClick={onStart} icon="▶" sub="2 à 4 joueurs sur le même écran">
          Partie locale
        </Btn>
        <button
          onClick={onOnline}
          className="hairline group relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-500/15 via-violet-500/10 to-brand-400/15 px-4 py-3 transition-all duration-150 hover:border-white/20 active:scale-[0.98]"
        >
          <span className="font-display flex items-center justify-center gap-2 text-[15px] font-bold tracking-tight text-white">
            <span className="text-[14px]">🌐</span> Jouer en ligne
          </span>
          <span className="mt-0.5 flex items-center justify-center gap-1.5 text-[10.5px] font-medium text-slate-400">
            {username ? (
              <>
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background: online ? '#4ade80' : '#64748b',
                    boxShadow: online ? '0 0 8px #4ade80' : 'none',
                  }}
                />
                {username} · {online ? 'connecté' : 'hors ligne'}
              </>
            ) : (
              'salle privée · code d’invitation · amis'
            )}
          </span>
        </button>
      </div>

      {/* La configuration reste accessible sans encombrer l'accueil. */}
      <details className="hairline group mt-4 rounded-2xl bg-black/20">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-3 text-[12px] font-semibold text-slate-300">
          <span>Configurer la partie locale</span>
          <span className="text-slate-600 transition group-open:rotate-90">›</span>
        </summary>
        <div className="space-y-3 border-t border-white/[0.06] px-3.5 pb-3.5 pt-3">
        <Field label="Joueurs">
          <Seg
            options={[2, 3, 4]}
            value={setup.count}
            onChange={(v) => update({ count: v })}
            fmt={(v) => `${v} joueurs`}
          />
        </Field>

        <div className="space-y-1.5">
          {Array.from({ length: setup.count }).map((_, i) => (
            <div
              key={i}
              className="group flex items-center gap-2.5 rounded-xl border bg-black/25 p-1.5 pl-2 transition-colors"
              style={{ borderColor: `${PALETTE[i].color}33` }}
            >
              <span
                className="font-display flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[13px] font-bold"
                style={{
                  background: PALETTE[i].color,
                  color: '#05070f',
                  boxShadow: `0 4px 14px -4px ${PALETTE[i].color}`,
                }}
              >
                {initialOf(setup.names[i])}
              </span>
              <input
                value={setup.names[i]}
                maxLength={14}
                onChange={(e) => {
                  const names = [...setup.names];
                  names[i] = e.target.value;
                  update({ names });
                }}
                placeholder={`Joueur ${i + 1}`}
                className="min-w-0 flex-1 bg-transparent text-[13.5px] font-semibold text-white outline-none placeholder:text-slate-600"
              />
              <button
                onClick={() => {
                  const cpus = [...setup.cpus];
                  cpus[i] = !cpus[i];
                  update({ cpus });
                }}
                className={`rounded-lg px-2.5 py-1.5 text-[10.5px] font-semibold transition ${
                  setup.cpus[i]
                    ? 'bg-slate-100 text-ink-950'
                    : 'hairline text-slate-400 hover:text-slate-200'
                }`}
              >
                {setup.cpus[i] ? 'IA' : 'Humain'}
              </button>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Grille">
            <Seg
              options={[4, 5, 6, 7]}
              value={setup.size}
              onChange={(v) => update({ size: v })}
              fmt={(v) => `${v}×${v}`}
            />
          </Field>
          <Field label="Chrono">
            <Seg
              options={[0, 5, 10, 15]}
              value={setup.turnLimit}
              onChange={(v) => update({ turnLimit: v })}
              fmt={(v) => (v === 0 ? '∞' : `${v}s`)}
            />
          </Field>
        </div>
        {anyCpu && (
          <Field label="Niveau de l’IA">
            <Seg
              options={['chill', 'sharp', 'ruthless'] as Difficulty[]}
              value={setup.difficulty}
              onChange={(v) => update({ difficulty: v })}
              fmt={(v) => ({ chill: 'Tranquille', sharp: 'Affûtée', ruthless: 'Sans pitié' })[v]}
            />
          </Field>
        )}
        </div>
      </details>

      <details className="hairline group mt-2 rounded-2xl bg-black/15">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-3 text-[11.5px] font-medium text-slate-500">
          <span>Règles, contrôles et classement local</span>
          <span className="transition group-open:rotate-90">›</span>
        </summary>
        <div className="border-t border-white/[0.06] px-3.5 pb-3.5">
          <Controls />
          <Leaderboard stats={stats} history={history} onReset={onReset} />
        </div>
      </details>
      <Signature className="mt-5" />
    </Panel>
  );
}

function Controls() {
  return (
    <div className="mt-5 grid grid-cols-2 gap-2">
      {[
        { t: 'Tactile', d: 'Touche l’espace entre deux points.' },
        { t: 'Clavier', d: 'Flèches pour viser · ZQSD pour tracer · P pause · R rejouer' },
      ].map((c) => (
        <div key={c.t} className="hairline rounded-xl bg-black/20 p-2.5">
          <p className="eyebrow mb-1 text-brand-400/80">{c.t}</p>
          <p className="text-[11px] leading-snug text-slate-400">{c.d}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function Leaderboard({
  stats,
  history,
  onReset,
}: {
  stats: PlayerStat[];
  history: MatchRow[];
  onReset?: () => void;
}) {
  return (
    <div className="hairline mt-5 rounded-2xl bg-black/25 p-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="eyebrow text-brand-400/80">Classement</span>
        {onReset && stats.length > 0 && (
          <button
            onClick={onReset}
            className="text-[10px] font-medium text-slate-600 transition hover:text-rose-400"
          >
            effacer
          </button>
        )}
      </div>
      {stats.length === 0 ? (
        <p className="py-2 text-center text-[11.5px] text-slate-500">
          Aucune partie enregistrée pour l’instant.
        </p>
      ) : (
        <ol className="space-y-0.5">
          {stats.slice(0, 6).map((s, i) => (
            <li
              key={s.name + i}
              className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 transition hover:bg-white/[0.03]"
            >
              <span className="num w-3 text-[11px] text-slate-600">{i + 1}</span>
              <span
                className="font-display flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-bold"
                style={{ background: s.color, color: '#05070f' }}
              >
                {initialOf(s.name)}
              </span>
              <span className="flex-1 truncate text-[12.5px] font-semibold text-slate-200">
                {s.name}
              </span>
              <span className="num text-[12px] font-bold text-amber-300">{s.wins}</span>
              <span className="text-[10px] text-slate-600">victoires</span>
              <span className="num w-8 text-right text-[11px] text-slate-500">{s.boxes}□</span>
            </li>
          ))}
        </ol>
      )}
      {history.length > 0 && (
        <div className="mt-2.5 border-t border-white/[0.06] pt-2.5">
          <p className="eyebrow mb-1.5 text-slate-600">Dernières parties</p>
          <ul className="space-y-1">
            {history.slice(0, 3).map((m, i) => (
              <li key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className="num shrink-0 text-slate-600">
                  {m.size}×{m.size}
                </span>
                <span className="flex flex-1 flex-wrap gap-x-1.5 truncate">
                  {m.names.map((n, j) => (
                    <span key={j} className="num" style={{ color: m.colors[j] }}>
                      {initialOf(n)}
                      {m.scores[j]}
                    </span>
                  ))}
                </span>
                <span className="shrink-0 truncate text-slate-500">
                  {m.winners.length === 1 ? `🏆 ${m.names[m.winners[0]]}` : 'égalité'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function PauseScreen({
  onResume,
  onRestart,
  onMenu,
}: {
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
}) {
  return (
    <Panel>
      <div className="flex justify-center">
        <div className="hairline flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04]">
          <span className="text-lg tracking-[0.2em] text-brand-300">❚❚</span>
        </div>
      </div>
      <h2 className="font-display mt-3 text-center text-[26px] font-bold tracking-tight text-white">
        Pause
      </h2>
      <p className="mt-1 text-center text-[12px] text-slate-500">La grille vous attend.</p>
      <div className="mt-5 space-y-2">
        <Btn onClick={onResume} sub="Échap · P">
          Reprendre
        </Btn>
        <Btn variant="ghost" onClick={onRestart} sub="R">
          Recommencer
        </Btn>
        <Btn variant="ghost" onClick={onMenu}>
          Menu principal
        </Btn>
      </div>
      <Signature className="mt-5" />
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

export function OverScreen({
  result,
  stats,
  history,
  onRestart,
  onMenu,
  onlineLabels,
}: {
  result: MatchResult;
  stats: PlayerStat[];
  history: MatchRow[];
  onRestart: () => void;
  onMenu: () => void;
  onlineLabels?: { restart: string; menu: string };
}) {
  const tie = result.winners.length > 1;
  const champ = result.players[result.winners[0]];
  const total = result.scores.reduce((a, b) => a + b, 0) || 1;
  const order = result.players
    .map((p, i) => ({ p, score: result.scores[i], i }))
    .sort((a, b) => b.score - a.score);

  return (
    <Panel wide>
      <p className="eyebrow text-center text-slate-600">Grille terminée</p>
      <h2
        className="font-display mt-1.5 text-center text-[30px] font-bold leading-none tracking-tight sm:text-[34px]"
        style={{
          color: tie ? '#e2e8f0' : champ.color,
          textShadow: `0 0 34px ${tie ? 'rgba(148,163,184,0.4)' : champ.glow}`,
        }}
      >
        {tie ? 'Égalité' : `${champ.name} gagne`}
      </h2>
      {!tie && (
        <p className="mt-1 text-center text-[11.5px] text-slate-500">
          {result.scores[result.winners[0]]} carrés sur {total}
        </p>
      )}

      <div className="mt-5 space-y-1.5">
        {order.map(({ p, score, i }, rank) => {
          const win = result.winners.includes(i);
          return (
            <div
              key={p.id}
              className="relative overflow-hidden rounded-xl border bg-black/25 px-3 py-2.5"
              style={{
                borderColor: win ? `${p.color}66` : 'rgba(255,255,255,0.06)',
                boxShadow: win ? `0 0 30px -12px ${p.glow}` : 'none',
              }}
            >
              <div
                className="absolute inset-y-0 left-0 transition-[width] duration-700"
                style={{
                  width: `${(score / total) * 100}%`,
                  background: `linear-gradient(90deg, ${p.color}2e, transparent)`,
                }}
              />
              <div className="relative flex items-center gap-2.5">
                <span className="num w-3 text-[11px] text-slate-600">{rank + 1}</span>
                <span
                  className="font-display flex h-7 w-7 items-center justify-center rounded-lg text-[12px] font-bold"
                  style={{ background: p.color, color: '#05070f' }}
                >
                  {p.badge}
                </span>
                <span className="flex-1 truncate text-[13.5px] font-semibold text-white">
                  {p.name}
                  {p.cpu && <span className="ml-1.5 text-[10px] text-slate-500">IA</span>}
                </span>
                {win && !tie && <span className="text-[13px]">🏆</span>}
                <span className="num text-[19px] font-extrabold text-white">{score}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 space-y-2">
        <Btn onClick={onRestart} sub={onlineLabels ? 'tout le monde reste connecté' : 'Entrée · R'}>
          {onlineLabels?.restart ?? 'Revanche'}
        </Btn>
        <Btn variant="ghost" onClick={onMenu}>
          {onlineLabels?.menu ?? 'Changer les joueurs'}
        </Btn>
      </div>

      <Leaderboard stats={stats} history={history} />
      <Signature className="mt-5" />
    </Panel>
  );
}
