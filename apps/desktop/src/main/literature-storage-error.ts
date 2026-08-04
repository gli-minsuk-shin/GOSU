export class LiteratureStorageError extends Error {
  constructor(readonly code: 'record_limit_reached' | 'identity_conflict') {
    super(code);
    this.name = 'LiteratureStorageError';
  }
}
