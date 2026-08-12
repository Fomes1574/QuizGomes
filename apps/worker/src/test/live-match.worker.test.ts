import {
  decodePoolState,
  transitionLiveMatch,
  type LiveMatchCommand,
  type LiveMatchProjection,
  type LiveMatchState,
} from '@quiz-gomes/domain';
import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { LiveMatchRepository } from '../repositories/live-match-repository.js';

interface TestMessage {
  code?: string;
  match?: LiveMatchProjection;
  result?: {
    opponent: { result: string; score: number };
    viewer: { knowledgeAfter: number; knowledgeDelta: number; result: string; score: number; xpDelta: number };
  };
  type?: string;
  voidReason?: string;
}

interface SocketCapture {
  socket: WebSocket;
  waitFor(type: string, predicate?: (message: TestMessage) => boolean): Promise<TestMessage>;
}

function capture(socket: WebSocket): SocketCapture {
  const messages: TestMessage[] = [];
  const waiters: Array<{
    predicate: ((message: TestMessage) => boolean) | undefined;
    reject: (reason?: unknown) => void;
    resolve: (message: TestMessage) => void;
    type: string;
  }> = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as TestMessage;
    const waiterIndex = waiters.findIndex(
      (waiter) => waiter.type === message.type && (waiter.predicate?.(message) ?? true),
    );
    const waiter = waiters[waiterIndex];
    if (waiter !== undefined) {
      waiters.splice(waiterIndex, 1);
      waiter.resolve(message);
    } else {
      messages.push(message);
    }
  });
  socket.accept();
  return {
    socket,
    waitFor: (type: string, predicate?: (message: TestMessage) => boolean) => {
      const existingIndex = messages.findIndex(
        (message) => message.type === type && (predicate?.(message) ?? true),
      );
      const existing = messages[existingIndex];
      if (existing !== undefined) {
        messages.splice(existingIndex, 1);
        return Promise.resolve(existing);
      }
      return new Promise<TestMessage>((resolve, reject) => {
        const waiter = { predicate, reject, resolve, type };
        waiters.push(waiter);
        setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) {
            waiters.splice(index, 1);
            reject(new Error(`Timeout aguardando ${type}.`));
          }
        }, 2_000);
      });
    },
  };
}

async function openRoom(stub: DurableObjectStub, uid: string): Promise<SocketCapture> {
  const response = await stub.fetch(new Request('https://room.internal/socket', {
    headers: { Upgrade: 'websocket', 'X-QG-Authenticated-Uid': uid },
  }));
  expect(response.status).toBe(101);
  expect(response.webSocket).not.toBeNull();
  return capture(response.webSocket as WebSocket);
}

async function expireAlarm(stub: DurableObjectStub): Promise<void> {
  await runInDurableObject(stub, async (_instance, state) => {
    const room = await state.storage.get<LiveMatchState>('room');
    if (room === undefined) throw new Error('Sala ausente.');
    room.phaseDeadlineMs = Date.now() - 1;
    if (room.pause !== null) room.pause.graceDeadlineMs = room.phaseDeadlineMs;
    await state.storage.put('room', room);
    await state.storage.setAlarm(Date.now() + 60_000);
  });
  expect(await runDurableObjectAlarm(stub)).toBe(true);
}

