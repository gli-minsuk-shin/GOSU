import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, rename, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
const SWIFT = String.raw`import Foundation
import Security
let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "science.gosu.briefing-memory.v2", kSecAttrAccount as String: "local-memory"]
var query = base
query[kSecReturnData as String] = true
query[kSecMatchLimit as String] = kSecMatchLimitOne
var result: CFTypeRef?
var status = SecItemCopyMatching(query as CFDictionary, &result)
if status == errSecItemNotFound {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { exit(2) }
    var add = base
    add[kSecValueData as String] = Data(bytes)
    add[kSecAttrLabel as String] = "GOSU Briefing automatic memory"
    status = SecItemAdd(add as CFDictionary, nil)
    guard status == errSecSuccess || status == errSecDuplicateItem else { exit(3) }
    status = SecItemCopyMatching(query as CFDictionary, &result)
}
guard status == errSecSuccess, let data = result as? Data, data.count == 32 else { exit(4) }
FileHandle.standardOutput.write(Data(data.base64EncodedString().utf8))
`;
/** The random AES key lives in macOS Keychain, never argv, a browser, source tree or a key file. */
export async function systemBriefingKey(directory: string): Promise<Buffer> {
  if (process.platform !== 'darwin') throw new Error('briefing_memory_keychain_unavailable');
  const runtime = join(directory, 'runtime');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  if (!(await lstat(runtime)).isDirectory() || (await lstat(runtime)).isSymbolicLink())
    throw new Error('briefing_memory_path_unsafe');
  const executable = join(
    runtime,
    `keychain-${createHash('sha256').update(SWIFT).digest('hex').slice(0, 16)}`,
  );
  try {
    const stat = await lstat(executable);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error('briefing_memory_path_unsafe');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const temporary = await mkdtemp(join(runtime, 'build-'));
    try {
      const output = join(temporary, 'keychain');
      await new Promise<void>((resolve, reject) => {
        const child = spawn('/usr/bin/xcrun', ['swiftc', '-O', '-o', output, '-'], {
          stdio: ['pipe', 'ignore', 'ignore'],
        });
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('briefing_memory_keychain_build_failed'));
        }, 90000);
        child.on('error', () => {
          clearTimeout(timer);
          reject(new Error('briefing_memory_keychain_build_failed'));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error('briefing_memory_keychain_build_failed'));
        });
        child.stdin.on('error', () => undefined);
        child.stdin.end(SWIFT);
      });
      await chmod(output, 0o700);
      await rename(output, executable);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  return new Promise((resolve, reject) =>
    execFile(
      executable,
      [],
      { timeout: 30000, maxBuffer: 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error || !/^[A-Za-z0-9+/]{43}=$/.test(stdout))
          return reject(new Error('briefing_memory_keychain_unavailable'));
        const key = Buffer.from(stdout, 'base64');
        if (key.length !== 32) return reject(new Error('briefing_memory_keychain_unavailable'));
        resolve(key);
      },
    ),
  );
}
