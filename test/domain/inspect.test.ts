import { describe, expect, it } from 'vitest';
import { inspectCatalogs, type CatalogInput, type Issue } from '../../src/domain/index.js';

const run = (base: Record<string, unknown>, target: Record<string, unknown>, locale = 'de-DE', options = {}): Issue[] =>
  inspectCatalogs(
    'en-US',
    [
      { locale: 'en-US', strings: base },
      { locale, strings: target },
    ],
    options,
  ).issues;
const codes = (issues: Issue[]): string[] => issues.map((issue) => `${issue.locale}:${issue.key}:${issue.code}`);

describe('inspectCatalogs — scenarios ported from the original CLI tests', () => {
  it('reports missing keys and mismatched placeholders', () => {
    const issues = run({ welcome: 'Hello {name}', cancel: 'Cancel' }, { welcome: 'Hallo {user}' });
    expect(codes(issues)).toEqual(['de-DE:cancel:missing_translation', 'de-DE:welcome:placeholder_mismatch']);
    expect(issues[1]?.detail).toBe('Expected {name}; found {user}.');
    expect(issues.every((issue) => issue.severity === 'blocker')).toBe(true);
  });

  it('accepts complete translations and flags unknown keys', () => {
    expect(codes(run({ welcome: 'Hello {name}' }, { welcome: 'Hallo {name}', extra: 'Zusatz' }))).toEqual(['de-DE:extra:unknown_key']);
    expect(run({ welcome: 'Hello {name}' }, { welcome: 'Hallo {name}' })).toEqual([]);
  });
});

describe('inspectCatalogs — server scan behaviour', () => {
  it('flags empty and whitespace-only translations as blockers', () => {
    expect(codes(run({ a: 'A', b: 'B' }, { a: '', b: '   ' }))).toEqual(['de-DE:a:empty_translation', 'de-DE:b:empty_translation']);
  });

  it('accepts an empty translation when the source is empty, but warns about the source', () => {
    const result = inspectCatalogs('en-US', [
      { locale: 'en-US', strings: { a: '' } },
      { locale: 'de-DE', strings: { a: '' } },
    ]);
    expect(codes(result.issues)).toEqual(['en-US:a:empty_source']);
    expect(result.coverage).toEqual({ translated: 1, expected: 1, ratio: 1 });
  });

  it('applies per-key budgets with grapheme counts and reports the source ratio', () => {
    const [issue] = run({ title: 'Save' }, { title: 'Speichern' }, 'de-DE', { budgets: { title: 6 } });
    expect(issue).toMatchObject({
      code: 'length_budget',
      severity: 'warning',
      detail: '9 characters for a 6-character UI budget (225% of the source length).',
    });
  });

  it('counts graphemes, not UTF-16 code units', () => {
    // 5 family emoji = 5 graphemes but 55 code units.
    const family = '👨‍👩‍👧‍👦'.repeat(5);
    expect(family.length).toBe(55);
    expect(run({ e: 'Hi' }, { e: family }, 'de-DE', { budgets: { e: 5 } })).toEqual([]);
    expect(codes(run({ e: 'Hi' }, { e: family }, 'de-DE', { budgets: { e: 4 } }))).toEqual(['de-DE:e:length_budget']);
  });

  it('warns about text expansion only for sources of at least 11 graphemes', () => {
    expect(codes(run({ s: 'Short text!' }, { s: 'Ein deutlich längerer Text' }))).toEqual(['de-DE:s:text_expansion']);
    expect(run({ s: 'Short text' }, { s: 'Ein deutlich längerer Text' })).toEqual([]);
  });

  it('checks the declared layout direction', () => {
    const catalogs: CatalogInput[] = [
      { locale: 'en-US', strings: {}, direction: 'ltr' },
      { locale: 'ar-SA', strings: {}, direction: 'ltr' },
      { locale: 'he-IL', strings: {}, direction: 'rtl' },
    ];
    const { issues } = inspectCatalogs('en-US', catalogs);
    expect(issues).toEqual([
      expect.objectContaining({
        locale: 'ar-SA',
        key: '__direction__',
        code: 'direction_mismatch',
        detail: 'ar-SA should use RTL layout direction.',
      }),
    ]);
  });

  it('computes key coverage over every target catalog', () => {
    const result = inspectCatalogs('en-US', [
      { locale: 'en-US', strings: { a: 'A', b: 'B' } },
      { locale: 'de-DE', strings: { a: 'A' } },
      { locale: 'fr-FR', strings: { a: 'A', b: 'B' } },
    ]);
    expect(result.coverage).toEqual({ translated: 3, expected: 4, ratio: 0.75 });
    expect(result.counts).toEqual({ blocker: 1, warning: 0, info: 0 });
  });

  it('returns no issues and full coverage without a base catalog', () => {
    const result = inspectCatalogs('en-US', [{ locale: 'de-DE', strings: { a: 'A' } }]);
    expect(result).toEqual({ issues: [], coverage: { translated: 0, expected: 0, ratio: 1 }, counts: { blocker: 0, warning: 0, info: 0 } });
  });

  it('sorts issues by severity, locale and key', () => {
    const issues = inspectCatalogs('en-US', [
      { locale: 'en-US', strings: { b: 'B', a: 'Hello {x}' } },
      { locale: 'fr-FR', strings: { extra: 'x' } },
      { locale: 'de-DE', strings: { a: 'Hallo', b: 'B' } },
    ]).issues;
    expect(codes(issues)).toEqual([
      'de-DE:a:placeholder_mismatch',
      'fr-FR:a:missing_translation',
      'fr-FR:b:missing_translation',
      'fr-FR:extra:unknown_key',
    ]);
  });
});

