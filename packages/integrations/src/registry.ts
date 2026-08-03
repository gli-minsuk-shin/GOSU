import type { ConnectorCapabilities, ConnectorDescriptor } from '@gosu/contracts';

const connector = (
  connectorId: string,
  displayName: string,
  capabilities: ConnectorCapabilities,
): ConnectorDescriptor => ({ schemaVersion: 1, connectorId, displayName, capabilities });

export const connectorRegistry = {
  github: connector('github', 'GitHub', {
    read: true,
    write: true,
    attachments: false,
    realtime: true,
    export: true,
  }),
  zotero: connector('zotero', 'Zotero', {
    read: true,
    write: false,
    attachments: false,
    realtime: false,
    export: true,
  }),
  obsidian: connector('obsidian', 'Obsidian', {
    read: true,
    write: false,
    attachments: true,
    realtime: false,
    export: true,
  }),
  overleaf: connector('overleaf', 'Overleaf', {
    read: false,
    write: false,
    attachments: true,
    realtime: false,
    export: true,
  }),
} as const;

export type ConnectorId = keyof typeof connectorRegistry;

export function getConnectorDescriptor(id: ConnectorId) {
  return connectorRegistry[id];
}
