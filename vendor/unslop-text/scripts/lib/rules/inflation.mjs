import { regexHits, weightedHits, runsOf, wordsIn, hasCitation, proseSentenceCounts } from './helpers.mjs';
import { compileVocab, findVocab } from '../vocab.mjs';

const NOT_NARRATIVE = ['ui', 'docs', 'article', 'message', 'marketing'];
const PROSE = ['docs', 'article', 'message', 'marketing'];
const EVERYWHERE = ['*'];

const vocabCache = new Map();
function vocabFor(profile) {
  if (!vocabCache.has(profile)) vocabCache.set(profile, compileVocab(profile));
  return vocabCache.get(profile);
}

const SIGNIFICANCE = [
  { re: /\b(?:marks?|marked|marking)\s+(?:a|an|the)\s+(?:pivotal|significant|major|important|turning|defining|key|crucial|notable)\s+(?:moment|point|milestone|step|shift|chapter|era)\b/gi, weight: 2 },
  { re: /\b(?:stands?|serves?|remains?) as an? (?:testament|beacon|reminder|symbol|catalyst|cornerstone)\b/gi, weight: 2 },
  { re: /\bplays? an? (?:vital|crucial|pivotal|key|significant|major|central|essential|critical|integral) role\b/gi, weight: 1.5 },
  { re: /\b(?:rich|vibrant|diverse) (?:tapestry|array|heritage|landscape) of\b/gi, weight: 2 },
  { re: /\bleaves? an? (?:lasting|indelible|enduring|profound) (?:mark|impact|legacy|impression)\b/gi, weight: 2 },
  { re: /\breflects? a broader\b/gi, weight: 2 },
  { re: /\b(?:highlights?|underscores?) the (?:importance|need|significance|value|role) of\b/gi, weight: 2 },
  { re: /\bpav(?:es|ed|ing) the way (?:for|to)\b/gi, weight: 1.5 },
  { re: /\bshaping the future of\b/gi, weight: 2 },
  { re: /\bthe future (?:looks|is) (?:bright|promising)\b/gi, weight: 2 },
  { re: /\bcontinues? to (?:inspire|captivate|resonate)\b/gi, weight: 1.5 },
  { re: /\bsetting the stage for\b/gi, weight: 1.5 },
  { re: /\ba (?:watershed|defining) moment\b/gi, weight: 2 },
  { re: /\bhas become increasingly\b/gi, weight: 1 },
  { re: /\bgrowing (?:recognition|awareness|importance|demand) (?:of|for|that)\b/gi, weight: 1 },
  { re: /\b(?:broader|wider) (?:implications|significance)\b/gi, weight: 1 },
  { re: /\bin the realm of\b/gi, weight: 1 },
  { re: /\bcontribut(?:e|es|ing) meaningfully to\b/gi, weight: 1.5 },
  { re: /\bthe advancement of\b/gi, weight: 0.75 },
];

const ASSOCIATION = [
  /\b(?:deeply|intricately|inextricably|intimately|intrinsically) (?:linked|tied|connected|associated|intertwined|rooted|woven|bound)\b/gi,
  /\binterplay (?:between|of)\b/gi,
  /\bintertwined\b/gi,
  /\binextricabl[ey]\b/gi,
];

const RIDERS = [
  { re: /,\s+(?:highlighting|underscoring|emphasi[sz]ing|showcasing|reflecting|fostering|cementing|solidifying|symboli[sz]ing|signall?ing|reinforcing|illustrating)\s+(?:the|its|their|a|an|how|that|his|her|our|your|this|these|why|what|both)\b/gi, weight: 2 },
  { re: /,\s+(?:ensuring|demonstrating|enabling|enhancing|contributing to|paving|shaping|driving|empowering|facilitating|promoting|cultivating|representing)\s+(?:that|the|its|their|a|an|how|his|her|our|your|this|these|better|greater)\b/gi, weight: 0.5 },
];

