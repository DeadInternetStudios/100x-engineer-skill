// Draws the diagrams the README shows, as plain SVG files in docs/img/diagrams. Each one carries its own dark background, so it reads the same
// on a light page and a dark one.
//
// The spec, so the next edit follows it:
//   surface  README asset, shown at about 720 px and shrunk to about 360 px on a phone, so type is large and lines are short
//   rules    square corners. Workflow diagrams use one row per step; session diagrams count messages
//   color    near-black panel, white and gray text. Blue marks messages from the reader. Amber highlights the second model
//   type     monospace for labels and commands, sans for sentences
//
//   node scripts/readme-diagrams.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatSummary } from '../lib/report.mjs';
import { SAMPLE } from './readme-sample.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'img', 'diagrams');
// The words of the request and of the worked prompt, counted from the file (the prompt rounded to ten), so the picture cannot drift from the example.
const PROMPT_WORDS = (() => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'examples', 'stock-comparison-prompt.md'), 'utf8');
  const prompt = doc.split('```markdown\n')[1].split('\n```')[0];
  return Math.round(prompt.split(/\s+/).filter(Boolean).length / 10) * 10;
})();
const REQUEST_WORDS = fs.readFileSync(path.join(ROOT, 'docs', 'examples', 'stock-comparison-prompt.md'), 'utf8').split('## Brief\n')[1].split('\n')[0].split(/\s+/).filter(Boolean).length;

const C = { bg: '#0b0e14', edge: '#262e3d', text: '#eef1f6', muted: '#a3acbb', dim: '#6b7589', amber: '#ffb000', amberBg: '#2a2008', line: '#1c2330' };
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const W = 720, PAD = 28, SPINE = 38, NUM = 58, NAME = 96, DESC = 262;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const frame = (h, title, desc, body, w = W) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t d" font-family="${SANS}">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<rect width="${w}" height="${h}" fill="${C.bg}"/><rect x=".75" y=".75" width="${w - 1.5}" height="${h - 1.5}" fill="none" stroke="${C.edge}" stroke-width="1.5"/>
${body}
</svg>
`;
const mono = (x, y, s, size, fill, extra = '') => `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`;
const sans = (x, y, s, size, fill, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`;

// One row of the grid: a node on the spine, a number, a name, a sentence. A judge row is amber and has no number.
function row(y, h, { num, name, text, judge }) {
  const cy = y + h / 2;
  let b = '';
  if (judge) {
    b += `<rect x="${PAD}" y="${y + 4}" width="${W - 2 * PAD}" height="${h - 8}" fill="${C.amberBg}"/>`;
    b += `<rect x="${SPINE - 6}" y="${cy - 6}" width="12" height="12" fill="${C.amber}"/>`;
    if (num) b += mono(NUM, cy + 6, num, 15, C.amber, 'font-weight="700"');
    b += mono(NAME, cy + 6, name, 17, C.amber, 'font-weight="700" letter-spacing=".06em"');
    b += sans(DESC, cy + 6, text, 17, C.text);
  } else {
    b += `<rect x="${SPINE - 5}" y="${cy - 5}" width="10" height="10" fill="${C.text}"/>`;
    b += mono(NUM, cy + 6, num || '', 15, C.dim, 'font-weight="700"');
    b += mono(NAME, cy + 6, name, 17, C.text, 'font-weight="700" letter-spacing=".06em"');
    b += sans(DESC, cy + 6, text, 17, C.muted);
  }
  return b;
}
const spine = (y0, y1) => `<path d="M${SPINE} ${y0}V${y1}" stroke="${C.edge}" stroke-width="2"/>`;

