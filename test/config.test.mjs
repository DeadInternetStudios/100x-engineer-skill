import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cli, sandbox, write } from './helpers.mjs';

test('defaults come from the built-in file', () => {
  const box = sandbox();
  const model = cli(['config', 'get', 'review.model'], { cwd: box.project, env: box.env });
  assert.equal(model.out.trim(), 'null', 'no vendor or model is built in, the judge is whatever the owner chose');
  assert.equal(cli(['config', 'get', 'polish.passes'], { cwd: box.project, env: box.env }).out.trim(), '3');
  assert.equal(cli(['config', 'get', 'variants.parallel'], { cwd: box.project, env: box.env }).out.trim(), 'false');
  assert.equal(cli(['config', 'get', 'subagents.atOnce'], { cwd: box.project, env: box.env }).out.trim(), '1');
  assert.equal(cli(['config', 'set', 'subagents.atOnce', '5', '--global'], { cwd: box.project, env: box.env }).code, 0);
  assert.equal(cli(['config', 'get', 'subagents.atOnce'], { cwd: box.project, env: box.env }).out.trim(), '5');
  box.cleanup();
});

test('global values override defaults and local values override global', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  assert.equal(cli(['config', 'set', 'polish.passes', '5', '--global'], { cwd: box.project, env: box.env }).code, 0);
  assert.equal(cli(['config', 'get', 'polish.passes'], { cwd: box.project, env: box.env }).out.trim(), '5');
  cli(['config', 'set', 'polish.passes', '2', '--local'], { cwd: box.project, env: box.env });
  assert.equal(cli(['config', 'get', 'polish.passes'], { cwd: box.project, env: box.env }).out.trim(), '2');
  assert.equal(cli(['config', 'get', 'polish.passes'], { cwd: box.home, env: box.env }).out.trim(), '5');
  box.cleanup();
});

test('a setting that changes who looks at the work, or what runs by itself, says so when it is set', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const set = (...args) => cli(['config', 'set', ...args], { cwd: box.project, env: box.env });
  assert.match(set('review.command', 'claude -p "$X100_TASK"', '--global').out, /This command runs by itself, with approvals off and with your permissions\. Use it on projects you wrote, never on one someone sent you\./);
  assert.match(set('review.rounds', '2', '--local').out, /This project asks for fewer judge rounds than the usual 5\. The report and the final message say so\./);
  assert.doesNotMatch(set('review.rounds', '5', '--local').out, /fewer judge rounds/);
  assert.match(set('review.rounds', '1', '--global').out, /Every project that does not set its own asks for fewer judge rounds than the usual 5\. The report and the final message of each run say so\./, 'the owner may lower their own setting, and is told it reaches every project');
  assert.doesNotMatch(set('review.rounds', '3', '--local').out, /fewer judge rounds/, 'more rounds than the owner usually asks for is not a cut');
  assert.doesNotMatch(set('review.rounds', '5', '--global').out, /fewer judge rounds/, 'back to the usual is not a cut');
  assert.match(set('review.enabled', 'false', '--local').out, /Review is off for this project\. The report and the final message say that no judge looked at it\./);
  assert.match(set('review.enabled', 'false', '--global').out, /Review is off for every project that does not turn it back on for itself\. The report and the final message of each run say that no judge looked at it\./);
  assert.doesNotMatch(set('review.enabled', 'true', '--global').out, /Review is off/);
  assert.doesNotMatch(set('polish.passes', '2', '--local').out, /judge/);
  assert.match(set('review.grind', 'true', '--local').out, /This project keeps judging past its usual rounds until a judge says it is ready to ship, until 3 ship tests in a row bring nothing better, or until 15 rounds are held\. That can take hours\./);
  assert.match(set('review.grind', 'true', '--global').out, /Every project that does not set its own keeps judging past its usual rounds until a judge says it is ready to ship/);
  assert.doesNotMatch(set('review.grind', 'false', '--local').out, /keeps judging/, 'turning it off says nothing');
  assert.equal(set('review.grind', 'yes', '--local').code, 1, 'the grind is a true or false, and a word is refused');
  box.cleanup();
});

