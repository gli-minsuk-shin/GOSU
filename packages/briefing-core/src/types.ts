import type { LiveSettings } from './live-settings.js';

export type BriefingKind = 'personal' | 'funding';
export type SourceKind =
  | 'email'
  | 'calendar'
  | 'todo'
  | 'papers'
  | 'weather'
  | 'ai-news'
  | 'news'
  | 'conference'
  | 'funding';
export type RoutineState = 'draft' | 'enabled' | 'paused';
export type BriefingSchedule = Readonly<{
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;
  anchorDate: string;
  timeZone: string;
  times: readonly string[];
  weekdays: readonly number[];
  monthDay: number;
}>;
export type InterestKeyword = Readonly<{
  term: string;
  weight: number;
  synonyms: readonly string[];
}>;
export type InterestProfile = Readonly<{
  keywords: readonly InterestKeyword[];
  excluded: readonly string[];
}>;
export type BriefingSource = Readonly<{
  id: string;
  kind: SourceKind;
  label: string;
  url?: string;
  country?: string;
  origin: 'fixture' | 'user';
}>;
export type BriefingRoutine = Readonly<{
  id: string;
  name: string;
  suggestedQuestions?: readonly string[] | undefined;
  kind: BriefingKind;
  state: RoutineState;
  schedule: BriefingSchedule;
  interest: InterestProfile;
  sources: readonly BriefingSource[];
  countries: readonly string[];
  sectionOrder?: readonly SourceKind[] | undefined;
  live?: LiveSettings | undefined;
  createdAt: string;
  updatedAt: string;
}>;
export type ScheduleOccurrence = Readonly<{
  scheduledFor: string;
  localDate: string;
  localTime: string;
  adjustment: 'none' | 'month-end' | 'dst-gap';
}>;
export type BriefingEvidence = Readonly<{
  id: string;
  sourceId: string;
  kind: SourceKind;
  title: string;
  abstract: string;
  summary: string;
  publishedAt: string;
  deadline?: string;
  url?: string;
  country?: string;
  readScope: 'fixture';
}>;
export type RankedEvidence = Readonly<{
  evidence: BriefingEvidence;
  score: number;
  matchedKeywords: readonly string[];
}>;
export type BriefingRun = Readonly<{
  id: string;
  routineId: string;
  routineName: string;
  scheduledFor: string;
  completedAt: string;
  mode: 'fixture';
  status: 'ready' | 'partial' | 'failed';
  items: readonly RankedEvidence[];
  hiddenItemIds: readonly string[];
  sourceResults: readonly {
    sourceId: string;
    label: string;
    status: 'ready' | 'unsupported';
    count: number;
  }[];
  progress: readonly { stage: 'collect' | 'deduplicate' | 'rank' | 'deliver'; count: number }[];
  scheduleSnapshot: BriefingSchedule;
  interestSnapshot: InterestProfile;
  sectionOrderSnapshot?: readonly SourceKind[] | undefined;
}>;
export type BriefingWorkspace = Readonly<{
  schemaVersion: 1;
  routines: readonly BriefingRoutine[];
  runs: readonly BriefingRun[];
  selectedRoutineId: string;
}>;
