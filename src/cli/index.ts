#!/usr/bin/env node
import { runCli } from './run.js';

process.exitCode = runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
  cwd: process.cwd(),
});
