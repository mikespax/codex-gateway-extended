import { registerGatewayDomainSubscribers } from "@/stores/gateway/domain-subscribers";

export default defineNuxtPlugin(() => {
  registerGatewayDomainSubscribers();
});