async function seedMatchFixture(
  prefix: string,
  knowledge = 500,
  mode: 'CASUAL' | 'RANKED' = 'RANKED',
): Promise<{
  poolId: string;
  resource: string;
  themeId: string;
  uids: [string, string];
  userIds: [string, string];
}> {
  const themeId = `${prefix}-theme`;
  const poolId = `${prefix}-pool`;
  const uids: [string, string] = [`${prefix}-firebase-1`, `${prefix}-firebase-2`];
  const userIds: [string, string] = [`${prefix}-user-1`, `${prefix}-user-2`];
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      `INSERT OR IGNORE INTO categories (id, slug, name, sort_order)
       VALUES ('test-live-category', 'test-live-category', 'Categoria sintética realtime', 999)`,
    ),
    env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(userIds[0], uids[0]),
    env.CORE_DB.prepare('INSERT INTO users (id, firebase_uid) VALUES (?1, ?2)').bind(userIds[1], uids[1]),
    env.CORE_DB.prepare(
      `INSERT INTO user_profiles (user_id, public_id, display_name)
       VALUES (?1, ?2, ?3)`,
    ).bind(userIds[0], `#QG${prefix.toUpperCase()}1`, `${prefix} Jogador 1`),
    env.CORE_DB.prepare(
      `INSERT INTO user_profiles (user_id, public_id, display_name)
       VALUES (?1, ?2, ?3)`,
    ).bind(userIds[1], `#QG${prefix.toUpperCase()}2`, `${prefix} Jogador 2`),
    env.CORE_DB.prepare(
      `INSERT INTO themes
        (id, category_id, slug, name, description, status, origin, question_shard_id, active_question_count)
       VALUES (?1, 'test-live-category', ?2, ?3, 'Fixture sintética de integração realtime.', 'ACTIVE', 'OFFICIAL', 'questions-01', 5)`,
    ).bind(themeId, `${prefix}-theme`, `${prefix} Tema`),
    env.CORE_DB.prepare(
      `INSERT INTO theme_rankings (user_id, theme_id, knowledge)
       VALUES (?1, ?2, ?3)`,
    ).bind(userIds[0], themeId, knowledge),
    env.CORE_DB.prepare(
      `INSERT INTO theme_rankings (user_id, theme_id, knowledge)
       VALUES (?1, ?2, ?3)`,
    ).bind(userIds[1], themeId, knowledge),
  ]);
  const questionStatements: D1PreparedStatement[] = [
    env.QUESTIONS_DB.prepare(
      `INSERT INTO question_pools (id, theme_id, difficulty, active_count)
       VALUES (?1, ?2, 'EASY', 5)`,
    ).bind(poolId, themeId),
  ];
  for (let index = 1; index <= 5; index += 1) {
    questionStatements.push(env.QUESTIONS_DB.prepare(
      `INSERT INTO questions
        (id, pool_id, active_slot, prompt, option_a, option_b, option_c, option_d, correct_option, content_hash, status)
       VALUES (?1, ?2, ?3, ?4, 'Correta', 'B', 'C', 'D', 0, ?5, 'ACTIVE')`,
    ).bind(`${prefix}-q-${index}`, poolId, index, `[FIXTURE] Pergunta realtime ${index}?`, `${prefix}-hash-${index}`));
  }
  await env.QUESTIONS_DB.batch(questionStatements);
  return { poolId, resource: `${themeId}:EASY:${mode}`, themeId, uids, userIds };
}

function apply(state: LiveMatchState, command: LiveMatchCommand, nowMs: number): LiveMatchState {
  return transitionLiveMatch(state, command, nowMs).state;
}

function startStoredMatch(initial: LiveMatchState): LiveMatchState {
  let state = apply(initial, { seat: 1, type: 'CONNECT' }, initial.createdAtMs + 1);
  state = apply(state, { seat: 2, type: 'CONNECT' }, initial.createdAtMs + 2);
  state = apply(state, { seat: 1, type: 'LOBBY_READY' }, initial.createdAtMs + 3);
  state = apply(state, { seat: 2, type: 'LOBBY_READY' }, initial.createdAtMs + 4);
  state = apply(state, { type: 'ALARM' }, state.phaseDeadlineMs ?? initial.createdAtMs + 5);
  state = apply(state, { roundNumber: 1, seat: 1, type: 'ROUND_READY' }, (state.phaseDeadlineMs ?? 0) - 2);
  return apply(state, { roundNumber: 1, seat: 2, type: 'ROUND_READY' }, (state.phaseDeadlineMs ?? 0) - 1);
}

