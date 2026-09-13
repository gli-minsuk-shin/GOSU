import { z } from 'zod';

export const MODEL_LAB_OPEN_CHANNEL = 'model-lab:open-project';
export const OpenProjectModelLabSchema = z.object({ projectId: z.string().uuid() }).strict();
export type ProjectModelLabLocation = Readonly<{ projectId: string; url: string }>;

export function isProjectModelLabLocation(
  value: unknown,
  projectId: string,
): value is ProjectModelLabLocation {
  if (
    !value ||
    typeof value !== 'object' ||
    !('url' in value) ||
    !('projectId' in value) ||
    value.projectId !== projectId ||
    typeof value.url !== 'string'
  )
    return false;
  try {
    const url = new URL(value.url);
    return (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      !!url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      new RegExp(`^/s/[a-f0-9]{64}/${projectId}/$`).test(url.pathname)
    );
  } catch {
    return false;
  }
}
