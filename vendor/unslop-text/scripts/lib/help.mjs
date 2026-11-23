// The text behind `unslop --help` and `unslop <command> --help`. A command's help lists exactly the options
// that command takes, read from the table `commands.mjs` runs, so the two cannot drift apart.

const WIDTH = 20;
const option = (label, text) => `${label.padEnd(WIDTH)}${text}`;

// Each option: its label and what it does. A function reads the names the command module owns.
const OPTIONS = {
  profile: ({ profiles }) => option('--profile <name>', `auto (default), ${profiles.join(', ')}`),
  level: ({ levels }) => option('--level <name>', `${levels.join(', ')} (default standard)`),
  format: () => option('--format <name>', 'auto (default), prose, lines, json, kv, csv, xml (Android strings.xml)'),
  column: () => option('--column <name>', 'csv and tsv: the column to use (default: the English one; a number counts)'),
  'all-strings': () => option('--all-strings', 'also use strings that look like code, paths or ids'),
  json: () => option('--json', 'machine-readable output'),
  max: () => option('--max <n>', 'how many findings to list'),
  'fail-above': () => option('--fail-above <n>', 'exit 1 when a slop score is above this'),
  'max-growth': () => option('--max-growth <n>', 'how much longer the rewrite may be (default 1.1, 1.15 for strings)'),
  summary: () => option('--summary', 'several files: print only the table of scores'),
  full: () => option('--full', 'several files with --fail-above: list every file\'s findings'),
  strict: () => option('--strict', 'a warning fails the run too'),
  name: () => option('--name <name>', 'the snapshot to use (default main)'),
  force: () => option('--force', 'replace a saved snapshot (begin), or write despite errors (apply)'),
  'allow-outside': () => option('--allow-outside', 'a saved file outside the working folder is meant'),
  offset: () => option('--offset <n>', 'start at this string'),
  limit: () => option('--limit <n>', 'list this many strings'),
  out: () => option('--out <file>', 'write the strings to a file'),
  write: () => option('--write', 'save the file (without it, a dry run)'),
  chunk: () => option('--chunk <words>', 'words per chunk (default 1200)'),
  min: () => option('--min <words>', 'the shortest chunk worth making (default 250)'),
};

// Where a command says an option differently from the generic line above.
const OPTION_NOTES = {
  lint: { max: option('--max <n>', 'findings to list per file (0 = all)'), json: option('--json', 'machine-readable output (a list when there are several files)') },
  check: { max: option('--max <n>', 'how many findings to list (default 12)') },
  finish: { max: option('--max <n>', 'how many findings to list per file (default 5)') },
  apply: { max: option('--max <n>', 'how many findings to list (default 12)'), force: option('--force', 'write even when check finds errors') },
  begin: { force: option('--force', 'replace an existing snapshot (this discards the saved originals)') },
  claims: { profile: option('--profile <name>', 'marks the stock phrases that were cut (two files only)') },
  diff: { profile: option('--profile <name>', 'marks the stock phrases that were cut') },
};

