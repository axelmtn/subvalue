export type Provider = 'codex' | 'claude';
export type Quality = 'HIGH' | 'MEDIUM' | 'LOW' | 'INCOMPLETE';
export type BillingMode = 'UNKNOWN' | 'SUBSCRIPTION' | 'API' | 'MIXED';
export interface UsageRecord {
  id: string;
  timestamp: string | null;
  provider: Provider;
  source_event_id: string;
  session_id: string | null;
  request_id: string | null;
  thread_id: string | null;
  model_raw: string | null;
  model_canonical: string | null;
  billing_mode: 'UNKNOWN';
  input_tokens: number | null;
  cached_input_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_creation_5m_tokens: number | null;
  cache_creation_1h_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  unallocated_total_tokens: number | null;
  total_tokens: number | null;
  project_identifier_hash: string | null;
  quality: Quality;
  source_schema: string;
  source_file_reference: string;
  notes: string[];
  service_tier: string | null;
  speed: string | null;
  web_search_requests: number | null;
  web_fetch_requests: number | null;
}
export interface Diagnostics {
  malformed: number;
  inherited: number;
  repeated: number;
  resets: number;
  oversize: number;
  unsupported: number;
  partialTail: boolean;
  first: string | null;
  last: string | null;
  records: number;
}
export interface SourceStatus {
  provider: Provider;
  detected: boolean;
  files: number;
  scanned: number;
  cached: number;
  errors: number;
  skippedLinks: number;
  missingFiles: number;
  diagnostics: Diagnostics;
}
export interface Settings {
  onboarded: boolean;
  currency: 'USD';
  include: Record<Provider, boolean>;
  receiptTheme?: 'dark' | 'light';
  billing: Record<Provider, { mode: BillingMode; monthly: number | null; planId?: string | null }>;
}
export const defaultSettings = (): Settings => ({
  onboarded: false,
  currency: 'USD',
  include: { codex: false, claude: false },
  billing: {
    codex: { mode: 'UNKNOWN', monthly: null },
    claude: { mode: 'UNKNOWN', monthly: null },
  },
});
export const emptyDiagnostics = (): Diagnostics => ({
  malformed: 0,
  inherited: 0,
  repeated: 0,
  resets: 0,
  oversize: 0,
  unsupported: 0,
  partialTail: false,
  first: null,
  last: null,
  records: 0,
});
