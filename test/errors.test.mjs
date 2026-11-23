import assert from 'node:assert/strict';
import test from 'node:test';
import { badJson, plainMessage } from '../lib/errors.mjs';

const osError = (code, path) => Object.assign(new Error(`${code}: scary operating system words, mkdir '${path}'`), { code, path });

test('a folder the user may not write to is named, with what to do', () => {
  for (const code of ['EACCES', 'EPERM', 'EROFS']) {
    const message = plainMessage(osError(code, '/work/app/.100x'));
    assert.match(message, /^cannot write \/work\/app\/\.100x\. It is read-only for you\./);
    assert.doesNotMatch(message, new RegExp(code));
  }
});

test('a full disk says so', () => {
  assert.match(plainMessage(osError('ENOSPC', '/work/app/.100x/decisions.tsv')), /^the disk is full/);
});

test('every other message stays as it was written', () => {
  assert.equal(plainMessage(new Error('unknown command "x". Run `100x help`.')), 'unknown command "x". Run `100x help`.');
  assert.equal(plainMessage(osError('ENOENT', '/gone')), "ENOENT: scary operating system words, mkdir '/gone'");
});

test('a state file that no longer reads names the file, the typo and the one way out', () => {
  const message = badJson('/work/app/.100x/run.json', new SyntaxError('Unexpected end of JSON input'), 'set the facts again with `100x run set`').message;
  assert.match(message, /^Invalid JSON in \/work\/app\/\.100x\/run\.json\. Unexpected end of JSON input\./);
  assert.match(message, /move the file aside with `mv \/work\/app\/\.100x\/run\.json \/work\/app\/\.100x\/run\.json\.bad` and set the facts again with `100x run set`\.$/);
});
