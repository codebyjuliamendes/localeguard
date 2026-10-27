import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT, runCli } from '../../src/cli/run.js';

let dir: string;
const write = (name: string, value: unknown): string => {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
};

function cli(...args: string[]): { code: number; stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  const code = runCli(args, { stdout: (text) => (stdout += `${text}\n`), stderr: (text) => (stderr += `${text}\n`), cwd: dir });
  return { code, stdout, stderr };
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localeguard-cli-'));
  write('locales/en-US.json', { welcome: 'Hello {name}', cancel: 'Cancel', title: 'Settings' });
  write('locales/de-DE.json', { welcome: 'Hallo {user}', title: 'Einstellungen' });
  write('locales/fr-FR.json', { welcome: 'Bonjour {name}', cancel: 'Annuler', title: 'Paramètres', extra: 'x' });
  write('ok/en.json', { a: 'A {n}' });
  write('ok/pt-BR.json', { a: 'A {n}' });
  write('budgets.json', { title: 10 });
  write('bad.json', '{nope');
  write('array.json', ['x']);
  write('weird-name.json', {});
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('localeguard CLI', () => {
  it('keeps the original flags and output format', () => {
    const { code, stderr } = cli('--base', 'locales/en-US.json', '--locale', 'de-DE', '--file', 'locales/de-DE.json');
    expect(code).toBe(EXIT.issues);
    expect(stderr).toContain('ERROR  de-DE:cancel  Missing translation: No de-DE string exists for this key.');
    expect(stderr).toContain('ERROR  de-DE:welcome  Placeholder mismatch: Expected {name}; found {user}.');
    expect(stderr).toContain('Found 2 blocker(s), 0 warning(s), 0 notice(s) in 1 catalog(s); 66.6% key coverage.');
  });

  it('passes clean catalogs with exit code 0', () => {
    const { code, stdout } = cli('--base', 'ok/en.json', '--file', 'ok/pt-BR.json');
    expect(code).toBe(EXIT.ok);
    expect(stdout).toBe('All 1 catalog(s) passed; 100% key coverage.\n');
  });

  it('treats warnings as passing unless --fail-on warning', () => {
    const args = ['--base', 'locales/en-US.json', '--file', 'locales/fr-FR.json'];
    expect(cli(...args).code).toBe(EXIT.ok);
    const strict = cli(...args, '--fail-on', 'warning');
    expect(strict.code).toBe(EXIT.issues);
    expect(strict.stderr).toContain('WARN   fr-FR:extra  Unknown key');
    expect(cli('--base', 'locales/en-US.json', '--file', 'locales/de-DE.json', '--fail-on', 'none').code).toBe(EXIT.ok);
  });

  it('checks a whole directory, applies budgets and prints JSON', () => {
    const { code, stdout } = cli('--base', 'locales/en-US.json', '--dir', 'locales', '--budgets', 'budgets.json', '--format', 'json');
    expect(code).toBe(EXIT.issues);
    const report = JSON.parse(stdout) as {
      locales: string[];
      passed: boolean;
      counts: Record<string, number>;
      issues: { code: string; key: string }[];
    };
    expect(report.locales).toEqual(['de-DE', 'fr-FR']);
    expect(report.passed).toBe(false);
    expect(report.counts).toEqual({ blocker: 2, warning: 2, info: 0 });
    expect(report.issues.filter((issue) => issue.code === 'length_budget').map((issue) => issue.key)).toEqual(['title']);
  });

  it('supports --quiet, --help and --version', () => {
    const quiet = cli('--base', 'locales/en-US.json', '--file', 'locales/de-DE.json', '-q');
    expect(quiet.stderr.trim().split('\n')).toHaveLength(1);
    expect(cli('--help').stdout).toContain('Usage: localeguard');
    expect(cli('-v').stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each([
    [['--file', 'locales/de-DE.json'], '--base is required'],
    [['--base', 'locales/en-US.json'], 'Pass at least one --file'],
    [['--base', 'locales/en-US.json', '--file', 'nl-NL.json'], 'Cannot read catalog nl-NL.json: ENOENT'],
    [['--base', 'locales/en-US.json', '--file', 'bad.json', '--locale', 'de'], 'bad.json is not valid JSON'],
    [['--base', 'locales/en-US.json', '--file', 'array.json', '--locale', 'de'], 'must contain a JSON object'],
    [['--base', 'locales/en-US.json', '--file', 'weird-name.json'], 'Cannot infer a locale'],
    [['--base', 'locales/en-US.json', '--file', 'ok/en.json', '--file', 'ok/pt-BR.json', '--locale', 'de'], '--locale can only be used'],
    [['--base', 'locales/en-US.json', '--file', 'locales/de-DE.json', '--format', 'xml'], '--format must be'],
    [['--base', 'locales/en-US.json', '--file', 'locales/de-DE.json', '--fail-on', 'all'], '--fail-on must be'],
    [['--base', 'locales/en-US.json', '--file', 'locales/de-DE.json', '--budgets', 'locales/en-US.json'], 'positive integers'],
    [['--base', 'locales/en-US.json', '--file', 'locales/en-US.json'], 'listed more than once'],
    [['--base', 'locales/en-US.json', '--dir', 'nowhere'], 'Cannot read directory'],
    [['--base', 'x.json', '--base-locale', 'EN', '--file', 'ok/en.json'], 'Invalid base locale'],
    [['--bogus'], "Unknown option '--bogus'"],
  ])('exits 2 for %j', (args, message) => {
    const { code, stderr } = cli(...args);
    expect(code).toBe(EXIT.usage);
    expect(stderr).toContain(message);
  });
});

describe('CLI entry point', () => {
  const entry = path.resolve('src/cli/index.ts');
  const tsx = path.resolve('node_modules/.bin/tsx');

  it('runs against the repository catalogs', () => {
    const output = execFileSync(tsx, [entry, '--base', 'locales/en-US.json', '--dir', 'locales', '--fail-on', 'warning'], {
      encoding: 'utf8',
    });
    expect(output).toContain('passed');
  });

  it('propagates the exit code', () => {
    const result = spawnSync(tsx, [entry, '--base', path.join(dir, 'locales/en-US.json'), '--file', path.join(dir, 'locales/de-DE.json')], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Placeholder mismatch');
  });
});
