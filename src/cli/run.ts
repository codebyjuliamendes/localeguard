import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { isCatalogTree } from '../domain/catalog.js';
import { inspectCatalogs, SEVERITY_RANK } from '../domain/inspect.js';
import { isValidLocale } from '../domain/locale.js';
import type { CatalogInput, CatalogTree, InspectionResult, Severity } from '../domain/types.js';
import { VERSION } from '../version.js';

export const EXIT = { ok: 0, issues: 1, usage: 2 } as const;

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

export const USAGE = `Usage: localeguard --base <source.json> (--file <catalog.json>... | --dir <folder>) [options]

Compares translated JSON catalogs against a source catalog.

Options:
  --base <file>          Source catalog (its file name is the base locale unless --base-locale is set)
  --base-locale <tag>    Base locale tag, e.g. en-US
  --file <file>          Target catalog; repeat for several files
  --locale <tag>         Locale of the single --file (defaults to the file name)
  --dir <folder>         Check every *.json in a folder except the base
  --budgets <file>       JSON object of per-key length budgets in characters
  --fail-on <level>      blocker (default) | warning | info | none
  --format <format>      text (default) | json
  -q, --quiet            Only print the summary line in text mode
  -h, --help             Show this help
  -v, --version          Show the version

Exit codes: 0 passed, 1 findings at or above --fail-on, 2 usage or input error.`;

class UsageError extends Error {}

function readJson(file: string, cwd: string, label: string): unknown {
  const resolved = path.resolve(cwd, file);
  let text: string;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new UsageError(`Cannot read ${label} ${file}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new UsageError(`${file} is not valid JSON: ${(error as Error).message}`);
  }
}

function readCatalog(file: string, cwd: string): CatalogTree {
  const value = readJson(file, cwd, 'catalog');
  if (!isCatalogTree(value)) throw new UsageError(`${file} must contain a JSON object of strings.`);
  return value;
}

function localeFromFile(file: string): string {
  const locale = path.basename(file, path.extname(file));
  if (!isValidLocale(locale))
    throw new UsageError(`Cannot infer a locale from "${path.basename(file)}"; name it like de-DE.json or pass --locale.`);
  return locale;
}

const LABEL: Record<Severity, string> = { blocker: 'ERROR', warning: 'WARN ', info: 'INFO ' };

function formatText(result: InspectionResult, catalogCount: number, quiet: boolean): string {
  const lines = quiet
    ? []
    : result.issues.map((issue) => `${LABEL[issue.severity]}  ${issue.locale}:${issue.key}  ${issue.kind}: ${issue.detail}`);
  const { blocker, warning, info } = result.counts;
  const coverage = `${Math.floor(result.coverage.ratio * 1000) / 10}% key coverage`;
  lines.push(
    result.issues.length
      ? `Found ${blocker} blocker(s), ${warning} warning(s), ${info} notice(s) in ${catalogCount} catalog(s); ${coverage}.`
      : `All ${catalogCount} catalog(s) passed; ${coverage}.`,
  );
  return lines.join('\n');
}

export function runCli(argv: readonly string[], io: CliIO): number {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        base: { type: 'string' },
        'base-locale': { type: 'string' },
        file: { type: 'string', multiple: true },
        locale: { type: 'string' },
        dir: { type: 'string' },
        budgets: { type: 'string' },
        'fail-on': { type: 'string', default: 'blocker' },
        format: { type: 'string', default: 'text' },
        quiet: { type: 'boolean', short: 'q', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    }));
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${USAGE}`);
    return EXIT.usage;
  }

  if (values.help) {
    io.stdout(USAGE);
    return EXIT.ok;
  }
  if (values.version) {
    io.stdout(VERSION);
    return EXIT.ok;
  }

  try {
    const format = values.format;
    if (format !== 'text' && format !== 'json') throw new UsageError(`--format must be text or json, got "${format}".`);
    const failOn = values['fail-on'];
    if (failOn !== 'none' && !(failOn in SEVERITY_RANK))
      throw new UsageError(`--fail-on must be blocker, warning, info or none, got "${failOn}".`);
    if (!values.base) throw new UsageError('--base is required.');
    const files = values.file ?? [];
    if (!files.length && !values.dir) throw new UsageError('Pass at least one --file or a --dir.');
    if (values.locale && (files.length !== 1 || values.dir)) throw new UsageError('--locale can only be used with a single --file.');

    const baseLocale = values['base-locale'] ?? localeFromFile(values.base);
    if (!isValidLocale(baseLocale)) throw new UsageError(`Invalid base locale "${baseLocale}".`);
    const baseResolved = path.resolve(io.cwd, values.base);

    const targets: { file: string; locale: string }[] = files.map((file) => ({ file, locale: values.locale ?? localeFromFile(file) }));
    if (values.dir) {
      const dir = path.resolve(io.cwd, values.dir);
      let names: string[];
      try {
        names = fs
          .readdirSync(dir)
          .filter((name) => name.endsWith('.json'))
          .sort();
      } catch {
        throw new UsageError(`Cannot read directory ${values.dir}.`);
      }
      for (const name of names) {
        const file = path.join(dir, name);
        if (path.resolve(file) !== baseResolved) targets.push({ file, locale: localeFromFile(file) });
      }
    }
    const seen = new Set<string>([baseLocale]);
    for (const target of targets) {
      if (seen.has(target.locale)) throw new UsageError(`Locale ${target.locale} is listed more than once.`);
      seen.add(target.locale);
    }

    let budgets: Record<string, number> | undefined;
    if (values.budgets) {
      const raw = readJson(values.budgets, io.cwd, 'budgets');
      if (!isCatalogTree(raw) || !Object.values(raw).every((value) => Number.isInteger(value) && (value as number) > 0)) {
        throw new UsageError(`${values.budgets} must be a JSON object of positive integers.`);
      }
      budgets = raw as Record<string, number>;
    }

    const catalogs: CatalogInput[] = [
      { locale: baseLocale, strings: readCatalog(values.base, io.cwd) },
      ...targets.map((target) => ({ locale: target.locale, strings: readCatalog(target.file, io.cwd) })),
    ];
    const result = inspectCatalogs(baseLocale, catalogs, { budgets });

    const failing =
      failOn === 'none' ? [] : result.issues.filter((issue) => SEVERITY_RANK[issue.severity] <= SEVERITY_RANK[failOn as Severity]);
    if (format === 'json') {
      io.stdout(
        JSON.stringify(
          {
            baseLocale,
            locales: targets.map((target) => target.locale),
            passed: failing.length === 0,
            counts: result.counts,
            coverage: result.coverage,
            issues: result.issues,
          },
          null,
          2,
        ),
      );
    } else {
      const report = formatText(result, targets.length, values.quiet);
      if (failing.length) io.stderr(report);
      else io.stdout(report);
    }
    return failing.length ? EXIT.issues : EXIT.ok;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(error.message);
      return EXIT.usage;
    }
    throw error;
  }
}
