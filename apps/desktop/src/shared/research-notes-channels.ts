export const RESEARCH_NOTES_IPC_CHANNELS = Object.freeze({
  current: 'gosu:research-notes:current',
  chooseVault: 'gosu:research-notes:choose-vault',
  read: 'gosu:research-notes:read',
  readAttachment: 'gosu:research-notes:read-attachment',
  syncLiterature: 'gosu:research-notes:sync-literature',
  createPaperNote: 'gosu:research-notes:create-paper-note',
} as const);