test('config with no word says in plain words who judges, who builds and how much polish, and print is still every setting as JSON', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const say = () => cli(['config'], { cwd: box.project, env: box.env });
  const first = say();
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /^Who judges\. Not chosen yet\. Call 100x-setup to pick one\./m);
  assert.match(first.out, /Up to 5 rounds before it ships\./);
  assert.match(first.out, /^Who builds\. The model of the thread you start it in\./m);
  assert.match(first.out, /^Polish\. 3 passes after the build\./m);
  assert.match(first.out, /^Report page\. The last 18 hours of finished runs\./m);
  assert.doesNotMatch(first.out, /[{}"]|reasoning_effort|fallbackModel|timeoutMinutes/, 'no JSON and no setting names');
  cli(['config', 'role', 'review', '--model', 'a-model', '--provider', 'some-app', '--global'], { cwd: box.project, env: box.env });
  cli(['config', 'set', 'polish.passes', '1', '--local'], { cwd: box.project, env: box.env });
  const next = say();
  assert.match(next.out, /^Who judges\. a-model through some-app\. Up to 5 rounds before it ships\./m);
  assert.match(next.out, /^Polish\. 1 pass after the build\./m);
  cli(['config', 'set', 'review.grind', 'true', '--local'], { cwd: box.project, env: box.env });
  assert.match(say().out, /^Who judges\. a-model through some-app\. 5 rounds, then more for as long as no judge says it is ready to ship\./m);
  cli(['config', 'set', 'review.grind', 'false', '--local'], { cwd: box.project, env: box.env });
  cli(['config', 'set', 'review.enabled', 'false', '--local'], { cwd: box.project, env: box.env });
  assert.match(say().out, /^Who judges\. Nobody\. Review is off, so the report and the final message say that no judge looked at it\./m);
  const printed = JSON.parse(cli(['config', 'print'], { cwd: box.project, env: box.env }).out);
  assert.equal(printed.polish.passes, 1);
  box.cleanup();
});

test('objects merge so a partial override keeps its siblings', () => {
  const box = sandbox();
  cli(['config', 'role', 'review', '--model', 'a-model', '--option', 'reasoning_effort=max', '--global'], { cwd: box.project, env: box.env });
  cli(['config', 'set', 'review.model', 'some-other-model', '--global'], { cwd: box.project, env: box.env });
  const options = JSON.parse(cli(['config', 'get', 'review.options'], { cwd: box.project, env: box.env }).out);
  assert.equal(options.reasoning_effort, 'max');
  assert.equal(cli(['config', 'get', 'review.model'], { cwd: box.project, env: box.env }).out.trim(), 'some-other-model');
  box.cleanup();
});

test('unknown settings, bad enums and a missing scope are refused', () => {
  const box = sandbox();
  const unknown = cli(['config', 'set', 'polish.pases', '3', '--global'], { cwd: box.project, env: box.env });
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.err, /not a known setting/);
  const badEnum = cli(['config', 'set', 'deploy.prod', 'always', '--global'], { cwd: box.project, env: box.env });
  assert.notEqual(badEnum.code, 0);
  assert.match(badEnum.err, /must be one of/);
  const noScope = cli(['config', 'set', 'polish.passes', '4'], { cwd: box.project, env: box.env });
  assert.notEqual(noScope.code, 0);
  assert.match(noScope.err, /Pick one scope/);
  assert.equal(fs.existsSync(path.join(box.home, '.100x', 'config.json')), false);
  box.cleanup();
});

test('review options accept free-form keys for a different model', () => {
  const box = sandbox();
  const set = cli(['config', 'set', 'review.options.effort', 'high', '--global'], { cwd: box.project, env: box.env });
  assert.equal(set.code, 0, set.err);
  const options = JSON.parse(cli(['config', 'get', 'review.options'], { cwd: box.project, env: box.env }).out);
  assert.equal(options.effort, 'high');
  box.cleanup();
});

test('unset removes a key so the default shows again', () => {
  const box = sandbox();
  cli(['config', 'set', 'polish.passes', '7', '--global'], { cwd: box.project, env: box.env });
  cli(['config', 'unset', 'polish.passes', '--global'], { cwd: box.project, env: box.env });
  assert.equal(cli(['config', 'get', 'polish.passes'], { cwd: box.project, env: box.env }).out.trim(), '3');
  box.cleanup();
});

