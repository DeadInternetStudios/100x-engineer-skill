import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCmdProblem } from '../lib/run-command.mjs';

function folder(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x100-runcmd-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}
const pkg = (scripts) => JSON.stringify({ scripts });

test('a command that starts something the folder has is fine, and so is one this check cannot read', () => {
  const dir = folder({ 'package.json': pkg({ dev: 'vite', start: 'node a.js', test: 'node --test' }), 'server.mjs': '', 'public/index.html': '', 'bin/run.sh': '' });
  for (const command of [
    'npm run dev', 'npm start', 'npm test', 'pnpm dev', 'yarn start', 'bun run dev', 'npm run dev -- --port 3000', 'PORT=4000 npm start',
    'node server.mjs', 'node --watch server.mjs --port 80', 'python3 -m http.server 8000', 'node -e "1"', 'open public/index.html', 'open http://localhost:5173',
    './bin/run.sh', 'bash bin/run.sh', 'npx serve .', 'cargo run', 'make run', 'cd app && npm start', 'npm run build | tee out.txt',
  ]) assert.equal(runCmdProblem(dir, command), null, command);
});

test('a command in a form this does not judge is never refused: other runtimes, a file with no extension, a page with a fragment, another package', () => {
  const dir = folder({ 'package.json': pkg({ build: 'x' }), 'main.ts': '', 'server.ts': '', 'src/server.js': '', 'register.mjs': '', 'server.mjs': '', 'public/index.html': '' });
  for (const command of [
    'deno task dev', 'deno run -A main.ts', 'deno run --allow-net server.ts', 'bun run server.ts', 'bun server.ts', 'node src/server', 'node .',
    'open -a Safari public/index.html', 'open -a "Google Chrome" public/index.html', 'open "public/index.html#/play"', 'open public/index.html?debug=1',
    'npm run dev --prefix web', 'pnpm --filter web dev', 'yarn --cwd web start', 'python3 ~/tools/serve.py', 'php -S localhost:8000', 'php -S 0.0.0.0:8080 -t public',
    'node --import ./register.mjs server.mjs', 'node --env-file=.env server.mjs', 'ruby -run -e httpd . -p 8000', 'uvicorn app:app --reload',
    'open', 'node', 'env PORT=1 node server.mjs',
  ]) assert.equal(runCmdProblem(dir, command), null, command);
});

test('a command that names a script or a file the folder does not have says which', () => {
  const dir = folder({ 'package.json': pkg({ dev: 'vite', build: 'vite build' }), 'server.mjs': '' });
  assert.equal(runCmdProblem(dir, 'npm run serve'), 'runs the package script "serve", and package.json has only dev, build');
  assert.equal(runCmdProblem(dir, 'npm start'), 'runs the package script "start", and package.json has only dev, build');
  assert.equal(runCmdProblem(dir, 'yarn run play'), 'runs the package script "play", and package.json has only dev, build');
  assert.equal(runCmdProblem(dir, 'node main.js'), 'runs main.js, and the project folder has no such file');
  assert.equal(runCmdProblem(dir, 'python3 app.py'), 'runs app.py, and the project folder has no such file');
  assert.equal(runCmdProblem(dir, 'open index.html'), 'opens index.html, and the project folder has no such file');
  assert.equal(runCmdProblem(dir, 'open -a Safari index.html'), 'opens index.html, and the project folder has no such file');
  assert.equal(runCmdProblem(dir, 'deno run main.ts'), 'runs main.ts, and the project folder has no such file');
  assert.equal(runCmdProblem(dir, 'bun run server.ts'), 'runs server.ts, and the project folder has no such file');
  assert.equal(runCmdProblem(dir, './run.sh'), 'runs ./run.sh, and the project folder has no such file');
  assert.equal(runCmdProblem(folder({ 'package.json': pkg({}) }), 'npm run dev'), 'runs the package script "dev", and package.json has no scripts');
});

test('a folder with no package.json cannot start a package script, and npm start may fall back to server.js', () => {
  assert.equal(runCmdProblem(folder(), 'npm run dev'), 'runs the package script "dev", and the project folder has no package.json');
  assert.equal(runCmdProblem(folder({ 'server.js': '' }), 'npm start'), 'runs the package script "start", and the project folder has no package.json');
  assert.equal(runCmdProblem(folder({ 'package.json': pkg({ build: 'x' }), 'server.js': '' }), 'npm start'), null);
  assert.equal(runCmdProblem(folder({ 'package.json': '{ not json' }), 'npm run dev'), null, 'a manifest this cannot read is not judged');
});
