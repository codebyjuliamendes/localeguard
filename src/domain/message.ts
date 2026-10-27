import { graphemeLength } from './text.js';

/**
 * Lightweight parser for the placeholder dialects found in product catalogs:
 * ICU MessageFormat (`{name}`, `{n, number}`, `{count, plural, ...}`, `select`, `selectordinal`),
 * mustache/i18next (`{{name}}`) and printf (`%s`, `%1$s`, `%.2f`).
 */

export type BranchFormat = 'plural' | 'selectordinal' | 'select';

export type MessageNode =
  | { type: 'text'; value: string }
  | { type: 'argument'; name: string; format: string | undefined; raw: string }
  | { type: 'branching'; name: string; format: BranchFormat; options: BranchOption[] }
  | { type: 'pound' }
  | { type: 'mustache'; name: string; raw: string }
  | { type: 'printf'; position: number | undefined; conversion: string; raw: string };

export interface BranchOption {
  selector: string;
  nodes: MessageNode[];
}

export interface ParsedMessage {
  nodes: MessageNode[];
  /** Syntax error description; when set, `nodes` holds a best-effort fallback. */
  error: string | undefined;
}

class MessageSyntaxError extends Error {}

const BRANCH_FORMATS: ReadonlySet<string> = new Set<BranchFormat>(['plural', 'selectordinal', 'select']);
const MUSTACHE = /\{\{\s*-?\s*([\p{L}\p{N}_.$-]+)\s*(?:,[^{}]*)?\}\}/uy;
// No space flag: "50% off" must not be read as `% o`.
const PRINTF = /%(?:(\d+)\$)?[-+0#]*(?:\d+|\*)?(?:\.(?:\d+|\*))?(?:hh|h|ll|l|L|z|j|t|q)?([sdifuxXoeEgGcpa@])|%%/gu;
const ARG_NAME = /[\p{L}\p{N}_.$-]+/uy;
const SELECTOR = /[^\s{}]+/uy;
const FORMAT_TYPE = /[A-Za-z]+/y;
const WHITESPACE = /\s*/uy;

class Parser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parse(): MessageNode[] {
    const nodes = this.nodes(0, false);
    if (this.pos < this.text.length) throw new MessageSyntaxError(`Unexpected "}" at position ${this.pos + 1}.`);
    return nodes;
  }

  private nodes(depth: number, inPlural: boolean): MessageNode[] {
    const nodes: MessageNode[] = [];
    let buffer = '';
    const flush = (): void => {
      if (buffer) nodes.push(...splitPrintf(buffer));
      buffer = '';
    };
    const { text } = this;
    while (this.pos < text.length) {
      const ch = text.charAt(this.pos);
      if (ch === "'") {
        buffer += this.apostrophe(inPlural);
        continue;
      }
      if (ch === '{') {
        const mustache = this.match(MUSTACHE);
        if (mustache) {
          flush();
          nodes.push({ type: 'mustache', name: mustache[1] ?? '', raw: mustache[0] });
          continue;
        }
        flush();
        nodes.push(this.argument(depth, inPlural));
        continue;
      }
      if (ch === '}') {
        if (depth > 0) break;
        throw new MessageSyntaxError(`Unexpected "}" at position ${this.pos + 1}.`);
      }
      if (ch === '#' && inPlural) {
        flush();
        nodes.push({ type: 'pound' });
        this.pos++;
        continue;
      }
      buffer += ch;
      this.pos++;
    }
    flush();
    return nodes;
  }

  /** ICU apostrophe rules: `''` is a literal quote; `'` before a syntax char quotes until the next `'`. */
  private apostrophe(inPlural: boolean): string {
    const { text } = this;
    const next = text[this.pos + 1];
    if (next === "'") {
      this.pos += 2;
      return "'";
    }
    if (next === '{' || next === '}' || (inPlural && next === '#')) {
      this.pos++;
      let quoted = '';
      while (this.pos < text.length) {
        const ch = text.charAt(this.pos);
        if (ch === "'") {
          if (text[this.pos + 1] === "'") {
            quoted += "'";
            this.pos += 2;
            continue;
          }
          this.pos++;
          break;
        }
        quoted += ch;
        this.pos++;
      }
      return quoted;
    }
    this.pos++;
    return "'";
  }

  private argument(depth: number, inPlural: boolean): MessageNode {
    const start = this.pos;
    this.pos++; // {
    this.skipWhitespace();
    const name = this.match(ARG_NAME)?.[0];
    if (!name) throw new MessageSyntaxError(`Placeholder at position ${start + 1} has no name.`);
    this.skipWhitespace();
    if (this.peek() === '}') {
      this.pos++;
      return { type: 'argument', name, format: undefined, raw: this.text.slice(start, this.pos) };
    }
    this.expect(',', start);
    this.skipWhitespace();
    const format = this.match(FORMAT_TYPE)?.[0];
    if (!format) throw new MessageSyntaxError(`Placeholder "${name}" has an empty format type.`);
    this.skipWhitespace();
    if (BRANCH_FORMATS.has(format)) {
      this.expect(',', start);
      const options = this.options(format as BranchFormat, depth, inPlural, start);
      return { type: 'branching', name, format: format as BranchFormat, options };
    }
    if (this.peek() === ',') this.skipStyle(start);
    this.expect('}', start);
    return { type: 'argument', name, format, raw: this.text.slice(start, this.pos) };
  }

  private options(format: BranchFormat, depth: number, inPlural: boolean, start: number): BranchOption[] {
    const options: BranchOption[] = [];
    for (;;) {
      this.skipWhitespace();
      const ch = this.peek();
      if (ch === undefined) throw new MessageSyntaxError(`Placeholder at position ${start + 1} is not closed.`);
      if (ch === '}') {
        this.pos++;
        break;
      }
      if (format !== 'select' && this.text.startsWith('offset:', this.pos)) {
        this.pos += 'offset:'.length;
        this.skipWhitespace();
        if (!/\d/.test(this.peek() ?? '')) throw new MessageSyntaxError('Plural offset must be a number.');
        while (/\d/.test(this.peek() ?? '')) this.pos++;
        continue;
      }
      const selector = this.match(SELECTOR)?.[0];
      if (!selector) throw new MessageSyntaxError(`Expected a selector at position ${this.pos + 1}.`);
      this.skipWhitespace();
      this.expect('{', start);
      const nodes = this.nodes(depth + 1, inPlural || format !== 'select');
      this.expect('}', start);
      options.push({ selector, nodes });
    }
    if (options.length === 0) throw new MessageSyntaxError(`The ${format} placeholder has no options.`);
    return options;
  }

  /** Skips an argument style such as `::currency/EUR` or `short`, honouring nested braces. */
  private skipStyle(start: number): void {
    let depth = 0;
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch === '{') depth++;
      else if (ch === '}') {
        if (depth === 0) return;
        depth--;
      }
      this.pos++;
    }
    throw new MessageSyntaxError(`Placeholder at position ${start + 1} is not closed.`);
  }

  private expect(ch: string, start: number): void {
    if (this.peek() !== ch) {
      if (this.peek() === undefined) throw new MessageSyntaxError(`Placeholder at position ${start + 1} is not closed.`);
      throw new MessageSyntaxError(`Expected "${ch}" at position ${this.pos + 1}.`);
    }
    this.pos++;
  }

  private peek(): string | undefined {
    return this.text[this.pos];
  }

  private skipWhitespace(): void {
    this.match(WHITESPACE);
  }

  private match(pattern: RegExp): RegExpExecArray | null {
    pattern.lastIndex = this.pos;
    const result = pattern.exec(this.text);
    if (result) this.pos += result[0].length;
    return result;
  }
}

