import { z } from "zod";
import {
  PERSISTENT_THREAD_CACHE_TTL_MS,
  PERSISTENT_THREAD_SNAPSHOT_MAX_BYTES,
  SERVER_THREAD_CACHE_LIMIT,
} from "~~/shared/config";
import { appServerThreadSchema } from "~~/shared/runtime/app-server";
import {
  threadHistorySchema,
  threadSettingsSchema,
  tokenUsageSchema,
  turnsPageStateSchema,
} from "~~/shared/runtime/realtime/server-message-schema";
import type { ThreadOpenSnapshot } from "../runtime/types";
import { decryptJson, encryptJson } from "./crypto";
import { gatewayDatabase, withGatewayDatabaseTransaction } from "./database";

const persistentSnapshotSchema = z
  .object({
    version: z.literal(1),
    snapshot: z
      .object({
        thread: appServerThreadSchema,
        history: threadHistorySchema,
        projectId: z.number().int().positive().nullable(),
        turnsPage: turnsPageStateSchema,
        threadSettings: threadSettingsSchema.nullable(),
        tokenUsage: tokenUsageSchema.nullable(),
      })
      .strict(),
  })
  .strict();

const cacheRowSchema = z.object({
  source_updated_at: z.number().int().nonnegative(),
  encrypted_snapshot_json: z.string().min(1),
  expires_at: z.string().min(1),
});

export interface PersistentThreadSnapshot {
  snapshot: ThreadOpenSnapshot;
  sourceUpdatedAt: number;
}

export function readPersistentThreadSnapshot(
  userId: number,
  hostId: number,
  threadId: string,
): PersistentThreadSnapshot | null {
  const db = gatewayDatabase();
  const row = db
    .prepare(
      `SELECT source_updated_at, encrypted_snapshot_json, expires_at
       FROM thread_snapshot_cache
       WHERE user_id = ? AND host_id = ? AND thread_id = ?`,
    )
    .get(userId, hostId, threadId);
  if (row === undefined) return null;

  try {
    const parsedRow = cacheRowSchema.parse(row);
    if (Date.parse(parsedRow.expires_at) <= Date.now()) {
      deletePersistentThreadSnapshot(userId, hostId, threadId);
      return null;
    }
    const payload = persistentSnapshotSchema.parse(decryptJson(parsedRow.encrypted_snapshot_json));
    if (
      payload.snapshot.thread.id !== threadId ||
      payload.snapshot.history.thread.id !== threadId ||
      payload.snapshot.thread.updatedAt !== parsedRow.source_updated_at
    ) {
      deletePersistentThreadSnapshot(userId, hostId, threadId);
      return null;
    }
    db.prepare(
      `UPDATE thread_snapshot_cache
       SET last_accessed_at = ?
       WHERE user_id = ? AND host_id = ? AND thread_id = ?`,
    ).run(new Date().toISOString(), userId, hostId, threadId);
    return {
      snapshot: payload.snapshot,
      sourceUpdatedAt: parsedRow.source_updated_at,
    };
  } catch {
    // A cache entry is disposable. Corruption, a schema change, or an encryption-key rotation
    // must fall through to the authoritative app-server path instead of breaking thread opens.
    deletePersistentThreadSnapshot(userId, hostId, threadId);
    return null;
  }
}

export function writePersistentThreadSnapshot(
  userId: number,
  hostId: number,
  threadId: string,
  snapshot: ThreadOpenSnapshot,
) {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + PERSISTENT_THREAD_CACHE_TTL_MS).toISOString();
  const payload = { version: 1 as const, snapshot };
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > PERSISTENT_THREAD_SNAPSHOT_MAX_BYTES) {
    deletePersistentThreadSnapshot(userId, hostId, threadId);
    return;
  }
  const encrypted = encryptJson(payload);
  withGatewayDatabaseTransaction((db) => {
    db.prepare(
      `INSERT INTO thread_snapshot_cache
         (user_id, host_id, thread_id, source_updated_at, turn_count,
          encrypted_snapshot_json, created_at, updated_at, last_accessed_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, host_id, thread_id) DO UPDATE SET
         source_updated_at = excluded.source_updated_at,
         turn_count = excluded.turn_count,
         encrypted_snapshot_json = excluded.encrypted_snapshot_json,
         updated_at = excluded.updated_at,
         last_accessed_at = excluded.last_accessed_at,
         expires_at = excluded.expires_at`,
    ).run(
      userId,
      hostId,
      threadId,
      snapshot.thread.updatedAt,
      snapshot.history.thread.turns.length,
      encrypted,
      nowIso,
      nowIso,
      nowIso,
      expiresAt,
    );
    db.prepare("DELETE FROM thread_snapshot_cache WHERE expires_at <= ?").run(nowIso);
    db.prepare(
      `DELETE FROM thread_snapshot_cache
       WHERE rowid IN (
         SELECT rowid FROM thread_snapshot_cache
         WHERE user_id = ?
         ORDER BY last_accessed_at DESC
         LIMIT -1 OFFSET ?
       )`,
    ).run(userId, SERVER_THREAD_CACHE_LIMIT);
  });
}

export function deletePersistentThreadSnapshot(userId: number, hostId: number, threadId: string) {
  gatewayDatabase()
    .prepare(
      `DELETE FROM thread_snapshot_cache
       WHERE user_id = ? AND host_id = ? AND thread_id = ?`,
    )
    .run(userId, hostId, threadId);
}

export function deletePersistentThreadSnapshotsForHost(userId: number, hostId: number) {
  gatewayDatabase()
    .prepare("DELETE FROM thread_snapshot_cache WHERE user_id = ? AND host_id = ?")
    .run(userId, hostId);
}

export function prunePersistentThreadSnapshotsToHosts(userId: number, hostIds: Set<number>) {
  const ids = [...hostIds];
  if (ids.length === 0) {
    gatewayDatabase().prepare("DELETE FROM thread_snapshot_cache WHERE user_id = ?").run(userId);
    return;
  }
  const placeholders = ids.map(() => "?").join(", ");
  gatewayDatabase()
    .prepare(
      `DELETE FROM thread_snapshot_cache
       WHERE user_id = ? AND host_id NOT IN (${placeholders})`,
    )
    .run(userId, ...ids);
}
