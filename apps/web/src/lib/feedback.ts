import { useSyncExternalStore } from 'react';

export type FeedbackCue = 'correct' | 'tap' | 'tick' | 'win' | 'wrong';

export interface FeedbackPreferences {
  sound: boolean;
  vibration: boolean;
}

const STORAGE_KEY = 'quiz-gomes:feedback';
const CHANGE_EVENT = 'quiz-gomes:feedback-change';
const DEFAULTS: FeedbackPreferences = { sound: true, vibration: true };

// [frequência Hz, início s, duração s]; tons curtos sintetizados, sem arquivos de áudio.
const TONES: Record<FeedbackCue, ReadonlyArray<readonly [number, number, number]>> = {
  correct: [[660, 0, 0.09], [990, 0.08, 0.16]],
  tap: [[520, 0, 0.035]],
  tick: [[880, 0, 0.045]],
  win: [[523, 0, 0.11], [659, 0.1, 0.11], [784, 0.2, 0.11], [1047, 0.3, 0.3]],
  wrong: [[233, 0, 0.14], [175, 0.11, 0.22]],
};

const VIBRATION: Record<FeedbackCue, number | number[]> = {
  correct: 18,
  tap: 8,
  tick: 6,
  win: [20, 50, 20, 50, 70],
  wrong: [30, 60, 30],
};

let cachedRaw: string | null | undefined;
let cachedPreferences: FeedbackPreferences = DEFAULTS;
let audioContext: AudioContext | null = null;

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function feedbackPreferences(): FeedbackPreferences {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedPreferences;
  cachedRaw = raw;
  try {
    const parsed = raw === null ? {} : JSON.parse(raw) as Partial<FeedbackPreferences>;
    cachedPreferences = {
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : DEFAULTS.sound,
      vibration: typeof parsed.vibration === 'boolean' ? parsed.vibration : DEFAULTS.vibration,
    };
  } catch {
    cachedPreferences = DEFAULTS;
  }
  return cachedPreferences;
}

export function setFeedbackPreference(key: keyof FeedbackPreferences, value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...feedbackPreferences(), [key]: value }));
  } catch {
    // Sem armazenamento a preferência vale só nesta tela.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function useFeedbackPreferences(): FeedbackPreferences {
  return useSyncExternalStore(subscribe, feedbackPreferences, () => DEFAULTS);
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
  try {
    audioContext ??= new window.AudioContext();
    if (audioContext.state === 'suspended') void audioContext.resume();
    return audioContext;
  } catch {
    return null;
  }
}

function playTones(cue: FeedbackCue): void {
  const context = audio();
  if (context === null) return;
  const start = context.currentTime;
  for (const [frequency, offset, duration] of TONES[cue]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = cue === 'wrong' ? 'triangle' : 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.09, start + offset + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + duration + 0.02);
  }
}

/** Som curto e vibração leve, ambos desligáveis no Perfil e sempre opcionais. */
export function feedback(cue: FeedbackCue): void {
  const preferences = feedbackPreferences();
  if (preferences.sound) playTones(cue);
  if (preferences.vibration && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(VIBRATION[cue]);
    } catch {
      // Alguns navegadores recusam vibração fora de um gesto do usuário.
    }
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