const COMMANDS = {
  lint: { group: 'Measure', short: 'Score padding, stock phrases and clarity. Read-only.', job: 'Score padding, stock phrases and clarity. Read-only: it does not rewrite.', usage: ['unslop lint <file|dir|-> ...'], example: 'unslop lint README.md', notes: ['Give "-" to read text from stdin: pbpaste | unslop lint - --profile docs', 'Text with no file name is read as UI strings or prose by its shape. --profile docs forces prose.'], exits: 'Exits 1 only with --fail-above.' },
  voice: { group: 'Measure', short: 'Measure how a text sounds: rhythm, contractions, person.', job: 'Measure how a text sounds: rhythm, contractions, person, questions. Two files compare.', usage: ['unslop voice <file> [<after>]'], example: 'unslop voice old.md new.md', exits: 'Reports and exits 0.' },
  plan: { group: 'Measure', short: 'Split a long text into chunks, worst first.', job: 'Split a long text into chunks, worst first.', usage: ['unslop plan <file>'], example: 'unslop plan handbook.md --chunk 800', exits: 'Reports and exits 0.' },
  audit: { group: 'Measure', short: 'Find inconsistent capitalization, punctuation, wording.', job: 'Find inconsistent capitalization, punctuation and wording.', usage: ['unslop audit <file>'], example: 'unslop audit locales/en.json', exits: 'Reports and exits 0.' },
  check: { group: 'Check a rewrite', short: 'Check that a rewrite kept the facts, then compare scores.', job: 'Check that a rewrite kept the numbers, names, code, links and placeholders.', usage: ['unslop check <before> <after>'], example: 'unslop check old.md new.md', exits: 'Exits 1 when it finds an error (with --strict, a warning too).' },
  claims: { group: 'Check a rewrite', short: "List a text's sentences, or what a rewrite cut or added.", job: "List a text's sentences as a checklist, or what a rewrite cut, replaced or added.", usage: ['unslop claims <file>', 'unslop claims <before> <after>'], example: 'unslop claims old.md new.md', exits: 'Reports and exits 0.' },
  diff: { group: 'Check a rewrite', short: 'Show every sentence a rewrite changed, side by side.', job: 'Show every sentence a rewrite changed, side by side.', usage: ['unslop diff <before> <after>'], example: 'unslop diff old.md new.md', exits: 'Reports and exits 0.' },
  begin: { group: 'Snapshots', short: 'Save the originals before you edit.', job: 'Save the originals before you edit.', usage: ['unslop begin <file|dir> ...'], example: 'unslop begin docs/', exits: 'Exits 0 when it saved them.' },
  finish: { group: 'Snapshots', short: 'Check every saved file against its original.', job: 'Check every saved file against its original.', usage: ['unslop finish'], example: 'unslop finish', exits: 'Exits 1 when a file fails or is missing (with --strict, a warning too).' },
  restore: { group: 'Snapshots', short: 'Put saved originals back.', job: 'Put saved originals back.', usage: ['unslop restore <file|all>'], example: 'unslop restore all', exits: 'Exits 0 when it restored them.' },
  strings: { group: 'UI strings', short: 'Export the editable strings of a file as JSON.', job: 'Export the editable strings of a file as JSON (key to text).', usage: ['unslop strings <file>'], example: 'unslop strings en.json --out edits.json', exits: 'Exits 0.' },
  apply: { group: 'UI strings', short: 'Put edited strings back and check them. Dry run by default.', job: 'Put edited strings back, and check the result. A dry run unless --write.', usage: ['unslop apply <file> <edits.json>'], example: 'unslop apply en.json edits.json --write', exits: 'Exits 1 when check finds an error.' },
  words: { group: 'Reference', short: 'Print plain-word swaps, wordy phrases and idioms.', job: 'Print plain-word swaps, wordy phrases and idioms.', usage: ['unslop words'], example: 'unslop words', exits: 'Exits 0.' },
  rules: { group: 'Reference', short: 'List every rule with its weight.', job: 'List every rule with its weight.', usage: ['unslop rules'], example: 'unslop rules --json', exits: 'Exits 0.' },
  profiles: { group: 'Reference', short: 'List the surface profiles.', job: 'List the surface profiles.', usage: ['unslop profiles'], example: 'unslop profiles', exits: 'Exits 0.' },
  demo: { group: 'Reference', short: 'A padded text, its rewrite, a pass and a failing copy.', job: 'Show a padded text, its plain rewrite, a passing check and a sabotaged copy that fails.', usage: ['unslop demo'], example: 'unslop demo', exits: 'Exits 1 if the check no longer behaves as the demo shows.' },
};

const GROUPS = ['Measure', 'Check a rewrite', 'Snapshots', 'UI strings', 'Reference'];

export const COMMAND_NAMES = Object.keys(COMMANDS);

export function globalHelp({ profiles, levels, options }) {
  const lines = ['unslop measures a text and checks that a rewrite kept its facts. Your agent writes the rewrite.', '', 'Usage: unslop <command> [options]     "unslop <command> --help" lists that command\'s options', ''];
  for (const group of GROUPS) {
    lines.push(group);
    for (const name of COMMAND_NAMES.filter((n) => COMMANDS[n].group === group)) {
      const { usage, short } = COMMANDS[name];
      usage.forEach((form, i) => lines.push(`  ${form.padEnd(34)}${i === 0 ? short : ''}`.trimEnd()));
    }
    lines.push('');
  }
  lines.push(
    'Examples',
    '  unslop lint README.md                      Score a file and list what to fix.',
    '  unslop begin docs/ && unslop finish        Save the originals, edit, then check each one.',
    '  unslop check old.md new.md                 Check that the rewrite kept the facts.',
    '  unslop claims old.md new.md                List only what the rewrite cut, replaced or added.',
    '  unslop demo                                A padded text, its rewrite, a pass and a fail.',
    '  unslop strings en.json --out edits.json    Export UI strings; put them back with apply.',
    '',
    'Options (a command rejects an option it does not take)',
  );
  for (const name of new Set(Object.values(options).flat())) lines.push(`  ${OPTIONS[name]({ profiles, levels })}`);
  lines.push(`  ${option('-h, --help', 'show help')}`, `  ${option('--version', 'show the version')}`, '', 'Exit codes: 0 ok, 1 a gate failed, 2 usage error.', 'Only check, finish, apply, demo and lint --fail-above can fail a gate.');
  return lines.join('\n');
}

export function commandHelp(name, { profiles, levels, options }) {
  const { job, usage, example, notes = [], exits } = COMMANDS[name];
  const lines = [`unslop ${name}: ${job}`, '', 'Usage', ...usage.map((form) => `  ${form}`)];
  for (const note of notes) lines.push(`  ${note}`);
  lines.push('', 'Options');
  for (const taken of options[name]) lines.push(`  ${OPTION_NOTES[name]?.[taken] ?? OPTIONS[taken]({ profiles, levels })}`);
  lines.push(`  ${option('-h, --help', 'show this help')}`, '', 'Example', `  ${example}`, '', `${exits} A usage error exits 2.`, 'Run "unslop --help" for every command.');
  return lines.join('\n');
}
