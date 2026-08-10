import { createPoolState, decodePoolState, encodePoolState, type PoolState } from '@quiz-gomes/domain';

interface PoolStateRow {
  pool_version: number;
  revision: number;
  state_blob: ArrayBuffer;
}

export interface VersionedPoolState {
  poolVersion: number;
  revision: number;
  state: PoolState;
}

export class PoolStateRepository {
  constructor(private readonly db: D1Database) {}

  async read(userId: string, poolId: string, poolVersion = 1): Promise<VersionedPoolState> {
    const row = await this.db.prepare(
      'SELECT pool_version, revision, state_blob FROM user_pool_states WHERE user_id = ?1 AND pool_id = ?2',
    ).bind(userId, poolId).first<PoolStateRow>();
    if (row === null) return { poolVersion, revision: 0, state: createPoolState() };
    return {
      poolVersion: row.pool_version,
      revision: row.revision,
      state: decodePoolState(new Uint8Array(row.state_blob)),
    };
  }

  async compareAndSet(
    userId: string,
    poolId: string,
    expectedRevision: number,
    poolVersion: number,
    state: PoolState,
  ): Promise<boolean> {
    const blob = encodePoolState(state);
    if (expectedRevision === 0) {
      const result = await this.db.prepare(
        `INSERT OR IGNORE INTO user_pool_states (user_id, pool_id, pool_version, state_blob, revision)
         VALUES (?1, ?2, ?3, ?4, 1)`,
      ).bind(userId, poolId, poolVersion, blob.buffer).run();
      return (result.meta.changes ?? 0) === 1;
    }
    const result = await this.db.prepare(
      `UPDATE user_pool_states
          SET state_blob = ?1, pool_version = ?2, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?3 AND pool_id = ?4 AND revision = ?5`,
    ).bind(blob.buffer, poolVersion, userId, poolId, expectedRevision).run();
    return (result.meta.changes ?? 0) === 1;
  }
}
