import {
  clampKnowledge,
  createLiveMatchState,
  encodePoolState,
  markAnswered,
  questionsForDifficulty,
  rankedAbandonmentLoss,
  resolveKnowledge,
  resultFromScores,
  TOTAL_XP_TO_MAX_LEVEL,
  xpAward,
  type Difficulty,
  type LiveMatchState,
  type LivePlayer,
  type LiveQuestion,
  type LiveSeat,
  type MatchMode,
  type MatchResult,
} from '@quiz-gomes/domain';
import { ApiError } from '../http/api-error.js';
import { PoolStateRepository } from './pool-state-repository.js';
import { QuestionRepository } from './question-repository.js';
import { QuestionSelectionService } from '../services/question-selection-service.js';
import { customAvatarUrl } from '../storage/custom-avatar.js';

interface InitializationPlayerRow {
  custom_avatar_version: number | null;
  display_name: string;
  equipped_frame_id: string | null;
  firebase_uid: string;
  knowledge: number;
  photo_url: string | null;
  user_id: string;
}

interface MatchConfigurationRow {
  question_shard_id: string;
  status: string;
}

interface ProgressRow {
  knowledge: number;
  total_xp: number;
  user_id: string;
}

interface FinalizedPlayerRow {
  knowledge_before: number | null;
  knowledge_delta: number | null;
  score: number;
  seat: LiveSeat;
  user_id: string;
  xp_delta: number;
}

interface FinalizedMatchRow {
  result_reason: string | null;
  status: 'FINISHED' | 'VOID';
  winner_user_id: string | null;
}

export interface FinalizedLivePlayer {
  knowledgeAfter: number;
  knowledgeBefore: number;
  knowledgeDelta: number;
  result: MatchResult;
  score: number;
  seat: LiveSeat;
  userId: string;
  xpDelta: number;
}

export interface FinalizedLiveMatch {
  players: [FinalizedLivePlayer, FinalizedLivePlayer];
  reason: string;
  status: 'FINISHED' | 'VOID';
  winnerUserId: string | null;
}

export interface MatchMembership {
  matchStatus: string;
  userId: string;
}

export interface ParsedMatchResource {
  difficulty: Difficulty;
  mode: MatchMode;
  themeId: string;
}

export function parseMatchResource(resource: string): ParsedMatchResource | null {
  const [themeId, difficulty, mode, extra] = resource.split(':');
  if (themeId === undefined || themeId.length === 0 || themeId.length > 128 || extra !== undefined) return null;
  if (difficulty !== 'EASY' && difficulty !== 'MEDIUM' && difficulty !== 'HARD') return null;
  if (mode !== 'CASUAL' && mode !== 'RANKED') return null;
  return { difficulty, mode, themeId };
}

function mapInitializationPlayer(row: InitializationPlayerRow): Omit<LivePlayer, 'connected' | 'lobbyReady' | 'roundReady' | 'score' | 'seat'> {
  return {
    customAvatarUrl: customAvatarUrl(row.user_id, row.custom_avatar_version),
    displayName: row.display_name,
    firebaseUid: row.firebase_uid,
    frameId: row.equipped_frame_id,
    knowledgeBefore: row.knowledge,
    photoUrl: row.photo_url,
    userId: row.user_id,
  };
}

function matchResultForPlayer(
  status: 'FINISHED' | 'VOID',
  winnerUserId: string | null,
  userId: string,
): MatchResult {
  if (status === 'VOID') return 'VOID';
  if (winnerUserId === null) return 'DRAW';
  return winnerUserId === userId ? 'WIN' : 'LOSS';
}

function resultCounters(result: MatchResult, ranked: boolean): { draws: number; losses: number; matches: number; wins: number } {
  if (!ranked || result === 'VOID') return { draws: 0, losses: 0, matches: 0, wins: 0 };
  return {
    draws: result === 'DRAW' ? 1 : 0,
    losses: result === 'LOSS' ? 1 : 0,
    matches: 1,
    wins: result === 'WIN' ? 1 : 0,
  };
}

