import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function designatedRequirement(output) {
  const value = output.match(/(?:^|\n)(?:#\s*)?designated => ([^\n]+)/)?.[1]?.trim();
  if (!value || value.length > 16000) throw Error('서명 식별자를 확인하지 못했습니다.');
  return value;
}
export function verifyIdentityContinuity(installed, candidate, allowReviewedMigration = false) {
  if (installed.id !== candidate.id) throw Error('앱 식별자가 달라 업데이트를 중단합니다.');
  const stable = (value) => {
    const syntax = value.replace(/"(?:\\.|[^"\\])*"/g, '""');
    return !/\bcdhash\b/.test(syntax) && /\b(?:anchor|certificate)\b/.test(syntax);
  };
  if (candidate.adHoc || !stable(candidate.requirement))
    throw Error(
      '후보 앱이 고정 인증서 서명이 아닙니다. 권한을 잃을 수 있는 ad-hoc 업데이트를 중단합니다.',
    );
  if (!stable(installed.requirement) || installed.requirement !== candidate.requirement) {
    if (!allowReviewedMigration)
      throw Error(
        '서명 신원이 달라집니다. 사용자와 일회성 인증서 전환·재승인을 검토한 뒤 진행해야 합니다.',
      );
    return { preservedIdentity: false, requiresOneTimeApproval: true };
  }
  return { preservedIdentity: true, requiresOneTimeApproval: false };
}
function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) throw Error('앱 서명/식별자 검사에 실패했습니다.');
  return result.stdout + result.stderr;
}
function inspect(path) {
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', path]);
  const signature = command('/usr/bin/codesign', ['-d', '--verbose=2', '-r-', path]);
  return {
    id: command('/usr/libexec/PlistBuddy', [
      '-c',
      'Print CFBundleIdentifier',
      resolve(path, 'Contents/Info.plist'),
    ]).trim(),
    requirement: designatedRequirement(signature),
    adHoc: /^Signature=adhoc$/m.test(signature),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (
      args.length < 2 ||
      args.length > 3 ||
      (args[2] && args[2] !== '--allow-reviewed-identity-migration')
    )
      throw Error(
        '사용법: node scripts/verify-update-continuity.mjs <installed.app> <candidate.app>',
      );
    const result = verifyIdentityContinuity(
      inspect(resolve(args[0])),
      inspect(resolve(args[1])),
      args[2] === '--allow-reviewed-identity-migration',
    );
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
