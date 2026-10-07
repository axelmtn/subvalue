import type { Settings, SourceStatus } from '../../core/src/types.ts';
import type { ScanProgress } from '../../core/src/scanner.ts';

/** Safe bootstrap metadata shared by the local server and bundled dashboard. */
export interface BootstrapResponse {
  token: string;
  settings: Settings;
  sources: SourceStatus[];
  demo: boolean;
  lastScan: string | null;
  scanning: boolean;
  progress: ScanProgress | null;
}
