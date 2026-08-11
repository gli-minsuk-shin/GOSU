import { createHash } from 'node:crypto';

import { parser } from '@lezer/python';

const POLICY_VERSION = 1;
const ALLOWED_IMPORTS = [
  'collections',
  'decimal',
  'fractions',
  'functools',
  'itertools',
  'json',
  'math',
  'numpy',
  're',
  'sklearn.metrics',
  'statistics',
  'typing',
] as const;

const FORBIDDEN_IDENTIFIERS = [
  '__import__',
  'asyncio',
  'breakpoint',
  'chmod',
  'chown',
  'compile',
  'ctypes',
  'ctypeslib',
  'delattr',
  'dir',
  'dump',
  'dumpsys',
  'eval',
  'exec',
  'execfile',
  'exit',
  'fork',
  'fromfile',
  'ftplib',
  'genfromtxt',
  'getattr',
  'globals',
  'help',
  'http',
  'importlib',
  'input',
  'io',
  'load',
  'loadtxt',
  'loads_pickle',
  'locals',
  'marshal',
  'memmap',
  'mkdir',
  'multiprocessing',
  'npyio',
  'open',
  'os',
  'pathlib',
  'pickle',
  'popen',
  'quit',
  'read',
  'remove',
  'rename',
  'replace',
  'requests',
  'rmdir',
  'save',
  'savetxt',
  'savez',
  'savez_compressed',
  'setattr',
  'shelve',
  'shutil',
  'socket',
  'spawn',
  'subprocess',
  'symlink',
  'sys',
  'tempfile',
  'threading',
  'tofile',
  'unlink',
  'urllib',
  'vars',
  'write',
  'yaml',
] as const;

const policyDescriptor = {
  schemaVersion: 1,
  policyVersion: POLICY_VERSION,
  allowedImports: ALLOWED_IMPORTS,
  forbiddenIdentifiers: FORBIDDEN_IDENTIFIERS,
  rejectDunderIdentifiers: true,
  executionAuthorization: false,
} as const;

export const EXPERIMENT_EVALUATION_CODE_POLICY_HASH = createHash('sha256')
  .update(JSON.stringify(policyDescriptor), 'utf8')
  .digest('hex');

const allowedImports = new Set<string>(ALLOWED_IMPORTS);
const forbiddenIdentifiers = new Set<string>(FORBIDDEN_IDENTIFIERS);

export class ExperimentEvaluationCodePolicyError extends Error {
  constructor() {
    super('experiment_evaluation_reference_code_rejected');
    this.name = 'ExperimentEvaluationCodePolicyError';
  }
}

function importAllowed(moduleName: string) {
  return [...allowedImports].some(
    (allowed) => moduleName === allowed || moduleName.startsWith(`${allowed}.`),
  );
}

function validateImportStatement(statement: string) {
  const normalized = statement
    .replace(/#[^\n]*/gu, '')
    .replace(/\\\s*\n/gu, ' ')
    .trim();
  const direct = /^import\s+(.+)$/u.exec(normalized);
  if (direct) {
    const modules = direct[1]!.split(',').map((part) => part.trim());
    if (
      modules.length === 0 ||
      modules.some((part) => {
        const match = /^([A-Za-z_][A-Za-z0-9_.]*)(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?$/u.exec(part);
        return !match || !importAllowed(match[1]!);
      })
    ) {
      throw new ExperimentEvaluationCodePolicyError();
    }
    return;
  }
  const from = /^from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\s+(.+)$/u.exec(normalized);
  if (!from || !importAllowed(from[1]!) || from[2]!.includes('*')) {
    throw new ExperimentEvaluationCodePolicyError();
  }
}

export function validateExperimentEvaluationReferenceCode(source: string) {
  if (source.includes('\0')) throw new ExperimentEvaluationCodePolicyError();
  const tree = parser.parse(source);
  const cursor = tree.cursor();
  for (;;) {
    if (cursor.type.isError) throw new ExperimentEvaluationCodePolicyError();
    if (cursor.name === 'ImportStatement') {
      validateImportStatement(source.slice(cursor.from, cursor.to));
    }
    if (cursor.name === 'VariableName' || cursor.name === 'PropertyName') {
      const identifier = source.slice(cursor.from, cursor.to);
      if (
        identifier.includes('__') ||
        forbiddenIdentifiers.has(identifier.toLocaleLowerCase('en-US'))
      ) {
        throw new ExperimentEvaluationCodePolicyError();
      }
    }
    if (cursor.firstChild()) continue;
    while (!cursor.nextSibling()) {
      if (!cursor.parent()) {
        return {
          schemaVersion: 1 as const,
          policyVersion: POLICY_VERSION,
          policyHash: EXPERIMENT_EVALUATION_CODE_POLICY_HASH,
          executionAuthorized: false as const,
        };
      }
    }
  }
}
