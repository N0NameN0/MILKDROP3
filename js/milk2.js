/**
 * MilkDrop 3 double-preset (.milk2) reader.
 *
 * A .milk2 file is a text container produced by MilkDrop 3:
 *
 *   blending_pattern=cercle
 *   blending_progress=0.45
 *   [PRESET1_BEGIN]
 *   NAME=...
 *   MILKDROP_PRESET_VERSION=201
 *   ...
 *   [PRESET1_END]
 *   [PRESET2_BEGIN]
 *   ...
 *   [PRESET2_END]
 *
 * Each enclosed block is a regular .milk preset. This module extracts the two
 * blocks and the few blending hints, and strips the leading display-only NAME
 * line so the renderer receives a clean preset stream.
 */

function extractBlock(text, index) {
  const begin = text.indexOf(`[PRESET${index}_BEGIN]`);
  const end = text.indexOf(`[PRESET${index}_END]`);
  if (begin < 0 || end < 0 || end <= begin) return null;
  return text.slice(begin + `[PRESET${index}_BEGIN]`.length, end).trim();
}

function cleanPreset(block) {
  if (!block) return '';
  const normalized = block.replace(/\r\n?/g, '\n');
  const start = normalized.search(/^(MILKDROP_PRESET_VERSION=|\[preset00\])/m);
  const body = start > 0 ? normalized.slice(start) : normalized;
  return body.trim();
}

function readName(block) {
  const match = block.match(/^NAME=(.+)$/m);
  return match ? match[1].trim() : '';
}

export function isMilk2Text(text) {
  return typeof text === 'string'
    && text.includes('[PRESET1_BEGIN]')
    && text.includes('[PRESET2_BEGIN]');
}

export function parseMilk2(text) {
  if (!isMilk2Text(text)) return null;
  const raw1 = extractBlock(text, 1);
  const raw2 = extractBlock(text, 2);
  const preset1 = cleanPreset(raw1);
  const preset2 = cleanPreset(raw2);
  if (!preset1 || !preset2) return null;

  const pattern = text.match(/^blending_pattern=\s*(.+)$/m)?.[1]?.trim() || 'screen';
  const parsedProgress = Number.parseFloat(text.match(/^blending_progress=\s*(.+)$/m)?.[1]);
  const progress = Number.isFinite(parsedProgress)
    ? Math.min(1, Math.max(0, parsedProgress))
    : 0.5;

  const name1 = readName(raw1);
  const name2 = readName(raw2);

  return {
    preset1,
    preset2,
    name1,
    name2,
    pattern,
    progress,
    title: name1 && name2 ? `${name1} + ${name2}` : (name1 || name2 || ''),
  };
}
