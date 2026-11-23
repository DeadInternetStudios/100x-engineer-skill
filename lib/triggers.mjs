// The phrases in a message that change a run: the number phrases table in skills/100x/SKILL.md. Text that is pasted after the skill name can
// carry one by accident, and the run then does something other than what the text describes. test/prompt.test.mjs keeps this list equal to
// the table. The modes are not here. Each is a skill of its own, so no word in a brief can pick one.
const COUNT = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';

const PHRASES = [
  { word: 'versions', turns: 'several versions of the idea', re: new RegExp(`\\b${COUNT} versions?\\b`) },
  { word: 'a length of work', turns: 'a clock that uses all the time', re: new RegExp(`\\bfor ${COUNT} (?:hours?|days?)\\b|\\buntil \\d{1,2}(?::\\d{2})? ?(?:am|pm)\\b|\\buse all (?:the )?(?:night|day)\\b`) },
  { word: 'rounds of judging', turns: 'a number of judge rounds', re: new RegExp(`\\b${COUNT} rounds? of judging\\b`) },
  { word: 'subagents', turns: 'a cap on helpers', re: new RegExp(`\\bmax(?:imum)? ${COUNT} subagents?\\b`) },
];

// Each hit says the line of its first appearance, so the owner can find it.
export function triggerHits(text) {
  const hits = [];
  const seen = new Set();
  for (const { word, turns, re } of PHRASES) {
    for (const match of text.matchAll(new RegExp(re.source, 'gi'))) {
      const key = `${word}|${match[0].toLowerCase()}`;
      if (!seen.has(key)) hits.push({ word, found: match[0], turns, line: text.slice(0, match.index).split('\n').length });
      seen.add(key);
    }
  }
  return hits;
}