function splitPrintf(text: string): MessageNode[] {
  const nodes: MessageNode[] = [];
  let last = 0;
  let literal = '';
  for (const match of text.matchAll(PRINTF)) {
    literal += text.slice(last, match.index);
    last = match.index + match[0].length;
    if (match[0] === '%%') {
      literal += '%';
      continue;
    }
    if (literal) nodes.push({ type: 'text', value: literal });
    literal = '';
    const position = match[1] === undefined ? undefined : Number(match[1]);
    nodes.push({ type: 'printf', position, conversion: match[2] ?? 's', raw: match[0] });
  }
  literal += text.slice(last);
  if (literal) nodes.push({ type: 'text', value: literal });
  return nodes;
}

/** Regex fallback used for malformed messages so placeholder checks still run. */
function fallbackNodes(text: string): MessageNode[] {
  const nodes: MessageNode[] = [];
  for (const match of text.matchAll(/\{\{\s*-?\s*([\p{L}\p{N}_.$-]+)[^{}]*\}\}|\{\s*([\p{L}\p{N}_.$-]+)\s*[,}]/gu)) {
    if (match[1] !== undefined) nodes.push({ type: 'mustache', name: match[1], raw: match[0] });
    else if (match[2] !== undefined) nodes.push({ type: 'argument', name: match[2], format: undefined, raw: match[0] });
  }
  return [...nodes, ...splitPrintf(text).filter((node) => node.type === 'printf')];
}

