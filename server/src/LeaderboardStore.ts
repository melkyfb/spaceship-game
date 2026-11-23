import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type LeaderboardMode = 'MULTIPLAYER' | 'SOLO' | string;

export interface RecordScoreInput {
  token?: string;
  playerToken?: string;
  name: string;
  score: number;
  wave: number;
  mode: LeaderboardMode;
}

export interface LeaderboardRow {
  token: string;
  name: string;
  score: number;
  wave: number;
  mode: LeaderboardMode;
  createdAt: string;
}

interface QueuedScore extends RecordScoreInput {
  createdAt: string;
}

export class LeaderboardStore {
  private readonly db: Database.Database;
  private readonly insertScoreStmt: Database.Statement;
  private readonly upsertTokenStmt: Database.Statement;
  private readonly touchTokenStmt: Database.Statement;
  private readonly getTokenStmt: Database.Statement;
  private readonly updateNameStmt: Database.Statement;
  private readonly queue: QueuedScore[] = [];
  private drainScheduled = false;
  private draining: Promise<void> | null = null;
  private drainResolve: (() => void) | null = null;
  private drainRetryCount = 0;
  private closed = false;
  private static readonly MAX_DRAIN_RETRIES = 3;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        token TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL,
        name TEXT NOT NULL,
        score INTEGER NOT NULL,
        wave INTEGER NOT NULL,
        mode TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(token) REFERENCES tokens(token)
      );
      CREATE INDEX IF NOT EXISTS idx_scores_mode_score ON scores(mode, score DESC, id ASC);
      CREATE INDEX IF NOT EXISTS idx_scores_token_mode ON scores(token, mode, score DESC);
    `);

    this.insertScoreStmt = this.db.prepare(`
      INSERT INTO scores (token, name, score, wave, mode, created_at)
      VALUES (@token, @name, @score, @wave, @mode, @createdAt)
    `);
    this.upsertTokenStmt = this.db.prepare(`
      INSERT INTO tokens (token, name, created_at, updated_at)
      VALUES (@token, @name, @now, @now)
      ON CONFLICT(token) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
    `);
    this.touchTokenStmt = this.db.prepare(`
      INSERT INTO tokens (token, name, created_at, updated_at)
      VALUES (@token, '', @now, @now)
      ON CONFLICT(token) DO NOTHING
    `);
    this.getTokenStmt = this.db.prepare(`SELECT token, name FROM tokens WHERE token = ?`);
    this.updateNameStmt = this.db.prepare(`UPDATE tokens SET name = @name, updated_at = @now WHERE token = @token`);
  }

  getOrCreateToken(existingToken?: string): string {
    const now = new Date().toISOString();
    if (typeof existingToken === 'string' && existingToken.length > 0) {
      const row = this.getTokenStmt.get(existingToken) as { token: string; name: string } | undefined;
      if (row) {
        return row.token;
      }
    }
    const token = randomUUID();
    this.touchTokenStmt.run({ token, now });
    return token;
  }

  /**
   * Enqueues score write off the hot tick. Call flush() in tests/shutdown to
   * await persistence.
   */
  recordScore(input: RecordScoreInput): void {
    if (this.closed) return;
    const score = normalizeScore(input.score);
    const wave = normalizeWave(input.wave);
    if (score <= 0) return;
    const rawToken = typeof input.token === 'string' ? input.token : input.playerToken;
    const token = typeof rawToken === 'string' ? rawToken : '';
    if (!token) return;
    const name = normalizeName(input.name);
    const mode = normalizeMode(input.mode);
    const createdAt = new Date().toISOString();

    this.queue.push({ token, name, score, wave, mode, createdAt });
    this.scheduleDrain();
  }

  getTop(mode: LeaderboardMode, limit: number): LeaderboardRow[] {
    const lim = normalizeLimit(limit);
    const normalizedMode = normalizeMode(mode);
    const rows = this.db.prepare(`
      SELECT
        s.token AS token,
        COALESCE(NULLIF(t.name, ''), s.name) AS name,
        s.score AS score,
        s.wave AS wave,
        s.mode AS mode,
        s.created_at AS createdAt
      FROM scores s
      LEFT JOIN tokens t ON t.token = s.token
      WHERE s.mode = ?
      ORDER BY s.score DESC, s.id ASC
      LIMIT ?
    `).all(normalizedMode, lim) as LeaderboardRow[];
    return rows;
  }

  getBestForToken(mode: LeaderboardMode, token: string): LeaderboardRow | null {
    const normalizedMode = normalizeMode(mode);
    if (typeof token !== 'string' || token.length === 0) return null;
    const row = this.db.prepare(`
      SELECT
        s.token AS token,
        COALESCE(NULLIF(t.name, ''), s.name) AS name,
        s.score AS score,
        s.wave AS wave,
        s.mode AS mode,
        s.created_at AS createdAt
      FROM scores s
      LEFT JOIN tokens t ON t.token = s.token
      WHERE s.mode = ? AND s.token = ?
      ORDER BY s.score DESC, s.id ASC
      LIMIT 1
    `).get(normalizedMode, token) as LeaderboardRow | undefined;
    return row ?? null;
  }

  getRankForScore(mode: LeaderboardMode, score: number): number {
    const normalizedMode = normalizeMode(mode);
    const s = normalizeScore(score);
    const row = this.db.prepare(
      `SELECT COUNT(*) + 1 AS rank FROM scores WHERE mode = ? AND score > ?`,
    ).get(normalizedMode, s) as { rank: number } | undefined;
    return row?.rank ?? 1;
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0 && !this.draining) return;
    // If a drain is scheduled or in progress, wait for it; also drain any
    // remaining queued items.
    if (this.draining) await this.draining;
    if (this.queue.length > 0) {
      this.drainNow();
    }
    if (this.draining) await this.draining;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      // Best-effort synchronous drain on close.
      this.drainNow();
    } catch (err) {
      console.error('[leaderboard-store] error draining on close; dropping queued scores', {
        queued: this.queue.length,
        err,
      });
    } finally {
      if (this.queue.length > 0) {
        console.error('[leaderboard-store] dropping queued scores on close', {
          queued: this.queue.length,
        });
        this.queue.length = 0;
      }
      this.drainScheduled = false;
      this.resolveDrain();
      try {
        this.db.close();
      } catch (err) {
        console.error('[leaderboard-store] error closing db', err);
      }
    }
  }

  private scheduleDrain(delayMs = 0): void {
    if (this.drainScheduled || this.closed) return;
    this.drainScheduled = true;
    if (!this.draining) {
      this.draining = new Promise<void>((resolve) => {
        this.drainResolve = resolve;
      });
    }
    const run = () => {
      this.drainScheduled = false;
      try {
        this.drainNow();
      } catch (err) {
        // drainNow handles its own errors, but guard against unexpected throws.
        console.error('[leaderboard-store] unexpected drain failure', err);
        this.queue.length = 0;
        this.resolveDrain();
      }
    };
    if (delayMs > 0) {
      setTimeout(run, delayMs);
    } else {
      setImmediate(run);
    }
  }

  private drainNow(): void {
    if (this.queue.length === 0) {
      this.drainRetryCount = 0;
      this.resolveDrain();
      return;
    }
    const batch = this.queue.splice(0, this.queue.length);
    const tx = this.db.transaction((items: QueuedScore[]) => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        this.upsertTokenStmt.run({ token: item.token, name: item.name, now: item.createdAt });
        this.insertScoreStmt.run(item);
      }
    });
    try {
      tx(batch);
      this.drainRetryCount = 0;
    } catch (err) {
      this.drainRetryCount += 1;
      const context = {
        batchSize: batch.length,
        queuedRemaining: this.queue.length,
        retry: this.drainRetryCount,
        maxRetries: LeaderboardStore.MAX_DRAIN_RETRIES,
        err,
      };
      if (this.drainRetryCount <= LeaderboardStore.MAX_DRAIN_RETRIES) {
        console.error('[leaderboard-store] drain failed; requeueing batch', context);
        this.queue.unshift(...batch);
        this.scheduleDrain(50 * this.drainRetryCount);
        return;
      }
      console.error('[leaderboard-store] drain failed; dropping batch after retries', context);
      this.drainRetryCount = 0;
      // Drop failed batch; continue draining any newer queued items.
    }

    if (this.queue.length === 0) {
      this.resolveDrain();
    } else {
      this.scheduleDrain();
    }
  }

  private resolveDrain(): void {
    const resolve = this.drainResolve;
    this.drainResolve = null;
    this.draining = null;
    if (resolve) resolve();
  }
}

function normalizeName(name: string): string {
  if (typeof name !== 'string') return 'Pilot';
  const trimmed = name.trim().slice(0, 24);
  return trimmed.length > 0 ? trimmed : 'Pilot';
}

function normalizeMode(mode: string): string {
  if (typeof mode !== 'string') return 'MULTIPLAYER';
  const trimmed = mode.trim();
  return trimmed.length > 0 ? trimmed : 'MULTIPLAYER';
}

function normalizeScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.trunc(score));
}

function normalizeWave(wave: number): number {
  if (!Number.isFinite(wave)) return 0;
  return Math.max(0, Math.trunc(wave));
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 10;
  return Math.max(1, Math.min(100, Math.trunc(limit)));
}
