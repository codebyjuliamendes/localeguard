import { flattenCatalog, type FlatCatalog } from './catalog.js';
import { expectedDirection, pluralCategories } from './locale.js';
import {
  branchUses,
  describeSignature,
  literalText,
  parseMessage,
  placeholderSignature,
  renderedLength,
  signaturesEqual,
  textualPlaceholders,
  type ParsedMessage,
} from './message.js';
import { bidiControlsBalanced, ISOLATE_PATTERN, LATIN_PATTERN, RTL_SCRIPT_PATTERN } from './text.js';
import type { CatalogInput, Coverage, InspectOptions, InspectionResult, Issue, IssueCode, Severity } from './types.js';

export const DIRECTION_KEY = '__direction__';
export const DEFAULT_EXPANSION_RATIO = 1.55;
export const DEFAULT_EXPANSION_MIN_LENGTH = 11;

const KINDS: Record<IssueCode, string> = {
  missing_translation: 'Missing translation',
  empty_translation: 'Empty translation',
  empty_source: 'Empty source string',
  invalid_value: 'Invalid value',
  duplicate_key: 'Duplicate key',
  malformed_message: 'Malformed message',
  placeholder_mismatch: 'Placeholder mismatch',
  plural_other_missing: 'Missing "other" plural form',
  plural_categories_missing: 'Incomplete plural forms',
  plural_category_unused: 'Unused plural form',
  select_other_missing: 'Missing "other" select case',
  length_budget: 'Text exceeds UI budget',
  text_expansion: 'Text expansion',
  unknown_key: 'Unknown key',
  direction_mismatch: 'Direction mismatch',
  missing_rtl_script: 'Missing RTL script',
  bidi_isolation: 'Bidi isolation recommended',
  bidi_controls_unbalanced: 'Unbalanced bidi controls',
  legacy: 'Finding',
};

export const SEVERITY_RANK: Record<Severity, number> = { blocker: 0, warning: 1, info: 2 };

export function issueKind(code: IssueCode): string {
  return KINDS[code];
}

const percent = (value: number, base: number): number => Math.round((value / Math.max(base, 1)) * 100);
const list = (items: readonly string[]): string => items.join(', ');

class IssueCollector {
  readonly issues: Issue[] = [];
  add(locale: string, key: string, severity: Severity, code: IssueCode, detail: string): void {
    this.issues.push({ locale, key, severity, code, kind: KINDS[code], detail });
  }
}

interface MessageContext {
  locale: string;
  key: string;
  value: string;
  parsed: ParsedMessage;
  rtl: boolean;
}

/** Checks that apply to any single message regardless of the source (syntax, plurals, bidi). */
function checkMessage(out: IssueCollector, { locale, key, value, parsed, rtl }: MessageContext): void {
  if (parsed.error) out.add(locale, key, 'blocker', 'malformed_message', `${parsed.error} Placeholder checks used a best-effort fallback.`);

  for (const use of branchUses(parsed.nodes)) {
    const selectors = new Set(use.selectors);
    if (!selectors.has('other')) {
      out.add(
        locale,
        key,
        'blocker',
        use.format === 'select' ? 'select_other_missing' : 'plural_other_missing',
        `{${use.name}, ${use.format}} must define an "other" case; ICU formatters throw or fall back without it.`,
      );
    }
    if (use.format === 'select') continue;
    const required = pluralCategories(locale, use.format === 'plural' ? 'cardinal' : 'ordinal');
    // `=0`/`=1`/`=2` explicit cases are accepted in place of zero/one/two.
    const exact: Record<string, string> = { zero: '=0', one: '=1', two: '=2' };
    const missing = required.filter(
      // "other" is already reported as a blocker above.
      (category) => category !== 'other' && !selectors.has(category) && !(exact[category] && selectors.has(exact[category])),
    );
    if (missing.length) {
      out.add(
        locale,
        key,
        'warning',
        'plural_categories_missing',
        `${locale} uses the ${use.format === 'plural' ? 'cardinal' : 'ordinal'} plural forms ${list(required)}; {${use.name}} is missing ${list(missing)}.`,
      );
    }
    const unused = use.selectors.filter((selector) => !selector.startsWith('=') && !required.includes(selector));
    if (unused.length) {
      out.add(
        locale,
        key,
        'info',
        'plural_category_unused',
        `${locale} never selects ${list(unused)} for {${use.name}}; these branches are dead text.`,
      );
    }
  }

  if (!bidiControlsBalanced(value)) {
    out.add(
      locale,
      key,
      'warning',
      'bidi_controls_unbalanced',
      'Directional embedding/isolate characters are not closed; surrounding UI text may be reordered.',
    );
  }

  if (!rtl) return;
  const literal = literalText(parsed.nodes);
  if (LATIN_PATTERN.test(literal) && !RTL_SCRIPT_PATTERN.test(literal)) {
    out.add(
      locale,
      key,
      'warning',
      'missing_rtl_script',
      `${locale} is a right-to-left locale but this string has only Latin text; it may be untranslated.`,
    );
  }
  const textual = textualPlaceholders(parsed.nodes);
  // Reordering only matters when the placeholder sits inside RTL text.
  if (textual.length && RTL_SCRIPT_PATTERN.test(literal) && !ISOLATE_PATTERN.test(value)) {
    out.add(
      locale,
      key,
      'info',
      'bidi_isolation',
      `Wrap ${list(textual)} in U+2068 FSI … U+2069 PDI (or render it inside <bdi>) so LTR values such as names or emails do not reorder the RTL sentence.`,
    );
  }
}

