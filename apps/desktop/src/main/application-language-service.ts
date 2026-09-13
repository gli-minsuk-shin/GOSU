import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  AppLanguageSchema,
  ApplicationLanguagePreferenceSchema,
  DEFAULT_APP_LANGUAGE,
  applyApplicationLanguageInstructions,
  type ApplicationLanguagePreference,
} from '@gosu/contracts';

const unconfigured = (): ApplicationLanguagePreference => ({
  language: DEFAULT_APP_LANGUAGE,
  configured: false,
});

/** Standalone Model Lab and Electron resolve the same user-owned preference file. */
export function defaultApplicationLanguagePath() {
  const root =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.platform === 'win32'
        ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
        : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'));
  return join(root, '@gosu', 'desktop', 'application-language.json');
}

export class ApplicationLanguageService {
  constructor(
    private readonly path: string | (() => string) = defaultApplicationLanguagePath,
    private readonly onChanged?: (preference: ApplicationLanguagePreference) => void,
  ) {}

  private filename() {
    return typeof this.path === 'function' ? this.path() : this.path;
  }

  get(): ApplicationLanguagePreference {
    try {
      return ApplicationLanguagePreferenceSchema.parse(
        JSON.parse(readFileSync(this.filename(), 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return unconfigured();
      throw new Error('application_language_preference_invalid', { cause: error });
    }
  }

  set(value: unknown): ApplicationLanguagePreference {
    const language = AppLanguageSchema.parse(value);
    const preference = { language, configured: true } as const;
    const filename = this.filename();
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(preference), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, filename);
    } finally {
      rmSync(temporary, { force: true });
    }
    try {
      this.onChanged?.(preference);
    } catch {
      // The atomic write already committed. A closed renderer must not turn the
      // durable receipt into a failed save; polling/reload reconciles the UI.
    }
    return preference;
  }
}

export const applicationLanguageContext = new AsyncLocalStorage<ApplicationLanguagePreference>();
let defaultService: ApplicationLanguageService | undefined;

/** Configure only at the trusted process entrypoint; tests/isolated transports default to legacy. */
export function configureApplicationLanguageService(service: ApplicationLanguageService) {
  defaultService = service;
}

export function applicationLanguageSnapshot(): ApplicationLanguagePreference {
  return applicationLanguageContext.getStore() ?? defaultService?.get() ?? unconfigured();
}

export function withApplicationLanguageInstructions(instructions: string) {
  return applyApplicationLanguageInstructions(instructions, applicationLanguageSnapshot());
}

/** Provider notifications arrive outside the original request async context. */
export function bindApplicationLanguageCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const preference = applicationLanguageSnapshot();
  return (...args) => applicationLanguageContext.run(preference, () => callback(...args));
}
