import { createHash } from "node:crypto";
import { gatewayDatabase, withGatewayDatabaseTransaction } from "../storage/database";

export type SupervisorMessageClaim = "new" | "accepted" | "processing" | "conflict";

export const supervisorMessageRequestStore = {
  claim(grantId: string, clientMessageId: string, text: string): SupervisorMessageClaim {
    const fingerprint = textFingerprint(text);
    return withGatewayDatabaseTransaction((database) => {
      const existing = database
        .prepare(
          `
            SELECT text_sha256, text_length, status
            FROM supervisor_message_requests
            WHERE grant_id = ? AND client_message_id = ?
          `,
        )
        .get(grantId, clientMessageId);
      if (existing !== undefined) {
        if (
          String(existing.text_sha256) !== fingerprint.sha256 ||
          Number(existing.text_length) !== fingerprint.length
        ) {
          return "conflict";
        }
        const status = String(existing.status);
        if (status === "accepted" || status === "processing") return status;
        database
          .prepare(
            `
              UPDATE supervisor_message_requests
              SET status = 'processing', turn_id = NULL, updated_at = ?
              WHERE grant_id = ? AND client_message_id = ?
            `,
          )
          .run(new Date().toISOString(), grantId, clientMessageId);
        return "new";
      }

      const now = new Date().toISOString();
      database
        .prepare(
          `
            INSERT INTO supervisor_message_requests
              (grant_id, client_message_id, text_sha256, text_length, status,
               turn_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'processing', NULL, ?, ?)
          `,
        )
        .run(grantId, clientMessageId, fingerprint.sha256, fingerprint.length, now, now);
      return "new";
    });
  },

  accept(grantId: string, clientMessageId: string, turnId: string | null) {
    gatewayDatabase()
      .prepare(
        `
          UPDATE supervisor_message_requests
          SET status = 'accepted', turn_id = ?, updated_at = ?
          WHERE grant_id = ? AND client_message_id = ?
        `,
      )
      .run(turnId, new Date().toISOString(), grantId, clientMessageId);
  },

  fail(grantId: string, clientMessageId: string) {
    gatewayDatabase()
      .prepare(
        `
          UPDATE supervisor_message_requests
          SET status = 'failed', turn_id = NULL, updated_at = ?
          WHERE grant_id = ? AND client_message_id = ?
        `,
      )
      .run(new Date().toISOString(), grantId, clientMessageId);
  },
};

function textFingerprint(text: string) {
  return {
    sha256: createHash("sha256").update(text).digest("hex"),
    length: Buffer.byteLength(text, "utf8"),
  };
}
