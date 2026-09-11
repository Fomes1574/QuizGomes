import { describe, expect, it } from 'vitest';
import { SafeAppUpdate, isGameplayPath } from '../lib/app-update.js';

describe('atualização segura do PWA', () => {
  it('reconhece somente as rotas competitivas como área sem reload automático', () => {
    expect(isGameplayPath('/partida/abc')).toBe(true);
    expect(isGameplayPath('/desafio/abc')).toBe(true);
    expect(isGameplayPath('/social')).toBe(false);
    expect(isGameplayPath('/')).toBe(false);
  });

  it('adia o reload de worker novo até sair de gameplay', () => {
    const update = new SafeAppUpdate();
    let reloads = 0;
    update.markReady();

    expect(update.onRoute('/partida/sala-1', () => { reloads += 1; })).toBe(false);
    expect(update.isPending).toBe(true);
    expect(reloads).toBe(0);

    expect(update.onRoute('/social', () => { reloads += 1; })).toBe(true);
    expect(reloads).toBe(1);
    expect(update.onRoute('/social', () => { reloads += 1; })).toBe(false);
  });
});
