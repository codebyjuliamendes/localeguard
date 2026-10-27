/** Pure presentation helpers (no DOM access) so they can be unit tested under Node. */
import type { Coverage, Issue, Severity } from '../http/contract.js';

export type LocaleHealth = 'source' | 'blocking' | 'review' | 'healthy';

const displayNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    return undefined;
  }
})();

export function localeLabel(tag: string): string {
  try {
    return displayNames?.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Regional-indicator flag for the region subtag, or a globe when there is none. */
export function flagFor(tag: string): string {
  const region = tag.split('-').find((part, index) => index > 0 && /^[A-Z]{2}$/.test(part));
  if (!region) return '🌐';
  // Region is validated as two ASCII capitals above.
  return String.fromCodePoint(0x1f1e6 + region.charCodeAt(0) - 65, 0x1f1e6 + region.charCodeAt(1) - 65);
}

export function localeHealth(locale: string, baseLocale: string, issues: readonly Issue[]): LocaleHealth {
  if (locale === baseLocale && !issues.some((issue) => issue.locale === locale && issue.severity === 'blocker')) return 'source';
  const own = issues.filter((issue) => issue.locale === locale && issue.severity !== 'info');
  if (own.some((issue) => issue.severity === 'blocker')) return 'blocking';
  return own.length ? 'review' : 'healthy';
}

export function countBySeverity(issues: readonly Issue[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { blocker: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity]++;
  return counts;
}

export function coverageLabel(coverage: Coverage | null | undefined): string {
  if (!coverage) return '–';
  // Floor so 99.6% never displays as a misleading 100%.
  return `${Math.floor(coverage.ratio * 100)}%`;
}

export function formatTimestamp(iso: string, locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Reads a dotted key from a nested or flat catalog for previewing a finding's text. */
export function lookupString(tree: Record<string, unknown>, key: string): string | undefined {
  const direct = tree[key];
  if (typeof direct === 'string') return direct;
  const parts = key.split('.');
  for (let split = 1; split < parts.length; split++) {
    const head = parts.slice(0, split).join('.');
    const child = tree[head];
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      const found = lookupString(child as Record<string, unknown>, parts.slice(split).join('.'));
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
