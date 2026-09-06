import { authenticatePeer } from "./handlers/auth";
import { subscribeHostLifecycle, unsubscribeHostLifecycle } from "./handlers/host-lifecycle";
import {
  activateThread,
  startThread,
  subscribeThread,
  unsubscribeThread,
} from "./handlers/thread-events";
import { clearThreadGoal, getThreadGoal, setThreadGoal } from "./handlers/thread-goals";
import { loadThreadTurns } from "./handlers/thread-turn-pages";
import {
  closeTerminal,
  listTerminals,
  openTerminal,
  resizeTerminal,
  writeTerminalInput,
} from "./handlers/terminal";
import {
  interruptTurn,
  ping,
  respondToServerRequest,
  startTurn,
  steerTurn,
} from "./handlers/turns";
import { RealtimeMessageDispatcher } from "./message-dispatcher";
import {
  allowInsecureBrowserPreviewTls,
  closeBrowserPreview,
  openBrowserPreview,
} from "./handlers/browser-preview";
import { subscribeHostMetrics, unsubscribeHostMetrics } from "./handlers/host-metrics";
import {
  refreshTmuxSessions,
  subscribeTmuxSessions,
  unsubscribeTmuxSessions,
} from "./handlers/tmux-sessions";
import { compareGitFile, inspectGitWorkspace } from "./handlers/file-git";

export const realtimeMessageDispatcher = new RealtimeMessageDispatcher({
  "auth.authenticate": { auth: "public", handler: authenticatePeer },
  "host.lifecycle.subscribe": subscribeHostLifecycle,
  "host.lifecycle.unsubscribe": unsubscribeHostLifecycle,
  "host.metrics.subscribe": subscribeHostMetrics,
  "host.metrics.unsubscribe": unsubscribeHostMetrics,
  "tmux.sessions.subscribe": subscribeTmuxSessions,
  "tmux.sessions.refresh": refreshTmuxSessions,
  "tmux.sessions.unsubscribe": unsubscribeTmuxSessions,
  "thread.activate": activateThread,
  "thread.start": startThread,
  "thread.subscribe": subscribeThread,
  "thread.unsubscribe": unsubscribeThread,
  "thread.turns.load": loadThreadTurns,
  "thread.goal.set": setThreadGoal,
  "thread.goal.get": getThreadGoal,
  "thread.goal.clear": clearThreadGoal,
  "turn.start": startTurn,
  "turn.steer": steerTurn,
  "turn.interrupt": interruptTurn,
  "serverRequest.respond": respondToServerRequest,
  "terminal.open": openTerminal,
  "terminal.list": listTerminals,
  "terminal.input": writeTerminalInput,
  "terminal.resize": resizeTerminal,
  "terminal.close": closeTerminal,
  "browser.open": openBrowserPreview,
  "browser.close": closeBrowserPreview,
  "browser.allowInsecureTls": allowInsecureBrowserPreviewTls,
  "file.git.compare": compareGitFile,
  "file.git.workspace.inspect": inspectGitWorkspace,
  ping,
});