const SALES = [
  /\bnestled (?:in|within|among|between|at)\b/gi,
  /\bin the heart of\b/gi,
  /\bbreathtaking\b/gi,
  /\bstunning(?:ly)?\b/gi,
  /\bunparalleled\b/gi,
  /\bunrivall?ed\b/gi,
  /\bsecond[- ]to[- ]none\b/gi,
  /\b(?:top[- ]notch|industry[- ]leading|next[- ]generation|mission[- ]critical|one[- ]stop[- ]shop)\b/gi,
  /\bnext[- ]level (?:experience|performance|power|quality|speed|results|solutions?|tools?|technology|productivity)\b/gi,
  /\btake (?:your|the|it|things) [^.!?]{0,25}to the next level\b/gi,
  /\bat your fingertips\b/gi,
  /\blook no further\b/gi,
  /\bunlock the full potential\b/gi,
  /\btailored to (?:your|their|the) (?:needs|requirements|goals)\b/gi,
  /\bso you can focus on what (?:really )?matters\b/gi,
  /\bperfect for (?:anyone|everyone|those)\b/gi,
  /\bwhether you['’]re looking (?:to|for)\b/gi,
  /\bwe(?:['’]re| are) (?:thrilled|excited|delighted|proud|pleased) to (?:announce|introduce|share|present|unveil)\b/gi,
  /\b(?:powerful (?:and|yet) (?:intuitive|simple|flexible|easy)|intuitive (?:and|yet) powerful)\b/gi,
];

const AUTHORITY = [
  /\b(?:experts|researchers|analysts|scholars|observers|critics|commentators|industry (?:leaders|experts|observers)) (?:argue|say|agree|believe|note|suggest|have noted|have argued|warn|point out|consider)\b/gi,
  /\b(?:studies|research|surveys|reports) (?:show|shows|suggest|suggests|indicate|indicates|reveal|reveals|demonstrate|demonstrates|have shown|has shown)\b/gi,
  /\b(?:industry|market|analyst) reports\b/gi,
  /\bmany (?:believe|argue|consider|say|experts)\b/gi,
  /\bit is (?:widely|generally|commonly) (?:believed|known|recognized|recognised|regarded|acknowledged|accepted|considered)\b/gi,
  /\bis (?:widely|generally|commonly) (?:regarded|considered|recognized|recognised|seen|viewed|acknowledged) as\b/gi,
  /\baccording to (?:some|many|experts|industry|observers|critics|analysts)\b/gi,
  /\bhas been (?:described|called|hailed|praised|lauded) as\b/gi,
  /\bis (?:often|frequently) (?:described|called|hailed|seen|viewed) as\b/gi,
];

const COPULA = [
  { re: /\b(?:serves|stands) as (?:a|an|the)\b/gi, weight: 1.5 },
  { re: /\bboasts? (?:a|an|the|over|more)\b/gi, weight: 1.5 },
  { re: /\b(?:embarks?|embarked|ventured?|ventures) (?:on|into)\b/gi, weight: 1.5 },
  { re: /\bis home to\b/gi, weight: 1 },
  { re: /\bplays host to\b/gi, weight: 1.5 },
  { re: /\b(?:features?|offers?|provides?) (?:a|an) (?:wide|rich|robust|comprehensive|range|variety|array|suite|host|selection)\b/gi, weight: 0.5 },
  { re: /\b(?:acts?|functions?) as (?:a|an|the)\b/gi, weight: 0.5 },
];

const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'from', 'by', 'of', 'in', 'with', 'as', 'vs', 'via', 'per', 'is', 'are', 'be', 'it', 'if', 'up']);
const GENERIC_HEADING = /^(?:conclusion|final thoughts|key takeaways|takeaways|wrapping up|in summary|the bottom line|why it matters|looking ahead|the road ahead|what['’]s next|closing thoughts)\b/i;

function isTitleCase(text) {
  const words = text.replace(/[^\p{L}\p{N}' -]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  const significant = words.slice(1).filter((w) => w.length > 2 && !SMALL_WORDS.has(w.toLowerCase()));
  if (significant.length < 2) return false;
  const capitalised = significant.filter((w) => /^\p{Lu}/u.test(w));
  return capitalised.length / significant.length >= 0.8;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const INFLATION_RULES = [
  {
    id: 'stock-vocabulary',
    kind: 'slop',
    group: 'inflation',
    title: 'Words that cluster in padded, generic text',
    fix: 'Use the plain word, or say the concrete thing. One stray word is fine; a cluster is the tell.',
    weight: 2,
    applies: EVERYWHERE,
    detect: ({ block, profile }) => {
      const found = findVocab(block.text, vocabFor(profile));
      const strong = found.filter((f) => f.tier === 'strong');
      const medium = found.filter((f) => f.tier === 'medium');
      const soft = found.filter((f) => f.tier === 'soft');
      const distinct = new Set(found.map((f) => f.word)).size;
      const hits = strong.map((f) => ({ index: f.index, length: f.length, text: f.word, weight: 2 }));
      if (strong.length || new Set(medium.map((f) => f.word)).size >= 2) {
        hits.push(...medium.map((f) => ({ index: f.index, length: f.length, text: f.word, weight: 1 })));
      }
      if (distinct >= 3) hits.push(...soft.map((f) => ({ index: f.index, length: f.length, text: f.word, weight: 0.5 })));
      return hits;
    },
    examples: {
      hit: [
        'The robust framework delves into the intricate tapestry of modern tools.',
        'We leverage a seamless pipeline and streamline the workflow, which is crucial.',
        'The guide delved deeper into each topic.',
        'This release will unleash the power of every team and unleash new potential.',
      ],
      miss: [
        'Unleash is a feature flag system. Run the unleash-server first, then open unleash-hosted.com.',
        'Our team moved from the Pivotal Tracker board to a Seamless Cloud account.',
        'A test harness runs the suite.',
        'Use the underscore character in names.',
        'Set the screen to landscape mode.',
        'The foster parent signed the form.',
        'We leverage the cache.',
        'Delve is a debugger for the Go programming language.',
      ],
    },
  },
  {
    id: 'inflated-significance',
    kind: 'slop',
    group: 'inflation',
    title: 'Inflated significance',
    fix: 'Keep the fact. Cut the claim about what it means.',
    weight: 2,
    applies: ['docs', 'article', 'message', 'marketing'],
    detect: ({ block }) => weightedHits(SIGNIFICANCE, block.text),
    examples: {
      hit: [
        'The release marks a pivotal moment for the project.',
        'It plays a vital role in the build.',
        'The festival stands as a testament to local pride.',
        'The change highlights the importance of testing.',
      ],
      miss: ['The release marks version 2.0.', 'The pivot table has a role in the report.'],
    },
  },
  {
    id: 'vague-association',
    kind: 'slop',
    group: 'inflation',
    title: 'Vague connection between topics',
    fix: 'Name the actual relation the source gives. If it gives none, cut the sentence.',
    weight: 1.5,
    applies: NOT_NARRATIVE,
    patterns: ASSOCIATION,
    examples: {
      hit: ['Her work is deeply rooted in local history.', 'The interplay between speed and cost matters.', 'Both are intertwined.'],
      miss: ['The key is linked to the lock.', 'The cable is connected to the router.'],
    },
  },
  {
    id: 'ing-rider',
    kind: 'slop',
    group: 'inflation',
    title: 'Trailing -ing clause that adds a claim',
    fix: 'Cut the rider unless the source states the claim. If it does, make it its own sentence.',
    weight: 2,
    applies: PROSE,
    detect: ({ block }) => weightedHits(RIDERS, block.text),
    examples: {
      hit: ["The patch landed in May, highlighting the team's focus on stability.", 'It supports caching, ensuring that rebuilds stay fast.'],
      miss: ['Sorting the list, we found the bug.', 'She ran, then rested.'],
    },
  },
  {
    id: 'sales-language',
    kind: 'slop',
    group: 'inflation',
    title: 'Sales language',
    fix: 'Say what the thing is and does. Use a number or a fact in place of the adjective.',
    weight: 1.5,
    applies: ['ui', 'docs', 'article', 'message', 'marketing'],
    patterns: SALES,
    examples: {
      hit: ["We're thrilled to announce the new release.", 'Nestled in the heart of the city, the hotel offers views.', 'Take your workflow to the next level.', 'Look no further.', 'The engine delivers unparalleled speed.'],
      miss: ['The hotel is in the city center.', 'The next level loads in two seconds.'],
    },
  },
  {
    id: 'borrowed-authority',
    kind: 'slop',
    group: 'inflation',
    title: 'Unnamed authority',
    fix: 'Name who said what, with a source, or cut it. Never invent a source.',
    weight: 1.5,
    applies: PROSE,
    detect: ({ block }) =>
      regexHits(AUTHORITY, block.text).filter((hit) => {
        const span = block.spans.find((s) => hit.index >= s.start && hit.index < s.end);
        return !(span && hasCitation(span.text));
      }),
    examples: {
      hit: ['Experts agree that testing matters.', 'Studies show that users prefer short text.', 'It is widely regarded as the best.'],
      miss: ['Studies show that users prefer short text [3].', 'A study by Smith in 2020 measured it.'],
    },
  },
  {
    id: 'avoid-copula',
    kind: 'slop',
    group: 'inflation',
    title: 'Avoiding "is", "are" and "has"',
    fix: 'Use is, are or has.',
    weight: 1.5,
    applies: PROSE,
    detect: ({ block }) => weightedHits(COPULA, block.text),
    examples: {
      hit: ['The library serves as a bridge between tools.', 'The hotel boasts a pool.', 'The festival is home to a thousand bands.'],
      miss: ['She served as a nurse in 1950.', 'The hotel has a pool.', 'The type represents a handle.'],
    },
  },
  {
    id: 'bold-decoration',
    kind: 'slop',
    group: 'format',
    scope: 'doc',
    title: 'Bold used as decoration',
    fix: 'Remove the bold. Turn the list into prose if the labels add nothing. Keep bold for warnings and UI names.',
    weight: 1,
    applies: PROSE,
    detect: ({ doc }) => {
      const hits = [];
      const blocks = doc.blocks;
      for (const run of runsOf(blocks, (b) => b.type === 'list-item' && b.boldLabel, 3)) {
        hits.push({ line: blocks[run.start].line, quote: blocks[run.start].text.slice(0, 80) });
      }
      for (const block of blocks) {
        if (block.type === 'paragraph' && block.boldCount >= 4 && block.boldCount / wordsIn(block.text) > 1 / 30) {
          hits.push({ line: block.line, quote: `${block.boldCount} bold spans in ${wordsIn(block.text)} words` });
        }
      }
      return hits;
    },
    examples: {
      hit: ['- **Speed:** Fast builds.\n- **Safety:** Strong types.\n- **Reach:** Many targets.'],
      miss: ['- **Speed:** Fast builds.\n- **Safety:** Strong types.', '- Fast builds.\n- Strong types.\n- Many targets.'],
    },
  },
  {
    id: 'heading-case',
    kind: 'slop',
    group: 'format',
    blocks: 'heading',
    title: 'Title Case heading',
    fix: 'Use sentence case unless the house style says otherwise.',
    weight: 0.25,
    applies: ['docs', 'article'],
    detect: ({ block }) => (block.level >= 2 && isTitleCase(block.text) ? [{ index: 0, length: block.text.length }] : []),
    examples: {
      hit: ['## Getting Started With Local Development'],
      miss: ['## Getting started with local development', '# Getting Started With Local Development', '## Using the CLI'],
    },
  },
  {
    id: 'heading-generic',
    kind: 'slop',
    group: 'format',
    blocks: 'heading',
    title: 'Generic summary heading',
    fix: 'Name what the section holds, or drop the section.',
    weight: 0.75,
    applies: ['article', 'message'],
    detect: ({ block }) => (GENERIC_HEADING.test(block.text) ? [{ index: 0, length: block.text.length }] : []),
    examples: {
      hit: ['## Final Thoughts', '## Key takeaways'],
      miss: ['## Summary of changes', '## Thoughts on caching'],
    },
  },
  {
    id: 'heading-echo',
    kind: 'slop',
    group: 'format',
    scope: 'doc',
    title: 'First line repeats the heading',
    fix: 'Delete the line and start with the first fact.',
    weight: 1,
    applies: ['docs', 'article'],
    detect: ({ doc }) => {
      const hits = [];
      doc.blocks.forEach((block, i) => {
        const next = doc.blocks[i + 1];
        if (block.type !== 'heading' || next?.type !== 'paragraph' || !next.spans[0]) return;
        const words = block.text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
        if (!words.length || words.length > 6) return;
        const echo = new RegExp(`^${words.map(escapeRegExp).join('\\s+')}\\s+(?:is|are)\\s+(?:an?\\s+)?(?:very\\s+|extremely\\s+|really\\s+)?(?:important|crucial|essential|vital|critical|key|fundamental)\\b`, 'i');
        if (echo.test(next.spans[0].text)) hits.push({ line: next.line, quote: next.spans[0].text.slice(0, 80) });
      });
      return hits;
    },
    examples: {
      hit: ['## Security\n\nSecurity is important for every project.'],
      miss: ['## Security\n\nThe scanner checks every package.'],
    },
  },
  {
    id: 'punctuation-monotony',
    kind: 'slop',
    group: 'rhythm',
    scope: 'doc',
    title: 'Almost no punctuation beyond commas and periods',
    fix: 'Where a colon, a question, parentheses or a quote would be natural, use it.',
    weight: 1,
    applies: ['article', 'message', 'marketing'],
    detect: ({ doc }) => {
      const prose = doc.blocks.filter((b) => b.type === 'paragraph' || b.type === 'quote');
      const words = prose.reduce((sum, b) => sum + wordsIn(b.text), 0);
      if (words < 250 || proseSentenceCounts(doc).length < 12) return [];
      const marks = prose.reduce((sum, b) => sum + (b.text.match(/[:;()?"“”!]/g)?.length ?? 0), 0);
      if ((marks / words) * 1000 >= 4) return [];
      return [{ line: prose[0].line, quote: `${marks} colons, questions, quotes or parentheses in ${words} words` }];
    },
    examples: {
      hit: [Array.from({ length: 14 }, (_, i) => `The team shipped release number ${i + 1} on time and the users kept using the product without complaint for many weeks in a row.`).join(' ')],
      miss: ['Short text, no problem.'],
    },
  },
  {
    id: 'list-overuse',
    kind: 'slop',
    group: 'format',
    scope: 'doc',
    title: 'Prose broken into bullets',
    fix: 'Write connected prose when the points depend on each other.',
    weight: 1,
    applies: ['article', 'message'],
    detect: ({ doc }) => {
      const prose = doc.blocks.filter((b) => b.type !== 'heading');
      const items = prose.filter((b) => b.type === 'list-item');
      if (items.length < 8 || items.length / prose.length <= 0.6) return [];
      return [{ line: items[0].line, quote: `${items.length} of ${prose.length} blocks are bullets` }];
    },
    examples: {
      hit: [Array.from({ length: 9 }, (_, i) => `- Point number ${i + 1} about the topic`).join('\n')],
      miss: ['- One\n- Two\n\nA paragraph of prose follows the short list.'],
    },
  },
  {
    id: 'contrast-closer',
    kind: 'slop',
    group: 'rhythm',
    scope: 'doc',
    title: 'Paragraphs end on a short punchline',
    fix: 'End the paragraph on its last real point. Keep a short closing sentence only where it earns its place.',
    weight: 1.5,
    applies: ['docs', 'article', 'message', 'marketing'],
    detect: ({ doc }) => {
      const multi = doc.blocks.filter((b) => b.type === 'paragraph' && b.spans.length >= 3);
      const closers = multi.filter((b) => {
        const last = b.spans.at(-1);
        const previous = b.spans.at(-2);
        return wordsIn(last.text) <= 6 && wordsIn(previous.text) >= 12 && !/\d/.test(last.text);
      });
      if (closers.length < 3 || closers.length / multi.length < 0.4) return [];
      return [{ line: closers[0].line, quote: `${closers.length} of ${multi.length} paragraphs end on a sentence of six words or fewer` }];
    },
    examples: {
      hit: [
        Array.from(
          { length: 4 },
          (_, i) => `The first long sentence explains the background of topic number ${i + 1} in detail. The second long sentence adds more context that the reader probably already has. That changes everything.`,
        ).join('\n\n'),
      ],
      miss: ['One paragraph. With two sentences.'],
    },
  },
  {
    id: 'exclamation-density',
    kind: 'slop',
    group: 'rhythm',
    scope: 'doc',
    title: 'Too many exclamation marks',
    fix: 'Keep an exclamation mark for the rare sentence that is truly excited.',
    weight: 1,
    applies: ['ui', 'docs', 'article', 'message'],
    detect: ({ doc }) => {
      const spans = doc.blocks.filter((b) => b.type !== 'heading').flatMap((b) => b.spans.map((s) => ({ s, b })));
      const bangs = spans.filter(({ s }) => s.text.endsWith('!'));
      if (bangs.length < 3 || bangs.length / spans.length < 0.25) return [];
      return [{ line: bangs[0].b.line, quote: `${bangs.length} of ${spans.length} sentences end with "!"` }];
    },
    examples: {
      hit: ['Welcome back! Your quest awaits! Claim your reward! Go now!'],
      miss: ['Welcome back. Your quest is ready. Claim your reward!'],
    },
  },
];
