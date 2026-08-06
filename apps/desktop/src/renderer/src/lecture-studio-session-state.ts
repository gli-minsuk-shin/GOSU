export interface LectureStudioDraftStore {
  read: (studioId: string) => string;
  write: (studioId: string, draft: string) => void;
}

/**
 * Keeps unsent Lecture Studio text only for the lifetime of the open renderer session.
 * Drafts deliberately never enter localStorage, SQLCipher, Hosted Sync, or telemetry.
 */
export class VolatileLectureStudioDrafts implements LectureStudioDraftStore {
  private readonly drafts = new Map<string, string>();

  read(studioId: string) {
    return this.drafts.get(studioId) ?? '';
  }

  write(studioId: string, draft: string) {
    if (draft === '') {
      this.drafts.delete(studioId);
      return;
    }
    this.drafts.set(studioId, draft);
  }
}
