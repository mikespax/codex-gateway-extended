import type { HostRecord } from "~~/shared/types";

export function hostRuntimeFingerprint(host: HostRecord) {
  return JSON.stringify({
    sshHost: host.sshHost,
    username: host.username,
    port: host.port,
    authMode: host.authMode,
    privateKeyPath: host.privateKeyPath,
    privateKey: host.privateKey,
    password: host.password,
    proxyUrl: host.proxyUrl,
  });
}