function publicSnapshot(question: LiveQuestion): string {
  return JSON.stringify({
    id: question.id,
    imageUrl: question.imageUrl,
    options: question.options,
    prompt: question.prompt,
  });
}

export class LiveMatchRepository {
  constructor(
    private readonly coreDb: D1Database,
    private readonly questionsDb: D1Database,
  ) {}

  async initialize(input: {
    createdAtMs: number;
    firebaseUids: readonly [string, string];
    matchId: string;
    resource: string;
  }): Promise<LiveMatchState> {
    const parsed = parseMatchResource(input.resource);
    if (parsed === null) throw new ApiError(400, 'INVALID_QUEUE', 'A fila escolhida é inválida.');
    if (input.firebaseUids[0] === input.firebaseUids[1]) {
      throw new ApiError(409, 'INVALID_MATCH_PLAYERS', 'A partida exige dois jogadores diferentes.');
    }

    const configuration = await this.coreDb.prepare(
      `SELECT question_shard_id, status
         FROM themes
        WHERE id = ?1`,
    ).bind(parsed.themeId).first<MatchConfigurationRow>();
    if (configuration === null || configuration.status !== 'ACTIVE') {
      throw new ApiError(409, 'THEME_UNAVAILABLE', 'Este tema não está disponível para partida.');
    }
    if (configuration.question_shard_id !== 'questions-01') {
      throw new ApiError(503, 'QUESTION_SHARD_UNAVAILABLE', 'O shard deste tema não está disponível.');
    }

    const playerStatement = this.coreDb.prepare(
      `SELECT u.id AS user_id, u.firebase_uid, p.display_name, p.photo_url, p.equipped_frame_id,
              CASE WHEN a.active = 1 THEN a.version ELSE NULL END AS custom_avatar_version,
              COALESCE(r.knowledge, 0) AS knowledge
         FROM users u
         JOIN user_profiles p ON p.user_id = u.id
         LEFT JOIN user_custom_avatars a ON a.user_id = u.id
         LEFT JOIN theme_rankings r ON r.user_id = u.id AND r.theme_id = ?2
        WHERE u.firebase_uid = ?1 AND u.disabled_at IS NULL`,
    );
    const playerRows = await this.coreDb.batch<InitializationPlayerRow>([
      playerStatement.bind(input.firebaseUids[0], parsed.themeId),
      playerStatement.bind(input.firebaseUids[1], parsed.themeId),
    ]);
    const firstRow = playerRows[0]?.results[0];
    const secondRow = playerRows[1]?.results[0];
    if (firstRow === undefined || secondRow === undefined) {
      throw new ApiError(409, 'PROFILE_REQUIRED', 'Os dois jogadores precisam de um perfil ativo.');
    }

    const selected = await new QuestionSelectionService(
      new QuestionRepository(this.questionsDb),
      new PoolStateRepository(this.coreDb),
    ).select(
      parsed.themeId,
      parsed.difficulty,
      [firstRow.user_id, secondRow.user_id],
      questionsForDifficulty(parsed.difficulty),
    );
    const liveQuestions: LiveQuestion[] = selected.questions.map((question) => ({
      correctOption: question.correctOption,
      id: question.id,
      imageUrl: null,
      options: question.options,
      prompt: question.prompt,
      slot: question.slot,
    }));
    const state = createLiveMatchState({
      createdAtMs: input.createdAtMs,
      difficulty: parsed.difficulty,
      matchId: input.matchId,
      mode: parsed.mode,
      players: [mapInitializationPlayer(firstRow), mapInitializationPlayer(secondRow)],
      poolId: selected.poolId,
      poolVersion: selected.poolVersion,
      questions: liveQuestions,
      themeId: parsed.themeId,
    });

    const statements: D1PreparedStatement[] = [
      this.coreDb.prepare(
        `INSERT INTO matches
          (id, theme_id, difficulty, mode, kind, status, question_shard_id, room_key, pool_id, pool_version)
         VALUES (?1, ?2, ?3, ?4, 'MATCHMAKING', 'PREPARING', ?5, ?1, ?6, ?7)`,
      ).bind(input.matchId, parsed.themeId, parsed.difficulty, parsed.mode, configuration.question_shard_id, selected.poolId, selected.poolVersion),
    ];
    for (const player of state.players) {
      statements.push(
        this.coreDb.prepare(
          `INSERT INTO match_players (match_id, user_id, seat, knowledge_before)
           VALUES (?1, ?2, ?3, ?4)`,
        ).bind(input.matchId, player.userId, player.seat, player.knowledgeBefore),
        this.coreDb.prepare(
          'INSERT INTO active_match_players (user_id, match_id) VALUES (?1, ?2)',
        ).bind(player.userId, input.matchId),
      );
    }
    state.questions.forEach((question, index) => {
      statements.push(this.coreDb.prepare(
        `INSERT INTO match_questions
          (match_id, round_number, question_id, pool_slot, public_snapshot_json, correct_option_sealed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(input.matchId, index + 1, question.id, question.slot, publicSnapshot(question), String(question.correctOption)));
    });
    try {
      await this.coreDb.batch(statements);
    } catch (error) {
      if (error instanceof Error && /(?:active_match_players|UNIQUE constraint failed)/i.test(error.message)) {
        throw new ApiError(409, 'PLAYER_BUSY', 'Um dos jogadores já está em outra partida.');
      }
      throw error;
    }
    return state;
  }

  async activeMatchForFirebaseUid(firebaseUid: string): Promise<string | null> {
    const row = await this.coreDb.prepare(
      `SELECT a.match_id
         FROM active_match_players a
         JOIN users u ON u.id = a.user_id
        WHERE u.firebase_uid = ?1 AND u.disabled_at IS NULL`,
    ).bind(firebaseUid).first<{ match_id: string }>();
    return row?.match_id ?? null;
  }

  async membership(firebaseUid: string, matchId: string): Promise<MatchMembership | null> {
    const row = await this.coreDb.prepare(
      `SELECT mp.user_id, m.status AS match_status
         FROM matches m
         JOIN match_players mp ON mp.match_id = m.id
         JOIN users u ON u.id = mp.user_id
        WHERE m.id = ?1 AND u.firebase_uid = ?2 AND u.disabled_at IS NULL`,
    ).bind(matchId, firebaseUid).first<{ match_status: string; user_id: string }>();
    return row === null ? null : { matchStatus: row.match_status, userId: row.user_id };
  }

  async markStarted(matchId: string): Promise<void> {
    const result = await this.coreDb.prepare(
      `UPDATE matches
          SET status = 'PLAYING', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
        WHERE id = ?1 AND status = 'PREPARING'`,
    ).bind(matchId).run();
    if ((result.meta.changes ?? 0) > 0) return;
    const row = await this.coreDb.prepare('SELECT status FROM matches WHERE id = ?1').bind(matchId).first<{ status: string }>();
    if (row?.status !== 'PLAYING') throw new Error('Partida não pôde entrar em PLAYING.');
  }

  async finalize(state: LiveMatchState): Promise<FinalizedLiveMatch> {
    const outcome = state.pendingOutcome;
    if (state.phase !== 'FINALIZING' || outcome === null) throw new Error('Partida fora de FINALIZING.');
    const existing = await this.readFinalized(state);
    if (existing !== null) return existing;

    const progressStatement = this.coreDb.prepare(
      `SELECT p.user_id, p.total_xp, COALESCE(r.knowledge, 0) AS knowledge
         FROM user_profiles p
         LEFT JOIN theme_rankings r ON r.user_id = p.user_id AND r.theme_id = ?2
        WHERE p.user_id = ?1`,
    );
    const progressResults = await this.coreDb.batch<ProgressRow>(state.players.map((player) => (
      progressStatement.bind(player.userId, state.themeId)
    )));
    const progressRows = progressResults.map((result) => result.results[0]);
    const firstProgress = progressRows[0];
    const secondProgress = progressRows[1];
    if (firstProgress === undefined || secondProgress === undefined) throw new Error('Progresso de jogador ausente.');

    const scoreResult = resultFromScores(state.players[0].score, state.players[1].score);
    const winnerUserId = outcome.kind !== 'COMPLETED' || scoreResult === 'DRAW'
      ? null
      : scoreResult === 'WIN' ? state.players[0].userId : state.players[1].userId;
    const results: [MatchResult, MatchResult] = outcome.kind === 'COMPLETED'
      ? [scoreResult, scoreResult === 'WIN' ? 'LOSS' : scoreResult === 'LOSS' ? 'WIN' : 'DRAW']
      : ['VOID', 'VOID'];
    const progress: [ProgressRow, ProgressRow] = [firstProgress, secondProgress];
    const deltas = state.players.map((player, index) => {
      const before = progress[index]?.knowledge ?? 0;
      const result = results[index] ?? 'VOID';
      let knowledgeDelta = 0;
      if (outcome.kind === 'COMPLETED') {
        knowledgeDelta = resolveKnowledge(before, state.difficulty, result, state.mode).appliedDelta;
      } else if (outcome.penalizedSeat === player.seat && state.mode === 'RANKED') {
        knowledgeDelta = rankedAbandonmentLoss(before).appliedDelta;
      }
      const requestedXp = outcome.kind === 'COMPLETED' ? xpAward(state.difficulty, result) : 0;
      const xpBefore = progress[index]?.total_xp ?? 0;
      const xpDelta = Math.max(0, Math.min(TOTAL_XP_TO_MAX_LEVEL, xpBefore + requestedXp) - xpBefore);
      return { knowledgeBefore: before, knowledgeDelta, result, xpDelta };
    }) as [
      { knowledgeBefore: number; knowledgeDelta: number; result: MatchResult; xpDelta: number },
      { knowledgeBefore: number; knowledgeDelta: number; result: MatchResult; xpDelta: number },
    ];

    const poolStates = state.startedAtMs === null
      ? null
      : await Promise.all(state.players.map((player) => (
        new PoolStateRepository(this.coreDb).read(player.userId, state.poolId, state.poolVersion)
      )));
    const servedSlots = state.startedAtMs === null
      ? []
      : state.questions.slice(0, Math.min(state.questions.length, state.roundIndex + 1)).map((question) => question.slot);

    const finalStatus = outcome.kind === 'COMPLETED' ? 'FINISHED' : 'VOID';
    const statements: D1PreparedStatement[] = [
      this.coreDb.prepare(
        `UPDATE matches
            SET status = ?1, winner_user_id = ?2, result_reason = ?3, result_version = 1,
                finished_at = CURRENT_TIMESTAMP
          WHERE id = ?4 AND result_version = 0 AND status IN ('PREPARING', 'PLAYING')`,
      ).bind(finalStatus, winnerUserId, outcome.reason, state.matchId),
    ];

    state.players.forEach((player, index) => {
      const delta = deltas[index];
      if (delta === undefined) return;
      statements.push(this.coreDb.prepare(
        `INSERT OR IGNORE INTO result_ledger
          (match_id, user_id, result_version, knowledge_delta, xp_delta, applied)
         SELECT ?1, ?2, 1, ?3, ?4, 0
          WHERE EXISTS (
            SELECT 1 FROM matches
             WHERE id = ?1 AND result_version = 1 AND status = ?5 AND result_reason = ?6
          )`,
      ).bind(state.matchId, player.userId, delta.knowledgeDelta, delta.xpDelta, finalStatus, outcome.reason));

      const counts = resultCounters(
        delta.result === 'VOID' && outcome.kind === 'VOID' && outcome.penalizedSeat === player.seat ? 'LOSS' : delta.result,
        state.mode === 'RANKED' && (outcome.kind === 'COMPLETED' || outcome.penalizedSeat === player.seat),
      );
      if (state.mode === 'RANKED' && (outcome.kind === 'COMPLETED' || outcome.penalizedSeat === player.seat)) {
        statements.push(
          this.coreDb.prepare(
            `INSERT OR IGNORE INTO theme_rankings (user_id, theme_id)
             VALUES (?1, ?2)`,
          ).bind(player.userId, state.themeId),
          this.coreDb.prepare(
            `UPDATE theme_rankings
                SET knowledge = MIN(999999, MAX(0, knowledge + ?1)),
                    ranked_matches = ranked_matches + ?2,
                    wins = wins + ?3,
                    losses = losses + ?4,
                    draws = draws + ?5,
                    updated_at = CURRENT_TIMESTAMP
              WHERE user_id = ?6 AND theme_id = ?7
                AND EXISTS (
                  SELECT 1 FROM result_ledger
                   WHERE match_id = ?8 AND user_id = ?6 AND applied = 0
                )`,
          ).bind(delta.knowledgeDelta, counts.matches, counts.wins, counts.losses, counts.draws, player.userId, state.themeId, state.matchId),
        );
      }
      statements.push(
        this.coreDb.prepare(
          `UPDATE user_profiles
              SET total_xp = MIN(?1, total_xp + ?2), updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?3
              AND EXISTS (
                SELECT 1 FROM result_ledger
                 WHERE match_id = ?4 AND user_id = ?3 AND applied = 0
              )`,
        ).bind(TOTAL_XP_TO_MAX_LEVEL, delta.xpDelta, player.userId, state.matchId),
        this.coreDb.prepare(
          `UPDATE match_players
              SET score = ?1, knowledge_before = ?2, knowledge_delta = ?3, xp_delta = ?4,
                  connection_outcome = ?5, completed_at = CURRENT_TIMESTAMP
            WHERE match_id = ?6 AND user_id = ?7
              AND EXISTS (
                SELECT 1 FROM result_ledger
                 WHERE match_id = ?6 AND user_id = ?7 AND applied = 0
              )`,
        ).bind(
          player.score,
          delta.knowledgeBefore,
          delta.knowledgeDelta,
          delta.xpDelta,
          outcome.kind === 'VOID' && outcome.reason === 'SYSTEM_FAILURE'
            ? 'SYSTEM_FAILURE'
            : outcome.kind === 'VOID' && outcome.penalizedSeat === player.seat
              ? 'INDIVIDUAL_DISCONNECT'
              : 'CONNECTED',
          state.matchId,
          player.userId,
        ),
      );

      const poolState = poolStates?.[index];
      if (poolState !== undefined && servedSlots.length > 0) {
        const nextState = servedSlots.reduce((current, slot) => markAnswered(current, slot), poolState.state);
        const blob = encodePoolState(nextState);
        statements.push(
          this.coreDb.prepare(
            `UPDATE user_pool_states
                SET state_blob = ?1, pool_version = ?2, revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE user_id = ?3 AND pool_id = ?4
                AND EXISTS (
                  SELECT 1 FROM result_ledger
                   WHERE match_id = ?5 AND user_id = ?3 AND applied = 0
                )`,
          ).bind(blob.buffer, state.poolVersion, player.userId, state.poolId, state.matchId),
          this.coreDb.prepare(
            `INSERT OR IGNORE INTO user_pool_states
              (user_id, pool_id, pool_version, state_blob, revision)
             SELECT ?1, ?2, ?3, ?4, 1
              WHERE EXISTS (
                SELECT 1 FROM result_ledger
                 WHERE match_id = ?5 AND user_id = ?1 AND applied = 0
              )`,
          ).bind(player.userId, state.poolId, state.poolVersion, blob.buffer, state.matchId),
        );
      }
    });

    for (const round of state.roundHistory) {
      round.answers.forEach((answer, index) => {
        const player = state.players[index];
        if (player === undefined) return;
        statements.push(this.coreDb.prepare(
          `INSERT OR IGNORE INTO match_answers
            (match_id, round_number, user_id, selected_option, remaining_ms, is_correct, score)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
            WHERE EXISTS (
              SELECT 1 FROM result_ledger
               WHERE match_id = ?1 AND user_id = ?3 AND applied = 0
            )`,
        ).bind(
          state.matchId,
          round.roundNumber,
          player.userId,
          answer.selectedOption,
          answer.remainingMs,
          answer.correct ? 1 : 0,
          answer.score,
        ));
      });
    }
    state.answers.forEach((answer, index) => {
      if (answer === null || state.roundHistory.at(-1)?.roundNumber === state.roundIndex + 1) return;
      const player = state.players[index];
      if (player === undefined) return;
      statements.push(this.coreDb.prepare(
        `INSERT OR IGNORE INTO match_answers
          (match_id, round_number, user_id, selected_option, remaining_ms, is_correct, score)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
          WHERE EXISTS (
            SELECT 1 FROM result_ledger
             WHERE match_id = ?1 AND user_id = ?3 AND applied = 0
          )`,
      ).bind(
        state.matchId,
        state.roundIndex + 1,
        player.userId,
        answer.selectedOption,
        answer.remainingMs,
        answer.correct ? 1 : 0,
        answer.score,
      ));
    });
    state.players.forEach((player) => {
      statements.push(this.coreDb.prepare(
        `UPDATE result_ledger
            SET applied = 1, applied_at = CURRENT_TIMESTAMP
          WHERE match_id = ?1 AND user_id = ?2 AND applied = 0`,
      ).bind(state.matchId, player.userId));
    });
    statements.push(this.coreDb.prepare('DELETE FROM active_match_players WHERE match_id = ?1').bind(state.matchId));

    await this.coreDb.batch(statements);
    const finalized = await this.readFinalized(state);
    if (finalized === null) throw new Error('Finalização transacional não foi confirmada.');
    return finalized;
  }

  private async readFinalized(state: LiveMatchState): Promise<FinalizedLiveMatch | null> {
    const match = await this.coreDb.prepare(
      `SELECT status, winner_user_id, result_reason
         FROM matches
        WHERE id = ?1 AND status IN ('FINISHED', 'VOID') AND result_version = 1`,
    ).bind(state.matchId).first<FinalizedMatchRow>();
    if (match === null) return null;
    const result = await this.coreDb.prepare(
      `SELECT user_id, seat, score, knowledge_before, knowledge_delta, xp_delta
         FROM match_players
        WHERE match_id = ?1
        ORDER BY seat`,
    ).bind(state.matchId).all<FinalizedPlayerRow>();
    const rows = result.results;
    const first = rows[0];
    const second = rows[1];
    if (first === undefined || second === undefined) throw new Error('Resultado sem os dois jogadores.');
    const map = (row: FinalizedPlayerRow): FinalizedLivePlayer => {
      const knowledgeBefore = row.knowledge_before ?? 0;
      const knowledgeDelta = row.knowledge_delta ?? 0;
      return {
        knowledgeAfter: clampKnowledge(knowledgeBefore + knowledgeDelta),
        knowledgeBefore,
        knowledgeDelta,
        result: matchResultForPlayer(match.status, match.winner_user_id, row.user_id),
        score: row.score,
        seat: row.seat,
        userId: row.user_id,
        xpDelta: row.xp_delta,
      };
    };
    return {
      players: [map(first), map(second)],
      reason: match.result_reason ?? (match.status === 'FINISHED' ? 'COMPLETED' : 'SYSTEM_FAILURE'),
      status: match.status,
      winnerUserId: match.winner_user_id,
    };
  }
}