function checkStructure(out: IssueCollector, locale: string, flat: FlatCatalog): void {
  for (const key of flat.invalid) out.add(locale, key, 'blocker', 'invalid_value', 'Values must be strings or nested objects of strings.');
  for (const key of flat.duplicates)
    out.add(locale, key, 'blocker', 'duplicate_key', 'This key is defined more than once (dotted and nested forms collide).');
}

function checkLength(
  out: IssueCollector,
  ctx: { locale: string; key: string; length: number; sourceLength: number | undefined; budget: number | undefined },
  options: { expansionRatio: number; expansionMinLength: number },
): void {
  const { locale, key, length, sourceLength, budget } = ctx;
  if (budget !== undefined && length > budget) {
    const ratio = sourceLength === undefined ? '' : ` (${percent(length, sourceLength)}% of the source length)`;
    out.add(locale, key, 'warning', 'length_budget', `${length} characters for a ${budget}-character UI budget${ratio}.`);
  } else if (sourceLength !== undefined && sourceLength >= options.expansionMinLength && length > sourceLength * options.expansionRatio) {
    out.add(
      locale,
      key,
      'warning',
      'text_expansion',
      `This translation is ${percent(length, sourceLength)}% of the source length; review buttons and narrow layouts.`,
    );
  }
}

export function sortIssues(issues: Issue[]): Issue[] {
  return issues.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.locale.localeCompare(b.locale) ||
      a.key.localeCompare(b.key) ||
      a.code.localeCompare(b.code),
  );
}

export function countIssues(issues: readonly Issue[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { blocker: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity]++;
  return counts;
}

/**
 * Compares every target catalog against the base catalog.
 * Pure and deterministic: shared by the HTTP API and the CLI.
 */
export function inspectCatalogs(baseLocale: string, catalogs: readonly CatalogInput[], options: InspectOptions = {}): InspectionResult {
  const out = new IssueCollector();
  const budgets = options.budgets ?? {};
  const lengthOptions = {
    expansionRatio: options.expansionRatio ?? DEFAULT_EXPANSION_RATIO,
    expansionMinLength: options.expansionMinLength ?? DEFAULT_EXPANSION_MIN_LENGTH,
  };
  const coverage: Coverage = { translated: 0, expected: 0, ratio: 1 };

  const base = catalogs.find((catalog) => catalog.locale === baseLocale);
  for (const catalog of catalogs) {
    if (catalog.direction === undefined) continue;
    const expected = expectedDirection(catalog.locale);
    if (catalog.direction !== expected) {
      out.add(
        catalog.locale,
        DIRECTION_KEY,
        'blocker',
        'direction_mismatch',
        `${catalog.locale} should use ${expected.toUpperCase()} layout direction.`,
      );
    }
  }
  if (!base) return { issues: sortIssues(out.issues), coverage, counts: countIssues(out.issues) };

  const baseFlat = flattenCatalog(base.strings);
  const baseRtl = expectedDirection(baseLocale) === 'rtl';
  checkStructure(out, baseLocale, baseFlat);
  const sources = new Map<string, { parsed: ParsedMessage; length: number }>();
  for (const [key, value] of baseFlat.entries) {
    const parsed = parseMessage(value);
    const length = renderedLength(parsed.nodes);
    sources.set(key, { parsed, length });
    if (!value.trim())
      out.add(baseLocale, key, 'warning', 'empty_source', 'The source string is empty; translators have nothing to work from.');
    checkMessage(out, { locale: baseLocale, key, value, parsed, rtl: baseRtl });
    checkLength(out, { locale: baseLocale, key, length, sourceLength: undefined, budget: budgets[key] }, lengthOptions);
  }

  for (const target of catalogs) {
    if (target === base) continue;
    const { locale } = target;
    const flat = flattenCatalog(target.strings);
    const rtl = expectedDirection(locale) === 'rtl';
    checkStructure(out, locale, flat);

    for (const [key, source] of sources) {
      coverage.expected++;
      const value = flat.entries.get(key);
      if (value === undefined) {
        if (!flat.invalid.includes(key)) out.add(locale, key, 'blocker', 'missing_translation', `No ${locale} string exists for this key.`);
        continue;
      }
      if (!value.trim()) {
        // An empty source makes an empty translation correct.
        if (baseFlat.entries.get(key)?.trim()) out.add(locale, key, 'blocker', 'empty_translation', 'The translated value is empty.');
        else coverage.translated++;
        continue;
      }
      coverage.translated++;
      const parsed = parseMessage(value);
      const expected = placeholderSignature(source.parsed.nodes);
      const actual = placeholderSignature(parsed.nodes);
      if (!signaturesEqual(expected, actual)) {
        out.add(
          locale,
          key,
          'blocker',
          'placeholder_mismatch',
          `Expected ${describeSignature(expected)}; found ${describeSignature(actual)}.`,
        );
      }
      checkMessage(out, { locale, key, value, parsed, rtl });
      checkLength(
        out,
        { locale, key, length: renderedLength(parsed.nodes), sourceLength: source.length, budget: budgets[key] },
        lengthOptions,
      );
    }

    for (const key of flat.entries.keys()) {
      if (!sources.has(key)) out.add(locale, key, 'warning', 'unknown_key', `This key does not exist in the ${baseLocale} source catalog.`);
    }
  }

  coverage.ratio = coverage.expected ? coverage.translated / coverage.expected : 1;
  return { issues: sortIssues(out.issues), coverage, counts: countIssues(out.issues) };
}
