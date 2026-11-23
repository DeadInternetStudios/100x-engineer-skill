import { countWords } from './text.mjs';
import { lintSource } from './lint.mjs';
import { fenceOpener, closesFence } from './fences.mjs';

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

// True for every line of a fenced code block, fences included.
function fenceLines(lines) {
  let fence = null;
  return lines.map((line) => {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      return true;
    }
    fence = fenceOpener(line, { listIndent: Infinity });
    return fence !== null;
  });
}

function paragraphs(lines) {
  const groups = [];
  let current = null;
  const inFence = fenceLines(lines);
  lines.forEach((text, i) => {
    const blank = !inFence[i] && !text.trim();
    if (blank) {
      current = null;
      return;
    }
    if (!current) {
      current = { start: i, end: i, lines: [] };
      groups.push(current);
    }
    current.end = i;
    current.lines.push(text);
  });
  return groups;
}

function splitSections(lines) {
  const sections = [];
  const path = [];
  const inFence = fenceLines(lines);
  let current = { heading: '', start: 0, lines: [] };
  lines.forEach((text, i) => {
    const heading = inFence[i] ? null : text.match(HEADING);
    if (heading) {
      if (current.lines.length) sections.push(current);
      path.length = heading[1].length - 1;
      path[heading[1].length - 1] = heading[2];
      current = { heading: path.filter(Boolean).join(' > '), start: i, lines: [text] };
    } else current.lines.push(text);
  });
  if (current.lines.length) sections.push(current);
  return sections;
}

export function planChunks(source, { chunkWords = 1200, minWords = 250 } = {}) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const chunks = [];
  let open = null;

  const close = () => {
    if (open) chunks.push(open);
    open = null;
  };

  for (const section of splitSections(lines)) {
    const sectionWords = countWords(section.lines.join('\n'));
    if (open && open.words >= minWords) close();
    if (open && open.words + sectionWords <= chunkWords) {
      open.end = section.start + section.lines.length - 1;
      open.words += sectionWords;
      open.headings.push(section.heading);
      continue;
    }
    close();
    if (sectionWords <= chunkWords) {
      open = { start: section.start, end: section.start + section.lines.length - 1, words: sectionWords, headings: [section.heading] };
      continue;
    }
    let piece = null;
    for (const group of paragraphs(section.lines)) {
      const groupWords = countWords(group.lines.join('\n'));
      const absoluteStart = section.start + group.start;
      const absoluteEnd = section.start + group.end;
      if (piece && piece.words + groupWords > chunkWords) {
        chunks.push(piece);
        piece = null;
      }
      if (!piece) piece = { start: absoluteStart, end: absoluteEnd, words: 0, headings: [section.heading] };
      piece.end = absoluteEnd;
      piece.words += groupWords;
    }
    if (piece) open = piece;
  }
  close();

  return chunks.map((chunk, i) => ({
    id: i + 1,
    startLine: chunk.start + 1,
    endLine: chunk.end + 1,
    words: chunk.words,
    heading: chunk.headings.find(Boolean) ?? '(start)',
    text: lines.slice(chunk.start, chunk.end + 1).join('\n'),
  }));
}

export function planDocument(source, options = {}) {
  const { chunkWords, minWords, ...lintOptions } = options;
  const whole = lintSource(source, { ...lintOptions, format: lintOptions.format ?? 'prose' });
  const chunks = planChunks(source, { chunkWords, minWords }).map((chunk) => {
    const report = lintSource(chunk.text, { profile: whole.profile, level: whole.level, format: 'prose' });
    const { text, ...rest } = chunk;
    return { ...rest, slop: report.scores.slop, slopBand: report.scores.slopBand, clarity: report.scores.clarity, clarityBand: report.scores.clarityBand };
  });
  return {
    profile: whole.profile,
    profileInferred: whole.profileInferred,
    level: whole.level,
    words: whole.metrics.words,
    sentences: whole.metrics.sentences,
    slop: whole.scores.slop,
    slopBand: whole.scores.slopBand,
    clarity: whole.scores.clarity,
    clarityBand: whole.scores.clarityBand,
    chunks,
  };
}
