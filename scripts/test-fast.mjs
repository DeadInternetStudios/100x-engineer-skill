// The fast test lane: every test except the ones that drive a real browser. It sets X100_FAST from Node, so it works in cmd and PowerShell as well as in a Unix shell.
import { spawnSync } from 'node:child_process';

const run = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], { stdio: 'inherit', env: { ...process.env, X100_FAST: '1' } });
process.exit(run.status ?? 1);
