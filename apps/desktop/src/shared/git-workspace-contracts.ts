import { z } from 'zod';

const uuidSchema = z.string().uuid();
const fullObjectIdSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/u);

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

export const GitRelativePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (value) => !hasControlCharacter(value) && !value.startsWith('/'),
    'Relative path required',
  )
  .refine(
    (value) =>
      value
        .split('/')
        .every((component) => component !== '' && component !== '.' && component !== '..'),
    'Unsafe path component',
  );

const gitRefNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      !hasControlCharacter(value) &&
      ![' ', '~', '^', ':', '?', '*', '[', '\\'].some((character) => value.includes(character)),
  )
  .refine(
    (value) =>
      value !== '@' &&
      !value.startsWith('-') &&
      !value.includes('..') &&
      !value.includes('@{') &&
      !value.includes('//') &&
      !value.endsWith('.') &&
      !value.endsWith('/') &&
      !value.endsWith('.lock') &&
      value.split('/').every((component) => component !== '' && !component.startsWith('.')),
    'Invalid branch name',
  );

export const GitBranchNameSchema = gitRefNameSchema.max(200);
export const GitExistingBranchNameSchema = gitRefNameSchema.max(1_024);

export const GitProjectInputSchema = z.object({ projectId: uuidSchema }).strict();

export const GitHeadCommandSchema = GitProjectInputSchema.extend({
  expectedHead: fullObjectIdSchema.nullable(),
  expectedBranch: GitExistingBranchNameSchema.nullable(),
}).strict();

export const GitFileInputSchema = GitProjectInputSchema.extend({
  path: GitRelativePathSchema,
}).strict();

export const GitDiffInputSchema = GitFileInputSchema.extend({ staged: z.boolean() }).strict();

export const GitCommitDetailInputSchema = GitProjectInputSchema.extend({
  commitSha: fullObjectIdSchema,
}).strict();

export const GitPathsCommandSchema = GitHeadCommandSchema.extend({
  paths: z.array(GitRelativePathSchema).min(1).max(100),
}).strict();

export const GitCommitInputSchema = GitHeadCommandSchema.extend({
  expectedIndexFingerprint: fingerprintSchema,
  summary: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4_000).optional(),
}).strict();

export const GitCreateBranchInputSchema = GitHeadCommandSchema.extend({
  name: GitBranchNameSchema,
}).strict();

export const GitSwitchBranchInputSchema = GitHeadCommandSchema.extend({
  name: GitExistingBranchNameSchema,
}).strict();

export type GitProjectInput = z.infer<typeof GitProjectInputSchema>;
export type GitHeadCommand = z.infer<typeof GitHeadCommandSchema>;
export type GitFileInput = z.infer<typeof GitFileInputSchema>;
export type GitDiffInput = z.infer<typeof GitDiffInputSchema>;
export type GitCommitDetailInput = z.infer<typeof GitCommitDetailInputSchema>;
export type GitPathsCommand = z.infer<typeof GitPathsCommandSchema>;
export type GitCommitInput = z.infer<typeof GitCommitInputSchema>;
export type GitCreateBranchInput = z.infer<typeof GitCreateBranchInputSchema>;
export type GitSwitchBranchInput = z.infer<typeof GitSwitchBranchInputSchema>;

export type GitFileEntry = Readonly<{
  path: string;
  kind: 'file' | 'symlink' | 'submodule';
}>;

export type GitChange = Readonly<{
  path: string;
  originalPath?: string | undefined;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  conflict: boolean;
}>;

export type GitBranch = Readonly<{
  name: string;
  current: boolean;
  upstream?: string | undefined;
  ahead: number;
  behind: number;
  headSha: string;
  lastCommitAt: string;
  lastCommitSubject: string;
}>;

export type GitCommit = Readonly<{
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  authoredAt: string;
  refs: readonly string[];
}>;

export type GitRepositoryState = Readonly<{
  repository: string;
  githubUrl: string;
  currentBranch: string | null;
  detachedHead: boolean;
  headSha: string | null;
  indexFingerprint: string;
  upstream?: string | undefined;
  ahead: number;
  behind: number;
  dirty: boolean;
  files: readonly GitFileEntry[];
  filesTruncated: boolean;
  changes: readonly GitChange[];
  branches: readonly GitBranch[];
  commits: readonly GitCommit[];
  historyTruncated: boolean;
}>;

export type GitWorkspaceSnapshot = Readonly<{
  schemaVersion: 1;
  projectId: string;
  repository: string | null;
  cloned: boolean;
  state?: GitRepositoryState | undefined;
}>;

export type GitFilePreview = Readonly<{
  path: string;
  sizeBytes: number;
  renderMode: 'markdown' | 'text';
  content: string;
  truncated: boolean;
}>;

export type GitTextPreview = Readonly<{
  content: string;
  truncated: boolean;
}>;
