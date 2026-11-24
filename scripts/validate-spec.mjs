// The same check as `for d in skills/*/; do npx -y skills-ref validate "$d"; done`, written in node so it also runs where npm uses cmd.exe.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProgram } from '../lib/proc.mjs';

const skills = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
for (const entry of fs.readdirSync(skills, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  const result = runProgram('npx', ['-y', 'skills-ref', 'validate', path.join(skills, entry.name)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
