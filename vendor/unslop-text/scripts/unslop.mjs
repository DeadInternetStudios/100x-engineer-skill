#!/usr/bin/env node
import { main, exitCodeFor } from './lib/commands.mjs';

process.stdout.on('error', (error) => {
  if (error.code !== 'EPIPE') throw error;
  process.exit(process.exitCode ?? 0);
});

const argv = process.argv.slice(2);

try {
  process.exitCode = main(argv);
} catch (error) {
  const { code, message } = exitCodeFor(error) ?? { code: 2, message: `internal error: ${error?.stack ?? error}` };
  if (argv.includes('--json')) console.log(JSON.stringify({ error: message }, null, 2));
  else console.error(`unslop: ${message}`);
  process.exitCode = code;
}
