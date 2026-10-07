import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Provider } from './types.ts';
export interface SourceRoot {
  provider: Provider;
  directory: string;
  safeLabel: string;
}
export function sourceRoots(home = os.homedir()): SourceRoot[] {
  return [
    {
      provider: 'codex',
      directory: path.join(home, '.codex', 'sessions'),
      safeLabel: '~/.codex/sessions/**/*.jsonl',
    },
    {
      provider: 'codex',
      directory: path.join(home, '.codex', 'archived_sessions'),
      safeLabel: '~/.codex/archived_sessions/*.jsonl',
    },
    {
      provider: 'claude',
      directory: path.join(home, '.claude', 'projects'),
      safeLabel: '~/.claude/projects/**/*.jsonl',
    },
  ];
}
export function inside(root: string, target: string): boolean {
  const r = path.relative(root, target);
  return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r));
}
export function safeDirectory(directory: string): boolean {
  let p = path.resolve(directory);
  while (true) {
    try {
      const s = fs.lstatSync(p);
      if (s.isSymbolicLink()) return false;
    } catch {
      return false;
    }
    const up = path.dirname(p);
    if (up === p) break;
    p = up;
  }
  return true;
}
export function detectedProviders(home = os.homedir()): Record<Provider, boolean> {
  return {
    codex: safeDirectory(path.join(home, '.codex')),
    claude: safeDirectory(path.join(home, '.claude')),
  };
}
export function enumerate(root: SourceRoot): {
  files: string[];
  skippedLinks: number;
  errors: number;
} {
  const result = { files: [] as string[], skippedLinks: 0, errors: 0 };
  if (!fs.existsSync(root.directory)) return result;
  if (!safeDirectory(root.directory)) {
    result.skippedLinks++;
    return result;
  }
  const canonical = fs.realpathSync(root.directory);
  function visit(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      result.errors++;
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink()) {
          result.skippedLinks++;
          continue;
        }
        if (!inside(canonical, fs.realpathSync(p))) {
          result.skippedLinks++;
          continue;
        }
        if (st.isDirectory()) {
          if (root.safeLabel.includes('**')) visit(p);
        } else if (st.isFile() && e.name.endsWith('.jsonl')) result.files.push(p);
      } catch {
        result.errors++;
      }
    }
  }
  visit(root.directory);
  return result;
}
export function openAllowedFile(root: SourceRoot, file: string): number {
  if (
    !inside(path.resolve(root.directory), path.resolve(file)) ||
    !file.endsWith('.jsonl') ||
    !safeDirectory(path.dirname(file))
  )
    throw new Error('Source access denied');
  const before = fs.lstatSync(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    !inside(fs.realpathSync(root.directory), fs.realpathSync(file))
  )
    throw new Error('Source access denied');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  const after = fs.fstatSync(fd);
  if (before.ino !== after.ino || before.dev !== after.dev) {
    fs.closeSync(fd);
    throw new Error('Source changed while opening');
  }
  return fd;
}
export function applicationDirectory(directory: string, home = os.homedir()): string {
  const resolved = path.resolve(directory);
  for (const name of ['.codex', '.claude']) {
    const source = path.join(home, name);
    if (inside(source, resolved) || inside(resolved, source))
      throw new Error('Application data must be separate from provider data');
  }
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) {
    const up = path.dirname(ancestor);
    if (up === ancestor) throw new Error('Invalid data directory');
    ancestor = up;
  }
  if (!safeDirectory(ancestor)) throw new Error('Application data directory must not use links');
  return resolved;
}
