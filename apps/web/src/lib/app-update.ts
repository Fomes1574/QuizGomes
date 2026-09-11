/** Rotas competitivas nunca sofrem reload automático de um Service Worker novo. */
export function isGameplayPath(pathname: string): boolean {
  return /^\/(?:partida|desafio)(?:\/|$)/.test(pathname);
}

/**
 * Mantém a atualização já ativada pelo SW pendente até que a navegação saia da
 * partida. A troca de controller é segura, mas recarregar no meio de uma sala
 * WebSocket não é: o cliente precisa preservar a regra de reconexão do jogo.
 */
export class SafeAppUpdate {
  private pending = false;
  private reloading = false;

  markReady(): void {
    this.pending = true;
  }

  onRoute(pathname: string, reload: () => void): boolean {
    if (!this.pending || this.reloading || isGameplayPath(pathname)) return false;
    this.pending = false;
    this.reloading = true;
    reload();
    return true;
  }

  get isPending(): boolean {
    return this.pending;
  }
}

export const safeAppUpdate = new SafeAppUpdate();
// Vitest não aplica `define` do Vite; o fallback deixa o diagnóstico neutro
// fora do bundle de produção.
export const buildFingerprint = typeof __QG_BUILD_FINGERPRINT__ === 'string'
  ? __QG_BUILD_FINGERPRINT__
  : 'local';
