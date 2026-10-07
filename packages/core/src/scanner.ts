import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { sourceRoots, detectedProviders, enumerate, openAllowedFile } from './security.ts';
import { hash } from './metadata.ts';
import type { Store, Checkpoint } from './storage.ts';
import { codexState, parseCodex, type CodexState } from './providers/codex/index.ts';
import { claudeState, parseClaude, type ClaudeState } from './providers/claude/index.ts';
import { emptyDiagnostics, type Provider, type SourceStatus, type Diagnostics } from './types.ts';
import { usageMetadata } from './usage-json.ts';
export const PARSER_VERSION = '2';
const MAX_LINE = 16 * 1024 * 1024;
const READ_BLOCK = 1024 * 1024;
const CODEX_MARKERS = ['"session_meta"', '"turn_context"', '"token_count"'].map((value) =>
  Buffer.from(value),
);
function fingerprint(fd: number, start: number, len: number): string {
  const b = Buffer.alloc(Math.max(0, len));
  const n = fs.readSync(fd, b, 0, b.length, start);
  return createHash('sha256').update(b.subarray(0, n)).digest('hex');
}
function combine(to: Diagnostics, from: Diagnostics) {
  for (const k of [
    'malformed',
    'inherited',
    'repeated',
    'resets',
    'oversize',
    'unsupported',
    'records',
  ] as const)
    to[k] += from[k];
  to.partialTail ||= from.partialTail;
  if (from.first) to.first = !to.first || from.first < to.first ? from.first : to.first;
  if (from.last) to.last = !to.last || from.last > to.last ? from.last : to.last;
}
export interface ScanProgress {
  provider: Provider;
  files: number;
  total: number;
  bytes: number;
  phase: 'scanning' | 'complete';
}
export async function scan(
  store: Store,
  options: { home?: string; onProgress?: (p: ScanProgress) => void } = {},
): Promise<SourceStatus[]> {
  const home = options.home ?? os.homedir(),
    detected = detectedProviders(home);
  const statuses: SourceStatus[] = (['codex', 'claude'] as Provider[]).map((provider) => ({
    provider,
    detected: detected[provider],
    files: 0,
    scanned: 0,
    cached: 0,
    errors: 0,
    skippedLinks: 0,
    missingFiles: 0,
    diagnostics: emptyDiagnostics(),
  }));
  const seen = new Set<string>();
  let bytes = 0;
  for (const root of sourceRoots(home)) {
    const status = statuses.find((s) => s.provider === root.provider)!;
    const found = enumerate(root);
    status.files += found.files.length;
    status.errors += found.errors;
    status.skippedLinks += found.skippedLinks;
    for (const file of found.files) {
      const ref = hash(root.safeLabel, path.relative(root.directory, file));
      seen.add(ref);
      let fd: number | undefined;
      let stream: fs.ReadStream | undefined;
      let transaction = false;
      try {
        fd = openAllowedFile(root, file);
        const stat = fs.fstatSync(fd);
        let cp = store.checkpoint(ref);
        const identity = `${stat.dev}:${stat.ino}:${PARSER_VERSION}`;
        if (
          cp &&
          cp.size === stat.size &&
          cp.mtime === stat.mtimeMs &&
          cp.identity === identity &&
          fingerprint(fd, 0, Math.min(4096, cp.offset)) === cp.head &&
          fingerprint(fd, Math.max(0, cp.offset - 4096), Math.min(4096, cp.offset)) === cp.tail
        ) {
          status.cached++;
          combine(status.diagnostics, cp.state.diagnostics);
          continue;
        }
        if (cp) {
          const headLen = Math.min(4096, cp.offset);
          const tailStart = Math.max(0, cp.offset - 4096);
          const appendSafe =
            stat.size > cp.size &&
            identity === cp.identity &&
            fingerprint(fd, 0, headLen) === cp.head &&
            fingerprint(fd, tailStart, cp.offset - tailStart) === cp.tail;
          if (!appendSafe) cp = null;
        }
        const state: CodexState | ClaudeState = cp
          ? cp.state
          : root.provider === 'codex'
            ? codexState()
            : claudeState();
        state.diagnostics.partialTail = false;
        let offset = cp?.offset ?? 0,
          lineNumber = cp?.line ?? 0;
        let parts: Buffer[] = [],
          length = 0,
          dropping = false,
          consumed = 0;
        const start = offset;
        store.db.exec('BEGIN IMMEDIATE');
        transaction = true;
        if (!cp) store.clearSource(ref);
        // The stream owns only the already validated read-only file descriptor.
        if (stat.size > start) {
          stream = fs.createReadStream(file, {
            fd,
            autoClose: false,
            start,
            end: stat.size - 1,
            highWaterMark: READ_BLOCK,
          });
          for await (const chunk of stream.iterator({ destroyOnReturn: false })) {
            bytes += chunk.length;
            let cursor = 0;
            while (cursor < chunk.length) {
              const newline = chunk.indexOf(10, cursor);
              const end = newline < 0 ? chunk.length : newline;
              const part = chunk.subarray(cursor, end);
              if (!dropping) {
                if (length + part.length > MAX_LINE) {
                  parts = [];
                  length = 0;
                  dropping = true;
                  state.diagnostics.oversize++;
                } else if (part.length) {
                  parts.push(part);
                  length += part.length;
                }
              }
              if (newline < 0) break;
              lineNumber++;
              const absoluteEnd = start + consumed + newline + 1;
              offset = absoluteEnd;
              if (!dropping && length) {
                const buffer = parts.length === 1 ? parts[0] : Buffer.concat(parts, length);
                // Native byte searches avoid decoding conversation-only Codex lines.
                // This is a conservative prefilter; the existing schema check still
                // decides relevance, including malformed metadata and quoted markers.
                const candidate =
                  root.provider === 'claude' ||
                  CODEX_MARKERS.some((marker) => buffer.includes(marker));
                if (candidate) {
                  let o: unknown = null;
                  try {
                    o = usageMetadata(buffer, root.provider);
                  } catch {
                    state.diagnostics.malformed++;
                  }
                  if (o) {
                    const r =
                      root.provider === 'codex'
                        ? parseCodex(o, state as CodexState, ref, lineNumber)
                        : parseClaude(o, state as ClaudeState, ref, lineNumber);
                    if (r) {
                      const result = store.put(r, ref);
                      if (result !== 'new') state.diagnostics.repeated++;
                    }
                  }
                }
              }
              parts = [];
              length = 0;
              dropping = false;
              cursor = newline + 1;
            }
            consumed += chunk.length;
            options.onProgress?.({
              provider: root.provider,
              files: status.scanned + status.cached,
              total: status.files,
              bytes,
              phase: 'scanning',
            });
          }
        }
        if (length || dropping) state.diagnostics.partialTail = true;
        const checkpoint: Checkpoint = {
          ref,
          size: stat.size,
          mtime: stat.mtimeMs,
          offset,
          line: lineNumber,
          head: fingerprint(fd, 0, Math.min(4096, offset)),
          tail: fingerprint(fd, Math.max(0, offset - 4096), Math.min(4096, offset)),
          state,
          identity,
        };
        // New records always receive a source association in put(); neither a
        // fresh import nor an append creates orphans needing a global sweep.
        store.saveCheckpoint(checkpoint);
        store.db.exec('COMMIT');
        transaction = false;
        status.scanned++;
        combine(status.diagnostics, state.diagnostics);
      } catch {
        if (transaction) store.db.exec('ROLLBACK');
        status.errors++;
        const previous = store.checkpoint(ref);
        if (previous) combine(status.diagnostics, previous.state.diagnostics);
      } finally {
        // A failed loop must not implicitly close the descriptor and then close
        // it again here. Await the stream's single close, including pending reads.
        if (stream) await new Promise<void>((resolve) => stream!.close(() => resolve()));
        else if (fd !== undefined) fs.closeSync(fd);
      }
    }
  }
  // Missing sources are retained as cached history, never silently treated as zero.
  for (const cp of store.allCheckpoints())
    if (!seen.has(cp.ref)) {
      const provider = (cp.state as CodexState).thread !== undefined ? 'codex' : 'claude';
      statuses.find((s) => s.provider === provider)!.missingFiles++;
    }
  store.save('sources', statuses);
  store.save('lastScan', new Date().toISOString());
  options.onProgress?.({
    provider: 'codex',
    files: statuses.reduce((n, s) => n + s.scanned + s.cached, 0),
    total: statuses.reduce((n, s) => n + s.files, 0),
    bytes,
    phase: 'complete',
  });
  return statuses;
}
