import { posix } from 'node:path';

import { z } from 'zod';

import {
  SSH_WORKSPACE_FILE_LIST_MAX_ENTRIES,
  SSH_WORKSPACE_FILE_READ_MAX_CHARACTERS,
  RemoteWorkspaceRootSchema,
  SshWorkspaceFileOperationSchema,
  type SshWorkspaceFileOperation,
} from '../shared/ssh-workspace-contracts';

const SSH_WORKSPACE_FILE_HELPER_OUTPUT_MAX_BYTES = 64 * 1024;
const SSH_WORKSPACE_FILE_CONTENT_MAX_BYTES = 48 * 1024;
export const SSH_WORKSPACE_FILE_MAX_STDIN_BYTES = 64 * 1024;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const blockedFileNames = new Set([
  '.git',
  '.ssh',
  '.gnupg',
  '.aws',
  '.env',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'credentials',
  'authorized_keys',
  'known_hosts',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);
const blockedFileSuffixes = ['.pem', '.key', '.p12', '.pfx', '.ppk'] as const;

function isBlockedFileSegment(value: string) {
  const normalized = value.toLowerCase();
  return (
    blockedFileNames.has(normalized) ||
    normalized.startsWith('.env.') ||
    normalized.startsWith('.gosu-write-') ||
    blockedFileSuffixes.some((suffix) => normalized.endsWith(suffix))
  );
}

const outputRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => {
    if (value.trim() !== value || value.startsWith('/') || value.endsWith('/')) return false;
    if (value.includes('\\')) return false;
    if (/\p{Cf}/u.test(value)) return false;
    if (/\p{Cs}/u.test(value)) return false;
    if (
      [...value].some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code <= 31 || (code >= 127 && code <= 159);
      })
    ) {
      return false;
    }
    return value
      .split('/')
      .every(
        (segment) =>
          segment.length > 0 &&
          segment !== '.' &&
          segment !== '..' &&
          !isBlockedFileSegment(segment),
      );
  });
const actionSchema = z.enum(['list', 'read', 'write']);
const errorCodeSchema = z.enum([
  'ssh_workspace_file_not_found',
  'ssh_workspace_file_conflict',
  'ssh_workspace_file_not_allowed',
  'ssh_workspace_file_too_large',
  'ssh_workspace_file_invalid',
  'ssh_workspace_file_commit_uncertain',
]);

const listResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal('list'),
    entries: z
      .array(
        z
          .object({
            relativePath: outputRelativePathSchema,
            sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .max(SSH_WORKSPACE_FILE_LIST_MAX_ENTRIES),
    truncated: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.entries.map((entry) => entry.relativePath)).size === value.entries.length,
    'Workspace file entries must be unique',
  );

const readResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal('read'),
    relativePath: outputRelativePathSchema,
    content: z
      .string()
      .refine(
        (value) => [...value].length <= SSH_WORKSPACE_FILE_READ_MAX_CHARACTERS,
        'Workspace file chunk is too long',
      ),
    contentSha256: sha256Schema,
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
    totalCharacters: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict()
  .refine((value) => {
    const end = value.offset + [...value.content].length;
    return value.truncated
      ? value.nextOffset === end && end < value.totalCharacters
      : value.nextOffset === null && end === value.totalCharacters;
  }, 'Workspace read offsets are inconsistent');

const writeResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: z.literal('write'),
    relativePath: outputRelativePathSchema,
    created: z.boolean(),
    previousSha256: sha256Schema.nullable(),
    contentSha256: sha256Schema,
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (value) => (value.created ? value.previousSha256 === null : value.previousSha256 !== null),
    'Workspace write provenance is inconsistent',
  );

const errorResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    action: actionSchema,
    error: errorCodeSchema,
  })
  .strict();

const outputSchema = z.union([
  listResultSchema,
  readResultSchema,
  writeResultSchema,
  errorResultSchema,
]);

export type SshWorkspaceFileOutput = z.infer<typeof outputSchema>;

export class SshWorkspaceFileProtocolError extends Error {
  constructor(readonly kind: 'invalid_input' | 'input_too_large' | 'invalid_output') {
    super(kind);
    this.name = 'SshWorkspaceFileProtocolError';
  }
}

export type SshWorkspaceFileInvocation = Readonly<{
  command: '/usr/bin/python3';
  args: readonly ['-I', '-S', '-c', string];
  stdinText: string;
}>;

