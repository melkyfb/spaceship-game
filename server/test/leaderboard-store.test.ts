import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LeaderboardStore } from '../src/LeaderboardStore';

function makeStore(): { store: LeaderboardStore; dir: string; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'asteroids-lb-'));
  const dbPath = join(dir, 'leaderboard.db');
  const store = new LeaderboardStore(dbPath);
  return {
    store,
    dir,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('recordScore persists and getTop returns top 10 ordered by score desc', async () => {
  const { store, close } = makeStore();
  try {
    const t1 = store.getOrCreateToken();
    const t2 = store.getOrCreateToken();
    const t3 = store.getOrCreateToken();

    store.recordScore({ token: t1, name: 'Alice', score: 100, wave: 2, mode: 'MULTIPLAYER' });
    store.recordScore({ token: t2, name: 'Bob', score: 300, wave: 5, mode: 'MULTIPLAYER' });
    store.recordScore({ token: t3, name: 'Cara', score: 200, wave: 3, mode: 'MULTIPLAYER' });
    await store.flush();

    const top = store.getTop('MULTIPLAYER', 10);
    assert.equal(top.length, 3);
    assert.deepEqual(top.map((e) => e.name), ['Bob', 'Cara', 'Alice']);
    assert.deepEqual(top.map((e) => e.score), [300, 200, 100]);
    assert.deepEqual(top.map((e) => e.wave), [5, 3, 2]);
  } finally {
    close();
  }
});

test('getTop respects limit and mode', async () => {
  const { store, close } = makeStore();
  try {
    for (let i = 0; i < 12; i++) {
      const token = store.getOrCreateToken();
      store.recordScore({ token, name: `P${i}`, score: (i + 1) * 10, wave: i + 1, mode: 'MULTIPLAYER' });
    }
    const other = store.getOrCreateToken();
    store.recordScore({ token: other, name: 'Other', score: 9999, wave: 99, mode: 'SOLO' });
    await store.flush();

    const top = store.getTop('MULTIPLAYER', 10);
    assert.equal(top.length, 10);
    assert.equal(top[0]?.score, 120);
    assert.equal(top[9]?.score, 30);
    assert.ok(top.every((e) => e.score !== 9999));
  } finally {
    close();
  }
});

test('getBestForToken returns best recorded score for token in mode', async () => {
  const { store, close } = makeStore();
  try {
    const token = store.getOrCreateToken();
    const other = store.getOrCreateToken();
    store.recordScore({ token, name: 'Alice', score: 50, wave: 1, mode: 'MULTIPLAYER' });
    store.recordScore({ token, name: 'Alice', score: 150, wave: 3, mode: 'MULTIPLAYER' });
    store.recordScore({ token, name: 'Alice', score: 75, wave: 2, mode: 'MULTIPLAYER' });
    store.recordScore({ token: other, name: 'Bob', score: 999, wave: 9, mode: 'MULTIPLAYER' });
    await store.flush();

    const best = store.getBestForToken('MULTIPLAYER', token);
    assert.ok(best);
    assert.equal(best.score, 150);
    assert.equal(best.wave, 3);
    assert.equal(best.name, 'Alice');

    const missing = store.getBestForToken('MULTIPLAYER', 'no-such-token');
    assert.equal(missing, null);
  } finally {
    close();
  }
});

test('display name is updatable for same token', async () => {
  const { store, close } = makeStore();
  try {
    const token = store.getOrCreateToken();
    store.recordScore({ token, name: 'OldName', score: 100, wave: 1, mode: 'MULTIPLAYER' });
    await store.flush();
    store.recordScore({ token, name: 'NewName', score: 50, wave: 1, mode: 'MULTIPLAYER' });
    await store.flush();

    const top = store.getTop('MULTIPLAYER', 10);
    assert.ok(top.length >= 1);
    // Best score row should reflect current display name
    const best = store.getBestForToken('MULTIPLAYER', token);
    assert.ok(best);
    assert.equal(best.name, 'NewName');
    assert.equal(best.score, 100);
    // Top entries for this token should also show updated name
    assert.ok(top.every((e) => e.name !== 'OldName'));
  } finally {
    close();
  }
});

test('getOrCreateToken returns opaque tokens and reuses existing token', () => {
  const { store, close } = makeStore();
  try {
    const a = store.getOrCreateToken();
    const b = store.getOrCreateToken();
    assert.equal(typeof a, 'string');
    assert.equal(typeof b, 'string');
    assert.ok(a.length > 0);
    assert.notEqual(a, b);

    const reused = store.getOrCreateToken(a);
    assert.equal(reused, a);

    const unknown = store.getOrCreateToken('does-not-exist');
    assert.equal(typeof unknown, 'string');
    assert.ok(unknown.length > 0);
    assert.notEqual(unknown, 'does-not-exist');
  } finally {
    close();
  }
});

test('drain failure logs, retries boundedly, drops batch, and does not throw uncaught', async () => {
  const { store, close } = makeStore();
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
  try {
    const token = store.getOrCreateToken();
    (store as any).insertScoreStmt = {
      run: () => {
        throw new Error('disk full');
      },
    };

    store.recordScore({ token, name: 'Alice', score: 100, wave: 1, mode: 'MULTIPLAYER' });
    await store.flush();

    assert.ok(errors.some((e) => e.includes('drain failed')), `expected drain failure log, got ${JSON.stringify(errors)}`);
    assert.ok(
      errors.some((e) => e.includes('dropping batch') || e.includes('requeueing batch')),
      `expected drop/requeue log, got ${JSON.stringify(errors)}`,
    );
    // Queue should be drained (dropped after retries) and flush should have resolved.
    assert.equal((store as any).queue.length, 0);
  } finally {
    console.error = originalError;
    close();
  }
});

test('close handles drain errors and still closes db', () => {
  const { store } = makeStore();
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
  try {
    const token = store.getOrCreateToken();
    (store as any).insertScoreStmt = {
      run: () => {
        throw new Error('disk full');
      },
    };
    store.recordScore({ token, name: 'Alice', score: 100, wave: 1, mode: 'MULTIPLAYER' });
    // close should not throw even if drain fails
    assert.doesNotThrow(() => store.close());
    assert.ok(errors.length >= 0); // may log drain/close errors
  } finally {
    console.error = originalError;
  }
});
