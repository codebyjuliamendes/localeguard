import { describe, expect, it } from 'vitest';
import type { Issue } from '../../src/http/contract.js';
import {
  countBySeverity,
  coverageLabel,
  flagFor,
  formatTimestamp,
  localeHealth,
  localeLabel,
  lookupString,
  pluralize,
} from '../../src/web/format.js';

const issue = (locale: string, severity: Issue['severity']): Issue => ({
  locale,
  key: 'k',
  severity,
  code: 'unknown_key',
  kind: 'x',
  detail: 'y',
});

describe('web format helpers', () => {
  it('labels locales and flags', () => {
    expect(localeLabel('de-DE')).toBe('German (Germany)');
    expect(localeLabel('zz-ZZ-invalid!')).toBe('zz-ZZ-invalid!');
    expect(flagFor('pt-BR')).toBe('🇧🇷');
    expect(flagFor('ar')).toBe('🌐');
    expect(flagFor('es-419')).toBe('🌐');
  });

  it('derives locale health, ignoring notices', () => {
    const issues = [issue('de-DE', 'blocker'), issue('fr-FR', 'warning'), issue('ar-SA', 'info')];
    expect(localeHealth('en-US', 'en-US', issues)).toBe('source');
    expect(localeHealth('de-DE', 'en-US', issues)).toBe('blocking');
    expect(localeHealth('fr-FR', 'en-US', issues)).toBe('review');
    expect(localeHealth('ar-SA', 'en-US', issues)).toBe('healthy');
    expect(localeHealth('en-US', 'en-US', [issue('en-US', 'blocker')])).toBe('blocking');
    expect(countBySeverity(issues)).toEqual({ blocker: 1, warning: 1, info: 1 });
  });

  it('formats coverage, counts and timestamps', () => {
    expect(coverageLabel({ translated: 995, expected: 1000, ratio: 0.995 })).toBe('99%');
    expect(coverageLabel(null)).toBe('–');
    expect(pluralize(1, 'key')).toBe('1 key');
    expect(pluralize(2, 'key')).toBe('2 keys');
    expect(formatTimestamp('not a date')).toBe('not a date');
    expect(formatTimestamp('2026-01-02T03:04:05Z', 'en-US')).toMatch(/2026/);
  });

  it('looks up flat, nested and mixed keys', () => {
    const tree = { 'a.b': 'flat', nav: { settings: 'nested', 'x.y': 'mixed' } };
    expect(lookupString(tree, 'a.b')).toBe('flat');
    expect(lookupString(tree, 'nav.settings')).toBe('nested');
    expect(lookupString(tree, 'nav.x.y')).toBe('mixed');
    expect(lookupString(tree, 'nav.missing')).toBeUndefined();
  });
});
