import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  defaultUsageLimitSettings,
  parseClaudeUsage,
  parseCodexRateLimits,
  UsageLimitSettingsSchema,
  USAGE_LIMIT_ERRORS,
  type ParsedUsageLimits,
  type ProviderUsageLimits,
  type UsageLimitError,
  type UsageLimitSettings,
  type UsageLimitStatus,
} from '../shared/usage-limit-contracts';

type ProviderId = ProviderUsageLimits['providerId'];
const PROVIDERS: readonly ProviderId[] = ['codex', 'claude-code'];
/** Below this the Claude CLI stays running between reads instead of starting for each one. */
const KEEP_ALIVE_BELOW_SECONDS = 60;
const MAX_BACKOFF_MS = 10 * 60_000;

export type UsageLimitSources = {
  /** The Codex app-server's `account/rateLimits/read`. Rejects with an Error carrying `code`. */
  codex: { read(): Promise<unknown> };
  claude: {
    /** Claude Code is an add-on the user connects in GOSU; without that nothing is asked. */
    connected(): boolean;
    read(keepAlive: boolean): Promise<unknown>;
    close(): void;
  };
};

export function usageLimitErrorCode(error: unknown): UsageLimitError {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    if ((USAGE_LIMIT_ERRORS as readonly string[]).includes(code)) return code as UsageLimitError;
    if (code === 'codex_auth_required') return 'usage_limits_auth';
    if (code === 'codex_unavailable' || code === 'codex_app_server_not_started')
      return 'usage_limits_unavailable';
  }
  const message = error instanceof Error ? error.message : '';
  if (/timed out/iu.test(message)) return 'usage_limits_timeout';
  if (/not_started|unavailable|ENOENT/iu.test(message)) return 'usage_limits_unavailable';
  if (/-32601|method not found|unknown method|unknown variant/iu.test(message))
    return 'usage_limits_unsupported';
  return 'usage_limits_failed';
}

const empty = (providerId: ProviderId): ProviderUsageLimits => ({
  providerId,
  connected: false,
  plan: null,
  windows: [],
  extraUsage: null,
  fetchedAt: null,
  error: null,
});

/**
 * Keeps the remaining subscription limits of the connected CLIs current: on a schedule the user
 * picks, only while the GOSU window is showing, one read at a time. A failed read keeps the last
 * good numbers, records a stable code and waits longer before the next attempt.
 */
export class UsageLimitService {
  private settings: UsageLimitSettings = defaultUsageLimitSettings();
  private providers = new Map<ProviderId, ProviderUsageLimits>(
    PROVIDERS.map((id) => [id, empty(id)]),
  );
  private failures = new Map<ProviderId, number>();
  private notBefore = new Map<ProviderId, number>();
  private running: Promise<UsageLimitStatus> | null = null;
  private timer: NodeJS.Timeout | undefined;
  private active = true;
  private queue: Promise<unknown> = Promise.resolve();
  private settingsError: UsageLimitStatus['settingsError'] = null;

  constructor(
    private readonly directory: string,
    private readonly sources: UsageLimitSources,
    private readonly notify: (status: UsageLimitStatus) => void = () => undefined,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  get path() {
    return join(this.directory, 'usage-limits.v1.json');
  }

  async load() {
    try {
      this.settings = UsageLimitSettingsSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      // A missing file means defaults. An unreadable one is reported (here and in every status, so
      // the Usage screen says so) and is only replaced when the user saves the settings again.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.settingsError = 'usage_limit_settings_unreadable';
        throw new Error('usage_limit_settings_unreadable', { cause: error });
      }
    }
    return this.settings;
  }

  status(): UsageLimitStatus {
    return {
      settings: this.settings,
      providers: PROVIDERS.map((id) => this.providers.get(id)!),
      refreshing: this.running !== null,
      settingsError: this.settingsError,
    };
  }

