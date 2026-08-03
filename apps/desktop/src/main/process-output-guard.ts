type ErrorStream = Readonly<{
  on(event: 'error', listener: (error: unknown) => void): unknown;
}>;

export function isClosedProcessOutput(error: unknown) {
  return (
    error instanceof Error && 'code' in error && (error.code === 'EIO' || error.code === 'EPIPE')
  );
}

export function handleProcessOutputError(error: unknown) {
  if (!isClosedProcessOutput(error)) throw error;
}

export function installProcessOutputGuards(
  streams: readonly ErrorStream[] = [process.stdout, process.stderr],
) {
  for (const stream of new Set(streams)) stream.on('error', handleProcessOutputError);
}
