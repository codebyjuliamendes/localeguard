#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function inspect(base, target, locale) {
  const issues = [];
  for (const [key, source] of Object.entries(base)) {
    const value = target[key];
    if (value === undefined) { issues.push(`${locale}:${key}: missing translation`); continue; }
    if (typeof value !== 'string' || !value.trim()) { issues.push(`${locale}:${key}: empty translation`); continue; }
    const placeholders = text => [...text.matchAll(/\{([\w.]+)\}/g)].map(match => match[1]).sort();
    if (JSON.stringify(placeholders(source)) !== JSON.stringify(placeholders(value))) issues.push(`${locale}:${key}: placeholder mismatch`);
  }
  for (const key of Object.keys(target)) if (!(key in base)) issues.push(`${locale}:${key}: unexpected key`);
  return issues;
}
function main(args) {
  const baseIndex = args.indexOf('--base'), localeIndex = args.indexOf('--locale'), fileIndex = args.indexOf('--file');
  if (baseIndex < 0 || fileIndex < 0 || !args[baseIndex + 1] || !args[fileIndex + 1]) {
    console.error('Usage: node scripts/check-catalog.js --base <source.json> --locale <locale> --file <catalog.json>'); return 2;
  }
  try {
    const base = JSON.parse(fs.readFileSync(path.resolve(args[baseIndex + 1]), 'utf8'));
    const target = JSON.parse(fs.readFileSync(path.resolve(args[fileIndex + 1]), 'utf8'));
    if (!base || typeof base !== 'object' || Array.isArray(base) || !target || typeof target !== 'object' || Array.isArray(target)) throw new Error('Catalog files must contain JSON objects of string values.');
    const issues = inspect(base, target, args[localeIndex + 1] || path.basename(args[fileIndex + 1], '.json'));
    if (!issues.length) { console.log('Catalog passed key and placeholder checks.'); return 0; }
    issues.forEach(issue => console.error(`ERROR  ${issue}`)); console.error(`Found ${issues.length} catalog issue(s).`); return 1;
  } catch (error) { console.error(error.message); return 2; }
}
if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { inspect, main };
