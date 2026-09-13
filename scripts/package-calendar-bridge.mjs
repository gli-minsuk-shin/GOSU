import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export function calendarBridgeSources(text) {
  const source = text.match(/const SOURCE = String.raw`([\s\S]*?)`;/)?.[1];
  const plist = text.match(/const PLIST = `([\s\S]*?)`;/)?.[1];
  if (!source || !plist || source.includes('${') || plist.includes('${'))
    throw Error('Calendar bridge source format changed');
  return { source, plist };
}
export async function packageCalendarBridge(appPath, arch) {
  if (!['arm64', 'x64'].includes(arch)) throw Error('Unsupported Calendar architecture');
  const { source, plist } = calendarBridgeSources(
    await readFile(new URL('../apps/briefing-lab/calendar-native.ts', import.meta.url), 'utf8'),
  );
  const contents = join(appPath, 'Contents', 'Resources', 'CalendarBridge.app', 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await writeFile(join(contents, 'Info.plist'), plist);
  await new Promise((resolve, reject) => {
    const child = spawn(
      '/usr/bin/xcrun',
      [
        'swiftc',
        '-swift-version',
        '5',
        '-O',
        '-target',
        `${arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`,
        '-o',
        join(contents, 'MacOS', 'CalendarBridge'),
        '-',
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let diagnostic = '';
    child.stderr.on('data', (b) => {
      diagnostic = (diagnostic + b).slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('Calendar bridge compile timeout'));
    }, 90000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(Error(diagnostic));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(source);
  });
}
