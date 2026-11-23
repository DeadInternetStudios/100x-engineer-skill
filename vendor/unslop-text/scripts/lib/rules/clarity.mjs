import { regexHits, wordsIn, isInstruction } from './helpers.mjs';
import { PLAIN_WORDS, WORDY_PHRASES, NOMINALIZATIONS, IDIOMS } from '../vocab.mjs';

const PLAIN_APPLIES = ['ui', 'docs', 'message', 'article', 'marketing'];

const wordyEntries = WORDY_PHRASES.map(([source, swap]) => ({ re: new RegExp(`\\b${source}\\b`, 'gi'), swap }));
const plainEntries = Object.entries(PLAIN_WORDS).map(([word, swap]) => ({ re: new RegExp(`\\b${word}\\b`, 'gi'), swap }));
const idiomPatterns = IDIOMS.map((source) => new RegExp(`\\b${source}\\b`, 'gi'));

const NOMINALIZATION = new RegExp(
  `\\b(?:make|makes|made|making|take|takes|took|taking|give|gives|gave|giving|perform|performs|performed|performing|conduct|conducts|conducted|conducting|carry out|carries out|carried out|carrying out|undertake|undertakes|undertook|provide|provides|provided|providing|offer|offers|offered|offering|reach|reaches|reached|reaching|come to|comes to|came to|have|has|had|having)\\s+(?:a|an|the)\\s+(?:\\w+\\s+)?(${Object.keys(NOMINALIZATIONS).join('|')})\\b`,
  'gi',
);

const IRREGULAR_PARTICIPLES = 'built made shown given run set sent kept held read written taken known seen found chosen spoken broken hidden stolen struck lost left paid put told thought understood begun drawn driven grown led met spent won forgotten eaten beaten fallen frozen shaken torn worn'.split(' ');
const NOT_PARTICIPLES = new Set(['need', 'speed', 'seed', 'feed', 'bleed', 'proceed', 'succeed', 'exceed', 'indeed', 'hundred', 'bed', 'red', 'shed']);
const ADJECTIVAL = new Set(
  'based located related named called supposed tired excited interested worried concerned surprised pleased disappointed involved committed dedicated qualified experienced advanced limited complicated detailed embedded distributed devoted gifted married retired scared bored amazed shocked confused satisfied determined prepared aged crowded finished born gone done'.split(' '),
);
// These name a state when nobody acts on the thing: "the time left", "notifications are turned off". "by" after one makes it a passive again.
const STATE_PARTICIPLES = new Set('left set turned closed hidden locked unlocked selected checked enabled disabled connected signed logged stuck lost'.split(' '));
const PASSIVE = new RegExp(
  `\\b(?:is|are|was|were|be|been|being)\\s+(?:(?:also|then|already|always|never|often|usually|automatically|manually|currently|first|not|n't|still|only)\\s+)*([a-z]{3,}ed|${IRREGULAR_PARTICIPLES.join('|')})\\b(?:\\s+by\\b)?`,
  'gi',
);

const VAGUE_ERRORS = [
  /\bsomething went wrong\b/gi,
  /\ban? (?:unexpected |unknown )?error (?:has )?occurred\b/gi,
  /^(?:oops|whoops|uh[- ]oh)\b/gi,
  /\bplease try again later\b/gi,
];

