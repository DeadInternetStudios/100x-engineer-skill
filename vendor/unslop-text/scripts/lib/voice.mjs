// Measures that stand for how an author sounds, so a rewrite that flattens the voice can be seen.
// A rewrite should cut stock phrases and keep the person. These counts are compared over the sentences
// the rewrite kept, reworded, split or joined. A cut sentence cannot lose its voice: it is gone.

// One letter behind the ending is enough to look at, so a long run of letters is read once.
const CONTRACTION = /(?<=\p{L})(?:n['’]t|['’](?:re|ve|ll|d|m))(?!\p{L})|\b(?:it|that|there|here|what|who|let|he|she)['’]s\b/giu;
const FIRST_PERSON = /\b(?:I|I['’](?:m|ve|ll|d)|[Mm]e|[Mm]y|[Mm]ine|[Mm]yself|[Ww]e|[Ww]e['’](?:re|ve|ll|d)|[Oo]ur|[Oo]urs|[Oo]urselves|[Uu]s)\b/gu;
const QUESTION = /\?(?=\s|$|["'”’)\]*])/g;

function count(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

export function voiceOf(text) {
  return {
    contractions: count(text, CONTRACTION),
    firstPerson: count(text, FIRST_PERSON),
    questions: count(text, QUESTION),
  };
}

export function addVoice(total, text) {
  const voice = voiceOf(text);
  for (const key of Object.keys(total)) total[key] += voice[key];
  return total;
}

export const emptyVoice = () => ({ contractions: 0, firstPerson: 0, questions: 0 });

// Contractions are for people. Docs may use either, and a strict rewrite spells them out on purpose.
export const CONTRACTION_PROFILES = new Set(['ui', 'message', 'marketing', 'article', 'narrative']);
// "We recommend" becomes "Use" in docs and "We are thrilled" is a stock line in marketing, so only text
// that is a person speaking keeps its "I" and "we".
export const FIRST_PERSON_PROFILES = new Set(['message', 'article', 'narrative']);
const MIN_MARKS = { contractions: 3, firstPerson: 3, questions: 2 };
// When cut sentences take every mark of a kind out of the text, fewer marks are enough to say so.
const MIN_MARKS_ALL_GONE = { contractions: 2, firstPerson: 2, questions: 1 };
// What is left when the voice is flattened: under half of what the author had.
const KEPT_SHARE = 0.5;

// A question rewritten as a statement is a loss at any count: the only question of a text is not noise.
// Contractions and "I" words in the sentences that stayed need the minimum, because stripping a stock
// opener ("It's important to note", "I've taken a look") takes one with it.
function lost(before, after, key) {
  if (key === 'questions' && before[key] >= 1 && after[key] === 0) return true;
  return before[key] >= MIN_MARKS[key] && after[key] < before[key] * KEPT_SHARE;
}

// The marks a profile and level protect, with the code and the advice of each warning.
function protectedMarks({ profile, level }) {
  const marks = [];
  if (CONTRACTION_PROFILES.has(profile) && level !== 'strict') marks.push({ key: 'contractions', code: 'voice-contractions', label: 'contractions', advice: 'If the author writes this way, keep it' });
  if (FIRST_PERSON_PROFILES.has(profile)) marks.push({ key: 'firstPerson', code: 'voice-first-person', label: '"I" and "we" words', advice: 'A person is speaking here, so keep the person' });
  marks.push({ key: 'questions', code: 'voice-questions', label: 'questions', advice: 'Check that no question was turned into a statement' });
  return marks;
}

// Warns, through the collector `c`, for each voice mark the rewrite dropped from the sentences it kept.
// Returns the codes it warned with.
export function compareVoice(before, after, context, c) {
  const warned = [];
  for (const { key, code, label, advice } of protectedMarks(context)) {
    if (!lost(before, after, key)) continue;
    const hint = key === 'contractions' ? ' ("unslop voice <before> <after>" counts the whole text)' : '';
    c.warn(code, `${label} went from ${before[key]} to ${after[key]} in the sentences that were kept${hint}. ${advice}`);
    warned.push(code);
  }
  return warned;
}

// Cutting the sentences that carry the voice flattens it as much as rewording them. `cut` holds the marks
// of the cut sentences that were not stock lines, `whole` and `left` the marks of the whole original and the whole rewrite.
export function compareCutVoice({ whole, left, cut }, context, c, already = []) {
  for (const { key, code, label, advice } of protectedMarks(context)) {
    const gone = left[key] === 0 && cut[key] >= MIN_MARKS_ALL_GONE[key];
    if (already.includes(code) || (!gone && (cut[key] < MIN_MARKS[key] || left[key] >= whole[key] * KEPT_SHARE))) continue;
    c.warn(code, `${label} went from ${whole[key]} to ${left[key]} in the whole text, because the sentences that carried them were cut. ${advice}`);
  }
}
