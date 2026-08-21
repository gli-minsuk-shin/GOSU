export const LITERATURE_IPC_CHANNELS = {
  list: 'gosu:literature:list',
  search: 'gosu:literature:search',
  updateAnnotations: 'gosu:literature:update-annotations',
  deleteRecord: 'gosu:literature:delete-record',
  importRecords: 'gosu:literature:import-records',
  exportRecords: 'gosu:literature:export-records',
  organize: 'gosu:literature:organize',
  cancelOrganize: 'gosu:literature:cancel-organize',
} as const;