  async configure(raw: unknown) {
    const settings = UsageLimitSettingsSchema.parse(raw);
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(settings), { mode: 0o600, flag: 'wx' });
          await rename(temporary, this.path);
        } finally {
          await rm(temporary, { force: true });
        }
        this.settings = settings;
        this.settingsError = null;
      });
    this.queue = task;
    await task;
    if (this.settings.refreshSeconds >= KEEP_ALIVE_BELOW_SECONDS) this.sources.claude.close();
    if (this.timer) this.schedule();
    this.notify(this.status());
    return this.status();
  }

  /** `force` is the user's "refresh now": it ignores the waiting time after a failure. */
  refresh(force = false): Promise<UsageLimitStatus> {
    if (this.running) return this.running;
    const run = (async () => {
      this.notify({ ...this.status(), refreshing: true });
      try {
        await Promise.all(PROVIDERS.map((id) => this.read(id, force)));
      } finally {
        this.running = null;
      }
      // Built after the run is over, so neither the answer nor the push still says "refreshing".
      const status = this.status();
      this.notify(status);
      return status;
    })();
    this.running = run;
    return run;
  }

  /** Codex pushes `account/rateLimits/updated` after its own turns: newer numbers at no cost. */
  acceptCodexNotification(method: unknown, params: unknown) {
    if (method !== 'account/rateLimits/updated') return;
    const parsed = parseCodexRateLimits(params);
    if (!parsed?.windows.length) return;
    this.store('codex', parsed);
    this.notify(this.status());
  }

  private async read(id: ProviderId, force: boolean) {
    if (!force && this.clock() < (this.notBefore.get(id) ?? 0)) return;
    if (id === 'claude-code' && !this.sources.claude.connected()) {
      this.providers.set(id, empty(id));
      return;
    }
    try {
      const raw =
        id === 'codex'
          ? await this.sources.codex.read()
          : await this.sources.claude.read(this.settings.refreshSeconds < KEEP_ALIVE_BELOW_SECONDS);
      const parsed = id === 'codex' ? parseCodexRateLimits(raw) : parseClaudeUsage(raw);
      if (!parsed) throw Object.assign(new Error('format'), { code: 'usage_limits_format' });
      this.store(id, parsed);
    } catch (error) {
      const code = usageLimitErrorCode(error);
      const previous = this.providers.get(id)!;
      const failures = (this.failures.get(id) ?? 0) + 1;
      this.failures.set(id, failures);
      this.notBefore.set(
        id,
        this.clock() +
          Math.min(
            MAX_BACKOFF_MS,
            this.settings.refreshSeconds * 1000 * 2 ** Math.min(failures, 8),
          ),
      );
      // Not logged in, or no CLI at all, is "not connected": it leaves the title bar. Any other
      // failure keeps the last good numbers on screen with the reason.
      const disconnected =
        code === 'usage_limits_auth' ||
        (code === 'usage_limits_unavailable' && !previous.fetchedAt);
      this.providers.set(id, {
        ...(disconnected ? empty(id) : previous),
        connected: !disconnected && previous.connected,
        error: code,
      });
    }
  }

  private store(id: ProviderId, parsed: ParsedUsageLimits) {
    this.failures.delete(id);
    this.notBefore.delete(id);
    this.providers.set(id, {
      providerId: id,
      connected: true,
      ...parsed,
      fetchedAt: new Date(this.clock()).toISOString(),
      error: null,
    });
  }

  private schedule() {
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.active) void this.refresh();
    }, this.settings.refreshSeconds * 1000);
    this.timer.unref?.();
  }

  start() {
    this.schedule();
    void this.refresh();
  }

  /** Hidden or minimized windows are not refreshed; showing the window refreshes at once. */
  setActive(active: boolean) {
    const resumed = active && !this.active;
    this.active = active;
    if (!active) this.sources.claude.close();
    if (resumed && this.timer) void this.refresh();
  }

  close() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.sources.claude.close();
  }
}