const cache = new Map<string, ParsedMessage>();
const CACHE_LIMIT = 5000;

export function parseMessage(text: string): ParsedMessage {
  const cached = cache.get(text);
  if (cached) return cached;
  let parsed: ParsedMessage;
  try {
    parsed = { nodes: new Parser(text).parse(), error: undefined };
  } catch (error) {
    if (!(error instanceof MessageSyntaxError)) throw error;
    parsed = { nodes: fallbackNodes(text), error: error.message };
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, parsed);
  return parsed;
}

export interface PlaceholderSignature {
  /** Order-insensitive tokens: ICU arguments, mustache and positional printf. */
  named: string[];
  /** Order-sensitive non-positional printf conversions. */
  sequential: string[];
}

export function placeholderSignature(nodes: readonly MessageNode[]): PlaceholderSignature {
  const named = new Set<string>();
  const sequential: string[] = [];
  const walk = (list: readonly MessageNode[]): void => {
    for (const node of list) {
      switch (node.type) {
        case 'argument':
          named.add(`{${node.name}}`);
          break;
        case 'branching':
          named.add(`{${node.name}, ${node.format}}`);
          for (const option of node.options) walk(option.nodes);
          break;
        case 'mustache':
          named.add(`{{${node.name}}}`);
          break;
        case 'printf':
          if (node.position === undefined) sequential.push(`%${node.conversion}`);
          else named.add(`%${node.position}$${node.conversion}`);
          break;
        default:
          break;
      }
    }
  };
  walk(nodes);
  return { named: [...named].sort(), sequential };
}

export function signaturesEqual(a: PlaceholderSignature, b: PlaceholderSignature): boolean {
  return a.named.join('\u0000') === b.named.join('\u0000') && a.sequential.join('\u0000') === b.sequential.join('\u0000');
}

export function describeSignature(signature: PlaceholderSignature): string {
  const tokens = [...signature.named, ...signature.sequential];
  return tokens.length ? tokens.join(', ') : 'no placeholders';
}

export interface BranchUse {
  name: string;
  format: BranchFormat;
  selectors: string[];
}

export function branchUses(nodes: readonly MessageNode[]): BranchUse[] {
  const uses: BranchUse[] = [];
  const walk = (list: readonly MessageNode[]): void => {
    for (const node of list) {
      if (node.type !== 'branching') continue;
      uses.push({ name: node.name, format: node.format, selectors: node.options.map((option) => option.selector) });
      for (const option of node.options) walk(option.nodes);
    }
  };
  walk(nodes);
  return uses;
}

/** Placeholders whose runtime value may be LTR text (names, URLs) inside an RTL sentence. */
export function textualPlaceholders(nodes: readonly MessageNode[]): string[] {
  const found = new Set<string>();
  const walk = (list: readonly MessageNode[]): void => {
    for (const node of list) {
      if (node.type === 'argument' && node.format === undefined) found.add(node.raw);
      else if (node.type === 'mustache') found.add(node.raw);
      else if (node.type === 'printf' && (node.conversion === 's' || node.conversion === '@')) found.add(node.raw);
      else if (node.type === 'branching') for (const option of node.options) walk(option.nodes);
    }
  };
  walk(nodes);
  return [...found];
}

/** Literal text of a message with placeholders removed (all branches concatenated). */
export function literalText(nodes: readonly MessageNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') return node.value;
      if (node.type === 'branching') return node.options.map((option) => literalText(option.nodes)).join(' ');
      return ' ';
    })
    .join('');
}

/**
 * Longest rendered variant in grapheme clusters. Placeholders count as their source text,
 * and plural/select messages are measured by their longest branch rather than all branches combined.
 */
export function renderedLength(nodes: readonly MessageNode[]): number {
  let total = 0;
  let literal = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        literal += node.value;
        break;
      case 'argument':
      case 'mustache':
      case 'printf':
        literal += node.raw;
        break;
      case 'pound':
        literal += '#';
        break;
      case 'branching':
        total += Math.max(0, ...node.options.map((option) => renderedLength(option.nodes)));
        break;
    }
  }
  return total + graphemeLength(literal);
}
