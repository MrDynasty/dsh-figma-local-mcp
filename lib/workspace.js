import { randomUUID, createHash } from 'node:crypto'
import { isAbsolute, resolve, relative, sep } from 'node:path'
import { FigmaError } from './errors.js'

const MAX_BYTES = 100 * 1024 * 1024
const quote = (text) => "'" + text.replace(/'/g, "'\\''") + "'"
const fail = (code, message) => { throw new FigmaError(code, message, 409) }
const within = (root, target) => { const path = relative(root, target); return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep) }
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

// Fixed, trusted helper: binary data travels only on stdin, not in commands,
// logs, network requests or an unconfined host fs call. The DSH shell provider
// applies the captured task's actual kernel policy to every filesystem access.
const WRITER = String.raw`
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const manifest = JSON.parse(process.argv[1]), input = fs.readFileSync(0);
if (input.length > 104857600 || manifest.files.reduce((n,f)=>n+f.size,0) !== input.length) throw Error('invalid payload');
const dir = path.resolve(manifest.directory);
fs.mkdirSync(path.dirname(dir), {recursive:true, mode:0o700});
fs.mkdirSync(dir, {mode:0o700}); // exclusive batch directory; never overwrite
let offset = 0; const receipt = [];
for (const file of manifest.files) {
  if (!/^[a-zA-Z0-9@_.-]+\.png$/.test(file.name) || file.name.includes('..')) throw Error('invalid filename');
  const target = path.join(dir,file.name), bytes = input.subarray(offset,offset+file.size); offset += file.size;
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw Error('invalid input hash');
  const fd = fs.openSync(target,'wx',0o600);
  try { fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const saved = fs.readFileSync(target);
  const hash = crypto.createHash('sha256').update(saved).digest('hex');
  if (saved.length !== file.size || hash !== file.sha256) throw Error('write verification failed');
  receipt.push({name:file.name,size:saved.length,sha256:hash});
}
process.stdout.write(JSON.stringify({files:receipt}));
`

export async function prepareWorkspaceSave(ctx, exec, outputDir = 'assets/figma', lifetimeSignal) {
  const active = () => { exec?.signal?.throwIfAborted(); lifetimeSignal?.throwIfAborted() }
  active()
  if (!exec?.agent || typeof ctx.workingDirectory?.ensure !== 'function' || typeof ctx.sandboxPolicy?.resolve !== 'function' || typeof ctx.shell?.resolve !== 'function' || typeof ctx.shell?.execute !== 'function' || ctx.shell.sandboxMode === undefined) fail('workspace_unavailable', '当前宿主缺少受沙箱保护的工作区保存能力；未退回手动下载或绕过权限写入。')
  if (typeof outputDir !== 'string' || !outputDir || outputDir.length > 240 || /[\u0000-\u001f\u007f]/.test(outputDir) || isAbsolute(outputDir) || outputDir.split(/[\\/]/).includes('..')) fail('invalid_output_dir', '保存目录必须是当前工作区内的相对目录。')
  const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
  active()
  const policy = Object.freeze({ ...ctx.sandboxPolicy.resolve({ session: exec.agent.session }) })
  if (!['workspace-write', 'danger-full-access'].includes(policy.mode) || typeof policy.workspaceRoot !== 'string' || !isAbsolute(policy.workspaceRoot) || !isAbsolute(cwd) || !within(policy.workspaceRoot, cwd) || !within(policy.workspaceRoot, resolve(cwd, outputDir))) fail('workspace_denied', '当前会话不能写入此工作区；请使用工作区内目录及允许写入的会话权限。不会自动提升权限。')
  const directory = resolve(cwd, outputDir, 'export-' + randomUUID())
  return async (files) => {
    active()
    if (!Array.isArray(files) || !files.length || files.length > 20) fail('workspace_save_failed', '导出文件清单无效。')
    const names = new Set(); let size = 0
    const manifest = { directory, files: files.map((file) => {
      if (typeof file.filename !== 'string' || !/^[a-zA-Z0-9@_.-]+\.png$/.test(file.filename) || file.filename.includes('..') || names.has(file.filename) || !Buffer.isBuffer(file.bytes)) fail('workspace_save_failed', '导出文件名称或二进制数据无效。')
      names.add(file.filename); size += file.bytes.length
      return { name: file.filename, size: file.bytes.length, sha256: digest(file.bytes) }
    }) }
    if (size > MAX_BYTES) fail('workspace_save_failed', '工作区保存批次超过 100 MB。')
    const abort = new AbortController()
    const cancel = () => abort.abort()
    for (const s of [exec.signal, lifetimeSignal]) s?.addEventListener('abort', cancel, { once: true })
    let result
    try {
      active()
      const spec = ctx.shell.resolve({
        command: `${quote(process.execPath)} -e ${quote(WRITER)} ${quote(JSON.stringify(manifest))}`,
        workdir: cwd, stdin: Buffer.concat(files.map((f) => f.bytes)), signal: abort.signal,
        timeoutMs: 30000, onExpiry: 'kill', stdoutMaxBytes: 32768,
        env: { ELECTRON_RUN_AS_NODE: '1' }, sandboxPolicy: policy,
      })
      result = await (await ctx.shell.execute(spec)).result()
      active()
    } catch {
      active()
      fail('workspace_save_failed', '图片未完整保存到工作区：保存被拒绝或执行失败。未绕过沙箱，也未将临时链接当作交付。')
    } finally { for (const s of [exec.signal, lifetimeSignal]) s?.removeEventListener('abort', cancel) }
    if (result.exitCode !== 0 || result.aborted || result.timedOut || result.signal || result.sandbox?.mode !== policy.mode || result.sandbox?.denied !== false) fail('workspace_save_failed', '图片未完整保存到工作区：沙箱拒绝、取消、超时或进程失败。请检查会话写权限；失败批次可能保留部分文件。')
    let receipt
    try { receipt = JSON.parse(result.stdout.text) } catch { fail('workspace_save_failed', '工作区保存回执无效；未报告保存成功。') }
    if (!Array.isArray(receipt.files) || receipt.files.length !== files.length || receipt.files.some((f, i) => f.name !== manifest.files[i].name || f.size !== manifest.files[i].size || f.sha256 !== manifest.files[i].sha256)) fail('workspace_save_failed', '图片保存校验失败；未报告保存成功。')
    return { files: files.map((file, i) => ({
      filename: file.filename, path: resolve(directory, file.filename), relativePath: relative(cwd, resolve(directory, file.filename)),
      width: file.width, height: file.height, warnings: file.warnings, bytes: receipt.files[i].size, sha256: receipt.files[i].sha256,
    })) }
  }
}
