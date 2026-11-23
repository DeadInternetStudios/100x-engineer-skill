export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// How a verdict reads in a sentence. The stored word for the best verdict is short, for columns; in prose it is said in full.
export const verdictSay = (verdict) => (verdict === 'ship' ? 'ready to ship' : verdict === 'dud' ? 'needs work' : verdict);

// A date the way a person says it, "Nov 19, 4:56 AM". Empty when the time does not parse.
export function when(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const flat = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
// A full stop ends a sentence when a capital letter follows, except after a title like Mr. or Dr. or a lone initial like A.
const SENTENCE = /^(.+?(?<!\b(?:Mr|Mrs|Ms|Dr|St|[A-Z]))[.!?])(?=\s+[A-Z`"'([]|$)/;
// A sentence this short is a lead-in, "Hey!" or "Built by A.", and says nothing about what the run is. The next sentence goes with it.
const LEAD_IN = 20;

// The sentence that says what a run is. A pitch opens with it, "A kana flashcard trainer for the phone.", and what follows is often the moment again.
export function firstSentence(text) {
  const line = flat(text);
  let end = 0;
  do {
    const next = SENTENCE.exec(line.slice(end).trimStart());
    if (!next) return line;
    end = line.indexOf(next[1], end) + next[1].length;
  } while (end < LEAD_IN && end < line.length);
  return line.slice(0, end);
}
export const afterFirstSentence = (text) => flat(text).slice(firstSentence(text).length).trim();

// A line cut at a word, with an ellipsis, when it is longer than a card line can be.
export function clipWords(text, max) {
  const line = flat(text);
  return line.length <= max ? line : `${line.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s,;:.]+$/, '')}…`;
}

const FILLER = new Set('the and for with that this from your you are not has have its into out one any who what when where then them they their will can all but was were been get got set sets run runs'.split());
const contentWords = (text) => new Set((String(text ?? '').toLowerCase().match(/[a-z]{3,}/g) ?? []).map((word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)).filter((word) => !FILLER.has(word)));

// Two sentences say the same thing when a third of the shorter one's words are in the other. The pitch and the moment of a run often do,
// and a page that prints both spends its first screen saying it twice. Measured on 19 real runs, the pairs that repeat score 0.33 and
// up, and the pairs that do not score 0.27 and down.
export function sameGround(a, b) {
  const first = contentWords(a);
  const second = contentWords(b);
  const shared = [...first].filter((word) => second.has(word)).length;
  return shared >= 3 && shared / Math.min(first.size, second.size) >= 0.33;
}

// What a card, the ranking and the finish message say a run is: the first sentence of its pitch. `100x finish` refuses a pitch over 240
// characters, so a run finished by this build is never cut. An older pitch that runs longer is cut at a word.
export const sayWhat = (pitch) => clipWords(firstSentence(pitch), 240);
