import type { CatalogTree } from './types.js';

export const KEY_SEPARATOR = '.';
export const MAX_DEPTH = 8;

export interface FlatCatalog {
  /** Flattened string entries in authoring order. */
  entries: Map<string, string>;
  /** Keys whose value is neither a string nor a nested object. */
  invalid: string[];
  /** Keys defined more than once (e.g. `{"a.b": ..., "a": {"b": ...}}`). */
  duplicates: string[];
}

const isPlainObject = (value: unknown): value is CatalogTree =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

/** Flattens nested catalogs into dotted keys, collecting structural problems instead of throwing. */
export function flattenCatalog(tree: CatalogTree): FlatCatalog {
  const result: FlatCatalog = { entries: new Map(), invalid: [], duplicates: [] };
  const visit = (node: CatalogTree, prefix: string, depth: number): void => {
    for (const [segment, value] of Object.entries(node)) {
      const key = prefix ? `${prefix}${KEY_SEPARATOR}${segment}` : segment;
      if (typeof value === 'string') {
        if (result.entries.has(key)) result.duplicates.push(key);
        else result.entries.set(key, value);
      } else if (isPlainObject(value) && depth < MAX_DEPTH) {
        visit(value, key, depth + 1);
      } else {
        result.invalid.push(key);
      }
    }
  };
  visit(tree, '', 1);
  return result;
}

export function isCatalogTree(value: unknown): value is CatalogTree {
  return isPlainObject(value);
}
