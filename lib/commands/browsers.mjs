import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CliError } from '../errors.mjs';
import { globalDir } from '../paths.mjs';
import { runProgram } from '../proc.mjs';
import { chromiumBuilds, resolvePlaywright } from '../playwright.mjs';

const usage = `
100x browsers [--check]

Installs Playwright and Chromium into ~/.100x when nothing on this machine provides them.
Does nothing when 100x shots can already find a browser. --check only reports, exit code 1 when missing.
Run it in the foreground and let it finish. A download left in the background dies when its shell call returns.
The installers' progress lines are kept and shown only when one of them fails.
`;

// The installers print a progress line for every 10 percent, which buries the answer for an agent. Keep the output, show it on failure.
export function install(label, command, args) {
  const result = runProgram(command, args, { encoding: 'utf8' });
  if (result.status === 0) return;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n');
  throw new CliError(`${label} failed${result.status === null ? ` (${result.error?.message ?? 'did not start'})` : ` with exit code ${result.status}`}.\n${output}`);
}

export default {
  name: 'browsers',
  summary: 'Install Playwright and Chromium into ~/.100x if they are missing.',
  usage,
  async run(argv) {
    const { values } = parseArgs({ args: argv, options: { check: { type: 'boolean' } } });
    const found = resolvePlaywright();
    if (found && chromiumBuilds().length) {
      console.log(`already available. Playwright ${found.version} via ${found.base}`);
      return undefined;
    }
    if (values.check) {
      console.log('not available');
      process.exitCode = 1;
      return undefined;
    }
    fs.mkdirSync(globalDir(), { recursive: true });
    console.log(`Installing Playwright into ${globalDir()}. This takes a minute or two, and the output is kept unless it fails.`);
    install('Installing Playwright', 'npm', ['install', '--prefix', globalDir(), '--no-audit', '--no-fund', 'playwright']);
    console.log('Installing Chromium. The download is large.');
    install('Installing Chromium', path.join(globalDir(), 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright'), ['install', 'chromium']);
    console.log('installed Playwright and Chromium into', globalDir());
    return undefined;
  },
};
