/**
 * Link de convite de amizade: `/convite/QGXXXX` abre direto a tela para
 * adicionar quem compartilhou. O "#" do ID público fica fora do caminho
 * (num link ele viraria âncora e sumiria).
 */
const PUBLIC_ID = /^QG[A-Z0-9]{4,32}$/;

export function inviteUrl(publicId: string, origin = window.location.origin): string {
  return `${origin}/convite/${encodeURIComponent(publicId.replace(/^#/, '').toUpperCase())}`;
}

/** Código do caminho → ID público (`#QG…`), ou `null` se não for um código válido. */
export function publicIdFromInviteCode(code: string | undefined): string | null {
  if (code === undefined) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(code);
  } catch {
    return null;
  }
  const normalized = decoded.trim().replace(/^#/, '').toUpperCase();
  return PUBLIC_ID.test(normalized) ? `#${normalized}` : null;
}

/**
 * Quem tocou em "Entrar e adicionar" ainda sem conta: o pedido sai sozinho
 * quando a conta fica pronta, mesmo que o login volte por redirecionamento.
 */
const PENDING_KEY = 'qg:invite-add';

export function rememberInviteAdd(publicId: string): void {
  try { sessionStorage.setItem(PENDING_KEY, publicId); } catch { /* Sem storage: o toque manual continua funcionando. */ }
}

export function takeInviteAdd(publicId: string): boolean {
  try {
    if (sessionStorage.getItem(PENDING_KEY) !== publicId) return false;
    sessionStorage.removeItem(PENDING_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Caminho do perfil de alguém: `/jogador/QGXXXX` (o "#" fica fora, como no convite). */
export function playerPath(publicId: string): string {
  return `/jogador/${encodeURIComponent(publicId.replace(/^#/, '').toUpperCase())}`;
}
