export class LectureStudioStorageError extends Error {
  constructor(readonly code: 'capacity_reached') {
    super(`lecture_${code}`);
    this.name = 'LectureStudioStorageError';
  }
}
