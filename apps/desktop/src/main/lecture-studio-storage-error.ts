export class LectureStudioStorageError extends Error {
  constructor(readonly code: 'capacity_reached' | 'trash_changed') {
    super(`lecture_${code}`);
    this.name = 'LectureStudioStorageError';
  }
}