function finishStoredEasyMatch(initial: LiveMatchState, winnerSeat: 1 | null): LiveMatchState {
  let state = startStoredMatch(initial);
  for (let round = 1; round <= 5; round += 1) {
    const answerDeadline = state.phaseDeadlineMs ?? 0;
    if (round === 1 && winnerSeat === 1) {
      const question = state.questions[state.roundIndex];
      if (question === undefined) throw new Error('Pergunta sintética ausente.');
      state = apply(state, {
        questionId: question.id,
        roundNumber: round,
        seat: 1,
        selectedOption: question.correctOption,
        type: 'ANSWER',
      }, answerDeadline - 9_000);
      state = apply(state, {
        questionId: question.id,
        roundNumber: round,
        seat: 2,
        selectedOption: (question.correctOption + 1) % 4,
        type: 'ANSWER',
      }, answerDeadline - 8_000);
    } else {
      state = apply(state, { type: 'ALARM' }, answerDeadline);
    }
    state = apply(state, { type: 'ALARM' }, state.phaseDeadlineMs ?? answerDeadline);
    if (round < 5) {
      state = apply(state, { roundNumber: round + 1, seat: 1, type: 'ROUND_READY' }, (state.phaseDeadlineMs ?? 0) - 2);
      state = apply(state, { roundNumber: round + 1, seat: 2, type: 'ROUND_READY' }, (state.phaseDeadlineMs ?? 0) - 1);
    }
  }
  return state;
}

async function initializeRoom(
  fixture: Awaited<ReturnType<typeof seedMatchFixture>>,
  roomId = crypto.randomUUID(),
): Promise<{ roomId: string; stub: DurableObjectStub }> {
  const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(roomId));
  const response = await stub.fetch('https://room.internal/initialize', {
    body: JSON.stringify({
      createdAtMs: Date.now(),
      firebaseUids: fixture.uids,
      matchId: roomId,
      resource: fixture.resource,
    }),
    method: 'POST',
  });
  expect(response.status).toBe(201);
  return { roomId, stub };
}

beforeAll(async () => {
  const coreTables = await env.CORE_DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('matches', 'active_match_players') ORDER BY name",
  ).all<{ name: string }>();
  expect(coreTables.results.map((row) => row.name)).toEqual(['active_match_players', 'matches']);
});

