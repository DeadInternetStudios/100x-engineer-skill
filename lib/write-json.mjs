import fs from 'node:fs';

// A state file is written whole or not at all, so a crash in the middle cannot leave half a file for the next command to misread.
export function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}