// 1. The pipeline: eight steps, with a second model judging after polish and after review.
function pipeline() {
  const ROWS = [
    { num: '01', name: 'PLAN', text: 'Turns your sentence into a detailed prompt' },
    { num: '02', name: 'CORE', text: 'Builds the riskiest part first' },
    { num: '03', name: 'BUILD', text: 'The first full version, plus likely extras' },
    { num: '04', name: 'POLISH x3', text: 'Layout, then details, then the key moment' },
    { judge: true, name: 'JUDGE', text: 'A second model checks the screenshots' },
    { num: '05', name: 'HARD TEST', text: 'Tests the one thing that must not break' },
    { num: '06', name: 'REVIEW', text: 'The code, then the screens, then: ship it?' },
    { judge: true, name: 'JUDGE', text: 'A second model answers, no glazing' },
    { num: '07', name: 'FINISH', text: 'Refuses to end without proof' },
    { num: '08', name: 'REPORT', text: 'One page: every run, best first' },
  ];
  const TOP = 92, RH = 54, GH = 48;
  let b = mono(PAD, 48, '$', 20, C.amber, 'font-weight="700"') + mono(PAD + 26, 48, '/100x Let me compare any stock with the S&P 500 in my stock market research app', 13, C.text);
  b += `<path d="M${PAD} 68H${W - PAD}" stroke="${C.line}" stroke-width="1.5"/>`;
  let y = TOP, body = '';
  const first = y + RH / 2;
  ROWS.forEach((r) => { const h = r.judge ? GH : RH; body += row(y, h, r); y += h; });
  const last = y - RH / 2;
  b += spine(first, last) + body;
  return frame(y + 20, '100x pipeline', 'Eight steps from one sentence to a report: plan, core, build, polish three times, hard test, review, finish and report. A second model judges after polish and after review.', b);
}

// 2. One review round: the builder makes a pass, a different model judges it, every finding is answered, and it repeats.
// A list of labelled lines in large type, one to a block, so it reads on a phone. Each block sits on a dark panel, a judge block on
// amber and a "more" block in a dashed outline. With flow, the blocks are steps and a down arrow leads from each one to the next.
const downArrow = (x, top, tip) => `<path d="M${x} ${top}V${tip - 2}" stroke="${C.dim}" stroke-width="3"/><path d="M${x - 8} ${tip - 10}L${x} ${tip}L${x + 8} ${tip - 10}" fill="none" stroke="${C.dim}" stroke-width="3" stroke-linejoin="miter"/>`;
function stacked(rows, y, { flow = false } = {}) {
  const bold = 'font-weight="700"';
  const BH = 76, GAP = flow ? 38 : 8;
  let b = '';
  rows.forEach((r, i) => {
    if (r.more) b += `<rect x="${PAD + 1}" y="${y + 1}" width="${W - 2 * PAD - 2}" height="${BH - 2}" fill="none" stroke="${C.edge}" stroke-width="2" stroke-dasharray="6 6"/>`;
    else b += `<rect x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="${BH}" fill="${r.judge ? C.amberBg : C.line}"/>`;
    b += mono(PAD + 20, y + 29, r.name, 20, r.judge ? C.amber : r.more ? C.dim : C.muted, bold + ' letter-spacing=".06em"');
    b += sans(PAD + 20, y + 61, r.text, 26, r.more ? C.muted : C.text);
    y += BH;
    if (flow && i < rows.length - 1) b += downArrow(PAD + 34, y + 6, y + GAP - 4);
    y += GAP;
  });
  return { b, y: y - GAP + 10 };
}