describe('Milestone 8 no runtime Workers simulado', () => {
  it('executa WebSocket, persiste/reconecta e aplica resultado idempotente no D1', async () => {
    const fixture = await seedMatchFixture('complete');
    const { roomId, stub } = await initializeRoom(fixture);

    const storedQuestions = await env.CORE_DB.prepare(
      'SELECT public_snapshot_json FROM match_questions WHERE match_id = ?1 ORDER BY round_number',
    ).bind(roomId).all<{ public_snapshot_json: string }>();
    expect(storedQuestions.results).toHaveLength(5);
    expect(storedQuestions.results.every((row) => !row.public_snapshot_json.includes('correctOption'))).toBe(true);
    expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total FROM active_match_players WHERE match_id = ?1')
      .bind(roomId).first<{ total: number }>()).toEqual({ total: 2 });

    const duplicateRepository = new LiveMatchRepository(env.CORE_DB, env.QUESTIONS_DB);
    await expect(duplicateRepository.initialize({
      createdAtMs: Date.now(), firebaseUids: fixture.uids, matchId: crypto.randomUUID(), resource: fixture.resource,
    })).rejects.toMatchObject({ code: 'PLAYER_BUSY' });

    const first = await openRoom(stub, fixture.uids[0]);
    const second = await openRoom(stub, fixture.uids[1]);
    await Promise.all([first.waitFor('ROOM_STATE'), second.waitFor('ROOM_STATE')]);
    first.socket.send(JSON.stringify({ type: 'READY' }));
    second.socket.send(JSON.stringify({ type: 'READY' }));
    await Promise.all([first.waitFor('PREPARING'), second.waitFor('PREPARING')]);
    await expireAlarm(stub);
    const [firstQuestion, secondQuestion] = await Promise.all([
      first.waitFor('ROUND_QUESTION'), second.waitFor('ROUND_QUESTION'),
    ]);
    expect(JSON.stringify(firstQuestion)).not.toContain('correctOption');
    expect(JSON.stringify(secondQuestion)).not.toContain('correctOption');
    expect(firstQuestion.match?.round).toEqual({ number: 1, total: 5 });
    const questionId = firstQuestion.match?.question?.id;
    expect(questionId).toBeTypeOf('string');
    if (questionId === undefined) throw new Error('Pergunta da primeira rodada ausente.');
    first.socket.send(JSON.stringify({ roundNumber: 1, type: 'ROUND_READY' }));
    second.socket.send(JSON.stringify({ roundNumber: 1, type: 'ROUND_READY' }));
    const [firstStarted, secondStarted] = await Promise.all([
      first.waitFor('ROUND_STARTED'), second.waitFor('ROUND_STARTED'),
    ]);
    const originalRemaining = firstStarted.match?.remainingMs ?? 0;
    expect(originalRemaining).toBeGreaterThan(9_000);
    expect(secondStarted.match?.remainingMs).toBeGreaterThan(9_000);

    first.socket.close(1_000, 'Teste de reconexão');
    const paused = await second.waitFor('PAUSED_FOR_RECONNECT');
    expect(paused.match?.phase).toBe('PAUSED');
    expect(paused.match?.paused?.phase).toBe('ANSWERING');
    const preservedRemaining = paused.match?.paused?.phaseRemainingMs ?? 0;
    expect(preservedRemaining).toBeLessThanOrEqual(originalRemaining);
    const storedPause = await runInDurableObject(stub, async (_instance, state) => {
      const room = await state.storage.get<LiveMatchState>('room');
      return room?.pause ?? null;
    });
    expect(storedPause).toMatchObject({ phase: 'ANSWERING', phaseRemainingMs: preservedRemaining });

    const firstReconnected = await openRoom(stub, fixture.uids[0]);
    const [firstResumed, secondResumed] = await Promise.all([
      firstReconnected.waitFor('RESUMED'), second.waitFor('RESUMED'),
    ]);
    expect(firstResumed.match?.phase).toBe('ANSWERING');
    expect(firstResumed.match?.remainingMs).toBeLessThanOrEqual(preservedRemaining);
    expect(firstResumed.match?.remainingMs).toBeGreaterThan(preservedRemaining - 250);
    expect(secondResumed.match?.remainingMs).toBeGreaterThan(0);

    firstReconnected.socket.send(JSON.stringify({
      questionId, roundNumber: 1, score: 999_999, selectedOption: 0, type: 'ANSWER',
    }));
    expect(await firstReconnected.waitFor('ERROR')).toMatchObject({ code: 'INVALID_MESSAGE' });
    firstReconnected.socket.send(JSON.stringify({ questionId, roundNumber: 1, selectedOption: 0, type: 'ANSWER' }));
    const opponentAnswered = await second.waitFor(
      'MATCH_STATE',
      (message) => message.match?.opponent.answered === true,
    );
    expect(opponentAnswered.match?.opponent).toEqual(expect.objectContaining({ answered: true, score: 0 }));
    expect(opponentAnswered.match?.opponent).not.toHaveProperty('correct');
    expect(opponentAnswered.match?.opponent).not.toHaveProperty('selectedOption');
    second.socket.send(JSON.stringify({ questionId, roundNumber: 1, selectedOption: 3, type: 'ANSWER' }));
    const [firstResolved, secondResolved] = await Promise.all([
      firstReconnected.waitFor('ROUND_RESOLVED'), second.waitFor('ROUND_RESOLVED'),
    ]);
    expect(firstResolved.match?.viewer.score).toBeGreaterThan(0);
    expect(secondResolved.match?.opponent.score).toBe(firstResolved.match?.viewer.score);
    expect(firstResolved.match?.resolution).toMatchObject({
      correctOption: 0,
      opponent: { answered: true, correct: false, selectedOption: 3 },
      viewer: { correct: true, selectedOption: 0 },
    });
    expect(secondResolved.match?.resolution).toMatchObject({
      correctOption: 0,
      opponent: { answered: true, correct: true, selectedOption: 0 },
      viewer: { correct: false, selectedOption: 3 },
    });
    expect(firstResolved.match?.opponent).not.toHaveProperty('selectedOption');
    expect(secondResolved.match?.opponent).not.toHaveProperty('selectedOption');

    for (let round = 2; round <= 5; round += 1) {
      await expireAlarm(stub);
      const [nextFirst, nextSecond] = await Promise.all([
        firstReconnected.waitFor('ROUND_QUESTION'), second.waitFor('ROUND_QUESTION'),
      ]);
      expect(nextFirst.match?.round?.number).toBe(round);
      firstReconnected.socket.send(JSON.stringify({ roundNumber: round, type: 'ROUND_READY' }));
      second.socket.send(JSON.stringify({ roundNumber: round, type: 'ROUND_READY' }));
      await Promise.all([firstReconnected.waitFor('ROUND_STARTED'), second.waitFor('ROUND_STARTED')]);
      await expireAlarm(stub);
      const [firstTimedOut, secondTimedOut] = await Promise.all([
        firstReconnected.waitFor('ROUND_RESOLVED'), second.waitFor('ROUND_RESOLVED'),
      ]);
      if (round === 2) {
        expect(firstTimedOut.match?.resolution).toMatchObject({
          correctOption: 0,
          opponent: { answered: false, correct: false, selectedOption: null },
          viewer: { correct: false, selectedOption: null },
        });
        expect(secondTimedOut.match?.resolution?.opponent.selectedOption).toBeNull();
      }
      expect(nextSecond.match?.question?.id).toBeTypeOf('string');
    }
    await expireAlarm(stub);
    const [firstFinished, secondFinished] = await Promise.all([
      firstReconnected.waitFor('MATCH_FINISHED'), second.waitFor('MATCH_FINISHED'),
    ]);
    expect(firstFinished.result?.viewer).toMatchObject({ knowledgeAfter: 525, knowledgeDelta: 25, result: 'WIN', xpDelta: 10 });
    expect(secondFinished.result?.viewer).toMatchObject({ knowledgeAfter: 490, knowledgeDelta: -10, result: 'LOSS', xpDelta: 0 });

    const matchRow = await env.CORE_DB.prepare(
      'SELECT status, result_version, winner_user_id FROM matches WHERE id = ?1',
    ).bind(roomId).first<{ result_version: number; status: string; winner_user_id: string | null }>();
    expect(matchRow).toEqual({ result_version: 1, status: 'FINISHED', winner_user_id: fixture.userIds[0] });
    expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total, SUM(applied) AS applied FROM result_ledger WHERE match_id = ?1')
      .bind(roomId).first<{ applied: number; total: number }>()).toEqual({ applied: 2, total: 2 });
    expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total FROM match_answers WHERE match_id = ?1')
      .bind(roomId).first<{ total: number }>()).toEqual({ total: 10 });
    expect(await env.CORE_DB.prepare('SELECT COUNT(*) AS total FROM active_match_players WHERE match_id = ?1')
      .bind(roomId).first<{ total: number }>()).toEqual({ total: 0 });

    for (const userId of fixture.userIds) {
      const row = await env.CORE_DB.prepare(
        'SELECT state_blob FROM user_pool_states WHERE user_id = ?1 AND pool_id = ?2',
      ).bind(userId, fixture.poolId).first<{ state_blob: ArrayBuffer }>();
      expect(row).not.toBeNull();
      expect(decodePoolState(new Uint8Array(row?.state_blob ?? new ArrayBuffer(0))).recentSlots).toHaveLength(5);
    }

    const finishedState = await runInDurableObject(stub, async (_instance, state) => {
      const room = await state.storage.get<LiveMatchState>('room');
      if (room === undefined) throw new Error('Sala ausente.');
      return room;
    });
    const retryState: LiveMatchState = { ...finishedState, phase: 'FINALIZING' };
    await duplicateRepository.finalize(retryState);
    await duplicateRepository.finalize(retryState);
    expect(await env.CORE_DB.prepare('SELECT total_xp FROM user_profiles WHERE user_id = ?1')
      .bind(fixture.userIds[0]).first<{ total_xp: number }>()).toEqual({ total_xp: 10 });
    expect(await env.CORE_DB.prepare('SELECT knowledge FROM theme_rankings WHERE user_id = ?1 AND theme_id = ?2')
      .bind(fixture.userIds[0], fixture.themeId).first<{ knowledge: number }>()).toEqual({ knowledge: 525 });
  });

  it('aplica somente derrota Média ao desconectado depois dos 7 segundos', async () => {
    const fixture = await seedMatchFixture('abandon');
    const { roomId, stub } = await initializeRoom(fixture);
    const first = await openRoom(stub, fixture.uids[0]);
    const second = await openRoom(stub, fixture.uids[1]);
    await Promise.all([first.waitFor('ROOM_STATE'), second.waitFor('ROOM_STATE')]);
    first.socket.send(JSON.stringify({ type: 'READY' }));
    second.socket.send(JSON.stringify({ type: 'READY' }));
    await Promise.all([first.waitFor('PREPARING'), second.waitFor('PREPARING')]);
    await expireAlarm(stub);
    await Promise.all([first.waitFor('ROUND_QUESTION'), second.waitFor('ROUND_QUESTION')]);
    first.socket.send(JSON.stringify({ roundNumber: 1, type: 'ROUND_READY' }));
    second.socket.send(JSON.stringify({ roundNumber: 1, type: 'ROUND_READY' }));
    await Promise.all([first.waitFor('ROUND_STARTED'), second.waitFor('ROUND_STARTED')]);
    first.socket.close(1_000, 'Queda individual sintética');
    await second.waitFor('PAUSED_FOR_RECONNECT');
    await expireAlarm(stub);
    const voided = await second.waitFor('MATCH_VOID');
    expect(voided.voidReason).toBe('INDIVIDUAL_DISCONNECT');
    expect(voided.result?.viewer).toMatchObject({ knowledgeDelta: 0, result: 'VOID', xpDelta: 0 });
    const players = await env.CORE_DB.prepare(
      'SELECT user_id, knowledge_delta, xp_delta FROM match_players WHERE match_id = ?1 ORDER BY seat',
    ).bind(roomId).all<{ knowledge_delta: number; user_id: string; xp_delta: number }>();
    expect(players.results).toEqual([
      { knowledge_delta: -20, user_id: fixture.userIds[0], xp_delta: 0 },
      { knowledge_delta: 0, user_id: fixture.userIds[1], xp_delta: 0 },
    ]);
  });

  it('persiste empate Ranqueado sem desempate, Conhecimento ou XP', async () => {
    const fixture = await seedMatchFixture('draw');
    const repository = new LiveMatchRepository(env.CORE_DB, env.QUESTIONS_DB);
    const matchId = crypto.randomUUID();
    const initial = await repository.initialize({
      createdAtMs: Date.now(), firebaseUids: fixture.uids, matchId, resource: fixture.resource,
    });
    const finalizing = finishStoredEasyMatch(initial, null);
    await repository.markStarted(matchId);
    const concurrentResults = await Promise.all([
      repository.finalize(finalizing),
      repository.finalize(finalizing),
    ]);
    const result = concurrentResults[0];
    if (result === undefined) throw new Error('Resultado concorrente ausente.');
    expect(concurrentResults[1]).toEqual(result);
    expect(result).toMatchObject({ status: 'FINISHED', winnerUserId: null });
    expect(result.players.map((player) => player.result)).toEqual(['DRAW', 'DRAW']);
    expect(result.players.map((player) => [player.knowledgeDelta, player.xpDelta])).toEqual([[0, 0], [0, 0]]);
    const rankings = await env.CORE_DB.prepare(
      `SELECT knowledge, ranked_matches, wins, losses, draws
         FROM theme_rankings
        WHERE theme_id = ?1
        ORDER BY user_id`,
    ).bind(fixture.themeId).all<{
      draws: number;
      knowledge: number;
      losses: number;
      ranked_matches: number;
      wins: number;
    }>();
    expect(rankings.results).toEqual([
      { draws: 1, knowledge: 500, losses: 0, ranked_matches: 1, wins: 0 },
      { draws: 1, knowledge: 500, losses: 0, ranked_matches: 1, wins: 0 },
    ]);
  });

  it('concede XP da vitória Casual sem alterar Conhecimento', async () => {
    const fixture = await seedMatchFixture('casual', 500, 'CASUAL');
    const repository = new LiveMatchRepository(env.CORE_DB, env.QUESTIONS_DB);
    const matchId = crypto.randomUUID();
    const initial = await repository.initialize({
      createdAtMs: Date.now(), firebaseUids: fixture.uids, matchId, resource: fixture.resource,
    });
    const finalizing = finishStoredEasyMatch(initial, 1);
    await repository.markStarted(matchId);
    const result = await repository.finalize(finalizing);
    expect(result.players[0]).toMatchObject({ knowledgeAfter: 500, knowledgeDelta: 0, result: 'WIN', xpDelta: 10 });
    expect(result.players[1]).toMatchObject({ knowledgeAfter: 500, knowledgeDelta: 0, result: 'LOSS', xpDelta: 0 });
    const rankings = await env.CORE_DB.prepare(
      'SELECT knowledge, ranked_matches FROM theme_rankings WHERE theme_id = ?1 ORDER BY user_id',
    ).bind(fixture.themeId).all<{ knowledge: number; ranked_matches: number }>();
    expect(rankings.results).toEqual([
      { knowledge: 500, ranked_matches: 0 },
      { knowledge: 500, ranked_matches: 0 },
    ]);
  });

  it('anula queda dupla sem penalidade e libera os dois locks', async () => {
    const fixture = await seedMatchFixture('double');
    const repository = new LiveMatchRepository(env.CORE_DB, env.QUESTIONS_DB);
    const matchId = crypto.randomUUID();
    const initial = await repository.initialize({
      createdAtMs: Date.now(), firebaseUids: fixture.uids, matchId, resource: fixture.resource,
    });
    let finalizing = startStoredMatch(initial);
    await repository.markStarted(matchId);
    const disconnectedAt = (finalizing.phaseDeadlineMs ?? Date.now()) - 5_000;
    finalizing = apply(finalizing, { seat: 1, type: 'DISCONNECT' }, disconnectedAt);
    finalizing = apply(finalizing, { seat: 2, type: 'DISCONNECT' }, disconnectedAt + 1);
    const result = await repository.finalize(finalizing);
    expect(result).toMatchObject({ reason: 'SYSTEM_FAILURE', status: 'VOID', winnerUserId: null });
    expect(result.players.map((player) => [player.knowledgeDelta, player.xpDelta])).toEqual([[0, 0], [0, 0]]);
    expect(await env.CORE_DB.prepare(
      'SELECT COUNT(*) AS total FROM active_match_players WHERE match_id = ?1',
    ).bind(matchId).first<{ total: number }>()).toEqual({ total: 0 });
    const rankings = await env.CORE_DB.prepare(
      'SELECT knowledge, ranked_matches FROM theme_rankings WHERE theme_id = ?1 ORDER BY user_id',
    ).bind(fixture.themeId).all<{ knowledge: number; ranked_matches: number }>();
    expect(rankings.results).toEqual([
      { knowledge: 500, ranked_matches: 0 },
      { knowledge: 500, ranked_matches: 0 },
    ]);
  });
});
