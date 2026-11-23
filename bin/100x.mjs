#!/usr/bin/env node
import { main } from '../lib/cli.mjs';
import { plainMessage } from '../lib/errors.mjs';

main(process.argv.slice(2)).catch((error) => {
  console.error(`100x: ${plainMessage(error)}`);
  if (process.env.X100_DEBUG) console.error(error.stack);
  process.exit(error.exitCode ?? 1);
});