test('the global folder is never mistaken for a project', () => {
  const box = sandbox();
  fs.mkdirSync(path.join(box.home, '.100x'), { recursive: true });
  const work = path.join(box.home, 'work');
  fs.mkdirSync(work);
  const result = cli(['config', 'path'], { cwd: work, env: box.env });
  assert.match(result.out, /local\s+none/);
  box.cleanup();
});

test('a corrupt config file gives a message that names the file', () => {
  const box = sandbox();
  write(path.join(box.home, '.100x', 'config.json'), '{ nope');
  const result = cli(['config', 'print'], { cwd: box.project, env: box.env });
  assert.notEqual(result.code, 0);
  assert.match(result.err, /Invalid JSON in .*config\.json/);
  assert.match(result.err, /mv .*config\.json .*config\.json\.bad` and the defaults apply again/);
  box.cleanup();
});

test('validate reports bad values written by hand', () => {
  const box = sandbox();
  write(path.join(box.home, '.100x', 'config.json'), JSON.stringify({ polish: { passes: 99 }, mystery: true }));
  const result = cli(['config', 'validate'], { cwd: box.project, env: box.env });
  assert.equal(result.code, 1);
  assert.match(result.out, /error polish\.passes/);
  assert.match(result.out, /warn mystery/);
  box.cleanup();
});

const json = (box, args) => JSON.parse(cli(args, { cwd: box.project, env: box.env }).out);

test('role review writes the whole option set and nulls the keys the new model does not take', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  cli(['config', 'role', 'review', '--provider', 'cursor', '--model', 'muse-wonder-1.0', '--option', 'reasoning_effort=max', '--option', 'contextWindow=300k', '--global'], { cwd: box.project, env: box.env });
  const set = cli(['config', 'role', 'review', '--provider', 'cursor', '--model', 'claude-opus-5-5', '--option', 'effort=max', '--option', 'contextWindow=300k', '--local'], { cwd: box.project, env: box.env });
  assert.equal(set.code, 0, set.err);
  assert.equal(json(box, ['config', 'get', 'review.options']).reasoning_effort, null, 'the key of the old model is switched off');
  assert.deepEqual(json(box, ['config', 'target', 'review']), { providerInstanceId: 'cursor', model: 'claude-opus-5-5', options: { effort: 'max', contextWindow: '300k' } });
  const call = json(box, ['review-call', '--json']);
  assert.deepEqual(call.delegateTask.target.options, { effort: 'max', contextWindow: '300k' }, 'a stale key never reaches the subagent tool');
  assert.equal(cli(['config', 'validate'], { cwd: box.project, env: box.env }).out.trim(), 'config ok');
  box.cleanup();
});

test('a local role does not inherit option keys from the global role', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  cli(['config', 'role', 'review', '--model', 'model-a', '--option', 'effort=max', '--global'], { cwd: box.project, env: box.env });
  cli(['config', 'role', 'review', '--model', 'model-b', '--option', 'reasoning_effort=high', '--local'], { cwd: box.project, env: box.env });
  assert.deepEqual(json(box, ['config', 'target', 'review']).options, { reasoning_effort: 'high' });
  assert.deepEqual(json(box, ['config', 'target', 'review']).model, 'model-b');
  box.cleanup();
});

test('quick and overnight follow the thread until a role is set, and clear goes back to following it', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  assert.deepEqual(json(box, ['config', 'target', 'quick']), {});
  assert.deepEqual(json(box, ['config', 'target', 'overnight']), {});
  cli(['config', 'role', 'quick', '--model', 'composer-2.5', '--option', 'fastMode=true', '--local'], { cwd: box.project, env: box.env });
  assert.deepEqual(json(box, ['config', 'target', 'quick']), { model: 'composer-2.5', options: { fastMode: true } });
  assert.deepEqual(json(box, ['config', 'target', 'overnight']), {}, 'roles are independent');
  cli(['config', 'role', 'quick', '--clear', '--local'], { cwd: box.project, env: box.env });
  assert.deepEqual(json(box, ['config', 'target', 'quick']), {});
  box.cleanup();
});

test('clearing a role in a project beats a global role of the same name', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  cli(['config', 'role', 'overnight', '--provider', 'cursor', '--model', 'claude-sonnet-5-5', '--option', 'reasoning_effort=max', '--global'], { cwd: box.project, env: box.env });
  assert.equal(json(box, ['config', 'target', 'overnight']).model, 'claude-sonnet-5-5');
  cli(['config', 'role', 'overnight', '--clear', '--local'], { cwd: box.project, env: box.env });
  assert.deepEqual(json(box, ['config', 'target', 'overnight']), {}, 'the project follows the thread again');
  assert.equal(json(box, ['config', 'target', 'overnight']).model, undefined);
  box.cleanup();
});

test('the fallback reviewer has its own options and is null until set', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  assert.equal(json(box, ['config', 'target', 'fallback']), null);
  cli(['config', 'role', 'review', '--provider', 'cursor', '--model', 'muse-wonder-1.0', '--global'], { cwd: box.project, env: box.env });
  cli(['config', 'role', 'fallback', '--model', 'claude-opus-5-5', '--option', 'effort=high', '--global'], { cwd: box.project, env: box.env });
  assert.deepEqual(json(box, ['review-call', '--json']).fallbackTarget, { providerInstanceId: 'cursor', model: 'claude-opus-5-5', options: { effort: 'high' } });
  cli(['config', 'role', 'fallback', '--clear', '--global'], { cwd: box.project, env: box.env });
  assert.equal(json(box, ['config', 'target', 'fallback']), null);
  box.cleanup();
});

test('role refuses a missing model, an unknown role, a bad option, both scopes and clearing the reviewer', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const run = (args) => cli(['config', 'role', ...args], { cwd: box.project, env: box.env });
  assert.match(run(['review', '--global']).err, /--model/);
  assert.match(run(['reviewer', '--model', 'x', '--global']).err, /Usage/);
  assert.match(run(['review', '--model', 'x', '--option', 'effort', '--global']).err, /id=value/);
  assert.match(run(['review', '--model', 'x']).err, /Pick one scope/);
  assert.match(run(['review', '--clear', '--global']).err, /cannot be cleared/);
  assert.match(run(['quick', '--model', 'x', '--clear', '--global']).err, /--model/);
  assert.equal(fs.existsSync(path.join(box.home, '.100x', 'config.json')), false, 'a refused call writes nothing');
  box.cleanup();
});

test('the builder preference is stored and cleared like the other roles and never leaks into quick', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  assert.deepEqual(json(box, ['config', 'target', 'builder']), {});
  const set = cli(['config', 'role', 'builder', '--provider', 'cursor', '--model', 'claude-sonnet-5-5', '--option', 'reasoning_effort=max', '--global'], { cwd: box.project, env: box.env });
  assert.equal(set.code, 0, set.err);
  assert.deepEqual(json(box, ['config', 'target', 'builder']), { providerInstanceId: 'cursor', model: 'claude-sonnet-5-5', options: { reasoning_effort: 'max' } });
  assert.deepEqual(json(box, ['config', 'target', 'quick']), {});
  cli(['config', 'role', 'builder', '--clear', '--global'], { cwd: box.project, env: box.env });
  assert.deepEqual(json(box, ['config', 'target', 'builder']), {});
  assert.equal(cli(['config', 'validate'], { cwd: box.project, env: box.env }).out.trim(), 'config ok');
  box.cleanup();
});

test('helper.ceiling holds subagents.atOnce down, and neither helper setting can be set or lifted by a project file', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const config = (...args) => cli(['config', ...args], { cwd: box.project, env: box.env });
  assert.equal(config('set', 'subagents.atOnce', '6', '--global').code, 0);
  assert.equal(config('set', 'helper.ceiling', '3', '--global').code, 0);
  assert.equal(config('get', 'subagents.atOnce').out.trim(), '3');
  assert.match(config('validate').out, /warn subagents\.atOnce is 6, above the ceiling of 3 in helper\.ceiling, so 3 applies/);
  assert.equal(config('set', 'subagents.atOnce', '2', '--local').code, 0);
  assert.equal(config('get', 'subagents.atOnce').out.trim(), '2', 'a project may ask for fewer');
  assert.equal(config('set', 'subagents.atOnce', '9', '--local').code, 0);
  assert.equal(config('get', 'subagents.atOnce').out.trim(), '3', 'and never for more than the ceiling');
  assert.notEqual(config('set', 'helper.ceiling', '32', '--local').code, 0);
  fs.writeFileSync(path.join(box.project, '.100x', 'config.json'), JSON.stringify({ helper: { ceiling: 32, only: 'composer-2.5' } }));
  assert.equal(config('get', 'helper.ceiling').out.trim(), '3');
  assert.equal(config('get', 'helper.only').out.trim(), 'null');
  assert.equal(config('set', 'helper.ceiling', '0', '--global').code === 0, false, 'a ceiling below 1 is refused');
  box.cleanup();
});

test('review-call refuses a judge on a 1m window on Cursor, and its text sends a Cursor agent to the SDK line with the flags the role asks for', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const role = (window) => cli(['config', 'role', 'review', '--provider', 'cursor', '--model', 'muse-wonder-1.0', '--option', 'reasoning_effort=max', '--option', `contextWindow=${window}`, '--global'], { cwd: box.project, env: box.env });
  assert.equal(role('300k').code, 0);
  const text = cli(['review-call'], { cwd: box.project, env: box.env }).out;
  assert.match(text, /In Cursor the Task tool is not that tool, so never use it: run `100x helper run --model muse-wonder-1\.0 --effort max --context 300k --task-file <file> --cwd <folder>` with block_until_ms 0 instead\./);
  assert.equal(role('1m').code, 0);
  for (const args of [['review-call'], ['review-call', '--json']]) {
    const refused = cli(args, { cwd: box.project, env: box.env });
    assert.notEqual(refused.code, 0, args.join(' '));
    assert.match(refused.err, /The judge is set to a 1m context window, which is MAX mode on Cursor, and a helper never starts in MAX mode\. Run `100x config role review --model muse-wonder-1\.0 --option contextWindow=300k --global`\./);
  }
  box.cleanup();
});

test('a project file with a planted helper key does not trap the local file: unrelated settings still write, and the planted keys can be removed one at a time', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const config = (...args) => cli(['config', ...args], { cwd: box.project, env: box.env });
  fs.writeFileSync(path.join(box.project, '.100x', 'config.json'), JSON.stringify({ helper: { only: 'x', ceiling: 99 } }));
  assert.equal(config('set', 'subagents.atOnce', '2', '--local').code, 0, 'an unrelated setting writes');
  assert.equal(config('get', 'subagents.atOnce').out.trim(), '2');
  assert.notEqual(config('set', 'helper.ceiling', '98', '--local').code, 0, 'a change to the key is still refused');
  assert.equal(config('unset', 'helper.only', '--local').code, 0);
  assert.equal(config('unset', 'helper.ceiling', '--local').code, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(box.project, '.100x', 'config.json'), 'utf8')).helper?.only, undefined);
  assert.match(config('validate').out, /^config ok/);
  box.cleanup();
});

test('a config file that is not an object is refused like a typo, naming the file, whatever the JSON is', () => {
  for (const shape of ['"x"', '5', 'null', '[]', 'true']) {
    const box = sandbox();
    cli(['init', '--no-git'], { cwd: box.project, env: box.env });
    fs.writeFileSync(path.join(box.project, '.100x', 'config.json'), shape);
    for (const args of [['config', 'get', 'helper.only'], ['config', 'validate'], ['config', 'print'], ['doctor', '--json']]) {
      const result = cli(args, { cwd: box.project, env: box.env });
      assert.doesNotMatch(result.err, /Cannot (read|create) propert|TypeError/, `${shape} ${args.join(' ')}`);
    }
    const result = cli(['config', 'validate'], { cwd: box.project, env: box.env });
    assert.notEqual(result.code, 0, shape);
    assert.match(result.err, /Invalid JSON in .*config\.json\. The file holds .*a config file is a JSON object/, shape);
    box.cleanup();
  }
  const owner = sandbox();
  write(path.join(owner.home, '.100x', 'config.json'), '"x"');
  const result = cli(['config', 'validate'], { cwd: owner.project, env: owner.env });
  assert.match(result.err, /Invalid JSON in .*config\.json\. The file holds a string/);
  owner.cleanup();
});

test('a planted review.command of the wrong type does not trap an unrelated local write, and the planted key can be removed', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const config = (...args) => cli(['config', ...args], { cwd: box.project, env: box.env });
  fs.writeFileSync(path.join(box.project, '.100x', 'config.json'), JSON.stringify({ review: { command: 123 } }));
  assert.equal(config('set', 'subagents.atOnce', '2', '--local').code, 0);
  assert.equal(config('get', 'subagents.atOnce').out.trim(), '2');
  assert.notEqual(config('set', 'review.command', 'x', '--local').code, 0, 'a change to the key is still refused');
  assert.equal(config('unset', 'review.command', '--local').code, 0);
  box.cleanup();
});

test('config target gives a judge or an overnight child only what a helper may use, and leaves the builder and the quick jobs as set', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const config = (...args) => cli(['config', ...args], { cwd: box.project, env: box.env });
  const role = (name, model, window) => config('role', name, '--provider', 'cursor', '--model', model, '--option', 'reasoning_effort=max', '--option', `contextWindow=${window}`, '--global');
  assert.equal(config('set', 'helper.only', 'muse-wonder-1.0 reasoning_effort=max context=300k', '--global').code, 0);
  assert.deepEqual(JSON.parse(config('target', 'overnight').out), { providerInstanceId: 'cursor', model: 'muse-wonder-1.0', options: { reasoning_effort: 'max', contextWindow: '300k' } }, 'an overnight child that follows the thread runs the locked selection');
  assert.equal(role('overnight', 'composer-2.5', '300k').code, 0);
  assert.match(config('target', 'overnight').err, /The overnight role is composer-2\.5 .*locked to muse-wonder-1\.0/);
  assert.equal(role('review', 'muse-wonder-1.0', '1m').code, 0);
  assert.match(config('target', 'review').err, /The review role is set to a 1m context window/);
  assert.equal(role('quick', 'composer-2.5', '300k').code, 0);
  assert.equal(JSON.parse(config('target', 'quick').out).model, 'composer-2.5', 'the quick jobs are the thread\'s own model');
  const wrote = config('role', 'review', '--provider', 'cursor', '--model', 'composer-2.5', '--option', 'contextWindow=300k', '--global');
  assert.equal(wrote.code, 0, 'the role is written');
  assert.match(wrote.out, /review = not a target a helper may start on\. The review role is composer-2\.5 .*locked to muse-wonder-1\.0/);
  assert.equal(config('role', 'quick', '--model', 'composer-2.5', '--global').out.includes('not a target'), false, 'the quick jobs are not helpers');
  box.cleanup();
});

test('preset lite moves three settings together, standard puts them back, and neither touches anything else', () => {
  const box = sandbox();
  const run = (...args) => cli(args, { cwd: box.project, env: box.env });
  const get = (key) => run('config', 'get', key).out.trim();
  assert.match(run('config', 'preset').out, /Now\. standard\. About 8 judge calls a run\./);
  run('config', 'set', 'subagents.atOnce', '3', '--global');
  const lite = run('config', 'preset', 'lite', '--global');
  assert.equal(lite.code, 0, lite.err);
  assert.match(lite.out, /Lite is on for every project that does not set its own\. 1 polish pass, 2 judge rounds, 2 features built ahead\. About 3 judge calls a run and not 8\./);
  assert.deepEqual([get('polish.passes'), get('review.rounds'), get('depth.max')], ['1', '2', '2']);
  assert.equal(get('test.budget'), 'after-polish', 'the one careful test stays');
  assert.equal(get('review.enabled'), 'true', 'the judge stays on');
  assert.equal(get('subagents.atOnce'), '3', 'a setting that is not part of the preset is left alone');
  assert.match(run('config', 'preset').out, /Now\. lite\. About 3 judge calls a run\./);
  assert.match(run('config').out, /Polish\. 1 pass after the build\. Lite is on, so about 3 judge calls a run\. Tokens the thread itself uses are not counted\./);
  assert.equal(run('config', 'validate').out.trim(), 'config ok');
  run('config', 'set', 'polish.passes', '2', '--global');
  assert.match(run('config', 'preset').out, /Now\. custom\./, 'a lite setting changed by hand is no longer lite');
  const standard = run('config', 'preset', 'standard', '--global');
  assert.match(standard.out, /The usual is back for every project that does not set its own\. 3 polish passes, 5 judge rounds, 5 features built ahead\./);
  const written = JSON.parse(fs.readFileSync(box.env.X100_HOME + '/config.json', 'utf8'));
  assert.equal(JSON.stringify(written.polish ?? {}) + JSON.stringify(written.review ?? {}) + JSON.stringify(written.depth ?? {}), '{}{}{}', 'standard removes the keys, it does not write the defaults');
  assert.equal(written.subagents.atOnce, 3);
  box.cleanup();
});

test('preset medium sits between lite and standard, and is told apart from both', () => {
  const box = sandbox();
  const run = (...args) => cli(args, { cwd: box.project, env: box.env });
  const medium = run('config', 'preset', 'medium', '--global');
  assert.equal(medium.code, 0, medium.err);
  assert.match(medium.out, /Medium is on for every project that does not set its own\. 2 polish passes, 3 judge rounds, 3 features built ahead\. About 5 judge calls a run and not 8\./);
  assert.match(run('config', 'preset').out, /Now\. medium\. About 5 judge calls a run\./);
  assert.match(run('config').out, /Medium is on, so about 5 judge calls a run\./);
  assert.equal(run('config', 'validate').out.trim(), 'config ok');
  run('config', 'preset', 'lite', '--global');
  assert.match(run('config', 'preset').out, /Now\. lite\./);
  run('config', 'preset', 'standard', '--global');
  assert.match(run('config', 'preset').out, /Now\. standard\./);
  box.cleanup();
});

test('the plan standards are a reference the setup skill reads, and none of them asks for Fable at max', () => {
  const plans = fs.readFileSync(new URL('../skills/100x/references/plans.md', import.meta.url), 'utf8');
  const setup = fs.readFileSync(new URL('../skills/100x-setup/SKILL.md', import.meta.url), 'utf8');
  assert.match(setup, /100x ref plans/);
  const claudeQuestion = setup.slice(setup.indexOf('Which plan are you on?'), setup.indexOf('In Codex, or when'));
  for (const line of ['Pro    ', 'Max    ', 'Ultra  ', 'write whatever you want', 'in your own words']) assert.ok(claudeQuestion.includes(line), line);
  assert.ok(!/Fable[^\n]*max/i.test(claudeQuestion), 'the question never offers Fable at max');
  const openaiQuestion = setup.slice(setup.indexOf('In Codex, or when'), setup.indexOf('Everywhere else'));
  for (const line of ['Go or Plus', 'Pro 100', 'Pro 200+', 'write whatever you want', 'in your own words']) assert.ok(openaiQuestion.includes(line), line);
  const openaiPlans = plans.slice(plans.indexOf('## OpenAI plans'));
  for (const plan of ['Go or Plus', 'Pro 100', 'Pro 200 or 500']) assert.ok(openaiPlans.includes(plan), plan);
  assert.ok(!/Astra, (max|xhigh)/i.test(openaiPlans), 'no OpenAI standard asks for the top effort');
  assert.ok(!/GPT-6\.1|GPT-6 (Sol|Astra)/.test(openaiPlans.split('\n').filter((line) => line.startsWith('|')).join('\n')), 'the tables name families, not old versions');
  assert.match(openaiPlans, /newest version of each/);
  const backup = openaiPlans.split('\n').find((line) => line.startsWith('| Backup judge'));
  assert.match(backup, /none \| none \| none/, 'a backup from the builder\'s family would be a self-review');
  assert.match(setup, /Claude Code or the Claude desktop app/);
  assert.match(setup, /Which models should do which job\?/, 'the other apps keep the plain question');
  for (const plan of ['Pro', 'Max', 'Ultra']) assert.ok(plans.includes(plan) && setup.includes(plan), plan);
  assert.doesNotMatch(plans.split('\n').filter((line) => line.startsWith('|')).join('\n'), /Fable, max/i, 'no table cell gives Fable the max effort');
  assert.match(plans, /Never use Fable at max effort/);
  assert.equal(cli(['ref', 'plans']).code, 0);
});

test('preset works for one project, and a name that is not a preset is refused', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const run = (...args) => cli(args, { cwd: box.project, env: box.env });
  const local = run('config', 'preset', 'lite', '--local');
  assert.equal(local.code, 0, local.err);
  assert.match(local.out, /Lite is on for this project\./);
  assert.equal(run('config', 'get', 'review.rounds').out.trim(), '2');
  const other = sandbox();
  assert.equal(cli(['config', 'get', 'review.rounds'], { cwd: other.project, env: other.env }).out.trim(), '5', 'another home is untouched');
  other.cleanup();
  const refused = run('config', 'preset', 'tiny', '--local');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /There is no preset "tiny"\. The presets are lite, medium and standard\./);
  assert.equal(run('config', 'preset', 'lite').code, 1, 'a scope is required');
  box.cleanup();
});
