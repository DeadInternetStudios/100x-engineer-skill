import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runProgram } from '../lib/proc.mjs';
import { ROOT } from './helpers.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('npm install -g from the repository carries what the tool reads at run time and nothing it does not', () => {
  const packed = runProgram('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const files = new Set(JSON.parse(packed.stdout)[0].files.map((f) => f.path));
  const skills = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const need = [pkg.bin['100x'], 'LICENSE', 'README.md', 'companions.json', 'evals/briefs.json', 'evals/PROTOCOL.md', 'evals/triggers.json', 'vendor/unslop-text/SKILL.md', 'scripts/install.sh', 'skills/100x/references/apps.md', 'skills/100x/assets/asset-check.mjs', ...skills.map((name) => `skills/${name}/SKILL.md`)];
  for (const file of need) assert.ok(files.has(file), `${file} is in the package`);
  for (const file of files) assert.ok(!/^(test|\.100x|\.git)\//.test(file), `${file} stays out of the package`);
  assert.ok(fs.statSync(path.join(ROOT, pkg.bin['100x'])).isFile());
});

test('package.json says where the repository is, which is what the skills and the README name', () => {
  assert.match(pkg.repository.url, /^git\+https:\/\/github\.com\/[^/]+\/[^/]+\.git$/);
  assert.equal(pkg.homepage, `${pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')}#readme`);
  assert.equal(pkg.bugs.url, `${pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')}/issues`);
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.keywords.includes('agent-skills'));
});
