import { weightedHits, proseBlocks } from './helpers.mjs';

const UI_FLUFF = [
  { re: /\b(?:embark on|begin|start|continue|customi[sz]e|enhance|elevate|personali[sz]e|fine-tune|enjoy|unleash|discover) your (?:\w+ )?(?:journey|adventure|experience|story|quest|masterpiece|potential)\b/gi, weight: 1.5 },
  { re: /\bon your (?:\w+ )?journey\b/gi, weight: 1.5 },
  { re: /\bunlock the (?:power|potential|magic|secrets?) of\b/gi, weight: 1.5 },
  { re: /\ba world of (?:possibilit(?:y|ies)|opportunit(?:y|ies)|wonders?|adventures?)\b/gi, weight: 1.5 },
  { re: /\btake your \w+ to the next level\b/gi, weight: 1.5 },
  { re: /\bplease wait while we\b/gi, weight: 1 },
  { re: /\bawaits?\b/gi, weight: 1 },
  { re: /\bimmersive\b/gi, weight: 1 },
  { re: /\bmasterpiece\b/gi, weight: 1 },
  { re: /\bcurated\b/gi, weight: 1 },
  { re: /\bsuccessfully\b/gi, weight: 1 },
  { re: /\bit (?:looks|seems) like\b/gi, weight: 1 },
  { re: /\btruly\b/gi, weight: 0.75 },
  { re: /\b(?:meet the (?:talented|amazing|incredible|passionate|dedicated)|(?:talented|passionate|dedicated) team)\b/gi, weight: 1 },
  { re: /\bplease note that\b/gi, weight: 0.75 },
  { re: /\bwe encountered\b/gi, weight: 1 },
  { re: /\birreversible and cannot be undone\b/gi, weight: 1 },
  { re: /\boptimal performance\b/gi, weight: 1 },
];

const STOCK_NAMES = /\b(?:Elara(?: Voss)?|Kael(?:en)?|Seraphina|Elowen|Eldoria|Eldermere|Whispering (?:Woods|Forest))\b/g;

const FICTION_CLICHES = [
  /\bwhispering (?:woods|forest|trees|winds?|shadows)\b/g,
  /\bdance of (?:light|shadows?|light and (?:shadows?|dark(?:ness)?))\b/gi,
  /\bthe air (?:was|hung) thick with\b/gi,
  /\bshivers? (?:ran|crept|raced|went) down (?:her|his|their) spine\b/gi,
  /\blittle did (?:she|he|they) know\b/gi,
  /\bbreath (?:she|he|they) (?:didn['’]t|hadn['’]t) (?:know|realized)\b/gi,
  /\bancient (?:magic|secrets|evil|power)\b/gi,
  /\bforgotten secrets\b/gi,
  /\bcountless (?:ages|generations|years|centuries)\b/gi,
  /\b(?:this|that) (?:was|is) (?:only|just) the beginning\b/gi,
  /\bonly (?:just )?the beginning\b/gi,
].map((re) => ({ re, weight: 1 }));

export const SURFACE_RULES = [
  {
    id: 'ui-fluff',
    kind: 'slop',
    group: 'ui',
    title: 'Marketing fluff in an interface string',
    fix: 'Say what the control does or what happened. "Play", "Saved.", "No photos yet."',
    weight: 1,
    applies: ['ui', 'marketing'],
    detect: ({ block }) => weightedHits(UI_FLUFF, block.text),
    examples: {
      hit: ['Embark on Your Journey', 'Your Gallery Awaits', 'Saved successfully.', "It looks like you haven't added any photos.", "Let's get started on your journey", 'Unlock the power of effortless budgeting', 'Discover a world of possibilities', 'Take your notes to the next level', 'Please wait while we fetch your data'],
      miss: ['Start game', "Delete this photo? You can't undo this.", 'Journey log', 'Unlock all levels', 'The world is large', 'Loading'],
    },
  },
  {
    id: 'fiction-cliche',
    kind: 'slop',
    group: 'fiction',
    title: 'Stock fantasy and fiction phrase',
    fix: 'Replace it with a detail only this story has: a name, an object, a sound.',
    weight: 1,
    applies: ['narrative'],
    detect: ({ block }) => weightedHits(FICTION_CLICHES, block.text),
    examples: {
      hit: ['The air was thick with magic, and little did she know what waited.', 'The whispering trees watched her pass.'],
      miss: ['She walked into the woods.', 'The air smelled of wet iron.'],
    },
  },
  {
    id: 'fiction-stock-name',
    kind: 'slop',
    group: 'fiction',
    scope: 'doc',
    title: 'Stock fantasy name',
    fix: 'Keep the author\'s names. Report the name and offer a rename; never rename silently.',
    weight: 0.25,
    applies: ['narrative'],
    detect: ({ doc }) => {
      const seen = new Map();
      for (const block of proseBlocks(doc)) {
        for (const match of block.text.matchAll(STOCK_NAMES)) {
          const key = match[0].split(' ')[0];
          if (!seen.has(key)) seen.set(key, { line: block.locate(match.index), quote: match[0], text: match[0] });
        }
      }
      return [...seen.values()];
    },
    examples: {
      hit: ['Elara Voss walked into the Whispering Woods.'],
      miss: ['Ines Dray walked into the Salt Marsh.'],
    },
  },
];
