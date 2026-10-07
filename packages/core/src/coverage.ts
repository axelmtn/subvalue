/** Reserve 100% for fully priced usage; missing coverage never becomes zero. */
export function formatPricingCoverage(coverage: number | null): string {
  if (coverage === null || !Number.isFinite(coverage) || coverage < 0 || coverage > 1) {
    return 'Unknown';
  }
  if (coverage === 1) return '100%';
  if (coverage === 0) return '0%';
  const percent = Math.round(coverage * 100);
  if (percent === 100) return '<100%';
  if (percent === 0) return '<1%';
  return `${percent}%`;
}
