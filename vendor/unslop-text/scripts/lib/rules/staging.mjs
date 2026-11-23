import { regexHits, weightedHits, sentenceHits, runsOf, wordsIn, isInstruction, dropOverlaps, proseSentenceCounts } from './helpers.mjs';
import { mean, stdev } from '../text.mjs';

const PROSE = ['docs', 'article', 'message', 'marketing'];
const NOT_NARRATIVE = ['ui', 'docs', 'article', 'message', 'marketing'];
const EVERYWHERE = ['*'];

const JUST_BUT = /(?:\bnot|n['’]t) (?:just|only|merely|simply)\b(?=[^.!?]{0,120}?(?:\bbut\b|\bit['’]s\b|\bit is\b|\bthey['’]re\b|\bthey are\b|\balso\b|[;—–]|\s-{1,2}\s))/gi;
const NOT_X_ITS_Y = /\b(?:it|this|that|they|these|those)(?:['’]s|['’]re| is| are| was| were)?\s+(?:not|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)\s+(?:a |an |the |about |just |only )?[^.!?;,—–]{1,60}[,;:—–]\s*(?:it['’]s|it is|this is|that['’]s|they['’]re|they are)\b/gi;
const NO_NO_JUST = /\bno [a-z]+(?: [a-z]+)?, no [a-z]+(?: [a-z]+)?,? (?:just|only|simply)\b/gi;
const RATHER_THAN = [
  { re: /^rather than\b/gi, weight: 0.75 },
  { re: /\b\w+ rather than (?:a|an|simply|just|merely)\b/gi, weight: 0.5 },
];
const PREVIOUS_NEGATES = /^(?:this|that|it|these|those|they)\s+(?:doesn['’]t mean|does not mean|(?:isn['’]t|is not|wasn['’]t|was not|aren['’]t|are not|weren['’]t|were not) (?:just|only|merely|simply|about|a|an|the))\b/i;
const NEXT_REVEALS = /^(?:it|this|that|they)(?:['’]s|['’]re| is| are| means?| was)\b|^(?:instead|rather)\b/i;

const CLOSERS = [
  /^(?:and )?(?:that|this)(?:['’]s| is) (?:the )?(?:real|whole|entire|actual|true) (?:point|win|magic|beauty|power|difference|catch|secret|story|takeaway|lesson|kicker)\b/i,
  /^(?:and )?(?:that|this)(?:['’]s| is) (?:the )?(?:magic|beauty|power|win|kicker)\b[^.!?]{0,30}[.!]$/i,
  /^let that sink in\b/i,
  /^read that again\b/i,
  /^think about that\b/i,
  /^(?:simple|easy) as that\b/i,
  /^(?:full stop|period|end of story)[.!]?$/i,
  /^that['’]s (?:it|all)[.!]?$/i,
  /^no (?:fluff|hype|magic|nonsense|catch|gimmicks|surprises|exceptions|excuses|compromises|guesswork|guessing|setup|config|configuration|boilerplate|bloat)\b[^.!?]{0,20}[.!]$/i,
];
const EVERY_SINGLE = /\b(?:every|each|one)\. (?:single|more|last)\. \w+/gi;

const SAYINGS = [
  /\bat (?:its|the) (?:core|heart)\b/gi,
  /\bthe (?:real|true|actual) (?:question|challenge|problem|issue|magic|power|win|beauty|difference|secret) (?:is|isn['’]t|lies)\b/gi,
  /\bin today['’]s (?:fast[- ]paced|digital|modern|ever[- ]changing|rapidly (?:evolving|changing)|interconnected|competitive)\b/gi,
  /\bin (?:an|the) (?:ever[- ](?:evolving|changing|shifting)|increasingly \w+) (?:world|landscape|era|age|environment)\b/gi,
  /\bin (?:a|an|the) (?:world|era|age|time|landscape) (?:where|of rapid)\b/gi,
  /\bthe (?:truth|reality) is\b/gi,
  /\bhere['’]s the (?:thing|catch|kicker|truth|deal)\b/gi,
  /\bthe (?:beauty|magic) of\b/gi,
];

const RUNUPS = [
  ...[
    /\blet['’]s (?:dive|delve|unpack|break (?:it|this|that) down|jump (?:in|right in))\b/gi,
    /\bdive right in\b/gi,
    /\bhere['’]s (?:what|everything|all) (?:you|we) (?:need|should|want) to know\b/gi,
    /\bwithout further ado\b/gi,
    /\bbuckle up\b/gi,
    /\bwhether you['’]re (?:a|an) (?:beginner|newcomer|novice|seasoned|veteran|expert|developer|pro|professional|small|large|first-time|casual|hardcore)[^.!?]{0,60}\bor\b/gi,
    /\bever wondered\b/gi,
  ].map((re) => ({ re, weight: 2 })),
  { re: /\bit(?:['’]s| is) (?:(?:important|crucial|essential|vital) to (?:note|mention|remember|recognize|understand)|worth (?:noting|mentioning|remembering|pointing out|emphasi[sz]ing)) that\b/gi, weight: 1.5 },
  ...[
    /\blet['’]s (?:explore|take a (?:closer )?look)\b/gi,
    /\bin this (?:article|post|guide|tutorial|blog|section|chapter|document|readme),? (?:we(?:['’]ll| will)|i(?:['’]ll| will)|you(?:['’]ll| will)) (?:explore|discuss|dive|delve|unpack|examine|look)\b/gi,
  ].map((re) => ({ re, weight: 0.5 })),
];
const RUNUP_SENTENCES = [/^(?:honestly|truthfully|frankly)\?/i, /^imagine (?:a world|if|waking up|having|being|a future)\b/i];

const DEFENCES = [
  /\bto be (?:clear|fair|honest|frank|precise)\b/gi,
  /\bmake no mistake\b/gi,
  /\blet me be (?:clear|direct|honest|blunt|frank)\b/gi,
  /\bi['’]m not saying\b/gi,
  /\bit['’]s (?:tempting|easy) to (?:think|assume|believe|say|dismiss|treat|see)\b/gi,
  /\byou might (?:think|assume|expect|wonder|ask)\b/gi,
  /\bsome (?:might|may|will) (?:argue|say|think|object)\b/gi,
  /\bcontrary to (?:popular|common) (?:belief|opinion|wisdom)\b/gi,
  /\bit['’]s a common (?:misconception|myth)\b/gi,
];

const AI_ADJECTIVES = new Set(
  `fast simple clean clear strong safe easy flexible powerful reliable scalable secure efficient intuitive seamless robust modern lightweight fun engaging accessible smart elegant fresh bold sleek lean quick cheap affordable friendly practical dependable consistent responsive customizable portable open transparent`.split(/\s+/),
);
const ADJECTIVE_ENDINGS = /(?:ive|ble|ful|ous|ic|ish|less|ary|ory|ent|ant)$/;
const ABSTRACT_NOUN_ENDINGS = /(?:ity|ness|ment|tion|sion|ance|ence|ship|ism)$/;
const TRIAD = /\b([a-z][a-z-]{2,40}), ([a-z][a-z-]{2,40}),? (?:and|or) ([a-z][a-z-]{2,40})\b/gi;

function isAdjective(word) {
  const w = word.toLowerCase();
  return AI_ADJECTIVES.has(w) || (w.length > 4 && ADJECTIVE_ENDINGS.test(w));
}
function isAbstractNoun(word) {
  const w = word.toLowerCase();
  return w.length > 5 && ABSTRACT_NOUN_ENDINGS.test(w);
}

const OPENER_WORDS = new Set(['it', 'this', 'that', 'they', 'we', 'you', 'i', 'he', 'she', 'there', 'these', 'our', 'its', 'each']);

const DASHES = [
  { re: /—/g, weight: 1 },
  { re: /(?<!\d) - (?!\d)/g, weight: 0.5 },
];

// A dash separates clauses only in running text. Two other uses are not slop. The first dash after a
// label in a list entry ("name - description", "Title — Author", "Why use it? - Read more") is the
// format that list conventions such as awesome-lint prescribe. A dash alone in a table cell means
// "empty". One pairing stays counted: a bold label followed by an em dash is the stock pattern. In
// 563,000 words of READMEs from 2020 it appeared 3 times. A bold label with a hyphen appeared 77 times
// and a plain label with a separator over 11,000 times.
const LABEL_WORDS = 8;
const CELL_SEPARATOR = ' · ';
const LONE_DASH = /^[-–—]{1,2}$/;

function inLoneDashCell(text, hit) {
  const before = text.lastIndexOf(CELL_SEPARATOR, hit.index);
  const after = text.indexOf(CELL_SEPARATOR, hit.index + hit.length);
  const cell = text.slice(before === -1 ? 0 : before + CELL_SEPARATOR.length, after === -1 ? text.length : after);
  return LONE_DASH.test(cell.trim());
}

function separatesLabel(block, hit) {
  const label = block.text.slice(0, hit.index);
  const isLabel = wordsIn(label) <= LABEL_WORDS || label.trimEnd().endsWith('?');
  return isLabel && !(block.boldLabel && hit.text === '—');
}

// Chinese, Japanese and Korean text uses the double dash as its own punctuation.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function dashHits(block) {
  if (CJK.test(block.text)) return [];
  const hits = weightedHits(DASHES, block.text);
  if (block.type === 'table-row') return hits.filter((hit) => !inLoneDashCell(block.text, hit));
  if (block.type === 'list-item' && hits.length && separatesLabel(block, hits[0])) return hits.slice(1);
  return hits;
}

const HEDGES = [
  /\b(?:could|might|may|can|would)\s+(?:potentially|possibly|perhaps|arguably|conceivably)\b/gi,
  /\b(?:potentially|possibly|arguably|perhaps)\s+(?:could|might|may|can)\b/gi,
  /\b(?:generally|typically|usually|often|normally)\s+tends?\s+to\b/gi,
  /\btends?\s+to\s+(?:generally|typically|usually|often|normally)\b/gi,
  /\bit (?:may|might|could) be (?:possible|worth noting|argued|said|suggested) that\b/gi,
  /\bit (?:is|can be) (?:possible|argued|said|suggested) that (?:it |this |they |there )?(?:may|might|could)\b/gi,
];

const RESIDUE = [
  ...[
    /\bas an? (?:ai|large language model|language model|llm)\b/gi,
    /\bgreat (?:question|point|catch|idea)!/gi,
    /\b(?:excellent|fantastic|wonderful|fascinating|insightful) (?:question|point|observation)\b/gi,
    /\bi hope (?:this|that) helps\b/gi,
    /\bi['’]d be happy to (?:help|assist|explain|clarify)\b/gi,
    /\bi['’]m happy to help\b/gi,
    /\bsure[!,] (?:here|let me|i can)\b/gi,
    /\bhere(?:['’]s| is| are) (?:a|an|the) (?:breakdown|summary|overview|comprehensive|detailed|quick|concise|simplified|rewritten|revised|improved|updated)\b/gi,
    /\bbelow is (?:a|an|the) (?:detailed |comprehensive |quick |concise )?(?:overview|summary|breakdown|list|guide|explanation|version)\b/gi,
    /\bis there anything else\b/gi,
    /\bthank you for (?:your question|asking|reaching out|bringing)\b/gi,
    /\byou['’]re absolutely right\b/gi,
    /\bsorry for the confusion\b/gi,
    /\bi apologi[sz]e for\b(?! (?:any|the|this) (?:inconvenience|confusion|frustration|trouble|disruption))/gi,
  ].map((re) => ({ re, weight: 3 })),
  ...[
    /\bfeel free to (?:reach out|ask|let me know|contact|share|adjust|modify|customi[sz]e)\b/gi,
    /\blet me know if (?:you|there)\b/gi,
    /\b(?:do not|don['’]t) hesitate to\b/gi,
    /\bwould you like (?:me )?to\b/gi,
    /\bhappy to help\b/gi,
  ].map((re) => ({ re, weight: 1 })),
];

const RESIDUE_OPENERS = [/^(?:certainly|absolutely|of course)[!.]/i];

const KNOWLEDGE_LIMITS = [
  /\bas of my (?:last|latest|most recent) (?:knowledge |training )?(?:update|training|cutoff|knowledge)\b/gi,
  /\bmy (?:knowledge|training) (?:cutoff|cut-off|data)\b/gi,
  /\bup to my last (?:training|knowledge)\b/gi,
  /\bi (?:don['’]t|do not) have (?:access to|specific information|real-time)\b/gi,
  /\b(?:specific )?(?:details|information|data) (?:about [^.!?]{1,60} )?(?:are|is|remain|remains) (?:limited|scarce|unclear|unavailable|sparse)\b/gi,
  /\b(?:is|are) not (?:widely|publicly|extensively|well|readily) (?:documented|available|known|disclosed|reported)\b/gi,
  /\bin the (?:provided|available|given|cited) (?:sources|search results|information|context|text|materials)\b/gi,
  /\bbased on (?:the )?(?:available|provided|given|public) (?:information|sources|context|data|text)\b/gi,
];

const CORRECTIVE = [
  { re: /\bshould (?:be )?(?:treated|viewed|seen|read|understood|regarded|interpreted|approached) as\b[^.!?]{0,100}?\brather than\b/gi, weight: 3 },
  { re: /\b(?:does not|doesn['’]t|do not|don['’]t) (?:by itself|in itself|on its own|alone) (?:establish|prove|confirm|demonstrate)\b/gi, weight: 2 },
  { re: /\bshould not be confused with\b/gi, weight: 1 },
];

const TEMPLATES = [/\[(?:your|insert)\s[^\]]{0,40}\]/gi, /\blorem ipsum\b/gi, /<insert [^>]+>/gi, /\bINSERT_(?:NAME|HERE|DESCRIPTION)\b/g];

const META = [
  /\bthis (?:article|document|guide|section|post|page|readme|tutorial|chapter|report) (?:will|aims to|provides?|explores?|covers?|outlines?|discusses?|offers?|serves?|presents?|examines?)\b/gi,
  /\bthe (?:table|list|following|section|chart|figure|diagram) (?:below|above) (?:shows?|compares?|lists?|outlines?|summari[sz]es?|provides?|illustrates?)\b/gi,
  /\bas (?:mentioned|discussed|noted|stated) (?:earlier|above|previously|before)\b/gi,
  /\bthe following (?:section|sections|table|list|steps|paragraphs?) (?:outline|outlines|provides?|describes?|shows?|covers?|explains?)\b/gi,
  /\bin (?:this|the following) (?:section|chapter),? (?:we|i|you)\b/gi,
];

const ENDINGS = [
  /^(?:in conclusion|in summary|to summari[sz]e|to sum up|in closing|all in all|the bottom line is|in essence)\b/i,
  /^(?:overall|ultimately|in short|in the end|at the end of the day),/i,
];

const EMOJI = /\p{Extended_Pictographic}/gu;

function firstWord(sentence) {
  return sentence.match(/^\W*([A-Za-z']+)/)?.[1]?.toLowerCase();
}

export const STAGING_RULES = [
  {
    id: 'negative-parallelism',
    kind: 'slop',
    group: 'staging',
    title: 'Not X but Y',
    fix: 'State the point. Keep a contrast only when the reader really holds the opposite belief.',
    weight: 2,
    applies: EVERYWHERE,
    detect: ({ block }) => {
      const hits = regexHits([JUST_BUT, NOT_X_ITS_Y, NO_NO_JUST], block.text);
      for (const span of block.spans) hits.push(...weightedHits(RATHER_THAN, span.text).map((hit) => ({ ...hit, index: span.start + hit.index })));
      for (let i = 0; i + 1 < block.spans.length; i++) {
        const a = block.spans[i];
        const b = block.spans[i + 1];
        if (PREVIOUS_NEGATES.test(a.text) && NEXT_REVEALS.test(b.text)) {
          hits.push({ index: a.start, length: b.end - a.start });
        }
      }
      return dropOverlaps(hits);
    },
    examples: {
      hit: [
        "It's not just a faster build tool, it's a new way to think about your pipeline.",
        "This isn't a bug. It's a feature.",
        'This was not the end of her journey. It was only the beginning.',
        "The update doesn't just fix crashes; it rebuilds the save system.",
        'No setup, no config, just code.',
        'Not only is it fast but also cheap.',
        'Rather than adding a new parser, the tool wraps the old one.',
      ],
      miss: [
        'It is not ready. It will be tomorrow.',
        'It is not clear, but the team plans to ship it.',
        'The build is not finished yet.',
        "We don't only support Linux.",
        'This is not a drill.',
      ],
    },
  },
  {
    id: 'one-line-closer',
    kind: 'slop',
    group: 'staging',
    title: 'One-line closer or slogan fragment',
    fix: 'Cut a closer that repeats the paragraph. Merge fragments into one claim.',
    weight: 1.5,
    applies: NOT_NARRATIVE,
    detect: ({ block }) => dropOverlaps([...sentenceHits(CLOSERS, block), ...regexHits([EVERY_SINGLE], block.text)]),
    examples: {
      hit: ["That's the real win.", 'Let that sink in.', 'Simple as that.', 'No setup. No config.', 'Every. Single. Day. Ship it.'],
      miss: ["That's the idea we agreed on.", 'No users were affected.', 'Read that file again before you commit.'],
    },
  },
  {
    id: 'staccato',
    kind: 'slop',
    group: 'rhythm',
    title: 'Run of tiny sentences',
    fix: 'Merge the fragments into one or two sentences that make a claim.',
    weight: 1.5,
    applies: ['docs', 'article', 'message', 'marketing'],
    detect: ({ block }) => {
      if (block.type !== 'paragraph') return [];
      const hits = [];
      for (const run of runsOf(block.spans, (span) => wordsIn(span.text) <= 4, 3)) {
        const spans = block.spans.slice(run.start, run.end);
        if (spans.every((span) => isInstruction(span.text))) continue;
        hits.push({ index: spans[0].start, length: spans.at(-1).end - spans[0].start });
      }
      return hits;
    },
    examples: {
      hit: ['Fast. Simple. Done. Ship it today with confidence and see the difference for yourself.'],
      miss: ['Click Save. Close the window. Restart the game.'],
    },
  },
  {
    id: 'profound-saying',
    kind: 'slop',
    group: 'staging',
    title: 'Saying that sounds deep',
    fix: 'Replace it with the specific claim, or cut it.',
    weight: 1.5,
    applies: EVERYWHERE,
    patterns: SAYINGS,
    examples: {
      hit: [
        'At its core, the tool is a cache.',
        'The real question is whether it scales.',
        "In today's fast-paced world, teams need speed.",
        "Here's the thing: nobody reads logs.",
        'The truth is, most apps never need it.',
      ],
      miss: ['The core module handles input.', 'In the 1990s, builds took hours.', 'The question is on page 3.'],
    },
  },
  {
    id: 'staged-runup',
    kind: 'slop',
    group: 'staging',
    title: 'Staged run-up before the point',
    fix: 'Delete the run-up and start with the point.',
    weight: 2,
    applies: EVERYWHERE,
    detect: ({ block }) => dropOverlaps([...weightedHits(RUNUPS, block.text), ...sentenceHits(RUNUP_SENTENCES, block)]),
    examples: {
      hit: [
        "Let's dive into the details.",
        "Here's what you need to know.",
        "In this guide, we'll explore caching.",
        'Without further ado, here is the list.',
        "Whether you're a beginner or a seasoned pro, this helps.",
        'Buckle up.',
        "It's important to note that the file is large.",
        'It is important to note that the file is large.',
        "It's worth noting that the file is large.",
      ],
      miss: ['We dive at dawn.', 'In this guide you will find the API list.', 'The file is worth the wait.'],
    },
  },
  {
    id: 'arguing-with-no-one',
    kind: 'slop',
    group: 'staging',
    title: 'Defending against an objection nobody made',
    fix: 'Remove the defence unless someone in the context raised the objection.',
    weight: 0.75,
    applies: PROSE,
    patterns: DEFENCES,
    examples: {
      hit: ['To be clear, this is optional.', "I'm not saying the old way was wrong.", 'You might think this is slow.'],
      miss: ['It is clear from the log.', 'We are not saying anything new here.'],
    },
  },
  {
    id: 'triad',
    kind: 'slop',
    group: 'rhythm',
    title: 'Forced triad',
    fix: 'Keep three items only when the meaning has three parts. Otherwise say the one thing that is true.',
    weight: 0.75,
    applies: PROSE,
    detect: ({ block }) => {
      const hits = [];
      for (const match of block.text.matchAll(TRIAD)) {
        const [, a, b, c] = match;
        if ([a, b, c].every(isAdjective) || [a, b, c].every(isAbstractNoun)) {
          hits.push({ index: match.index, length: match[0].length });
        }
      }
      return hits;
    },
    examples: {
      hit: ['The new dashboard is fast, intuitive, and powerful.', 'We improve performance, reliability, and scalability.'],
      miss: ['We shipped Python, Rust, and Go bindings.', 'Mix red, white, and blue paint.'],
    },
  },
  {
    id: 'repeated-openings',
    kind: 'slop',
    group: 'rhythm',
    title: 'Same opening word three times in a row',
    fix: 'Merge two of the sentences, or start one with the action or the condition.',
    weight: 0.75,
    applies: ['docs', 'article', 'message'],
    detect: ({ block }) => {
      if (block.type !== 'paragraph') return [];
      const hits = [];
      const firsts = block.spans.map((span) => firstWord(span.text));
      for (let i = 0; i + 2 < firsts.length; i++) {
        const word = firsts[i];
        if (word && OPENER_WORDS.has(word) && firsts[i + 1] === word && firsts[i + 2] === word) {
          let end = i + 3;
          while (end < firsts.length && firsts[end] === word) end++;
          hits.push({ index: block.spans[i].start, length: block.spans[end - 1].end - block.spans[i].start });
          i = end - 1;
        }
      }
      return hits;
    },
    examples: {
      hit: ['It reads the file. It checks the header. It starts the parser.'],
      miss: ['Click Save. Click Close. Click Exit.'],
    },
  },
  {
    id: 'dashes',
    kind: 'slop',
    group: 'rhythm',
    title: 'Dash used as a clause separator',
    fix: 'Use a period, colon, comma or parentheses. Vary them. Do not swap every dash for a comma.',
    weight: 1,
    applies: ['ui', 'docs', 'article', 'message', 'marketing'],
    detect: ({ block }) => dashHits(block),
    examples: {
      hit: [
        'The tool — fast and small — ships today.',
        'It works - mostly.',
        'The tool &mdash; fast and small &mdash; ships today.',
        '- **Fast** — runs in milliseconds.',
        '- Open the settings page and check the proxy field - then save.',
      ],
      miss: [
        'Pages 3–5 cover setup.',
        'It works -- mostly.',
        'The rule – as it was written – is old.',
        'A well-known fix.',
        'Score: 5 - 3.',
        '- fyne - Cross platform native GUIs for Go.',
        '- Eloquent JavaScript — Marijn Haverbeke',
        '- **Config** - saves global read-only settings.',
        '- Why should you avoid running non-UI code on the main thread? - Learn from here',
        '| Tool | Size |\n|---|---|\n| lint | — |\n| check | - |',
        '目录 Week1 —— What is Machine Learning Week2 —— Linear Regression',
        'Chapter 3 —— 安装和配置 —— Install and configure the server.',
      ],
    },
  },
  {
    id: 'stacked-hedges',
    kind: 'slop',
    group: 'rhythm',
    title: 'Stacked hedges',
    fix: 'Keep one hedge, and only if the source supports it.',
    weight: 1,
    applies: NOT_NARRATIVE,
    patterns: HEDGES,
    examples: {
      hit: ['This could potentially cause crashes.', 'It may possibly fail.', 'Users generally tend to skip it.', 'It might arguably be the best.'],
      miss: ['This could cause crashes.', 'Files often take a while to load.', 'It may rain.'],
    },
  },
  {
    id: 'chatbot-residue',
    kind: 'slop',
    group: 'residue',
    title: 'Chatbot residue',
    fix: 'Delete the wrapper. Keep the content.',
    weight: 3,
    applies: NOT_NARRATIVE,
    detect: ({ block }) =>
      dropOverlaps([...weightedHits(RESIDUE, block.text), ...sentenceHits(RESIDUE_OPENERS, block).map((hit) => ({ ...hit, weight: 3 }))]),
    examples: {
      hit: [
        'Great question! Caching works like this.',
        'I hope this helps.',
        'As an AI language model, I cannot browse.',
        "Here's a breakdown of the options.",
        'Certainly! Here is the summary.',
        'Let me know if you have questions.',
      ],
      miss: ['The question of caching is old.', 'Sure enough, the build failed.', 'We hope the patch helps.'],
    },
  },
  {
    id: 'knowledge-limit',
    kind: 'slop',
    group: 'residue',
    title: 'Guess about missing sources or knowledge limits',
    fix: 'Say what the source does not show, or cut the sentence. Never guess to fill the gap.',
    weight: 2.5,
    applies: NOT_NARRATIVE,
    patterns: KNOWLEDGE_LIMITS,
    examples: {
      hit: [
        'As of my last knowledge update, the API had no limits.',
        'While specific details are limited, the tool likely supports exports.',
        "The author's life is not widely documented.",
        'Based on the available information, the mine closed in 1998.',
      ],
      miss: ['Details are in the appendix.', 'The data are available on request.'],
    },
  },
  {
    id: 'corrective-framing',
    kind: 'slop',
    group: 'residue',
    title: 'Corrective framing of a source or claim',
    fix: 'State what the evidence shows. Drop the instruction about how to read it.',
    weight: 2,
    applies: NOT_NARRATIVE,
    detect: ({ block }) => weightedHits(CORRECTIVE, block.text),
    examples: {
      hit: ['The claim should be treated as tradition rather than as history.', 'The report does not by itself establish a cause.'],
      miss: ['The claim should be checked before release.'],
    },
  },
  {
    id: 'template-leftover',
    kind: 'slop',
    group: 'residue',
    title: 'Template placeholder left in the text',
    fix: 'Fill in the real value or remove the sentence.',
    weight: 3,
    applies: ['article', 'message', 'marketing'],
    patterns: TEMPLATES,
    examples: {
      hit: ['Dear [Your Name], thanks for writing.', 'Lorem ipsum dolor sit amet.'],
      miss: ['Insert the card into the slot.'],
    },
  },
  {
    id: 'meta-text',
    kind: 'slop',
    group: 'residue',
    title: 'Text about the document instead of the subject',
    fix: 'Write about the subject. Let headings and layout do the signposting.',
    weight: 1,
    applies: ['docs', 'article', 'message'],
    patterns: META,
    examples: {
      hit: ['This guide will walk you through setup.', 'The table below compares the plans.', 'As mentioned earlier, caching helps.'],
      miss: ['The guide is in the docs folder.'],
    },
  },
  {
    id: 'ending-summary',
    kind: 'slop',
    group: 'staging',
    title: 'Summary closer',
    fix: 'End on the last concrete fact, or on the action the reader should take.',
    weight: 1.5,
    applies: ['docs', 'article', 'message'],
    detect: ({ block }) => sentenceHits(ENDINGS, block),
    examples: {
      hit: ['In conclusion, caching matters.', 'Overall, the update is a win.'],
      miss: ['Overall length is 12 cm.', 'The summary is in section 3.'],
    },
  },
  {
    id: 'uniform-rhythm',
    kind: 'slop',
    group: 'rhythm',
    scope: 'doc',
    title: 'Sentence lengths barely vary',
    fix: 'Mix lengths: fold two linked ideas into one longer sentence, and let one short sentence stand where it matters.',
    weight: 2,
    applies: ['docs', 'article', 'message', 'marketing'],
    detect: ({ doc }) => {
      const counts = proseSentenceCounts(doc);
      if (counts.length < 10) return [];
      const m = mean(counts);
      const spread = stdev(counts);
      if (m < 5 || m > 26 || spread / m >= 0.3) return [];
      const first = doc.blocks.find((b) => b.type === 'paragraph');
      return [{ line: first?.line ?? 1, quote: `${counts.length} sentences, mean ${m.toFixed(1)} words, spread ${spread.toFixed(1)}` }];
    },
    examples: {
      hit: [
        Array.from({ length: 10 }, (_, i) => `The ${['team', 'tool', 'file', 'task', 'plan', 'step', 'test', 'build', 'user', 'page'][i]} runs the check and reports the result.`).join(' '),
      ],
      miss: [
        'It works. The team spent three weeks tracing a memory leak that only appeared when the save file crossed four megabytes, which nobody expected. Why? Cache. We removed it. Then the leak vanished, along with two other bugs we had logged as unrelated, and the build time dropped by half. Strange. Sometimes the boring answer wins. Nobody argued with the numbers after that.',
      ],
    },
  },
  {
    id: 'emoji-decoration',
    kind: 'slop',
    group: 'format',
    blocks: 'all',
    title: 'Emoji as decoration',
    fix: 'Remove the emoji. Keep one only where a person would really send it.',
    weight: 1,
    applies: ['ui', 'docs', 'article', 'message'],
    detect: ({ block }) => {
      const found = [...block.text.matchAll(EMOJI)];
      if (!found.length) return [];
      const leading = found[0].index === 0 && (block.type === 'heading' || block.type === 'list-item');
      if (leading || found.length >= 3) return [{ index: found[0].index, length: found[0][0].length }];
      return [];
    },
    examples: {
      hit: ['- 🚀 Fast builds', '## ✨ Features', 'Ship it 🚀 now 🎉 and relax ✨.'],
      miss: ['We shipped it 🎉'],
    },
  },
];
