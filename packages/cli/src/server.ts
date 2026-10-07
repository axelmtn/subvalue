import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Store } from '../../core/src/storage.ts';
import { scan, type ScanProgress } from '../../core/src/scanner.ts';
import { dateRange, summarize } from '../../core/src/summary.ts';
import { demoData } from '../../core/src/demo.ts';
import {
  defaultSettings,
  type BillingMode,
  type Settings,
  type UsageRecord,
} from '../../core/src/types.ts';
import type { Summary } from '../../core/src/summary.ts';
import type { BootstrapResponse } from './protocol.ts';
import { isRecord } from '../../core/src/metadata.ts';
import { safeDirectory } from '../../core/src/security.ts';
import { subscriptionPlan } from '../../core/src/subscriptions.ts';
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const billingModes = ['UNKNOWN', 'SUBSCRIPTION', 'NO_SUBSCRIPTION', 'API', 'MIXED'] as const;
const isBillingMode = (value: unknown): value is BillingMode =>
  billingModes.some((mode) => mode === value);

export function validateSettings(value: unknown): Settings {
  if (!isRecord(value) || value.currency !== 'USD' || typeof value.onboarded !== 'boolean')
    throw new Error('Invalid settings');
  if (!isRecord(value.billing) || !isRecord(value.include))
    throw new Error('Invalid billing settings');
  const settings = defaultSettings();
  settings.onboarded = value.onboarded;
  if (value.receiptTheme !== undefined) {
    if (value.receiptTheme !== 'dark' && value.receiptTheme !== 'light')
      throw new Error('Invalid receipt theme');
    settings.receiptTheme = value.receiptTheme;
  }
  for (const provider of ['codex', 'claude'] as const) {
    const billing = value.billing[provider];
    const included = value.include[provider];
    if (!isRecord(billing) || !isBillingMode(billing.mode) || typeof included !== 'boolean')
      throw new Error('Invalid billing settings');
    const monthly = billing.monthly;
    if (
      monthly !== null &&
      (typeof monthly !== 'number' || !Number.isFinite(monthly) || monthly < 0 || monthly > 1000000)
    )
      throw new Error('Invalid subscription amount');
    const planId = billing.planId;
    if (planId != null && typeof planId !== 'string') throw new Error('Invalid subscription plan');
    const plan = planId == null ? undefined : subscriptionPlan(provider, planId);
    if (planId != null && !plan) throw new Error('Invalid subscription plan');
    if (
      billing.mode === 'SUBSCRIPTION' &&
      plan &&
      (monthly === null || Math.abs(monthly - plan.monthly) > 0.005)
    )
      throw new Error('Subscription amount does not match the selected plan');
    settings.billing[provider] = {
      mode: billing.mode,
      monthly: billing.mode === 'SUBSCRIPTION' ? (plan?.monthly ?? monthly) : null,
    };
    if (billing.mode === 'SUBSCRIPTION' && planId !== undefined)
      settings.billing[provider].planId = plan?.id ?? null;
    settings.include[provider] = included;
  }
  return settings;
}
export async function startServer(options: {
  store?: Store;
  port: number;
  publicDirectory: string;
  demo?: boolean;
  home?: string;
}) {
  const secret = randomBytes(32).toString('hex');
  const demo = options.demo ? demoData() : null;
  let demoSettings = demo?.settings;
  let scanning = false;
  let progress: ScanProgress | null = null;
  let sessionOrigin = '';
  let scanCompletion: Promise<void> | null = null;
  let revision = '',
    history: UsageRecord[] | null = null;
  const summaries = new Map<string, Summary>();
  const invalidate = () => {
    revision = '';
    history = null;
    summaries.clear();
  };
  const server = http.createServer(async (req, res) => {
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    };
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const expectedHost = new URL(sessionOrigin).host;
    if (req.headers.host !== expectedHost) {
      json(403, { error: 'Host denied' });
      return;
    }
    if (req.headers.origin && req.headers.origin !== sessionOrigin) {
      json(403, { error: 'Origin denied' });
      return;
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      json(403, { error: 'Cross-site access denied' });
      return;
    }
    const url = new URL(req.url ?? '/', sessionOrigin);
    try {
      if (url.pathname.startsWith('/api/')) {
        // The bootstrap is same-origin only. Mutations require its per-launch token.
        if (url.pathname === '/api/bootstrap' && req.method === 'GET') {
          json(200, {
            token: secret,
            settings: demoSettings ?? options.store!.settings(),
            sources: demo?.statuses ?? options.store!.statuses(),
            demo: !!demo,
            lastScan: options.store?.get<string>('lastScan') ?? null,
            scanning,
            progress,
          } satisfies BootstrapResponse);
          return;
        }
        if (url.pathname === '/api/summary' && req.method === 'GET') {
          if (scanning) {
            json(503, { error: 'Scan in progress' });
            return;
          }
          const range = dateRange(
            url.searchParams.get('period') ?? '30d',
            new Date(),
            url.searchParams.get('from') ?? undefined,
            url.searchParams.get('to') ?? undefined,
            url.searchParams.get('month') ?? undefined,
            url.searchParams.get('anchor') ?? undefined,
          );
          // History bounds use all normalized metadata, never original transcripts.
          const currentRevision = demo ? 'demo' : options.store!.revision();
          if (currentRevision !== revision) {
            invalidate();
            revision = currentRevision;
          }
          const key = JSON.stringify(range);
          let result = summaries.get(key);
          if (!result) {
            history ??= demo?.records ?? options.store!.records();
            result = summarize(
              history,
              demo?.statuses ?? options.store!.statuses(),
              demoSettings ?? options.store!.settings(),
              range,
              demo?.catalog,
              !!demo,
            );
            if (summaries.size >= 16) summaries.delete(summaries.keys().next().value!);
            summaries.set(key, result);
          }
          json(200, result);
          return;
        }
        const given = req.headers['x-subvalue-token'];
        if (
          typeof given !== 'string' ||
          given.length !== secret.length ||
          !timingSafeEqual(Buffer.from(given), Buffer.from(secret))
        ) {
          json(403, { error: 'Session token required' });
          return;
        }
        if (url.pathname === '/api/settings' && req.method === 'POST') {
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 16384) {
              json(413, { error: 'Request too large' });
              return;
            }
          }
          const settings = validateSettings(JSON.parse(body));
          // A rescan holds a transaction on this connection while streaming files.
          // Save independently after it ends, so a later rollback cannot erase
          // settings that the browser has already been told were persisted.
          while (scanCompletion) await scanCompletion;
          if (demo) demoSettings = settings;
          else options.store!.saveSettings(settings);
          invalidate();
          json(200, { saved: true });
          return;
        }
        if (url.pathname === '/api/rescan' && req.method === 'POST') {
          if (demo) {
            json(200, { scanning: false });
            return;
          }
          if (scanning) {
            json(409, { error: 'Scan already running' });
            return;
          }
          scanning = true;
          json(202, { scanning: true });
          scanCompletion = scan(options.store!, {
            home: options.home,
            onProgress: (p) => {
              progress = p;
            },
          })
            .then(() => {})
            .catch(() => {
              progress = null;
            })
            .finally(() => {
              invalidate();
              scanning = false;
              scanCompletion = null;
            });
          return;
        }
        json(404, { error: 'Not found' });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(405, { error: 'Method not allowed' });
        return;
      }
      const name =
        url.pathname === '/' || ['/overview', '/receipt', '/settings'].includes(url.pathname)
          ? 'index.html'
          : url.pathname === '/landing'
            ? 'landing.html'
            : url.pathname.slice(1);
      if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.includes('..') || !mime[path.extname(name)]) {
        json(404, { error: 'Not found' });
        return;
      }
      const base = path.resolve(options.publicDirectory),
        target = path.resolve(base, name);
      if (
        !target.startsWith(base + path.sep) ||
        !safeDirectory(path.dirname(target)) ||
        !fs.existsSync(target)
      ) {
        json(404, { error: 'Not found' });
        return;
      }
      const before = fs.lstatSync(target);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        !fs.realpathSync(target).startsWith(fs.realpathSync(base) + path.sep)
      ) {
        json(404, { error: 'Not found' });
        return;
      }
      if (req.method === 'HEAD') {
        res.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(target)] });
        res.end();
        return;
      }
      const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)),
        after = fs.fstatSync(fd);
      if (before.ino !== after.ino || before.dev !== after.dev) {
        fs.closeSync(fd);
        json(404, { error: 'Not found' });
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(target)] });
      const stream = fs.createReadStream(target, { fd, autoClose: true });
      stream.on('error', () => res.destroy());
      res.once('close', () => stream.destroy());
      stream.pipe(res);
    } catch {
      json(400, { error: 'Unable to complete request' });
    }
  });
  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      const error = (e: Error) => reject(e);
      server.once('error', error);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', error);
        const address = server.address();
        if (!address || typeof address === 'string')
          return reject(new Error('No listening address'));
        sessionOrigin = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  try {
    await listen(options.port);
  } catch (e) {
    if (
      options.port === 0 ||
      !['EADDRINUSE', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')
    )
      throw e;
    await listen(0);
  }
  return {
    server,
    url: sessionOrigin,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
