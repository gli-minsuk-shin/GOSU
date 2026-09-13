import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { safeAppleMailUrl } from './src/apple-mail-url';

/** LaunchServices handoff only. No shell, AppleScript, browser policy change or arbitrary app. */
export async function openOriginalMail(
  url: string,
  signal: AbortSignal,
  run = spawn,
  platform = process.platform,
) {
  if (platform !== 'darwin') throw new Error('mail_open_macos_required');
  const canonical = safeAppleMailUrl(url);
  if (!canonical) throw new Error('mail_open_target_invalid');
  if (signal.aborted) throw new Error('source_cancelled');
  await new Promise<void>((resolve, reject) => {
    const child = run('/usr/bin/open', ['-b', 'com.apple.mail', canonical], {
      shell: false,
      stdio: 'ignore',
      env: { PATH: '/usr/bin:/bin', HOME: homedir() },
    });
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) {
        child.kill('SIGTERM');
        reject(error);
      } else resolve();
    };
    const abort = () => finish(new Error('source_cancelled'));
    const timer = setTimeout(() => finish(new Error('mail_open_timeout')), 10000);
    child.once('error', () => finish(new Error('mail_open_failed')));
    child.once('close', (code) => finish(code === 0 ? undefined : new Error('mail_open_failed')));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
