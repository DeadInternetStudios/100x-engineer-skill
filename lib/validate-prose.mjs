import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { companionScript } from './companions.mjs';

export const PROSE_TARGETS = ['skills', 'docs', 'README.md', 'NOTICE.md', 'UPSTREAM.md'];
export const PROSE_LIMIT = 8;

export const unslopTextTool = () => companionScript('unslop-text');

export function proseLint(root) {
  const tool = unslopTextTool();
  if (!fs.existsSync(tool)) return { ran: false, ok: true, output: `prose lint skipped. unslop-text was not found at ${tool}` };
  const targets = PROSE_TARGETS.map((name) => path.join(root, name)).filter((target) => fs.existsSync(target));
  const result = spawnSync(process.execPath, [tool, 'lint', ...targets, '--profile', 'docs', '--fail-above', String(PROSE_LIMIT)], { encoding: 'utf8', timeout: 120000 });
  return { ran: true, ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}
