import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CliError } from '../errors.mjs';
import { MATRICES, parseSteps, parseViewports, resolveTarget, runMatrix, viewportsFor } from '../matrix.mjs';
import { findProjectRoot } from '../paths.mjs';

const usage = `
100x shots <url|file|folder> [options]

Opens the target in headless Chromium at many viewports and device pixel ratios, takes a screenshot per state,
and runs mechanical checks. Broken means a real defect (overflow, cut-off text, stretched or blurry canvas,
broken image, console error, failed step, blank page). Weak means a guideline miss (tap target under 44px,
text under 12px on phones, overlapping controls, no viewport meta). Info is context.
It also saves every string the page showed, once each and one per line, in texts.txt next to the screenshots.
Those are the words a person reads, including text a script put there, so \`100x text lint <texts.txt> --profile ui\` checks the real copy.

Options
  --label <name>        Folder under .100x/shots. Default "run". Use core, build, pass-1, pass-2, pass-3, must-not-break, final.
  --out <dir>           Exact output folder. Overrides --label.
  --matrix <name>       ${Object.keys(MATRICES).join(', ')}. Default standard. all-rotate adds a rotate test.
  --viewports <list>    WIDTHxHEIGHT[@DPR] comma list, for example 390x844@3,844x390@3. Overrides --matrix.
  --steps <file|json>   States to reach. [{"click":"text=Start"},{"wait":500},{"shot":"playing"}]
                        Actions. goto click tap dblclick hover fill press type wait waitFor scroll eval viewport shot.
  --init-script <file>  JavaScript run before the page loads. Seed localStorage to test late game numbers.
  --wait <ms|selector>  Extra wait after load.
  --resize-test         After the states, rotate the viewport without reloading and check again.
  --full-page           Full page screenshots instead of the viewport.
  --no-checks           Screenshots only.
  --sound               Leave audio on. Default is muted.
  --fail-on-broken      Exit code 1 when anything is broken.
  --json                Print the whole result as JSON.
`;

export default {
  name: 'shots',
  summary: 'Screenshot and check a page across many resolutions and states.',
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        label: { type: 'string' },
        out: { type: 'string' },
        matrix: { type: 'string' },
        viewports: { type: 'string' },
        steps: { type: 'string' },
        'init-script': { type: 'string' },
        wait: { type: 'string' },
        'resize-test': { type: 'boolean' },
        'full-page': { type: 'boolean' },
        'no-checks': { type: 'boolean' },
        sound: { type: 'boolean' },
        'fail-on-broken': { type: 'boolean' },
        json: { type: 'boolean' },
      },
    });
    if (!positionals[0]) throw new CliError('Usage: 100x shots <url|file|folder> [options]. Run `100x help shots`.');
    const cwd = process.cwd();
    const matrixName = values.viewports ? 'custom' : (values.matrix ?? 'standard');
    const root = findProjectRoot(cwd);
    const base = root ? path.join(root, '.100x', 'shots') : path.join(cwd, '100x-shots');
    const outDir = path.resolve(cwd, values.out ?? path.join(base, values.label ?? 'run'));
    const result = await runMatrix({
      cwd,
      url: resolveTarget(positionals[0], cwd),
      outDir,
      matrixName,
      viewports: values.viewports ? parseViewports(values.viewports) : viewportsFor(matrixName),
      steps: parseSteps(values.steps),
      initScript: values['init-script'] ? fs.readFileSync(values['init-script'], 'utf8') : undefined,
      waitFor: values.wait,
      resizeTest: values['resize-test'] || matrixName === 'all-rotate',
      fullPage: values['full-page'],
      checks: !values['no-checks'],
      sound: values.sound,
      settleMs: 600,
      timeoutMs: 20000,
    });
    // A page that opened at no size was never measured. Say that first and fail, so nobody reads the rest as a verdict on the page.
    const notOpened = result.viewports.every((viewport) => viewport.states.every((state) => state.findings.some((finding) => finding.check === 'navigation')));
    if (notOpened) process.exitCode = 1;
    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (notOpened) console.log(`NOT OPENED at any size. ${result.viewports[0].states[0].findings.find((finding) => finding.check === 'navigation').detail}. Nothing was measured. Start the app or check the address, then shoot again.`);
      const { totals, states, examined } = result.summary;
      console.log(`shots ${result.viewports.length} viewports, ${states} states, ${examined} elements looked at. ${(result.durationMs / 1000).toFixed(1)}s`);
      console.log(`broken ${totals.broken}  weak ${totals.weak}  info ${totals.info}`);
      let shown = 0;
      for (const viewport of result.viewports) {
        for (const state of viewport.states) {
          for (const finding of state.findings.filter((f) => f.severity === 'broken')) {
            if (shown++ < 12) console.log(`  BROKEN ${finding.check.padEnd(12)} ${viewport.id} ${state.name}${finding.sel ? ` ${finding.sel}` : ''}. ${finding.detail}`);
          }
        }
      }
      if (totals.broken > shown) console.log(`  ${totals.broken - shown} more broken in matrix.md`);
      if (result.hint) console.log(`  ${result.hint}`);
      console.log(`report ${path.join(outDir, 'matrix.md')}`);
      if (result.strings) console.log(`texts  ${path.join(outDir, 'texts.txt')} (${result.strings} strings the page showed, one per line). Lint the copy with 100x text lint <that file> --profile ui`);
      console.log(`sheet  ${path.join(outDir, 'contact-sheet.html')} (open the contact-sheet.png beside it to see every shot in one image)`);
    }
    if (values['fail-on-broken'] && result.summary.totals.broken > 0) process.exitCode = 1;
    return undefined;
  },
};
