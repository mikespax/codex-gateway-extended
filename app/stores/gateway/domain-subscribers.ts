import { registerGatewayLifecycleSubscribers } from "./domain-subscribers/gateway-lifecycle";
import { registerHistoryProjectionSubscribers } from "./domain-subscribers/history-projections";
import { registerRealtimeResourceSubscribers } from "./domain-subscribers/realtime-resources";
import { registerThreadProjectionSubscribers } from "./domain-subscribers/thread-projections";

let subscribersRegistered = false;

export function registerGatewayDomainSubscribers() {
  if (subscribersRegistered) return;
  subscribersRegistered = true;

  registerGatewayLifecycleSubscribers();
  registerRealtimeResourceSubscribers();
  registerThreadProjectionSubscribers();
  registerHistoryProjectionSubscribers();
}
