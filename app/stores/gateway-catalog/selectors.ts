import type { HostRecord, ProjectRecord } from "~~/shared/types";

export function hostById(hosts: HostRecord[], hostId: number | null) {
  return hostId === null ? null : (hosts.find((host) => host.id === hostId) ?? null);
}

export function projectById(projects: ProjectRecord[], projectId: number | null) {
  return projectId === null ? null : (projects.find((project) => project.id === projectId) ?? null);
}
