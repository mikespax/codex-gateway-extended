import { randomBytes, randomUUID } from "node:crypto";
import type { ServerNotification, ServerNotificationTarget } from "~~/shared/types";
import { z } from "zod";
import { decryptJson, encryptJson, hashToken } from "../storage/crypto";
import { gatewayDatabase, withGatewayDatabaseTransaction } from "../storage/database";

const NOTIFICATION_REPLY_DAYS = 7;

const androidDeviceRowSchema = z.object({
  id: z.string(),
  user_id: z.number(),
  name: z.string(),
  token_hash: z.string(),
  fcm_token_hash: z.string(),
  encrypted_fcm_token: z.string(),
  is_active: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  last_seen_at: z.string(),
});

const androidNotificationRowSchema = z.object({
  device_id: z.string(),
  notification_key: z.string(),
  target_kind: z.enum(["thread", "tmuxMonitor"]),
  host_id: z.number(),
  project_id: z.number().nullable(),
  thread_id: z.string().nullable(),
  monitor_id: z.number().nullable(),
  title: z.string(),
  body: z.string(),
  reply_allowed: z.number(),
  delivery_status: z.enum(["pending", "sent", "failed"]),
  expires_at: z.string(),
  replied_at: z.string().nullable(),
});

const replyStatusRowSchema = z.object({ status: z.string() });
const encryptedFcmTokenSchema = z.object({ fcmToken: z.string().min(1) });

type AndroidDeviceRow = z.infer<typeof androidDeviceRowSchema>;
type AndroidNotificationRow = z.infer<typeof androidNotificationRowSchema>;

