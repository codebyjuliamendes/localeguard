const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** User-perceived character count: "👩🏽‍💻" and "é" (e + U+0301) both count as one. */
export function graphemeLength(text: string): number {
  // Printable ASCII fast path: one code unit per grapheme.
  if (/^[\x20-\x7e]*$/.test(text)) return text.length;
  return Array.from(segmenter.segment(text)).length;
}

export const RTL_SCRIPT_PATTERN = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u;
export const LATIN_PATTERN = /\p{Script=Latin}/u;
export const ISOLATE_PATTERN = /[\u2066-\u2069]/u;

const EMBEDDING_OPENERS = /[\u202A\u202B\u202D\u202E]/gu;
const EMBEDDING_CLOSER = /\u202C/gu;
const ISOLATE_OPENERS = /[\u2066\u2067\u2068]/gu;
const ISOLATE_CLOSER = /\u2069/gu;

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

/** True when every embedding/override (LRE…RLO) has a PDF and every isolate (LRI/RLI/FSI) has a PDI. */
export function bidiControlsBalanced(text: string): boolean {
  return count(text, EMBEDDING_OPENERS) === count(text, EMBEDDING_CLOSER) && count(text, ISOLATE_OPENERS) === count(text, ISOLATE_CLOSER);
}
