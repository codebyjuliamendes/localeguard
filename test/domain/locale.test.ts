import { describe, expect, it } from 'vitest';
import { flattenCatalog } from '../../src/domain/catalog.js';
import { expectedDirection, isValidLocale, pluralCategories } from '../../src/domain/locale.js';
import { bidiControlsBalanced, graphemeLength } from '../../src/domain/text.js';

describe('locale helpers', () => {
  it.each(['en', 'en-US', 'pt-BR', 'zh-Hant-TW', 'es-419', 'fil-PH'])('accepts %s', (tag) => expect(isValidLocale(tag)).toBe(true));
  it.each(['EN-us', 'en_US', 'english', 'en-us', 'iw-IL', 'x', ''])('rejects %j', (tag) => expect(isValidLocale(tag)).toBe(false));

  it.each([
    ['ar-SA', 'rtl'],
    ['he-IL', 'rtl'],
    ['fa-IR', 'rtl'],
    ['ur-PK', 'rtl'],
    ['de-DE', 'ltr'],
    ['az-Arab', 'rtl'],
    ['uz-Latn-UZ', 'ltr'],
  ])('%s is %s', (tag, direction) => expect(expectedDirection(tag)).toBe(direction));

  it('returns CLDR plural categories in canonical order', () => {
    expect(pluralCategories('ar')).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
    expect(pluralCategories('ja-JP')).toEqual(['other']);
    expect(pluralCategories('en-US', 'ordinal')).toEqual(['one', 'two', 'few', 'other']);
  });
});

describe('text helpers', () => {
  it('counts grapheme clusters', () => {
    expect(graphemeLength('abc')).toBe(3);
    expect(graphemeLength('👩🏽‍💻')).toBe(1);
    expect(graphemeLength('é')).toBe(1);
    expect(graphemeLength('नमस्ते')).toBe(3);
    expect(graphemeLength('a\r\nb')).toBe(3);
  });

  it('checks bidi control balance', () => {
    expect(bidiControlsBalanced('⁨x⁩ ‪y‬')).toBe(true);
    expect(bidiControlsBalanced('⁧x')).toBe(false);
  });
});

describe('flattenCatalog', () => {
  it('flattens nested objects and stops at the depth limit', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: 'too deep' } } } } } } } } };
    expect(flattenCatalog({ x: { y: 'z' }, ...deep })).toEqual({
      entries: new Map([['x.y', 'z']]),
      invalid: ['a.b.c.d.e.f.g.h'],
      duplicates: [],
    });
  });

  it('rejects class instances and null', () => {
    expect(flattenCatalog({ d: new Date(0), n: null }).invalid).toEqual(['d', 'n']);
  });
});
