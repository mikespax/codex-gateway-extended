import type { ProjectRecord } from "./sidebar-types";

export interface NewThreadProjectActivity {
  hostId: number;
  projectId: number | null;
  cwd: string | null;
  updatedAt: number;
  isSubAgent: boolean;
}

/**
 * Pick the configured project directory to use when the global new-thread host switcher is used.
 * The current project remains the least surprising choice for the currently selected host. For a
 * different host, use the most recently active configured project, then its first project.
 */
export function selectNewThreadProject(input: {
  hostId: number;
  selectedHostId: number | null;
  selectedProjectId: number | null;
  projects: readonly ProjectRecord[];
  activity: readonly NewThreadProjectActivity[];
}) {
  const hostProjects = input.projects.filter((project) => project.hostId === input.hostId);
  if (hostProjects.length === 0) return null;

  if (input.selectedHostId === input.hostId && input.selectedProjectId !== null) {
    const selectedProject = hostProjects.find((project) => project.id === input.selectedProjectId);
    if (selectedProject !== undefined) return selectedProject;
  }

  const projectById = new Map(hostProjects.map((project) => [project.id, project]));
  const projectByPath = new Map(hostProjects.map((project) => [project.remotePath, project]));
  const mostRecentActivityByProject = new Map<number, number>();

  for (const record of input.activity) {
    if (record.hostId !== input.hostId || record.isSubAgent) continue;
    const project =
      (record.projectId === null ? undefined : projectById.get(record.projectId)) ??
      (record.cwd === null ? undefined : projectByPath.get(record.cwd));
    if (project === undefined) continue;
    const previous = mostRecentActivityByProject.get(project.id) ?? 0;
    if (record.updatedAt > previous) mostRecentActivityByProject.set(project.id, record.updatedAt);
  }

  let mostRecentProject: ProjectRecord | undefined;
  let mostRecentAt = -1;
  for (const project of hostProjects) {
    const activityAt = mostRecentActivityByProject.get(project.id);
    if (activityAt === undefined || activityAt <= mostRecentAt) continue;
    mostRecentProject = project;
    mostRecentAt = activityAt;
  }
  return mostRecentProject ?? hostProjects[0];
}
