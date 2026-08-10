import { describe, expect, it } from 'vitest';
import { applyProgressOnce, resolveConnectionLoss, TOTAL_XP_TO_MAX_LEVEL } from '../index.js';

describe('resultado idempotente', () => {
  it('retry não duplica Conhecimento nem XP', () => {
    const first = applyProgressOnce({ knowledge: 100, totalXp: 20 }, new Set(), 'match-1:user-1', { knowledge: 75, xp: 30 });
    expect(first).toMatchObject({ applied: true, state: { knowledge: 175, totalXp: 50 } });
    const retry = applyProgressOnce(first.state, first.ledger, 'match-1:user-1', { knowledge: 75, xp: 30 });
    expect(retry).toMatchObject({ applied: false, state: { knowledge: 175, totalXp: 50 } });
  });

  it('respeita piso/cap de Conhecimento e nível 999', () => {
    expect(applyProgressOnce({ knowledge: 2, totalXp: TOTAL_XP_TO_MAX_LEVEL - 1 }, new Set(), 'x', { knowledge: -30, xp: 30 }).state)
      .toEqual({ knowledge: 0, totalXp: TOTAL_XP_TO_MAX_LEVEL });
  });
});

describe('desconexão', () => {
  it('pausa por exatamente 7 segundos', () => {
    expect(resolveConnectionLoss({ disconnectedKnowledge: 0, disconnectedPlayers: 1, elapsedMs: 0, infrastructureFailure: false, mode: 'RANKED' }))
      .toEqual({ kind: 'WAITING', remainingGraceMs: 7_000 });
    expect(resolveConnectionLoss({ disconnectedKnowledge: 0, disconnectedPlayers: 1, elapsedMs: 6_999, infrastructureFailure: false, mode: 'RANKED' }))
      .toEqual({ kind: 'WAITING', remainingGraceMs: 1 });
  });

  it('aplica somente derrota Média ao desconectado ranqueado', () => {
    expect(resolveConnectionLoss({ disconnectedKnowledge: 0, disconnectedPlayers: 1, elapsedMs: 7_000, infrastructureFailure: false, mode: 'RANKED' }))
      .toEqual({ disconnectedKnowledgeDelta: 0, kind: 'VOID_INDIVIDUAL' });
    expect(resolveConnectionLoss({ disconnectedKnowledge: 2_500, disconnectedPlayers: 1, elapsedMs: 7_000, infrastructureFailure: false, mode: 'RANKED' }))
      .toEqual({ disconnectedKnowledgeDelta: -22, kind: 'VOID_INDIVIDUAL' });
  });

  it('Casual, queda dupla e falha sistêmica não punem', () => {
    expect(resolveConnectionLoss({ disconnectedKnowledge: 5_000, disconnectedPlayers: 1, elapsedMs: 7_000, infrastructureFailure: false, mode: 'CASUAL' }))
      .toEqual({ disconnectedKnowledgeDelta: 0, kind: 'VOID_INDIVIDUAL' });
    expect(resolveConnectionLoss({ disconnectedKnowledge: 5_000, disconnectedPlayers: 2, elapsedMs: 7_000, infrastructureFailure: false, mode: 'RANKED' }))
      .toEqual({ disconnectedKnowledgeDelta: 0, kind: 'VOID_SYSTEM' });
    expect(resolveConnectionLoss({ disconnectedKnowledge: 5_000, disconnectedPlayers: 1, elapsedMs: 7_000, infrastructureFailure: true, mode: 'RANKED' }))
      .toEqual({ disconnectedKnowledgeDelta: 0, kind: 'VOID_SYSTEM' });
  });
});