/*
 * This source is an application constant, never model-authored code. The only
 * variable data crosses SSH as bounded JSON on stdin. Directory file
 * descriptors and O_NOFOLLOW keep every operation under the approved root even
 * if a path is changed into a symlink between validation and use.
 */
export const SSH_WORKSPACE_FILE_HELPER_PROGRAM = String.raw`
import hashlib,json,os,secrets,stat,sys,unicodedata

MAX_INPUT=65536
MAX_FILE_BYTES=65536
MAX_WRITE_CHARS=24000
MAX_WRITE_BYTES=49152
MAX_READ_CHARS=16000
MAX_ENTRIES=200
MAX_VISITED=5000
MAX_OUTPUT=32768
ERRORS={'not_found':'ssh_workspace_file_not_found','conflict':'ssh_workspace_file_conflict','not_allowed':'ssh_workspace_file_not_allowed','too_large':'ssh_workspace_file_too_large','invalid':'ssh_workspace_file_invalid','commit_uncertain':'ssh_workspace_file_commit_uncertain'}
BLOCKED_EXACT={'.git','.ssh','.gnupg','.aws','.env','.netrc','.npmrc','.pypirc','credentials','authorized_keys','known_hosts','id_rsa','id_dsa','id_ecdsa','id_ed25519'}
BLOCKED_SUFFIX=('.pem','.key','.p12','.pfx','.ppk')
BLOCKED_PREFIX=('.gosu-write-',)
DIR_FLAGS=os.O_RDONLY|os.O_DIRECTORY|getattr(os,'O_CLOEXEC',0)|getattr(os,'O_NOFOLLOW',0)
READ_FLAGS=os.O_RDONLY|getattr(os,'O_CLOEXEC',0)|getattr(os,'O_NOFOLLOW',0)

class OperationError(Exception):
    def __init__(self,code): self.code=code

def raise_error(code):
    raise OperationError(code)

def has_control(value):
    return any(ord(ch)<=31 or 127<=ord(ch)<=159 for ch in value)

def has_format(value):
    return any(unicodedata.category(ch)=='Cf' for ch in value)

def has_surrogate(value):
    return any(unicodedata.category(ch)=='Cs' for ch in value)

def has_unsafe_content(value):
    return has_format(value) or has_surrogate(value) or any((ord(ch)<=31 and ord(ch) not in (9,10,13)) or 127<=ord(ch)<=159 for ch in value)

def blocked_segment(segment):
    lower=segment.lower()
    return lower in BLOCKED_EXACT or lower.startswith('.env.') or lower.startswith(BLOCKED_PREFIX) or lower.endswith(BLOCKED_SUFFIX)

def relative_segments(value):
    if not isinstance(value,str) or not value or len(value)>512 or value.startswith('/') or value.endswith('/') or '\\' in value or has_control(value) or has_format(value) or has_surrogate(value):
        raise_error('invalid')
    parts=value.split('/')
    if any(not part or part in ('.','..') or blocked_segment(part) for part in parts):
        raise_error('not_allowed')
    return parts

def absolute_path(value,max_length):
    if not isinstance(value,str) or not value.startswith('/') or value=='/' or len(value)>max_length or value.endswith('/') or '\\' in value or has_control(value) or has_format(value) or has_surrogate(value) or os.path.normpath(value)!=value:
        raise_error('invalid')
    return value

def open_directory_at(start_fd,segments):
    current=os.dup(start_fd)
    try:
        for segment in segments:
            next_fd=os.open(segment,DIR_FLAGS,dir_fd=current)
            os.close(current)
            current=next_fd
        return current
    except Exception:
        os.close(current)
        raise

def open_workspace(root,cwd):
    root=absolute_path(root,1024)
    cwd=absolute_path(cwd,1537)
    if os.path.realpath(root)!=root or os.path.realpath(cwd)!=cwd:
        raise_error('not_allowed')
    try:
        if os.path.commonpath((root,cwd))!=root:
            raise_error('not_allowed')
    except ValueError:
        raise_error('not_allowed')
    rel=os.path.relpath(cwd,root)
    cwd_parts=[] if rel=='.' else relative_segments(rel)
    try:
        root_info=os.lstat(root)
        if stat.S_ISLNK(root_info.st_mode) or not stat.S_ISDIR(root_info.st_mode): raise_error('not_allowed')
        root_fd=os.open(root,DIR_FLAGS)
        opened_info=os.fstat(root_fd)
        if (opened_info.st_dev,opened_info.st_ino)!=(root_info.st_dev,root_info.st_ino) or os.path.realpath(root)!=root:
            os.close(root_fd)
            raise_error('not_allowed')
        cwd_fd=open_directory_at(root_fd,cwd_parts)
        return root_fd,cwd_fd
    except FileNotFoundError:
        raise_error('not_found')
    except (NotADirectoryError,PermissionError,OSError):
        raise_error('not_allowed')

def open_parent(cwd_fd,path):
    parts=relative_segments(path)
    try:
        return open_directory_at(cwd_fd,parts[:-1]),parts[-1]
    except FileNotFoundError:
        raise_error('not_found')
    except (NotADirectoryError,PermissionError,OSError):
        raise_error('not_allowed')

def read_fd(fd):
    info=os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        raise_error('not_allowed')
    if info.st_size>MAX_FILE_BYTES:
        raise_error('too_large')
    chunks=[]
    remaining=MAX_FILE_BYTES+1
    while remaining>0:
        chunk=os.read(fd,min(16384,remaining))
        if not chunk: break
        chunks.append(chunk)
        remaining-=len(chunk)
    raw=b''.join(chunks)
    if len(raw)>MAX_FILE_BYTES:
        raise_error('too_large')
    try:
        text=raw.decode('utf-8','strict')
    except UnicodeDecodeError:
        raise_error('not_allowed')
    if '\x00' in text:
        raise_error('not_allowed')
    return raw,text,info

def output_bytes(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode('utf-8')

def emit(value):
    if value.get('action')=='list':
        while len(output_bytes(value))>MAX_OUTPUT and value['entries']:
            value['entries'].pop()
            value['truncated']=True
    elif value.get('action')=='read':
        while len(output_bytes(value))>MAX_OUTPUT and value['content']:
            value['content']=value['content'][:max(0,len(value['content'])//2)]
            end=value['offset']+len(value['content'])
            value['nextOffset']=end if end<value['totalCharacters'] else None
            value['truncated']=value['nextOffset'] is not None
    encoded=output_bytes(value)
    if len(encoded)>MAX_OUTPUT:
        value={'schemaVersion':1,'action':value.get('action','list'),'error':ERRORS['too_large']}
        encoded=output_bytes(value)
    sys.stdout.buffer.write(encoded)

def list_files(cwd_fd,limit):
    entries=[]
    truncated=False
    visited=0
    queue=[('',os.dup(cwd_fd))]
    try:
        while queue and len(entries)<limit and visited<MAX_VISITED:
            prefix,current=queue.pop(0)
            try:
                names=sorted(os.listdir(current))
                for name in names:
                    if blocked_segment(name) or name.strip()!=name or '\\' in name or has_control(name) or has_format(name) or has_surrogate(name): continue
                    visited+=1
                    if visited>MAX_VISITED:
                        truncated=True
                        break
                    try:
                        info=os.stat(name,dir_fd=current,follow_symlinks=False)
                    except (FileNotFoundError,PermissionError,OSError):
                        continue
                    relative=name if not prefix else prefix+'/'+name
                    if len(relative)>512:
                        truncated=True
                        continue
                    if stat.S_ISDIR(info.st_mode):
                        try:
                            queue.append((relative,os.open(name,DIR_FLAGS,dir_fd=current)))
                        except (FileNotFoundError,NotADirectoryError,PermissionError,OSError):
                            pass
                    elif stat.S_ISREG(info.st_mode) and info.st_size<=9007199254740991:
                        entries.append({'relativePath':relative,'sizeBytes':info.st_size})
                        if len(entries)>=limit:
                            truncated=bool(queue) or names.index(name)<len(names)-1
                            break
            finally:
                os.close(current)
        if queue or visited>=MAX_VISITED: truncated=True
    finally:
        for _,fd in queue:
            try: os.close(fd)
            except OSError: pass
    return entries,truncated

def read_file(cwd_fd,path,offset,max_characters):
    parent,name=open_parent(cwd_fd,path)
    try:
        try: fd=os.open(name,READ_FLAGS,dir_fd=parent)
        except FileNotFoundError: raise_error('not_found')
        except (PermissionError,OSError): raise_error('not_allowed')
        try: raw,text,_=read_fd(fd)
        finally: os.close(fd)
    finally:
        os.close(parent)
    if offset>len(text): raise_error('invalid')
    end=min(len(text),offset+max_characters)
    return {'schemaVersion':1,'action':'read','relativePath':path,'content':text[offset:end],'contentSha256':hashlib.sha256(raw).hexdigest(),'offset':offset,'nextOffset':end if end<len(text) else None,'totalCharacters':len(text),'truncated':end<len(text)}

def current_file(parent,name):
    try: fd=os.open(name,READ_FLAGS,dir_fd=parent)
    except FileNotFoundError: return None
    except (PermissionError,OSError): raise_error('not_allowed')
    try:
        raw,_,info=read_fd(fd)
        return raw,info,hashlib.sha256(raw).hexdigest()
    finally:
        os.close(fd)

def write_all(fd,raw):
    view=memoryview(raw)
    while view:
        written=os.write(fd,view)
        if written<=0: raise OSError()
        view=view[written:]

def write_file(cwd_fd,path,content,expected):
    if not isinstance(content,str) or len(content)>MAX_WRITE_CHARS or has_unsafe_content(content):
        raise_error('too_large' if isinstance(content,str) and len(content)>MAX_WRITE_CHARS else 'invalid')
    raw=content.encode('utf-8')
    if len(raw)>MAX_WRITE_BYTES: raise_error('too_large')
    if expected is not None and (not isinstance(expected,str) or len(expected)!=64 or any(ch not in '0123456789abcdef' for ch in expected)):
        raise_error('invalid')
    parent,name=open_parent(cwd_fd,path)
    temp='.gosu-write-'+secrets.token_hex(12)
    temp_exists=False
    committed=False
    try:
        try:
            prior=current_file(parent,name)
            if expected is None and prior is not None: raise_error('conflict')
            if expected is not None and prior is None: raise_error('not_found')
            if prior is not None and prior[2]!=expected: raise_error('conflict')
            mode=0o644 if prior is None else stat.S_IMODE(prior[1].st_mode)&0o777
            try:
                temp_fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_CLOEXEC',0),0o600,dir_fd=parent)
                temp_exists=True
                try:
                    os.fchmod(temp_fd,mode)
                    write_all(temp_fd,raw)
                    os.fsync(temp_fd)
                finally:
                    os.close(temp_fd)
                if prior is None:
                    try: os.link(temp,name,src_dir_fd=parent,dst_dir_fd=parent,follow_symlinks=False)
                    except FileExistsError: raise_error('conflict')
                    committed=True
                    os.unlink(temp,dir_fd=parent)
                    temp_exists=False
                else:
                    latest=current_file(parent,name)
                    if latest is None: raise_error('conflict')
                    same_identity=(latest[1].st_dev,latest[1].st_ino,latest[1].st_size,getattr(latest[1],'st_mtime_ns',0))==(prior[1].st_dev,prior[1].st_ino,prior[1].st_size,getattr(prior[1],'st_mtime_ns',0))
                    if not same_identity or latest[2]!=expected: raise_error('conflict')
                    os.replace(temp,name,src_dir_fd=parent,dst_dir_fd=parent)
                    committed=True
                    temp_exists=False
                os.fsync(parent)
            finally:
                if temp_exists:
                    try: os.unlink(temp,dir_fd=parent)
                    except OSError: pass
        except OperationError:
            raise
        except Exception:
            if committed: raise_error('commit_uncertain')
            raise
        digest=hashlib.sha256(raw).hexdigest()
        return {'schemaVersion':1,'action':'write','relativePath':path,'created':prior is None,'previousSha256':None if prior is None else prior[2],'contentSha256':digest,'sizeBytes':len(raw)}
    finally:
        os.close(parent)

action='list'
root_fd=None
cwd_fd=None
try:
    raw_input=sys.stdin.buffer.read(MAX_INPUT+1)
    if len(raw_input)>MAX_INPUT: raise_error('too_large')
    try: request=json.loads(raw_input.decode('utf-8','strict'))
    except (UnicodeDecodeError,json.JSONDecodeError): raise_error('invalid')
    if not isinstance(request,dict) or request.get('schemaVersion')!=1 or request.get('action') not in ('list','read','write'):
        raise_error('invalid')
    action=request['action']
    common={'schemaVersion','action','workspaceRoot','workingDirectory'}
    allowed={'list':common|{'maxEntries'},'read':common|{'relativePath','offset','maxCharacters'},'write':common|{'relativePath','content','expectedSha256'}}[action]
    if set(request)!=allowed: raise_error('invalid')
    root_fd,cwd_fd=open_workspace(request['workspaceRoot'],request['workingDirectory'])
    if action=='list':
        limit=request['maxEntries']
        if not isinstance(limit,int) or isinstance(limit,bool) or not 1<=limit<=MAX_ENTRIES: raise_error('invalid')
        entries,truncated=list_files(cwd_fd,limit)
        emit({'schemaVersion':1,'action':'list','entries':entries,'truncated':truncated})
    elif action=='read':
        offset=request['offset']; maximum=request['maxCharacters']
        if not isinstance(offset,int) or isinstance(offset,bool) or offset<0 or not isinstance(maximum,int) or isinstance(maximum,bool) or not 1<=maximum<=MAX_READ_CHARS: raise_error('invalid')
        emit(read_file(cwd_fd,request['relativePath'],offset,maximum))
    else:
        emit(write_file(cwd_fd,request['relativePath'],request['content'],request['expectedSha256']))
except OperationError as error:
    emit({'schemaVersion':1,'action':action,'error':ERRORS[error.code]})
    sys.exit(3)
except Exception:
    emit({'schemaVersion':1,'action':action,'error':ERRORS['invalid']})
    sys.exit(4)
finally:
    for fd in (cwd_fd,root_fd):
        if fd is not None:
            try: os.close(fd)
            except OSError: pass
`.trim();

