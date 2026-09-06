import { test as base, type Page } from "@playwright/test";
import {
  addRemoteHost,
  addRemoteProject,
  readRemoteEnv,
  sendImageTurnThroughGateway,
  startRemoteThreadFromProjectMenu,
  type RemoteCodexEnv,
  type UiHost,
  type UiProject,
} from "../helpers/remote-codex";

interface ProvisionRemoteWorkspaceOptions {
  hostName?: string;
  projectName?: string;
  remotePath?: string;
}

export interface RemoteWorkspaceFixture {
  readonly remote: RemoteCodexEnv;
  addHost(name?: string): Promise<UiHost>;
  addProject(hostId: number, name?: string, remotePath?: string): Promise<UiProject>;
  startThread(projectId: number): Promise<string>;
  sendImageTurn(
    targetPage: Page,
    params: {
      hostId: number;
      threadId: string;
      cwd: string;
      imagePath: string;
      marker: string;
    },
  ): Promise<void>;
  provision(options?: ProvisionRemoteWorkspaceOptions): Promise<{
    host: UiHost;
    project: UiProject;
  }>;
}

interface RemoteWorkspaceTestFixtures {
  remoteWorkspace: RemoteWorkspaceFixture;
}

interface RemoteWorkspaceWorkerFixtures {
  remoteCodexEnvironment: RemoteCodexEnv;
}

export const test = base.extend<RemoteWorkspaceTestFixtures, RemoteWorkspaceWorkerFixtures>({
  // The Docker topology writes one immutable environment file per worker run. Parsing it once at
  // worker scope avoids repeated filesystem plumbing without sharing browser or Gateway state
  // between tests; Host and Project creation remain test-scoped operations against the real UI.
  remoteCodexEnvironment: [
    async ({ browserName: _browserName }, use) => await use(await readRemoteEnv()),
    { scope: "worker" },
  ],

  remoteWorkspace: async ({ page, remoteCodexEnvironment }, use) => {
    const addHost = async (name?: string) =>
      await addRemoteHost(page, remoteCodexEnvironment, name);
    const addProject = async (hostId: number, name?: string, remotePath?: string) =>
      await addRemoteProject(page, remoteCodexEnvironment, hostId, name, remotePath);

    await use({
      remote: remoteCodexEnvironment,
      addHost,
      addProject,
      startThread: async (projectId) =>
        await startRemoteThreadFromProjectMenu(page, remoteCodexEnvironment, projectId),
      sendImageTurn: async (targetPage, params) =>
        await sendImageTurnThroughGateway(targetPage, remoteCodexEnvironment, params),
      async provision(options = {}) {
        const host = await addHost(options.hostName);
        const project = await addProject(host.id, options.projectName, options.remotePath);
        return { host, project };
      },
    });
  },
});

export { expect } from "@playwright/test";
