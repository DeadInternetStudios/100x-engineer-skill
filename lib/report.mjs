import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { reportedUsual } from './config.mjs';
import { stageTags } from './git.mjs';
import { lookFirst, lookTone, worstReason } from './look-first.mjs';
import { reasonsFor, reasonText, SHORT, shownReasons } from './why-not.mjs';
import { checkWords, mustNotBreakList } from './must-not-break.mjs';
import { fileUrl, galleryFile } from './paths.mjs';
import { finalMatrix, readAsks, runRows, stateFile } from './project.mjs';
import { renderReportHtml } from './report-html.mjs';
import { modern } from './runfile.mjs';
import { plural, sayWhat, verdictSay } from './text.mjs';

// A judge that is the model that built the run shares its blind spots, and the report says so.
const reviewer = (review) => `${review.model}${review.sameAsBuilder ? ', the same model that built it' : ''}`;
const reviewCounts = (review) => `${review.flags ?? 0} flagged, ${review.fixed ?? 0} fixed${review.rejected ? `, ${review.rejected} rejected` : ''}${review.deferred ? `, ${review.deferred} deferred` : ''}`;
// A line ends without a period unless it is a full sentence, so a value written as a sentence loses its last one here.
const bare = (text) => String(text ?? '').trim().replace(/\.$/, '');
const workText = (work) => {
  const span = work.minutes >= 90 ? `${(work.minutes / 60).toFixed(1).replace(/\.0$/, '')} h` : `${work.minutes} min`;
  return `${span} of ${work.totalMinutes >= 90 ? `${Math.round(work.totalMinutes / 60)} h` : `${work.totalMinutes} min`} asked for, ${plural(work.rounds, 'round')}${work.stoppedEarly ? `, stopped early: ${bare(work.stoppedEarly)}` : ''}`;
};
const workLine = (work) => (work ? `Work: ${workText(work)}` : null);
const listed = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
// Five rounds look at three things, so the line names each thing once and not once per round.
const lastWord = (review) => (review.rounds.lastReady === null ? 'the judge did not say' : review.rounds.lastReady ? 'ready to ship' : 'NOT ready to ship');
const roundsDone = (review) => `${review.rounds.held} of ${review.rounds.planned} done, on ${listed([...new Set(review.rounds.lenses)])}${review.rounds.usual ? ` (this project's setting is lower than the usual ${review.rounds.usual})` : ''}`;
const roundsText = (review) => (review?.rounds ? `${roundsDone(review)}${review.rounds.lastReady === null ? ', with no last word from the judge' : `, and the last word was ${lastWord(review)}`}` : null);
const roundsLine = (review) => (roundsText(review) ? `Judge rounds: ${roundsText(review)}` : null);

// The passes that ran against the number the owner usually asks for, so a run the clock cut short, or a project set to take fewer, says so.
function polishText(root, run) {
  const done = run.polishPasses ?? 0;
  const wanted = run.mode === 'mockup' ? 0 : reportedUsual(run.verdict === 'dud' ? 'polish.dudPasses' : 'polish.passes', { cwd: root });
  return Number.isInteger(wanted) && done < wanted ? `${done} of ${wanted}` : String(done);
}

// "Must not break: screen sizes passed (0 broken of 212 ...)" in the report and in the final message, the words the page and the ranking use.
const checkLine = (check) => {
  const { kind, sentence } = checkWords(check);
  const said = /^[A-Z][a-z]/.test(sentence) ? sentence.toLowerCase() : sentence;
  const summary = bare(check.summary);
  return `Must not break: ${kind} ${said}${summary ? ` (${summary})` : ''}`;
};
const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

// What both pages draw from, read once from the run folder.
export function reportModel(root, run) {
  run = modern(run) ?? {};
  const { asks } = readAsks(root);
  const matrix = finalMatrix(root);
  const checks = mustNotBreakList(run);
  // The folder goes with the command, because the page may be read, and the command pasted, from anywhere.
  const command = typeof run.runCmd === 'string' && run.runCmd.trim() ? `cd ${root} && ${run.runCmd}` : null;
  return { run, name: path.basename(root), matrix, asks, closed: asks.filter((a) => a.status !== 'open').length, rows: runRows(root), tags: stageTags(root), checks, alerts: lookFirst(run, matrix, checks), tone: lookTone(run, matrix, checks), worst: worstReason(run, matrix, checks), reasons: reasonsFor({ ...run, path: root }), table: checkRows(root, run, matrix, checks), command };
}

// The checks as rows for the page: a label, a badge that is red when it has to stop the reader, and the words. The markdown
// report spells the same facts as lines.
const CHECK_TONE = { pass: 'ship', fail: 'dud', skipped: 'fine' };
const JUDGE_WORD = { true: { text: 'Ready to ship', tone: 'ship' }, false: { text: 'Not ready to ship', tone: 'dud' }, null: { text: 'No word', tone: 'fine' } };

function checkRows(root, run, matrix, checks) {
  // A run with no verdict has not got to the end, so what it has not recorded yet is not a failure and is not shown as one.
  const notYet = !run.verdict;
  const rows = checks.length
    ? checks.map((check) => {
        const { kind, sentence } = checkWords(check);
        return { label: `Must not break, ${kind}`, badge: { text: sentence, tone: CHECK_TONE[check.status] ?? 'fine' }, text: typeof check.summary === 'string' ? check.summary : Number.isFinite(check.summary) ? String(check.summary) : '' };
      })
    : [{ label: 'Must not break', text: notYet ? 'Not recorded yet.' : 'No check recorded.' }];
  rows.push(
    matrix
      ? {
          label: 'Screen sizes',
          link: fs.existsSync(stateFile(root, 'shots', matrix.label, 'contact-sheet.html')) ? { href: `shots/${encodeURIComponent(matrix.label)}/contact-sheet.html`, text: 'Open the contact sheet' } : undefined,
          badge: matrix.totals.broken ? { text: 'Broken', tone: 'dud' } : matrix.totals.weak ? { text: 'Weak', tone: 'fine' } : { text: 'Clean', tone: 'ship' },
          text: `Broken ${matrix.totals.broken}, weak ${matrix.totals.weak} across ${plural(matrix.viewports, 'size')} and ${plural(matrix.states, 'state')}. ${plural(matrix.examined, 'element')} looked at. Pictures in .100x/shots/${matrix.label}.`,
        }
      : { label: 'Screen sizes', text: run.matrixSkipped ? `Skipped, ${run.matrixSkipped}` : notYet ? 'Not recorded yet.' : 'Not run.' },
  );
  const review = run.review;
  rows.push(
    review?.status === 'reviewed'
      ? { label: 'Review', text: `${reviewer(review)}. ${reviewCounts(review)}.${review.note ? ` ${review.note}` : ''}` }
      : notYet
        ? { label: 'Review', text: 'Not recorded yet.' }
        : { label: 'Review', badge: { text: 'Unreviewed', tone: 'dud' }, text: review?.note ?? 'No reason given.' },
  );
  if (review?.rounds) rows.push({ label: 'Judge rounds', badge: JUDGE_WORD[review.rounds.lastReady], text: roundsDone(review) });
  rows.push({ label: 'Polish passes', text: polishText(root, run) });
  if (run.work) rows.push({ label: 'Work', text: workText(run.work) });
  if (run.ship) rows.push({ label: 'Ship', text: `${run.ship.preview ?? 'no preview deploy'}${run.ship.note ? `. ${run.ship.note}` : ''}` });
  return rows;
}

// The same report as a page to read, next to the markdown. The picture is the copy of the hero that finish leaves in .100x.
export function buildReportHtml(root, run) {
  run = modern(run) ?? {};
  const heroName = run.heroRel ? path.basename(run.heroRel) : null;
  return renderReportHtml(reportModel(root, run), { gallery: pathToFileURL(galleryFile()).href, hero: heroName && fs.existsSync(stateFile(root, heroName)) ? heroName : null, heroGone: Boolean(heroName) && !fs.existsSync(stateFile(root, heroName)) });
}

export function buildReport(root, run) {
  run = modern(run) ?? {};
  const { matrix, asks, closed, rows, tags, alerts, reasons } = reportModel(root, run);
  const lines = [`# ${run.title ?? 'Untitled'}`, '', run.pitch ?? '', ''];
  // A markdown viewer joins lines that sit next to each other into one paragraph, so every fact is its own paragraph or list item.
  lines.push(`Verdict: ${run.verdict ? verdictSay(run.verdict) : 'unknown'}. ${run.verdictWhy ?? ''}`.trim(), '');
  if (alerts.length) lines.push(`Look first: ${alerts.join('. ')}`, '');
  if (reasons.length) lines.push('Why not ready to ship:', '', ...reasons.map((reason) => `- ${reasonText(reason)}`), '');
  lines.push(`The moment: ${bare(run.moment) || 'not named'}`);
  lines.push('', `Run: \`${run.runCmd ?? 'unknown'}\`${run.url ? `, then open ${run.url}` : ''}`);
  if (run.tryFirst?.length) lines.push('', 'Try first:', '', ...run.tryFirst.map((step, i) => `${i + 1}. ${step}`));

  lines.push('', '## Checks', '');
  const checkLines = [];
  checkLines.push(
    matrix
      ? `Screen sizes: ${matrix.totals.broken} broken, ${matrix.totals.weak} weak across ${plural(matrix.viewports, 'size')} and ${plural(matrix.states, 'state')}, ${plural(matrix.examined, 'element')} looked at, pictures in .100x/shots/${matrix.label}`
      : `Screen sizes: ${run.matrixSkipped ? `skipped, ${bare(run.matrixSkipped)}` : 'not run'}`,
  );
  const checks = mustNotBreakList(run);
  if (checks.length === 0) checkLines.push('Must not break: no check recorded');
  for (const check of checks) checkLines.push(checkLine(check));
  if (run.review?.status === 'reviewed') {
    checkLines.push(`Review (${reviewer(run.review)}): ${reviewCounts(run.review)}${run.review.note ? `. ${bare(run.review.note)}` : ''}`);
  } else {
    checkLines.push(`Review: UNREVIEWED${run.review?.note ? `, ${bare(run.review.note)}` : ''}`);
  }
  if (roundsLine(run.review)) checkLines.push(roundsLine(run.review));
  checkLines.push(`Polish passes: ${polishText(root, run)}`);
  if (workLine(run.work)) checkLines.push(workLine(run.work));
  if (run.ship) checkLines.push(`Ship: ${run.ship.preview ?? 'no preview deploy'}${run.ship.note ? `, ${bare(run.ship.note)}` : ''}`);

  lines.push(...checkLines.map((line) => `- ${line}`));

  // A run with no asks and no decisions on record has no such section, because "0 of 0" reads as missing data.
  if (asks.length) {
    lines.push('', '## Asks', '', `${closed} of ${asks.length} closed.`, '');
    for (const ask of asks) lines.push(`- ${ask.status === 'done' ? 'done' : ask.status === 'dropped' ? 'dropped' : 'OPEN'}. ${ask.text}`);
  }

  if (run.features?.length) {
    lines.push('', '## Features and how to cut them', '', '| Feature | Cut hint |', '|---|---|');
    for (const feature of run.features) lines.push(`| ${cell(feature.name)} | ${cell(feature.cutHint)} |`);
  }
  if (run.nextAsks?.length) lines.push('', '## Next likely asks', '', ...run.nextAsks.map((ask) => `- ${ask}`));

  if (rows.length) {
    lines.push('', '## Trail', '', `${rows.length} decisions in \`.100x/decisions.tsv\`. Last ${Math.min(10, rows.length)} below.`, '');
    for (const row of rows.slice(-10)) lines.push(`- ${row.phase}. ${row.decision} (${row.result})`);
  }
  if (tags.length) lines.push('', `Stage tags. ${tags.join(', ')}`);
  return `${lines.join('\n')}\n`;
}

export function chatSummary(entry) {
  entry = modern(entry);
  const m = entry.matrix;
  const alerts = lookFirst(entry, m, mustNotBreakList(entry));
  const { first, more } = shownReasons(reasonsFor(entry));
  const lines = [
    `${entry.title}: ${sayWhat(entry.pitch)} Verdict: ${verdictSay(entry.verdict)}. ${entry.verdictWhy}`,
    ...(alerts.length ? [`Look first: ${alerts.join('. ')}`] : []),
    ...(first.length ? [`Why not ready to ship: ${[...first.map((reason, i) => `${i + 1}) ${reasonText(reason, SHORT)}`), ...(more ? [`and ${more} more in the report`] : [])].join('; ')}`] : []),
    `The moment: ${bare(entry.moment)}`,
    `Run: ${entry.runCmd}${entry.url ? `, then open ${entry.url}` : ''}`,
    `Try first: ${entry.tryFirst.map((step, i) => `${i + 1}) ${bare(step)}`).join(' ')}`,
    ...mustNotBreakList(entry).map(checkLine),
    entry.review.status === 'reviewed'
      ? `Review (${reviewer(entry.review)}): ${reviewCounts(entry.review)}`
      : `Review: UNREVIEWED, ${bare(entry.review.note)}`,
    ...(roundsLine(entry.review) ? [roundsLine(entry.review)] : []),
    m ? `Screen sizes: ${m.totals.broken} broken, ${m.totals.weak} weak, ${plural(m.viewports, 'size')} and ${plural(m.examined, 'element')} checked` : `Screen sizes: ${entry.matrixSkipped ? `skipped, ${bare(entry.matrixSkipped)}` : 'not run'}`,
    ...(entry.asks.total ? [`Asks: ${entry.asks.closed} of ${entry.asks.total} closed`] : []),
    `Report: ${fileUrl(path.join(entry.path, '.100x', 'REPORT.html'))}`,
  ];
  if (workLine(entry.work)) lines.splice(-1, 0, workLine(entry.work));
  if (entry.nextAsks?.length) lines.push(`Next likely asks: ${entry.nextAsks.slice(0, 3).join('; ')}${entry.nextAsks.length > 3 ? `; and ${entry.nextAsks.length - 3} more in the report` : ''}`);
  return lines.join('\n');
}