export interface AndroidDevice {
  id: string;
  userId: number;
  name: string;
  fcmToken: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface AndroidReplyContext {
  deviceId: string;
  userId: number;
  notificationKey: string;
  target: ServerNotificationTarget;
  expiresAt: string;
  repliedAt: string | null;
  replyAllowed: boolean;
}

export const androidDeviceRepository = {
  register(userId: number, name: string, fcmToken: string) {
    const id = randomUUID();
    const deviceToken = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    withGatewayDatabaseTransaction((db) => {
      const fcmTokenHash = hashToken(fcmToken);
      db.prepare(
        `UPDATE android_devices SET is_active = 0, updated_at = ?
         WHERE user_id = ? AND fcm_token_hash = ? AND is_active = 1`,
      ).run(now, userId, fcmTokenHash);
      db.prepare(
        `INSERT INTO android_devices
          (id, user_id, name, token_hash, fcm_token_hash, encrypted_fcm_token, is_active,
           created_at, updated_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).run(
        id,
        userId,
        name,
        hashToken(deviceToken),
        fcmTokenHash,
        encryptJson({ fcmToken }),
        now,
        now,
        now,
      );
    });
    return { id, deviceToken, createdAt: now };
  },

  authenticate(deviceToken: string): AndroidDevice | null {
    const parsed = androidDeviceRowSchema.safeParse(
      gatewayDatabase()
        .prepare("SELECT * FROM android_devices WHERE token_hash = ? AND is_active = 1")
        .get(hashToken(deviceToken)),
    );
    if (!parsed.success) return null;
    const row = parsed.data;
    const now = new Date().toISOString();
    gatewayDatabase()
      .prepare("UPDATE android_devices SET last_seen_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, row.id);
    return deviceFromRow({ ...row, last_seen_at: now, updated_at: now });
  },

  list(userId: number) {
    return gatewayDatabase()
      .prepare(
        `SELECT * FROM android_devices
         WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC`,
      )
      .all(userId)
      .map((row) => deviceFromRow(androidDeviceRowSchema.parse(row)));
  },

  revoke(userId: number, deviceId: string) {
    return Number(
      gatewayDatabase()
        .prepare(
          `UPDATE android_devices SET is_active = 0, updated_at = ?
           WHERE id = ? AND user_id = ? AND is_active = 1`,
        )
        .run(new Date().toISOString(), deviceId, userId).changes,
    );
  },

  updateFcmToken(deviceId: string, userId: number, fcmToken: string) {
    const now = new Date().toISOString();
    return withGatewayDatabaseTransaction((db) => {
      const fcmTokenHash = hashToken(fcmToken);
      db.prepare(
        `UPDATE android_devices SET is_active = 0, updated_at = ?
         WHERE user_id = ? AND fcm_token_hash = ? AND id <> ? AND is_active = 1`,
      ).run(now, userId, fcmTokenHash, deviceId);
      const result = db
        .prepare(
          `UPDATE android_devices
         SET fcm_token_hash = ?, encrypted_fcm_token = ?, updated_at = ?, last_seen_at = ?
         WHERE id = ? AND user_id = ? AND is_active = 1`,
        )
        .run(fcmTokenHash, encryptJson({ fcmToken }), now, now, deviceId, userId);
      return Number(result.changes) > 0;
    });
  },

  prepareNotification(deviceId: string, notification: ServerNotification) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + NOTIFICATION_REPLY_DAYS * 86_400_000).toISOString();
    const target = notification.target;
    gatewayDatabase()
      .prepare(
        `INSERT INTO android_notifications
          (device_id, notification_key, target_kind, host_id, project_id, thread_id, monitor_id,
           title, body, reply_allowed, delivery_status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(device_id, notification_key) DO UPDATE SET
           title = excluded.title,
           body = excluded.body,
           expires_at = excluded.expires_at`,
      )
      .run(
        deviceId,
        notification.key,
        target.kind,
        target.hostId,
        target.projectId,
        target.threadId,
        target.kind === "tmuxMonitor" ? target.monitorId : null,
        notification.title,
        notification.body,
        androidReplyAllowed(notification) ? 1 : 0,
        now.toISOString(),
        expiresAt,
      );
  },

  notificationWasSent(deviceId: string, notificationKey: string) {
    const row = gatewayDatabase()
      .prepare(
        `SELECT 1 FROM android_notifications
         WHERE device_id = ? AND notification_key = ? AND delivery_status = 'sent'`,
      )
      .get(deviceId, notificationKey);
    return row !== undefined;
  },

  markNotificationSent(deviceId: string, notificationKey: string) {
    gatewayDatabase()
      .prepare(
        `UPDATE android_notifications
         SET delivery_status = 'sent', delivery_error = NULL, sent_at = ?
         WHERE device_id = ? AND notification_key = ?`,
      )
      .run(new Date().toISOString(), deviceId, notificationKey);
  },

  markNotificationFailed(deviceId: string, notificationKey: string, error: string) {
    gatewayDatabase()
      .prepare(
        `UPDATE android_notifications
         SET delivery_status = 'failed', delivery_error = ?
         WHERE device_id = ? AND notification_key = ?`,
      )
      .run(error.slice(0, 500), deviceId, notificationKey);
  },

  replyContext(device: AndroidDevice, notificationKey: string): AndroidReplyContext | null {
    const parsed = androidNotificationRowSchema.safeParse(
      gatewayDatabase()
        .prepare(
          `SELECT * FROM android_notifications
         WHERE device_id = ? AND notification_key = ? AND delivery_status = 'sent'`,
        )
        .get(device.id, notificationKey),
    );
    if (!parsed.success || Date.parse(parsed.data.expires_at) <= Date.now()) return null;
    const row = parsed.data;
    return {
      deviceId: row.device_id,
      userId: device.userId,
      notificationKey: row.notification_key,
      target: targetFromRow(row),
      expiresAt: row.expires_at,
      repliedAt: row.replied_at,
      replyAllowed: Number(row.reply_allowed) === 1,
    };
  },

  claimReply(deviceId: string, notificationKey: string, clientMessageId: string) {
    return withGatewayDatabaseTransaction((db) => {
      const parsed = replyStatusRowSchema.safeParse(
        db
          .prepare(
            `SELECT status FROM android_reply_requests
           WHERE device_id = ? AND client_message_id = ?`,
          )
          .get(deviceId, clientMessageId),
      );
      const existing = parsed.success ? parsed.data : undefined;
      if (existing?.status === "failed") {
        db.prepare(
          `UPDATE android_reply_requests
           SET status = 'processing', error = NULL, updated_at = ?
           WHERE device_id = ? AND client_message_id = ?`,
        ).run(new Date().toISOString(), deviceId, clientMessageId);
        return "new";
      }
      if (existing !== undefined) return existing.status;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO android_reply_requests
          (device_id, client_message_id, notification_key, status, created_at, updated_at)
         VALUES (?, ?, ?, 'processing', ?, ?)`,
      ).run(deviceId, clientMessageId, notificationKey, now, now);
      return "new";
    });
  },

  completeReply(deviceId: string, notificationKey: string, clientMessageId: string) {
    const now = new Date().toISOString();
    withGatewayDatabaseTransaction((db) => {
      db.prepare(
        `UPDATE android_reply_requests
         SET status = 'accepted', error = NULL, updated_at = ?
         WHERE device_id = ? AND client_message_id = ?`,
      ).run(now, deviceId, clientMessageId);
      db.prepare(
        `UPDATE android_notifications SET replied_at = ?
         WHERE device_id = ? AND notification_key = ?`,
      ).run(now, deviceId, notificationKey);
    });
  },

  failReply(deviceId: string, clientMessageId: string, error: string) {
    gatewayDatabase()
      .prepare(
        `UPDATE android_reply_requests
         SET status = 'failed', error = ?, updated_at = ?
         WHERE device_id = ? AND client_message_id = ?`,
      )
      .run(error.slice(0, 500), new Date().toISOString(), deviceId, clientMessageId);
  },
};

function deviceFromRow(row: AndroidDeviceRow): AndroidDevice {
  const decrypted = encryptedFcmTokenSchema.parse(decryptJson(row.encrypted_fcm_token));
  return {
    id: row.id,
    userId: Number(row.user_id),
    name: row.name,
    fcmToken: decrypted.fcmToken,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function androidReplyAllowed(notification: ServerNotification) {
  return (
    notification.target.kind === "thread" &&
    (notification.key.startsWith("thread-terminal:") || notification.key.startsWith("thread-goal:"))
  );
}

function targetFromRow(row: AndroidNotificationRow): ServerNotificationTarget {
  if (row.target_kind === "thread") {
    if (row.thread_id === null) throw new Error("Thread notification is missing a thread id");
    return {
      kind: "thread",
      hostId: Number(row.host_id),
      projectId: row.project_id === null ? null : Number(row.project_id),
      threadId: row.thread_id,
    };
  }
  return {
    kind: "tmuxMonitor",
    hostId: Number(row.host_id),
    projectId: row.project_id === null ? null : Number(row.project_id),
    threadId: row.thread_id,
    monitorId: row.monitor_id ?? 0,
  };
}
