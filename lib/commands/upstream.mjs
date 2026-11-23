import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import UPSTREAM from '../upstream.json' with { type: 'json' };
import { CliError } from '../errors.mjs';
import { plural } from '../text.mjs';

const usage = `
100x upstream [--json]

100x began from pstack (MIT, ${UPSTREAM.repo}, folder ${UPSTREAM.path}), pinned at ${UPSTREAM.pinned.slice(0, 7)}.
This lists newer commits that touch pstack upstream, so good ideas can be pulled in by hand. It changes nothing.
Needs the gh command and a network. Set X100_GH to use another gh binary.
`;

export function newerCommits(tsv, pinned) {
  const commits = tsv.split('\n').filter(Boolean).map((line) => {
    const [sha, date, ...subject] = line.split('\t');
    return { sha, date, subject: subject.join('\t') };
  });
  const index = commits.findIndex((commit) => pinned.startsWith(commit.sha) || commit.sha.startsWith(pinned.slice(0, 7)));
  return { found: index >= 0, newer: index >= 0 ? commits.slice(0, index) : commits };
}

export default {
  name: 'upstream',
  summary: 'List pstack commits newer than the one 100x was built from.',
  usage,
  async run(argv) {
    const { values } = parseArgs({ args: argv, options: { json: { type: 'boolean' } } });
    let tsv;
    try {
      tsv = execFileSync(process.env.X100_GH ?? 'gh', ['api', `repos/${UPSTREAM.repo}/commits?path=${UPSTREAM.path}&per_page=40`, '--jq', '.[] | [.sha[0:7], .commit.committer.date, (.commit.message | split("\\n")[0])] | @tsv'], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      throw new CliError(`Could not read ${UPSTREAM.repo} on GitHub. ${(error.stderr || error.message).toString().trim().slice(0, 200)}`);
    }
    const { found, newer } = newerCommits(tsv, UPSTREAM.pinned);
    if (values.json) return console.log(JSON.stringify({ pinned: UPSTREAM.pinned, found, newer }, null, 2));
    if (!found) console.log(`The pinned commit ${UPSTREAM.pinned.slice(0, 7)} is not among the latest 40 commits. Everything below may be newer.`);
    console.log(newer.length ? `${plural(newer.length, 'newer commit')} touch${newer.length === 1 ? 'es' : ''} ${UPSTREAM.path} since ${UPSTREAM.pinned.slice(0, 7)}.` : `Up to date with ${UPSTREAM.path} at ${UPSTREAM.pinned.slice(0, 7)}.`);
    for (const commit of newer) console.log(`${commit.sha} ${commit.date.slice(0, 10)} ${commit.subject}`);
    return undefined;
  },
};
