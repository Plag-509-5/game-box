import type { Hud } from '../game/Game';
import { Mark } from './Brand';

export function TopBar({
  hud,
  onPause,
  muted,
  onToggleMute,
  ping,
}: {
  hud: Hud;
  onPause: () => void;
  muted: boolean;
  onToggleMute: () => void;
  ping?: number;
}) {
  const many = hud.players.length > 2;
  const cur = hud.players[hud.turn];
  const timePct = hud.turnLimit > 0 ? Math.max(0, Math.min(1, hud.turnTime / hud.turnLimit)) : 1;
  const danger = hud.turnLimit > 0 && hud.turnTime < 3;

  return (
    <div className="pointer-events-none relative z-20 w-full px-2.5 pt-2.5 sm:px-4 sm:pt-3.5">
      {/* score cards */}
      <div className={`grid gap-1.5 sm:gap-2 ${many ? 'grid-cols-4' : 'grid-cols-2'}`}>
        {hud.players.map((p, i) => {
          const active = i === hud.turn;
          return (
            <div
              key={p.id}
              className="relative overflow-hidden rounded-2xl border px-2 py-1.5 transition-all duration-300 sm:px-3 sm:py-2"
              style={{
                borderColor: active ? `${p.color}80` : 'rgba(255,255,255,0.06)',
                background: active
                  ? `linear-gradient(170deg, ${p.color}22, rgba(8,11,22,0.75))`
                  : 'rgba(8,11,22,0.55)',
                boxShadow: active ? `0 10px 34px -14px ${p.glow}` : 'none',
                transform: active ? 'translateY(0)' : 'translateY(2px) scale(0.975)',
                opacity: active ? 1 : 0.55,
                backdropFilter: 'blur(14px)',
              }}
            >
              <div className="flex items-center gap-1.5 sm:gap-2.5">
                <span
                  className="font-display flex h-6 w-6 shrink-0 items-center justify-center rounded-[9px] text-[12px] font-bold sm:h-8 sm:w-8 sm:text-[15px]"
                  style={{
                    color: '#05070f',
                    background: p.color,
                    boxShadow: active ? `0 4px 16px -4px ${p.color}` : 'none',
                  }}
                >
                  {p.badge}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[10px] font-semibold tracking-tight sm:text-[11.5px]"
                    style={{ color: active ? p.color : '#94a3b8' }}
                  >
                    {p.name}
                    {p.cpu && <span className="ml-1 opacity-50">IA</span>}
                  </p>
                  <p className="num text-[17px] font-extrabold leading-none text-white sm:text-[23px]">
                    {hud.scores[i]}
                  </p>
                </div>
              </div>
              {active && (
                <span
                  className="absolute bottom-0 left-0 h-[2.5px] w-full origin-left rounded-full"
                  style={{
                    background: danger ? '#fb7185' : p.color,
                    transform: `scaleX(${hud.turnLimit > 0 ? timePct : 1})`,
                    transition: 'transform 120ms linear',
                    boxShadow: `0 0 10px ${danger ? '#fb7185' : p.color}`,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* status strip */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Mark size={14} />
          <span
            className="truncate text-[11px] font-semibold tracking-tight sm:text-[12.5px]"
            style={{ color: cur?.color }}
          >
            {cur?.cpu ? `${cur.name} réfléchit…` : `Au tour de ${cur?.name}`}
          </span>
          {hud.streak > 1 && (
            <span
              key={hud.streak}
              className="animate-pop num shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold text-ink-950"
              style={{ background: '#a3e635', boxShadow: '0 0 16px rgba(163,230,53,0.55)' }}
            >
              ×{hud.streak}
            </span>
          )}
          {danger && !cur?.cpu && (
            <span className="num shrink-0 animate-pulse text-[12px] font-extrabold text-rose-400">
              {hud.turnTime.toFixed(1)}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {hud.online && (
            <span
              className="num flex items-center gap-1 text-[10px] font-bold"
              style={{
                color: !ping ? '#4ade80' : ping < 120 ? '#4ade80' : ping < 260 ? '#fbbf24' : '#fb7185',
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {ping ? `${ping}ms` : 'hôte'}
            </span>
          )}
          <span className="num text-[10.5px] text-slate-500">
            {hud.total - hud.boxesLeft}/{hud.total}
          </span>
          <div className="pointer-events-auto flex gap-1.5">
            <IconBtn onClick={onToggleMute} label="Son">
              {muted ? '🔇' : '🔊'}
            </IconBtn>
            <IconBtn onClick={onPause} label="Pause">
              <span className="tracking-[0.1em]">❚❚</span>
            </IconBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[10px] text-slate-300 backdrop-blur transition hover:border-brand-400/40 hover:bg-brand-400/10 hover:text-white active:scale-90"
    >
      {children}
    </button>
  );
}
