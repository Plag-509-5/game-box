/* Tiny WebAudio synth for game SFX — no assets needed */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('box.muted') === '1';
  } catch {
    return false;
  }
})();

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.28;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function unlockAudio() {
  ac();
}

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.28;
  try {
    localStorage.setItem('box.muted', m ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function isMuted() {
  return muted;
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = 'sine',
  vol = 0.5,
  slide = 0,
  delay = 0,
) {
  const a = ac();
  if (!a || !master || muted) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur: number, vol = 0.3, freq = 1200) {
  const a = ac();
  if (!a || !master || muted) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start();
}

const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98];

export const sfx = {
  line() {
    tone(330, 0.07, 'triangle', 0.25, 90);
  },
  blocked() {
    tone(120, 0.12, 'sawtooth', 0.18, -40);
  },
  box(combo: number) {
    const i = Math.min(SCALE.length - 1, combo);
    tone(SCALE[i], 0.2, 'triangle', 0.5, 40);
    tone(SCALE[i] * 2, 0.12, 'sine', 0.22, 60, 0.02);
    noise(0.12, 0.12, 2200);
  },
  cpuBox() {
    tone(196, 0.22, 'sawtooth', 0.22, -50);
  },
  clear() {
    [0, 2, 4, 6].forEach((n, k) => tone(SCALE[n], 0.28, 'triangle', 0.4, 60, k * 0.07));
    noise(0.4, 0.15, 900);
  },
  gameOver() {
    [440, 349, 293, 220].forEach((f, k) => tone(f, 0.35, 'sawtooth', 0.3, -30, k * 0.12));
  },
  win() {
    [523, 659, 784, 1046].forEach((f, k) => tone(f, 0.3, 'triangle', 0.4, 20, k * 0.1));
  },
  ui() {
    tone(660, 0.06, 'square', 0.14, 120);
  },
  tick() {
    tone(880, 0.05, 'square', 0.12, -200);
  },
};
