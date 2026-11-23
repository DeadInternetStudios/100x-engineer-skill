export class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

// A file the CLI keeps for itself and can no longer read. Say which file, why, and the one way out.
export const badJson = (file, error, afterwards) => new CliError(`Invalid JSON in ${file}. ${error.message}. Fix the typo, or move the file aside with \`mv ${file} ${file}.bad\` and ${afterwards}.`);

// A folder the user may not write to is a failure no command can repair on its own. Say what is wrong and what to do, in plain words.
export function plainMessage(error) {
  if (['EACCES', 'EPERM', 'EROFS'].includes(error.code)) return `cannot write ${error.path ?? 'here'}. It is read-only for you. Work in a folder you can write to, or change who may write there.`;
  if (error.code === 'ENOSPC') return 'the disk is full, so nothing can be saved. Free some space and run it again.';
  return error.message;
}