describe('inspectCatalogs — nested catalogs', () => {
  it('flattens nested keys and matches them against dotted keys', () => {
    expect(
      run({ nav: { settings: 'Settings', billing: 'Billing' } }, { 'nav.settings': 'Einstellungen', nav: { billing: 'Abrechnung' } }),
    ).toEqual([]);
  });

  it('reports colliding and invalid values', () => {
    const issues = run({ a: { b: 'B' } }, { 'a.b': 'x', a: { b: 'y' }, n: 3, list: ['x'] });
    expect(codes(issues)).toEqual(['de-DE:a.b:duplicate_key', 'de-DE:list:invalid_value', 'de-DE:n:invalid_value']);
  });
});

describe('inspectCatalogs — placeholder dialects', () => {
  it.each([
    ['ICU simple', 'Hi {name}', 'Hallo {name}', true],
    ['ICU formatted vs simple', 'Paid {amount, number, ::currency/EUR}', 'Bezahlt {amount}', true],
    ['ICU plural vs simple', '{count, plural, one {# day} other {# days}}', '{count} Tage', false],
    ['mustache', 'Hi {{user}}', 'Hallo {{ user }}', true],
    ['mustache renamed', 'Hi {{user}}', 'Hallo {{name}}', false],
    ['printf order', '%s has %d items', '%d Elemente hat %s', false],
    ['printf positional reorder', '%1$s has %2$d items', '%2$d Elemente hat %1$s', true],
    ['printf literal percent', '50%% off %s', '50 %% Rabatt %s', true],
    ['printf missing', 'Hi %s', 'Hallo', false],
    ['percent sign in prose', '50% off', '50 % Rabatt', true],
    ['ICU quoted braces', "Use '{braces}'", "Nutze '{Klammern}'", true],
    ['apostrophe in prose', "Don't {verb}", "N'oubliez pas {verb}", true],
  ])('%s', (_label, source, target, ok) => {
    const issues = run({ k: source }, { k: target }).filter((issue) => issue.code === 'placeholder_mismatch');
    expect(issues.length === 0).toBe(ok);
  });

  it('compares placeholders nested inside plural branches', () => {
    const source = '{count, plural, one {# file by {owner}} other {# files by {owner}}}';
    const target = '{count, plural, one {# Datei von {user}} other {# Dateien von {user}}}';
    const [issue] = run({ k: source }, { k: target });
    expect(issue?.detail).toBe('Expected {count, plural}, {owner}; found {count, plural}, {user}.');
  });

  it('reports malformed messages and still compares placeholders', () => {
    const issues = run({ k: 'Hello {name}' }, { k: 'Hallo {name' });
    expect(codes(issues)).toEqual(['de-DE:k:malformed_message', 'de-DE:k:placeholder_mismatch']);
    expect(issues[0]?.detail).toContain('is not closed');
    // The fallback still recognises intact placeholders in a broken message.
    expect(codes(run({ k: 'Hi {name} {x}' }, { k: 'Hallo {name} {x' }))).toEqual([
      'de-DE:k:malformed_message',
      'de-DE:k:placeholder_mismatch',
    ]);
    expect(codes(run({ k: 'Hi {name}' }, { k: 'Hallo {name} }' }))).toEqual(['de-DE:k:malformed_message']);
  });

  it('reports stray closing braces', () => {
    expect(codes(run({ k: 'Hi' }, { k: 'Hallo }' }))).toEqual(['de-DE:k:malformed_message']);
  });
});

