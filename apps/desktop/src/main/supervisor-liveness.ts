type SignalCheck = (pid: number, signal: 0) => unknown;

export function parseSupervisorPid(raw: string | undefined) {
  if (!raw || !/^[1-9]\d*$/u.test(raw)) return null;
  const pid = Number(raw);
  return Number.isSafeInteger(pid) ? pid : null;
}

export function isSupervisorAlive(pid: number, signalCheck: SignalCheck = process.kill) {
  try {
    signalCheck(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ESRCH'
    );
  }
}
