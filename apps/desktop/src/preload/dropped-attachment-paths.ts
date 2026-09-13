/** Only Electron-backed native Files resolve. Synthetic File objects/strings cannot name local paths. */
export function droppedAttachmentPaths(
  files: readonly File[],
  getPath: (file: File) => string,
): string[] {
  if (!Array.isArray(files) || files.length < 1 || files.length > 5)
    throw new Error('attachment_too_many');
  const paths = files.map((file) => getPath(file));
  if (paths.some((path) => !path || path.length > 4096) || new Set(paths).size !== paths.length)
    throw new Error('attachment_invalid');
  return paths;
}