describe('inspectCatalogs — plural rules per locale', () => {
  const source = '{n, plural, one {# item} other {# items}}';

  it('requires the CLDR categories of the target locale', () => {
    const [issue] = run({ k: source }, { k: '{n, plural, one {# عنصر} other {# عناصر}}' }, 'ar-SA');
    expect(issue).toMatchObject({ code: 'plural_categories_missing', severity: 'warning' });
    expect(issue?.detail).toBe(
      'ar-SA uses the cardinal plural forms zero, one, two, few, many, other; {n} is missing zero, two, few, many.',
    );
  });

  it('accepts complete Arabic and Polish plurals', () => {
    expect(run({ k: source }, { k: '{n, plural, zero {ص} one {و} two {ا} few {ق} many {ك} other {غ}}' }, 'ar-SA')).toEqual([]);
    expect(run({ k: source }, { k: '{n, plural, one {# plik} few {# pliki} many {# plików} other {# pliku}}' }, 'pl-PL')).toEqual([]);
  });

  it('accepts =1 in place of one and flags categories the locale never uses', () => {
    expect(run({ k: source }, { k: '{n, plural, =1 {ein Ding} other {# Dinge}}' })).toEqual([]);
    expect(codes(run({ k: source }, { k: '{n, plural, one {#} few {#} other {#}}' }))).toEqual(['de-DE:k:plural_category_unused']);
  });

  it('treats a missing other case as a blocker', () => {
    expect(codes(run({ k: source }, { k: '{n, plural, one {#}}' }))).toEqual(['de-DE:k:plural_other_missing']);
    expect(codes(run({ k: '{g, select, male {He} other {They}}' }, { k: '{g, select, male {Er}}' }))).toEqual([
      'de-DE:k:select_other_missing',
    ]);
  });

  it('uses ordinal rules for selectordinal', () => {
    const ordinal = '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}';
    expect(run({ k: ordinal }, { k: ordinal }, 'en-GB')).toEqual([]);
    expect(codes(run({ k: ordinal }, { k: '{n, selectordinal, other {#.}}' }, 'de-DE'))).toEqual([]);
  });

  it('measures plural messages by their longest branch', () => {
    const target = '{n, plural, one {# Tag} other {# Tage übrig}}';
    expect(run({ k: source }, { k: target }, 'de-DE', { budgets: { k: 12 } })).toEqual([]);
    expect(codes(run({ k: source }, { k: target }, 'de-DE', { budgets: { k: 11 } }))).toEqual(['de-DE:k:length_budget']);
  });
});

describe('inspectCatalogs — right-to-left locales', () => {
  it.each(['ar-SA', 'he-IL', 'fa-IR', 'ur-PK'])('recommends bidi isolation for textual placeholders in %s', (locale) => {
    const [issue] = run({ k: 'Hello {name}' }, { k: 'שלום {name}' }, locale);
    expect(issue).toMatchObject({ code: 'bidi_isolation', severity: 'info' });
  });

  it('does not recommend isolation when isolates are present or placeholders are numeric', () => {
    expect(run({ k: 'Hi {name}' }, { k: 'مرحبا ⁨{name}⁩' }, 'ar-SA')).toEqual([]);
    expect(run({ k: '{n, number} files' }, { k: '{n, number} ملفات' }, 'ar-SA')).toEqual([]);
  });

  it('warns when an RTL string contains only Latin text', () => {
    expect(codes(run({ k: 'Cancel' }, { k: 'Cancel' }, 'ar-SA'))).toEqual(['ar-SA:k:missing_rtl_script']);
    expect(run({ k: '{count}' }, { k: '{count}' }, 'ar-SA')).toEqual([]);
  });

  it('flags unbalanced bidi control characters in any locale', () => {
    expect(codes(run({ k: 'A' }, { k: '‫B' }))).toEqual(['de-DE:k:bidi_controls_unbalanced']);
    expect(run({ k: 'A' }, { k: '‫B‬' })).toEqual([]);
  });
});
