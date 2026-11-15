#!/usr/bin/env node
/**
 * Scans presets/ and writes manifest.json for the web library.
 * Usage: node tools/gen-manifest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const presetsRoot = path.join(root, 'presets');
const outFile = path.join(root, 'manifest.json');

if (!fs.existsSync(presetsRoot)) {
  console.error(`Presets folder not found : ${presetsRoot}`);
  process.exit(1);
}

const categories = new Map();
const presets = [];
let index = 0;

function walk(dir, parts = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, [...parts, entry.name]);
      continue;
    }
    if (!entry.isFile() || !/\.milk2?$/i.test(entry.name)) continue;

    const isDouble = entry.name.toLowerCase().endsWith('.milk2');
    const name = entry.name.replace(/\.milk2?$/i, '');
    const url = [...parts, entry.name].map(encodeURIComponent).join('/');
    const category = parts[0] || 'Divers';
    const subcategory = parts.slice(1).join(' / ');
    const firstDash = name.indexOf(' - ');
    let author = '';
    let title = name;
    if (firstDash > 0 && firstDash < 32) {
      author = name.slice(0, firstDash);
      title = name.slice(firstDash + 3);
    }

    const record = {
      i: index++,
      n: name,
      a: author,
      t: title,
      c: category,
      s: subcategory,
      p: url,
      z: fs.statSync(full).size,
    };
    if (isDouble) {
      record.k = 'milk2';
      const text = fs.readFileSync(full, 'utf8');
      const names = [...text.matchAll(/^NAME=(.+)$/gm)].map((match) => match[1].trim());
      record.d = names.length >= 2 ? names.slice(0, 2) : names;
      record.bp = text.match(/^blending_pattern=\s*(.+)$/m)?.[1]?.trim() || '';
    }
    presets.push(record);
    categories.set(category, (categories.get(category) || 0) + 1);
  }
}

walk(presetsRoot);

const categoryList = [...categories.entries()]
  .sort((a, b) => a[0].localeCompare(b[0], 'fr'))
  .map(([id, count]) => ({ id, count }));

const manifest = {
  generated: new Date().toISOString(),
  count: presets.length,
  categories: categoryList,
  presets,
};

fs.writeFileSync(outFile, JSON.stringify(manifest));
console.log(`✓ ${presets.length} presets · ${categoryList.length} categories`);
console.log(`  ${path.relative(root, outFile)} — ${(fs.statSync(outFile).size / 1024 / 1024).toFixed(2)} Mo`);
for (const category of categoryList) {
  console.log(`  ${String(category.count).padStart(5)}  ${category.id}`);
}
