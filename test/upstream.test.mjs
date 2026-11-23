import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { newerCommits } from '../lib/commands/upstream.mjs';
import { cli, sandbox } from './helpers.mjs';

const PINNED = 'bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7';

test('commits newer than the pinned one are the ones before it in the list', () => {
  const tsv = 'aaa1111\t2026-11-20T10:00:00Z\tfeat: new thing\nbbb2222\t2026-11-18T10:00:00Z\tfix: other\nbf0c7cd\t2026-11-15T03:36:17Z\tfeat: pinned\nc742dd6\t2026-10-27T23:12:40Z\told\n';
  const { found, newer } = newerCommits(tsv, PINNED);
  assert.equal(found, true);
  assert.deepEqual(newer.map((c) => c.sha), ['aaa1111', 'bbb2222']);
});

test('when the pinned commit is not in the list everything is reported as maybe newer', () => {
  const { found, newer } = newerCommits('aaa1111\t2026-11-20T10:00:00Z\tfeat\n', PINNED);
  assert.equal(found, false);
  assert.equal(newer.length, 1);
});

function fakeGh(box, body, code = 0) {
  const file = path.join(box.dir, 'fake-gh');
  fs.writeFileSync(file, `#!/bin/sh\n${code ? `echo "gh: network down" >&2\nexit ${code}` : `printf '%s' '${body}'`}\n`, { mode: 0o755 });
  return { ...box.env, X100_GH: file };
}

test('upstream prints newer commits using gh, and says so when up to date', () => {
  const box = sandbox();
  const newer = cli(['upstream'], { env: fakeGh(box, 'aaa1111\t2026-11-20T10:00:00Z\tfeat: new thing\nbf0c7cd\t2026-11-15T03:36:17Z\tpinned\n') });
  assert.equal(newer.code, 0, newer.err);
  assert.match(newer.out, /1 newer commit touches pstack since bf0c7cd\./);
  assert.match(newer.out, /aaa1111 2026-11-20 feat: new thing/);
  const same = cli(['upstream'], { env: fakeGh(box, 'bf0c7cd\t2026-11-15T03:36:17Z\tpinned\n') });
  assert.match(same.out, /Up to date with pstack at bf0c7cd\./);
  box.cleanup();
});

test('upstream explains a gh failure instead of printing nothing', () => {
  const box = sandbox();
  const result = cli(['upstream'], { env: fakeGh(box, '', 1) });
  assert.equal(result.code, 1);
  assert.match(result.err, /Could not read cursor\/plugins on GitHub\. gh: network down/);
  box.cleanup();
});
