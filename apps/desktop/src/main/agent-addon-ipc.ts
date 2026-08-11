import { AGENT_ADD_ON_CHANNELS } from '../shared/agent-addon-channels';
import {
  parseAgentAddOnStatusRequest,
  parseConnectAgentAddOnRequest,
  parseDisconnectAgentAddOnRequest,
} from '../shared/agent-addon-contracts';
import type { AgentAddOnRegistry } from './agent-addon-service';

type RegisterHandler = (channel: string, listener: (...arguments_: unknown[]) => unknown) => void;

export function registerAgentAddOnIpc(register: RegisterHandler, registry: AgentAddOnRegistry) {
  register(AGENT_ADD_ON_CHANNELS.status, (input) => {
    const request = parseAgentAddOnStatusRequest(input);
    return registry.statuses(request.ids);
  });
  register(AGENT_ADD_ON_CHANNELS.connect, (input) => {
    const request = parseConnectAgentAddOnRequest(input);
    return registry.connect(request.id);
  });
  register(AGENT_ADD_ON_CHANNELS.disconnect, (input) => {
    const request = parseDisconnectAgentAddOnRequest(input);
    return registry.disconnect(request.id);
  });
}
