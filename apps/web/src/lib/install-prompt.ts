/**
 * Convite para instalar o app (PWA) depois da primeira vitória. O evento
 * `beforeinstallprompt` só existe no Chrome/Edge/Android e precisa ser
 * guardado cedo; no iPhone não há API, então mostramos o passo a passo.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const STORAGE_KEY = 'quiz-gomes:install-invite';
let deferred: BeforeInstallPromptEvent | null = null;

export function captureInstallPrompt(target: Window = window): void {
  target.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
  });
  target.addEventListener('appinstalled', () => {
    deferred = null;
    markInstallInviteSeen();
  });
}

export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export function isIos(userAgent = navigator.userAgent, touchPoints = navigator.maxTouchPoints): boolean {
  // iPadOS se apresenta como Mac, mas tem toque.
  return /iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && touchPoints > 1);
}

export function installInviteSeen(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== null; } catch { return true; }
}

export function markInstallInviteSeen(): void {
  try { localStorage.setItem(STORAGE_KEY, 'seen'); } catch { /* Sem storage: o convite simplesmente não volta. */ }
}

export type InstallInviteKind = 'ios' | 'prompt' | null;

/** Qual convite cabe aqui: nenhum se já instalado, já visto ou sem como instalar. */
export function installInviteKind(): InstallInviteKind {
  if (isStandalone() || installInviteSeen()) return null;
  if (deferred !== null) return 'prompt';
  return isIos() ? 'ios' : null;
}

export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (event === null) return false;
  deferred = null;
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome === 'accepted';
}
