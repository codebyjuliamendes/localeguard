export type Severity = 'blocker' | 'warning' | 'info';
export type Direction = 'ltr' | 'rtl';

/** A catalog as authored: flat dotted keys, nested objects, or a mix of both. */
export type CatalogTree = Record<string, unknown>;

export type IssueCode =
  | 'missing_translation'
  | 'empty_translation'
  | 'empty_source'
  | 'invalid_value'
  | 'duplicate_key'
  | 'malformed_message'
  | 'placeholder_mismatch'
  | 'plural_other_missing'
  | 'plural_categories_missing'
  | 'plural_category_unused'
  | 'select_other_missing'
  | 'length_budget'
  | 'text_expansion'
  | 'unknown_key'
  | 'direction_mismatch'
  | 'missing_rtl_script'
  | 'bidi_isolation'
  | 'bidi_controls_unbalanced'
  /** Findings stored before issue codes existed. */
  | 'legacy';

export interface Issue {
  locale: string;
  key: string;
  severity: Severity;
  code: IssueCode;
  /** Human-readable category shown in the UI and CLI. */
  kind: string;
  detail: string;
}

export interface CatalogInput {
  locale: string;
  strings: CatalogTree;
  /** Declared layout direction; when omitted the direction check is skipped. */
  direction?: Direction | undefined;
}

export interface InspectOptions {
  /** Maximum rendered length (grapheme clusters) per flattened key. */
  budgets?: Readonly<Record<string, number>> | undefined;
  /** Target/source length ratio that triggers a text expansion warning. */
  expansionRatio?: number | undefined;
  /** Sources shorter than this (in graphemes) are exempt from the expansion check. */
  expansionMinLength?: number | undefined;
}

export interface Coverage {
  translated: number;
  expected: number;
  /** 0..1, or 1 when nothing is expected. */
  ratio: number;
}

export interface InspectionResult {
  issues: Issue[];
  coverage: Coverage;
  counts: Record<Severity, number>;
}
