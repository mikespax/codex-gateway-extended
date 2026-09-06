import { gatewayDatabase } from "../storage/database";
import { hashToken } from "../storage/crypto";

export const SUPERVISOR_PERMISSIONS = [
  "thread.history.read",
  "thread.events.read",
  "thread.projectManagement.send",
] as const;

export type SupervisorPermission = (typeof SUPERVISOR_PERMISSIONS)[number];

export interface SupervisorGrant {
  id: string;
  userId: number;
  username: string;
  hostId: number;
  projectId: number | null;
  threadId: string;
  label: string;
  permissions: SupervisorPermission[];
  persistent: boolean;
  expiresAt: string | null;
}

export const supervisorGrantStore = {
  authenticate(token: string): SupervisorGrant | null {
    if (token === "" || token.length > 256) return null;
    const row = gatewayDatabase()
      .prepare(
        `
          SELECT supervisor_grants.id,
                 supervisor_grants.user_id,
                 supervisor_grants.host_id,
                 supervisor_grants.project_id,
                 supervisor_grants.thread_id,
                 supervisor_grants.label,
                 supervisor_grants.permissions_json,
                 supervisor_grants.is_persistent,
                 supervisor_grants.expires_at,
                 users.username,
                 users.is_active
          FROM supervisor_grants
          JOIN users ON users.id = supervisor_grants.user_id
          WHERE supervisor_grants.token_hash = ?
            AND supervisor_grants.revoked_at IS NULL
        `,
      )
      .get(hashToken(token));
    if (row === undefined || Number(row.is_active) !== 1) return null;
    const persistent = Number(row.is_persistent) === 1;
    if (!persistent && Date.parse(String(row.expires_at)) <= Date.now()) return null;
    const permissions = parsePermissions(row.permissions_json);
    if (permissions.length === 0) return null;

    const now = new Date().toISOString();
    gatewayDatabase()
      .prepare("UPDATE supervisor_grants SET last_used_at = ? WHERE id = ?")
      .run(now, String(row.id));
    return {
      id: String(row.id),
      userId: Number(row.user_id),
      username: String(row.username),
      hostId: Number(row.host_id),
      projectId: row.project_id === null ? null : Number(row.project_id),
      threadId: String(row.thread_id),
      label: String(row.label),
      permissions,
      persistent,
      expiresAt: persistent ? null : String(row.expires_at),
    };
  },
};

export function hasSupervisorPermission(grant: SupervisorGrant, permission: SupervisorPermission) {
  return grant.permissions.includes(permission);
}

function parsePermissions(value: unknown): SupervisorPermission[] {
  try {
    const parsed: unknown = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return [];
    const permissions = new Set<SupervisorPermission>();
    for (const permission of parsed) {
      if (typeof permission === "string" && isSupervisorPermission(permission)) {
        permissions.add(permission);
      }
    }
    return [...permissions].sort(
      (left, right) => SUPERVISOR_PERMISSIONS.indexOf(left) - SUPERVISOR_PERMISSIONS.indexOf(right),
    );
  } catch {
    return [];
  }
}

function isSupervisorPermission(value: string): value is SupervisorPermission {
  return (
    value === "thread.history.read" ||
    value === "thread.events.read" ||
    value === "thread.projectManagement.send"
  );
}
