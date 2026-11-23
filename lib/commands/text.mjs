import { runCompanion } from '../companions.mjs';

const usage = `
100x text lint <file|folder> --profile <ui|docs|article|message|marketing|narrative> [--fail-above <n>]
100x text check <before> <after>
100x text begin <file|folder> ... then 100x text finish

Runs unslop-text, the pinned copy that ships with 100x in vendor/unslop-text. It measures padding, stock phrases and clarity,
and checks that a rewrite kept its facts. The flags are the tool's own: \`100x text --help\` lists them. \`100x shots\` saves the words
a page shows in texts.txt, and the polish stage lints that file. \`100x validate --prose\` lints the skill and its docs. Set X100_UNSLOP_TEXT_CLI to a checkout's
skills/unslop-text/scripts/unslop.mjs to try a change to the tool itself.
`;

export default {
  name: 'text',
  summary: 'Lint and check copy with unslop-text.',
  passThrough: true,
  usage,
  async run(argv) {
    process.exitCode = runCompanion('unslop-text', argv, { rename: true }).status;
  },
};
