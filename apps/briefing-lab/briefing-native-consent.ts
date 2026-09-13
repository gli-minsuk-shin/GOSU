import { spawn } from 'node:child_process';
export async function confirmPrivateBriefing(message: string, signal: AbortSignal) {
  if (process.platform !== 'darwin' || signal.aborted)
    throw new Error('briefing_native_consent_unavailable');
  const script = String.raw`function run(argv){var app=Application.currentApplication();app.includeStandardAdditions=true;try{var result=app.displayDialog(argv[0],{withTitle:'GOSU Briefing — Private data',buttons:['취소','이 요청 허용'],defaultButton:'취소',cancelButton:'취소',givingUpAfter:90});return result.buttonReturned==='이 요청 허용'&&!result.gaveUp?'approved':'denied';}catch(e){return 'denied';}}`;
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', script, message.slice(0, 3000)],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let output = '',
      done = false;
    const finish = (accepted: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      child.kill('SIGTERM');
      if (accepted) resolve();
      else reject(new Error('briefing_native_consent_denied'));
    };
    const cancel = () => finish(false),
      timer = setTimeout(cancel, 95000);
    signal.addEventListener('abort', cancel, { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 100) finish(false);
    });
    child.on('error', cancel);
    child.on('close', () => finish(output.trim() === 'approved'));
    if (signal.aborted) cancel();
  });
}
