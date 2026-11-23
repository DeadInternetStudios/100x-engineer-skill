import { parseArgs } from 'node:util';
import { REPO_ROOT } from '../paths.mjs';
import { validateRepo } from '../validate.mjs';
import { PROSE_LIMIT, proseLint } from '../validate-prose.mjs';

const usage = `
100x validate [--root <dir>] [--json] [--prose]

Structural gate for the skills. Each skill meets the Agent Skills specification (agentskills.io): the name is lowercase letters, digits and single hyphens and matches
its folder, the description fits 1024 characters, the only keys are name, description, license, compatibility (up to 500 characters), metadata (strings) and allowed-tools,
and the body stays under 5000 tokens. License, compatibility and metadata must match package.json (\`node scripts/stamp-skills.mjs\` writes them). The front matter must
parse as YAML. The house rules add: the description says when to use the skill, SKILL.md stays inside its line budget, no skill keeps a modes folder (a mode is a skill of its own),
links and referenced files exist, no skill names a file outside its own folder (another skill is named by its name, a shared guide is printed with \`100x ref <name>\`), every
file in references/ is named in SKILL.md and nothing in assets/ is orphaned, every \`100x <command>\` named in prose exists, and prose has no long dashes or placeholders.
--prose also runs unslop-text lint with the docs profile over skills, docs and the top level notes, and fails above a slop score of ${PROSE_LIMIT} per 1000 words.
It also compares the command lists in README.md and docs/design.md with the CLI, so they cannot drift.
It checks form, not meaning. A skill that tells the agent to force push or deploy to production still passes, so a person or the review reads what the instructions ask for.
It is skipped with a note when the pinned unslop-text is missing. Exit code 1 when anything fails.
`;

export default {
  name: 'validate',
  summary: 'Check the skill files for structure, links and prose rules.',
  usage,
  async run(argv) {
    const { values } = parseArgs({ args: argv, options: { root: { type: 'string' }, json: { type: 'boolean' }, prose: { type: 'boolean' } } });
    const { commandNames, commandUsages } = await import('./index.mjs');
    const findings = validateRepo(values.root ?? REPO_ROOT, { commands: commandNames, usages: commandUsages });
    const prose = values.prose ? proseLint(values.root ?? REPO_ROOT) : null;
    if (prose && !prose.ok) findings.push({ level: 'error', rule: 'prose-lint', file: '.', message: `unslop-text lint failed.\n${prose.output}` });
    if (values.json) console.log(JSON.stringify(findings, null, 2));
    else if (findings.length) for (const f of findings) console.log(`${f.level} ${f.rule} ${f.file}: ${f.message}`);
    else console.log(prose?.ran ? 'validate ok. prose lint ok' : 'validate ok');
    if (prose && !prose.ran && !values.json) console.log(prose.output);
    if (findings.some((f) => f.level === 'error')) process.exitCode = 1;
    return undefined;
  },
};
