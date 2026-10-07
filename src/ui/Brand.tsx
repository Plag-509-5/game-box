export function Logo({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  const big = size === 'lg';
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-3">
        <Mark size={big ? 34 : 24} />
        <h1
          className={`font-display sheen font-bold leading-none ${
            big ? 'text-[44px] sm:text-[56px]' : 'text-2xl'
          }`}
          style={{ letterSpacing: big ? '-0.045em' : '-0.03em' }}
        >
          BOX
        </h1>
      </div>
      {big && (
        <p className="mt-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">
          <span className="h-px w-6 bg-gradient-to-r from-transparent to-white/25" />
          ferme le carré
          <span className="h-px w-6 bg-gradient-to-l from-transparent to-white/25" />
        </p>
      )}
    </div>
  );
}

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
      <defs>
        <linearGradient id="bx-g" x1="0" y1="0" x2="40" y2="40">
          <stop offset="0%" stopColor="#6ff0e6" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <rect
        x="5.5"
        y="5.5"
        width="29"
        height="29"
        rx="8"
        stroke="url(#bx-g)"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <rect x="16" y="16" width="8" height="8" rx="2.5" fill="url(#bx-g)" />
      <circle cx="5.5" cy="5.5" r="2.6" fill="#6ff0e6" />
      <circle cx="34.5" cy="34.5" r="2.6" fill="#3b82f6" />
    </svg>
  );
}

export function Signature({ className = '' }: { className?: string }) {
  return (
    <p
      className={`text-center text-[10px] font-medium tracking-[0.18em] text-slate-600 ${className}`}
    >
      UN JEU DE{' '}
      <span className="font-display font-bold tracking-[0.12em] text-slate-300">PLAG</span>
    </p>
  );
}