export const CLARITY_RULES = [
  {
    id: 'long-sentence',
    kind: 'clarity',
    group: 'structure',
    light: true,
    title: 'Long sentence',
    fix: 'Split at the second idea. Put the condition first, then the action.',
    weight: 1,
    applies: ['*'],
    detect: ({ block, limits }) => {
      if (block.type === 'table-row') return [];
      const hits = [];
      for (const span of block.spans) {
        const count = wordsIn(span.text);
        const { warn, hard } = limits[isInstruction(span.text) ? 'instruction' : 'description'];
        if (count > warn) {
          hits.push({ index: span.start, length: span.text.length, weight: count > hard ? 1 : 0.5, note: `${count} words, limit ${warn}` });
        }
      }
      return hits;
    },
    examples: {
      hit: [
        'The configuration service reads the settings file when it starts and then validates every key against the schema before it publishes the resulting values to all of the other services that depend on them at runtime.',
      ],
      miss: ['The service reads the settings file when it starts.'],
    },
  },
  {
    id: 'semicolon',
    kind: 'clarity',
    group: 'structure',
    title: 'Semicolon',
    fix: 'Use two sentences, or join with "and" or "because".',
    weight: 0.5,
    applies: ['ui', 'docs', 'message'],
    alsoStrict: ['article', 'marketing'],
    patterns: [/;/g],
    examples: { hit: ['It works; it is fast.'], miss: ['It works. It is fast.', 'Use &nbsp; or &amp; in the markup.'] },
  },
  {
    id: 'wordy-phrase',
    kind: 'clarity',
    group: 'words',
    title: 'Wordy phrase',
    fix: 'Use the short form.',
    weight: 0.5,
    applies: PLAIN_APPLIES,
    detect: ({ block }) => {
      const hits = [];
      for (const { re, swap } of wordyEntries) {
        for (const match of block.text.matchAll(re)) hits.push({ index: match.index, length: match[0].length, note: `use: ${swap}` });
      }
      return hits;
    },
    examples: {
      hit: ['We did this in order to save time.', 'It failed due to the fact that the disk was full.', 'It is important to note that the file is large.'],
      miss: ['We did this to save time.', 'It failed because the disk was full.'],
    },
  },
  {
    id: 'plain-word',
    kind: 'clarity',
    group: 'words',
    title: 'Heavy word with a plain equivalent',
    fix: 'Use the plain word.',
    weight: 0.5,
    applies: PLAIN_APPLIES,
    detect: ({ block }) => {
      const hits = [];
      for (const { re, swap } of plainEntries) {
        for (const match of block.text.matchAll(re)) hits.push({ index: match.index, length: match[0].length, note: `use: ${swap}` });
      }
      return hits;
    },
    examples: {
      hit: ['Utilize the cache.', 'Prior to the update, back up your save.', 'It will facilitate the transfer.'],
      miss: ['Use the cache.', 'Before the update, back up your save.'],
    },
  },
  {
    id: 'nominalization',
    kind: 'clarity',
    group: 'words',
    title: 'Action buried in a noun',
    fix: 'Put the action in the verb: "decide", not "make a decision".',
    weight: 0.5,
    applies: ['ui', 'docs', 'message', 'article'],
    detect: ({ block }) =>
      regexHits([NOMINALIZATION], block.text).map((hit) => {
        const noun = hit.text.split(/\s+/).at(-1).toLowerCase();
        return { ...hit, note: `use the verb: ${NOMINALIZATIONS[noun]}` };
      }),
    examples: {
      hit: ['We made a decision to remove it.', 'The team will conduct an investigation.', 'Please provide an explanation.'],
      miss: ['We decided to remove it.', 'The decision was final.'],
    },
  },
  {
    id: 'passive-voice',
    kind: 'clarity',
    group: 'structure',
    title: 'Passive voice',
    fix: 'Name the actor and use an active verb, unless the actor is unknown or unimportant.',
    weight: 0.5,
    applies: ['ui', 'docs', 'message', 'article', 'marketing'],
    detect: ({ block }) => {
      const hits = [];
      for (const match of block.text.matchAll(PASSIVE)) {
        const participle = match[1].toLowerCase();
        if (ADJECTIVAL.has(participle) || NOT_PARTICIPLES.has(participle)) continue;
        if (STATE_PARTICIPLES.has(participle) && !/\bby$/i.test(match[0])) continue;
        hits.push({ index: match.index, length: match[0].length });
      }
      return hits;
    },
    examples: {
      hit: ['The token is validated by the gateway.', 'Your changes were not saved.', 'The file was written to disk.', 'The lock was closed by the timer.'],
      miss: ['The gateway validates the token.', 'The team is interested in the results.', 'The door is open.', 'Say how much time is left.', 'Notifications are turned off.', 'The door is closed.'],
    },
  },
  {
    id: 'idiom',
    kind: 'clarity',
    group: 'words',
    title: 'Idiom or business cliche',
    fix: 'Say the literal thing.',
    weight: 0.75,
    applies: ['ui', 'docs', 'article', 'marketing'],
    patterns: idiomPatterns,
    examples: {
      hit: ['We will circle back next week.', 'This is low-hanging fruit.', 'Reach out to support.'],
      miss: ['We will talk again next week.', 'Contact support.'],
    },
  },
  {
    id: 'modal-strict',
    kind: 'clarity',
    group: 'words',
    strict: true,
    title: 'Modal other than can, must or will',
    fix: 'Use can, must or will. Keep the source certainty: "might fail" becomes "can fail", never "fails".',
    weight: 0.25,
    applies: ['ui', 'docs', 'message', 'article', 'marketing'],
    patterns: [/\b(?:should|may|might|could|would)\b/gi],
    examples: { hit: ['The tool should work.', 'It may fail.'], miss: ['The tool works.'] },
  },
  {
    id: 'paragraph-length',
    kind: 'clarity',
    group: 'structure',
    title: 'Paragraph too long',
    fix: 'Split by topic. Put the topic sentence first.',
    weight: 1,
    applies: ['docs', 'article', 'message', 'marketing'],
    detect: ({ block, profileConfig }) =>
      block.type === 'paragraph' && block.spans.length > profileConfig.paragraphSentences
        ? [{ index: 0, length: block.text.length, note: `${block.spans.length} sentences, limit ${profileConfig.paragraphSentences}` }]
        : [],
    examples: {
      hit: [Array.from({ length: 9 }, (_, i) => `Sentence number ${i + 1} says one thing.`).join(' ')],
      miss: ['One short paragraph. It has two sentences.'],
    },
  },
  {
    id: 'ui-vague-error',
    kind: 'slop',
    group: 'ui',
    title: 'Vague error or apology',
    fix: 'Say what happened and what the reader can do: "Could not save. The disk is full."',
    weight: 1.5,
    applies: ['ui'],
    patterns: VAGUE_ERRORS,
    examples: {
      hit: ['Something went wrong.', 'Oops! We could not load your save.', 'An unexpected error occurred.'],
      miss: ['Could not save. The disk is full.'],
    },
  },
  {
    id: 'click-here',
    kind: 'clarity',
    group: 'words',
    title: 'Link text that says nothing',
    fix: 'Make the link text name the destination.',
    weight: 0.5,
    applies: ['ui', 'docs'],
    patterns: [/\bclick here\b/gi, /\bread more here\b/gi],
    examples: { hit: ['Click here to download.'], miss: ['Download the installer.'] },
  },
];
