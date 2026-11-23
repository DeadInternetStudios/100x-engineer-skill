import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromiumBuilds, resolvePlaywright } from '../lib/playwright.mjs';
import { cli, sandbox } from './helpers.mjs';

test('browsers --check reports missing when nothing provides Playwright', () => {
  const box = sandbox();
  const result = cli(['browsers', '--check'], { cwd: box.project, env: { ...box.env, X100_PLAYWRIGHT_FROM: '' } });
  assert.equal(result.code, 1);
  assert.match(result.out, /not available/);
  box.cleanup();
});

test('browsers --check reports available when Playwright resolves', { skip: resolvePlaywright() && chromiumBuilds().length ? false : 'Playwright and a Chromium build are not both here. Run `100x browsers`.' }, () => {
  const box = sandbox();
  const result = cli(['browsers', '--check'], { cwd: box.project, env: box.env });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /already available/);
  box.cleanup();
});

// A stand-in npm that writes a stand-in playwright, which prints a progress line for each 5 percent like the real one does.
function fakeInstallers(box, { exit = 0 } = {}) {
  const bin = path.join(box.dir, 'fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh
prefix=""
while [ $# -gt 0 ]; do if [ "$1" = "--prefix" ]; then prefix="$2"; fi; shift; done
mkdir -p "$prefix/node_modules/.bin"
cat > "$prefix/node_modules/.bin/playwright" <<'INNER'
#!/bin/sh
i=0
while [ $i -lt 20 ]; do echo "|progress| $((i * 5))% of 160 MiB"; i=$((i + 1)); done
echo "disk is full" >&2
exit ${exit}
INNER
chmod +x "$prefix/node_modules/.bin/playwright"
`);
  fs.chmodSync(path.join(bin, 'npm'), 0o755);
  return { ...box.env, X100_PLAYWRIGHT_FROM: '', PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}

test('browsers installs without printing a progress line for every ten percent', () => {
  const box = sandbox();
  const result = cli(['browsers'], { cwd: box.project, env: fakeInstallers(box) });
  assert.equal(result.code, 0, result.err);
  assert.doesNotMatch(result.out, /progress/);
  assert.match(result.out, /Installing Playwright into .*\.100x\./);
  assert.match(result.out, /Installing Chromium\./);
  assert.match(result.out, /installed Playwright and Chromium into/);
  assert.ok(fs.existsSync(path.join(box.home, '.100x', 'node_modules', '.bin', 'playwright')));
  box.cleanup();
});

test('a failed install shows the end of what the installer said', () => {
  const box = sandbox();
  const result = cli(['browsers'], { cwd: box.project, env: fakeInstallers(box, { exit: 3 }) });
  assert.equal(result.code, 1);
  assert.match(result.err, /Installing Chromium failed with exit code 3\./);
  assert.match(result.err, /disk is full/);
  assert.match(result.err, /95% of 160 MiB/);
  assert.doesNotMatch(result.err, /\|progress\| 0% of/, 'only the last lines are shown');
  box.cleanup();
});