// OpenSSH arguments cannot contain literal control characters. This fixed,
// one-line bootstrap decodes the app-owned program without accepting code from
// stdin; stdin remains JSON data only.
export const SSH_WORKSPACE_FILE_HELPER_SOURCE = `exec(${JSON.stringify(
  SSH_WORKSPACE_FILE_HELPER_PROGRAM,
)})`;

function validatedWorkingDirectory(canonicalRoot: string, workingDirectory: string) {
  const root = RemoteWorkspaceRootSchema.safeParse(canonicalRoot);
  if (!root.success || !posix.isAbsolute(workingDirectory)) {
    throw new SshWorkspaceFileProtocolError('invalid_input');
  }
  const normalizedWorkingDirectory = posix.normalize(workingDirectory);
  if (
    normalizedWorkingDirectory !== workingDirectory ||
    (workingDirectory !== root.data && !workingDirectory.startsWith(`${root.data}/`))
  ) {
    throw new SshWorkspaceFileProtocolError('invalid_input');
  }
  return { canonicalRoot: root.data, workingDirectory: normalizedWorkingDirectory };
}

export function buildSshWorkspaceFileInvocation(
  input: SshWorkspaceFileOperation,
  canonicalRoot: string,
  workingDirectory: string,
): SshWorkspaceFileInvocation {
  const operation = SshWorkspaceFileOperationSchema.safeParse(input);
  if (!operation.success) throw new SshWorkspaceFileProtocolError('invalid_input');
  const paths = validatedWorkingDirectory(canonicalRoot, workingDirectory);
  const common = {
    schemaVersion: 1 as const,
    action: operation.data.action,
    workspaceRoot: paths.canonicalRoot,
    workingDirectory: paths.workingDirectory,
  };
  const request =
    operation.data.action === 'list'
      ? { ...common, maxEntries: operation.data.maxEntries }
      : operation.data.action === 'read'
        ? {
            ...common,
            relativePath: operation.data.relativePath,
            offset: operation.data.offset,
            maxCharacters: operation.data.maxCharacters,
          }
        : {
            ...common,
            relativePath: operation.data.relativePath,
            content: operation.data.content,
            expectedSha256: operation.data.expectedSha256,
          };
  const stdinText = JSON.stringify(request);
  if (
    Buffer.byteLength(stdinText, 'utf8') > SSH_WORKSPACE_FILE_MAX_STDIN_BYTES ||
    (operation.data.action === 'write' &&
      Buffer.byteLength(operation.data.content, 'utf8') > SSH_WORKSPACE_FILE_CONTENT_MAX_BYTES)
  ) {
    throw new SshWorkspaceFileProtocolError('input_too_large');
  }
  return {
    command: '/usr/bin/python3',
    args: ['-I', '-S', '-c', SSH_WORKSPACE_FILE_HELPER_SOURCE],
    stdinText,
  };
}

export function parseSshWorkspaceFileOutput(stdout: string): SshWorkspaceFileOutput {
  if (Buffer.byteLength(stdout, 'utf8') > SSH_WORKSPACE_FILE_HELPER_OUTPUT_MAX_BYTES) {
    throw new SshWorkspaceFileProtocolError('invalid_output');
  }
  try {
    return outputSchema.parse(JSON.parse(stdout) as unknown);
  } catch {
    throw new SshWorkspaceFileProtocolError('invalid_output');
  }
}