function reviewCatch() {
  const bold = 'font-weight="700"';
  const stockC = C.text, indexC = '#7f8aa0';
  let b = sans(PAD, 54, 'What the second model caught', 34, C.text, bold) + sans(PAD, 90, 'Illustrated review of the stock comparison chart', 22, C.muted);
  // Two small charts. A line is a list of percent changes, drawn from where it starts (0 to 1 across the panel) to the right edge.
  const PW = 316, PH = 190, TOP = 130, LO = -10, HI = 30;
  const line = (x0, from, values, color, width) => {
    const step = ((1 - from) * (PW - 24)) / (values.length - 1);
    const pts = values.map((v, i) => `${(x0 + 12 + from * (PW - 24) + i * step).toFixed(1)},${(TOP + 44 + ((HI - v) / (HI - LO)) * (PH - 60)).toFixed(1)}`);
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="miter"/>`;
  };
  const zero = TOP + 44 + (HI / (HI - LO)) * (PH - 60);
  const panel = (x0, label, labelColor) => `<rect x="${x0}" y="${TOP}" width="${PW}" height="${PH}" fill="${C.line}"/>`
    + mono(x0 + 14, TOP + 32, label, 22, labelColor, bold + ' letter-spacing=".06em"')
    + `<path d="M${x0 + 12} ${zero}H${x0 + PW - 12}" stroke="${C.edge}" stroke-width="2" stroke-dasharray="4 6"/>` + mono(x0 + PW - 14, zero - 10, '0%', 20, C.dim, 'text-anchor="end"');
  const stock = [0, 5, -3, 7, 12, 9, 16, 21, 17, 24];
  const L = PAD, Rt = W - PAD - PW;
  b += panel(L, 'BEFORE', C.muted) + line(L, 0, [0, 3, 2, 6, 9, 8, 12, 15, 14, 18, 17, 20, 22, 21, 25], indexC, 3) + line(L, 0.45, stock, stockC, 3.5);
  // The finding, in amber: the stretch where only the index has a line.
  const gapEnd = L + 12 + 0.45 * (PW - 24);
  b += `<path d="M${L + 12} ${TOP + PH - 14}H${gapEnd}M${L + 12} ${TOP + PH - 22}v16M${gapEnd} ${TOP + PH - 22}v16" stroke="${C.amber}" stroke-width="3"/>`;
  b += mono((L + 12 + gapEnd) / 2, TOP + PH - 26, '5 months', 22, C.amber, bold + ' text-anchor="middle"');
  b += panel(Rt, 'AFTER', C.text) + line(Rt, 0, [0, 2, 1, 4, 6, 5, 8, 10, 9, 12], indexC, 3) + line(Rt, 0, stock, stockC, 3.5);
  // One key for both charts.
  const ky = TOP + PH + 34;
  b += `<path d="M${PAD} ${ky - 6}h28" stroke="${stockC}" stroke-width="3.5"/>` + sans(PAD + 38, ky, 'The stock', 20, C.text);
  b += `<path d="M${PAD + 170} ${ky - 6}h28" stroke="${indexC}" stroke-width="3"/>` + sans(PAD + 208, ky, 'S&P 500', 20, C.muted);
  // What happened, one step to a block, the finding in amber.
  const STEPS = [
    { name: 'FINDING', lines: ['The S&P 500 line starts 5 months before the stock line'], judge: true },
    { name: 'FIX', lines: ['Both lines start on the first day both have prices'] },
    { name: 'CHECK', lines: ['A test fails if the start dates differ and it passes now'] },
  ];
  // The steps run top to bottom, so an arrow leads from each one to the next. The finding is the second model's, in amber.
  let y = ky + 34;
  STEPS.forEach((s, i) => {
    const h = 50 + s.lines.length * 32;
    b += `<rect x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="${h}" fill="${s.judge ? C.amberBg : C.line}"/>`;
    b += mono(PAD + 20, y + 30, s.name, 20, s.judge ? C.amber : C.muted, bold + ' letter-spacing=".06em"');
    s.lines.forEach((t, j) => { b += sans(PAD + 20, y + 62 + j * 32, t, 25, C.text); });
    y += h;
    if (i < STEPS.length - 1) {
      b += downArrow(PAD + 34, y + 6, y + 34);
      y += 38;
    }
  });
  return frame(y + 16, 'What the second model caught', 'Illustrated review of the stock comparison chart. Before: the S&P 500 line starts 5 months before the stock line, so the two do not share a starting point. The second model flags it. After: both lines start at 0% on the first day both have prices. A test now fails if the start dates differ, and it passes.', b);
}

// 3. The prompt step on a one-line request. The words come from docs/examples/stock-comparison-prompt.md, which passes `100x prompt check`.
// Blue is the reader's message, as in the timelines. Each part is a label over one line of large type, so it reads on a phone.
function promptStep() {
  const bold = 'font-weight="700"';
  const human = '#b3d9ff';
  const ROWS = [
    { name: 'GOAL', text: 'Both lines start at 0% on the first shared day' },
    { name: 'RULE', text: 'Percent change from a shared start, not prices' },
    { name: 'RISK', text: 'A stock split shows up as a fake loss' },
    { name: 'ASKS', text: '9 asks, two of them tests that must fail first' },
    { name: 'HARD TEST', text: 'A two-for-one split shows 0% change' },
    { name: 'DO NOT', text: 'Draw raw prices on a shared axis' },
    { name: 'MOMENT', text: 'Type a ticker, both lines start at 0%' },
    { judge: true, name: 'JUDGE', text: 'Does a hand count across a split match?' },
  ];
  let b = mono(PAD, 46, 'YOU TYPE', 20, human, bold + ' letter-spacing=".06em"');
  b += sans(PAD, 82, '/100x Let me compare any stock with the', 25, human) + sans(PAD, 114, 'S&P 500 in my stock market research app', 25, human);
  // What you type turns into the prompt, so one arrow leads from the request down to it. The parts below are a list, not steps.
  b += downArrow(PAD + 14, 134, 166);
  b += mono(PAD, 200, '100X WRITES THIS FIRST · AN EXCERPT', 20, C.dim, bold + ' letter-spacing=".04em"');
  const s = stacked(ROWS, 220);
  b += s.b;
  const y = s.y;
  b += mono(PAD, y + 30, `${REQUEST_WORDS} words in, about ${PROMPT_WORDS} words out`, 22, C.text, bold);
  return frame(y + 54, 'The prompt step on a one-line request', `You type "Let me compare any stock with the S&P 500 in my stock market research app", and 100x first writes a full prompt of about ${PROMPT_WORDS} words. An excerpt. Goal: both lines start at 0% on the first shared day. Rule: percent change from a shared start, not prices. Risk: a stock split shows up as a fake loss. Asks: 9, two of them tests that must fail first. Hard test: a two-for-one split shows 0% change. Do not: draw raw prices on a shared axis. Moment: type a ticker, both lines start at 0%. Judge: does a hand count across a split match?`, b);
}

// 4. Tell the same story twice, with a timestamp and speaker for every event.
function journey(session) {
  const human = '#b3d9ff';
  const bold = 'font-weight="700"';
  const inset = 32;
  const textX = 65;
  let y = 116;
  let body = sans(inset, 51, session.title, 39, C.text, bold)
    + sans(inset, 91, session.window, 24, C.muted);
  const description = [session.window];

  for (const [heading, events] of [['By hand', session.byHand], ['With 100x', session.withSkill]]) {
    const sent = events.filter(event => event.actor === 'Your message').length;
    const count = sent === 1 ? '1 message from you' : `${sent} messages from you`;
    body += `<rect x="1" y="${y}" width="${W - 2}" height="68" fill="${C.line}"/>`;
    body += sans(inset, y + 45, heading, 34, C.text, bold)
      + sans(W - inset, y + 44, count, 25, human, 'text-anchor="end"');
    description.push(`${heading}. ${count}.`);
    y += 106;
    const start = y - 8;
    let last = start;
    let nodes = '';
    for (const { time, actor, lines } of events) {
      const color = actor === 'Your message' ? human : actor === 'Second model' ? C.amber : C.muted;
      last = y - 8;
      nodes += `<circle cx="${inset}" cy="${last}" r="7" fill="${color}" stroke="${C.bg}" stroke-width="4"/>`;
      nodes += mono(textX, y, time, 23, color, bold) + sans(197, y, actor, 24, color, bold);
      for (const line of lines) {
        y += 32;
        nodes += sans(textX, y, line, 26, C.text);
      }
      description.push(`${time}, ${actor}. ${lines.join(' ')}`);
      y += 44;
    }
    body += `<path d="M${inset} ${start}V${last}" stroke="${C.edge}" stroke-width="3"/>` + nodes;
  }
  return frame(y - 10, session.title, description.join(' '), body);
}

const FEATURE = {
  title: 'Add a stock comparison chart',
  window: 'Illustrated afternoon, 1 pm to 5 pm',
  byHand: [
    { time: '1:00 pm', actor: 'Your message', lines: ['“Let me compare any stock with the S&P 500', 'in my stock market research app”'] },
    { time: '1:32 pm', actor: 'Your message', lines: ['The first chart shows prices in dollars. You ask', 'for percentage gains so the lines are comparable.'] },
    { time: '1:55 pm', actor: 'Your message', lines: ['A stock appears to lose half its value overnight.', 'You check the date and find a stock split.'] },
    { time: '2:10 pm', actor: 'Your message', lines: ['You ask the agent to test the math across the', 'split and show you the expected numbers.'] },
    { time: '2:24 pm', actor: 'Your message', lines: ['You try a newly listed stock. The two lines', 'start on different dates. You flag it and leave.'] },
    { time: '2:42 pm', actor: 'Agent', lines: ['“What should we show when the stock has less', 'history than the index?” The agent waits.'] },
    { time: '5:00 pm', actor: 'You return', lines: ['You open the chat. The question has been', 'waiting for over two hours.'] },
  ],
  withSkill: [
    { time: '1:00 pm', actor: 'Your message', lines: ['“Let me compare any stock with the S&P 500', 'in my stock market research app”'] },
    { time: '1:02 pm', actor: 'You step away', lines: ['You send it and leave. The agent builds', 'the chart and checks the math.'] },
    { time: '1:08 pm', actor: 'Agent', lines: ['The agent plans a chart that starts both lines', 'at 0% and shows how much each has moved.'] },
    { time: '2:50 pm', actor: 'Agent', lines: ['It tests a two-for-one split. A move from $100 to', '$50 on the split date shows 0% loss, as expected.'] },
    { time: '3:35 pm', actor: 'Second model', lines: ['The reviewer opens a newly listed stock and', 'finds the index line starts five months earlier.'] },
    { time: '4:42 pm', actor: 'Agent', lines: ['It starts both lines on the first date they share,', 'reruns the checks, and saves the chart and', 'test results in the report.'] },
    { time: '5:00 pm', actor: 'You return', lines: ['You open the report and can verify the split', 'math and the date both lines start.'] },
  ],
};

const APP = {
  title: 'Build a small budget app',
  window: 'Illustrated night, 10:02 pm to 7 am',
  byHand: [
    { time: '10:02 pm', actor: 'Your message', lines: ['“Build me a small app to track my budget”'] },
    { time: '10:11 pm', actor: 'Your message', lines: ['The app lists purchases. You explain that you', 'want to see how much you have left to spend.'] },
    { time: '10:25 pm', actor: 'Your message', lines: ['You open it on your phone. The balance is off', 'screen, so you ask to see it above the list.'] },
    { time: '10:36 pm', actor: 'Your message', lines: ['You ask the agent to enter a purchase and', 'check that the balance drops by that amount.'] },
    { time: '10:48 pm', actor: 'Your message', lines: ['You ask it to check refunds too. Then you', 'close the chat and go to bed.'] },
    { time: '11:05 pm', actor: 'Agent', lines: ['“Which database should I use for purchases?”', 'The agent waits for you to choose one.'] },
    { time: '7:00 am', actor: 'You return', lines: ['You wake up to the database question. The', 'build has been on hold for nearly eight hours.'] },
  ],
  withSkill: [
    { time: '10:02 pm', actor: 'Your message', lines: ['“Build me a small app to track my budget”'] },
    { time: '10:09 pm', actor: 'Agent', lines: ['The agent plans around one question. After a', 'purchase, how much can you still spend?'] },
    { time: '10:48 pm', actor: 'You go to bed', lines: ['The agent keeps working. It chooses to save', 'purchases on your device and records why.'] },
    { time: '11:50 pm', actor: 'Agent', lines: ['It enters a $4.35 purchase and refunds it.', 'It checks that the original balance returns.'] },
    { time: '1:05 am', actor: 'Second model', lines: ['The reviewer opens the phone layout and spots', 'that the balance sits below the purchase list.'] },
    { time: '2:15 am', actor: 'Agent', lines: ['The agent moves the balance above the list and', 'saves a new phone screenshot in the report.'] },
    { time: '7:00 am', actor: 'You return', lines: ['You open the app, enter your first purchase,', 'and see how much you have left to spend.'] },
  ],
};

// 5. An overnight run: the first version, then rounds until the clock ends.
function overnight() {
  const human = '#b3d9ff';
  const bold = 'font-weight="700"';
  const ROWS = [
    { name: 'FIRST RUN', text: 'All eight steps once, tagged best' },
    { name: 'ROUND 1 · FRESH EYES', text: 'Every screen, like a stranger' },
    { judge: true, name: 'JUDGE', text: 'A fresh second model checks the round' },
    { name: 'ROUND 2 · BREAK IT', text: 'Empty, huge, offline, rapid taps' },
    { judge: true, name: 'JUDGE', text: 'A fresh second model checks the round' },
    { name: 'ROUND 3 · HARD TEST', text: 'Five more tests on the key thing' },
    { judge: true, name: 'JUDGE', text: 'A fresh second model checks the round' },
    { more: true, name: 'MORE ROUNDS', text: 'More lenses, then a harder lap' },
    { name: 'END', text: 'Finish refuses until the clock is over' },
    { name: 'REPORT', text: 'One page: every run, best first' },
  ];
  let b = mono(PAD, 46, 'YOU TYPE', 20, human, bold + ' letter-spacing=".06em"') + sans(PAD, 84, '/100x-overnight a farming game, for 8 hours', 25, human);
  b += `<path d="M${PAD} 110H${W - PAD}" stroke="${C.edge}" stroke-width="1.5"/>`;
  const s = stacked(ROWS, 134, { flow: true });
  b += s.b;
  b += sans(PAD, s.y + 30, 'Each round: measure, change, measure again', 23, C.text) + sans(PAD, s.y + 64, 'Keep what got better, roll back the rest', 23, C.text);
  return frame(s.y + 92, 'An overnight run', 'You type: /100x-overnight a farming game, for 8 hours. After the first full run, 100x works in rounds until the clock ends: fresh eyes, break it, hard test, then more. Each round ends with a fresh second model checking it, keeps the change if it helped and rolls it back if not. Finish refuses until the clock is over, then the report.', b);
}

// 7. Small verified blocks that add up to a system. Each block states six properties and is checked alone, the seams between blocks are checked,
// the real blocks then run together in one model, and the ledger marks a proof stale when the code under it changes.
function verifiedBlocks() {
  const bold = 'font-weight="700"';
  const ROWS = [
    { name: 'BLOCK · SPLIT A BILL', text: 'Every cent lands in exactly one share' },
    { name: 'BLOCK · ORDER', text: 'Only a paid order ships' },
    { name: 'BLOCK · REFUND', text: 'Never more than was paid' },
    { name: 'SEAMS', text: 'What one block gives, the next accepts' },
    { name: 'SYSTEM MODEL', text: 'The real blocks run together' },
    { name: 'LEDGER', text: 'Change the code, the proof goes stale' },
  ];
  let b = mono(PAD, 46, 'SIX PROPERTIES PER BLOCK', 20, C.muted, bold + ' letter-spacing=".06em"') + sans(PAD, 84, 'state, steps, rules, results, always, eventually', 25, C.text);
  b += `<path d="M${PAD} 110H${W - PAD}" stroke="${C.edge}" stroke-width="1.5"/>`;
  const s = stacked(ROWS, 134, { flow: true });
  b += s.b;
  b += sans(PAD, s.y + 30, 'Each block is checked on its own', 23, C.text) + sans(PAD, s.y + 64, 'Then all of them are checked together', 23, C.text);
  return frame(s.y + 92, 'Small verified blocks', 'Each small block states six properties: state, steps, rules, results, what always holds and what must eventually happen. Each block is checked on its own. The seams between blocks are checked. The real blocks then run together in one system model. The ledger marks a proof stale when the code under it changes.', b);
}

// 6. The final message of the made-up stock run, wrapped so it reads on a phone. It is narrower than the others, 560 wide, so its
// type stays large when a phone shrinks it. The text comes from chatSummary, word for word.
function finalMessage() {
  const bold = 'font-weight="700"';
  const text = chatSummary(SAMPLE);
  const pieces = (w, n) => (w.length <= n ? [w] : w.split(/(?<=\/)/).reduce((acc, p) => { if (acc.length && (acc[acc.length - 1] + p).length <= n) acc[acc.length - 1] += p; else acc.push(...(p.match(new RegExp(`.{1,${n}}`, 'g')))); return acc; }, []));
  const wrap = (s, n) => { const out = []; let line = ''; for (const w of s.split(' ').flatMap((w) => pieces(w, n))) { if (line && (line + ' ' + w).length > n) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; } out.push(line); return out; };
  let b = mono(PAD, 46, 'THE FINAL MESSAGE · ILLUSTRATED RUN', 20, C.dim, bold + ' letter-spacing=".04em"');
  const FW = 560;
  b += `<path d="M${PAD} 66H${FW - PAD}" stroke="${C.edge}" stroke-width="1.5"/>`;
  let y = 104;
  for (const line of text.split('\n')) {
    const cut = line.indexOf(': ');
    const label = line.slice(0, cut), rest = line.slice(cut + 2);
    const review = label.startsWith('Review') || label.startsWith('Judge rounds');
    b += mono(PAD, y, label, 22, review ? C.amber : C.muted, bold);
    y += 32;
    for (const part of wrap(rest, 36)) { b += mono(PAD, y, part, 22, C.text); y += 31; }
    y += 14;
  }
  return frame(y + 4, 'The final message of an illustrated run', text, b, FW);
}

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.svg')) fs.rmSync(path.join(OUT, f));
for (const [name, fn] of Object.entries({ 'by-hand-app': () => journey(APP), 'by-hand-feature': () => journey(FEATURE), pipeline, 'review-catch': reviewCatch, 'final-message': finalMessage, 'prompt-step': promptStep, overnight, 'verified-blocks': verifiedBlocks })) fs.writeFileSync(path.join(OUT, `${name}.svg`), fn());
console.log('drew the diagrams in ' + path.relative(process.cwd(), OUT));
