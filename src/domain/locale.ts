import type { Direction } from './types.js';

/** Languages written right-to-left. ar/he/fa/ur are the primary targets; the rest share the same scripts. */
export const RTL_LANGUAGES: ReadonlySet<string> = new Set(['ar', 'he', 'iw', 'fa', 'ur', 'ps', 'yi', 'dv', 'ckb', 'sd', 'ug']);
const RTL_SCRIPTS: ReadonlySet<string> = new Set(['Arab', 'Hebr', 'Syrc', 'Thaa', 'Nkoo', 'Adlm', 'Rohg']);

// language[-Script][-REGION]; region is ISO 3166 alpha-2 or UN M.49.
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/;

/** Accepts canonical BCP 47 tags of the form `en`, `pt-BR`, `zh-Hant-TW`, `es-419`. */
export function isValidLocale(tag: string): boolean {
  if (!LOCALE_PATTERN.test(tag)) return false;
  try {
    return Intl.getCanonicalLocales(tag)[0] === tag;
  } catch {
    return false;
  }
}

export function expectedDirection(tag: string): Direction {
  const [language = '', ...subtags] = tag.split('-');
  const script = subtags.find((part) => part.length === 4);
  if (script) return RTL_SCRIPTS.has(script) ? 'rtl' : 'ltr';
  return RTL_LANGUAGES.has(language.toLowerCase()) ? 'rtl' : 'ltr';
}

const pluralRulesCache = new Map<string, readonly string[]>();
const CLDR_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** CLDR plural categories required by a locale, e.g. `ar` → zero, one, two, few, many, other. */
export function pluralCategories(locale: string, type: Intl.PluralRuleType = 'cardinal'): readonly string[] {
  const cacheKey = `${locale}|${type}`;
  let categories = pluralRulesCache.get(cacheKey);
  if (!categories) {
    categories = [...new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories].sort(
      (a, b) => CLDR_ORDER.indexOf(a) - CLDR_ORDER.indexOf(b),
    );
    pluralRulesCache.set(cacheKey, categories);
  }
  return categories;
}
