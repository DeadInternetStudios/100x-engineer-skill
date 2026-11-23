const entry = (pattern, skip = []) => ({ pattern, skip });

const AI_VOCAB = {
  strong: [
    entry('delv(?:e|es|ed|ing)(?= (?:into|deeper|deep|further|in)\\b)'),
    entry('tapestr(?:y|ies)'),
    entry('testament'),
    entry('pivotal'),
    entry('intricac(?:y|ies)'),
    entry('intricate(?:ly)?'),
    entry('meticulous(?:ly)?'),
    entry('multifaceted'),
    entry('underscor(?:e|es|ed|ing)(?= (?:the|its|their|his|her|how|that|a|an|our|your|this|these|those|just|not|both|each|every|all|what|why|importance|need|significance|value)\\b)'),
    entry('showcas(?:e|es|ed|ing)'),
    entry('vibrant'),
    entry('bustling'),
    entry('nestled'),
    entry('groundbreaking'),
    entry('renowned'),
    entry('seamless(?:ly)?'),
    entry('plethora'),
    entry('myriad'),
    entry('beacon'),
    entry('cornerstone'),
    entry('paramount'),
    entry('game[- ]chang(?:er|ers|ing)'),
    entry('unleash(?:es|ed|ing)?(?= (?:the|your|its|their|our|a|an|new|full|more|true|every|all|his|her|this|these|those|hidden|creativity|potential|power)\\b)'),
    entry('supercharg(?:e|es|ed|ing)'),
    entry('revolutioniz(?:e|es|ed|ing)'),
    entry('empower(?:s|ed|ing|ment)?'),
    entry('treasure trove'),
    entry('ever[- ](?:evolving|changing|shifting)'),
  ],
  medium: [
    entry('robust(?:ness)?'),
    entry('cutting[- ]edge'),
    entry('state[- ]of[- ]the[- ]art'),
    entry('best[- ]in[- ]class'),
    entry('world[- ]class'),
    entry('holistic(?:ally)?'),
    entry('synerg(?:y|ies)'),
    entry('transformative'),
    entry('indispensable'),
    entry('unwavering'),
    entry('deep[- ]dive'),
    entry('additionally'),
    entry('moreover'),
    entry('furthermore'),
    entry('crucial(?:ly)?'),
    entry('enhanc(?:e|es|ed|ing|ement|ements)'),
    entry('leverag(?:e|es|ed|ing)'),
    entry('utili[sz](?:e|es|ed|ing|ation)'),
    entry('comprehensive(?:ly)?'),
    entry('streamlin(?:e|es|ed|ing)'),
    entry('landscape(?! (?:mode|orientation|layout|format|view|photo\\w*|paint\\w*|architect\\w*|design\\w*))'),
    entry('realm', ['narrative', 'ui']),
    entry('enduring'),
    entry('interplay'),
    entry('bolster(?:s|ed|ing)?'),
    entry('garner(?:s|ed|ing)?'),
    entry('align(?:s|ed|ing)? with'),
    entry('emphasi[sz](?:e|es|ed|ing)'),
    entry('valuable'),
    entry('notabl(?:y|e)'),
    entry('ultimately'),
    entry('foster(?:s|ed|ing)?(?! (?:care|child|children|home|homes|parent|parents|family|mother|father|kid|kids|carer|carers)\\b)'),
    entry('(?<!\\b(?:test|safety|wiring|climbing|dog|horse|cable|seat|parachute) )harness(?:es|ed|ing)?'),
    entry('prioriti[sz](?:e|es|ed|ing)'),
    entry('unlock(?:s|ed|ing)? (?:the |your |its |their |new |full |hidden )?(?:potential|power|value|insights?|possibilities|opportunit\\w+|secrets?|growth|creativity|success|benefits|capabilit\\w+)', ['ui', 'narrative']),
    entry('elevat(?:e|es|ed|ing) (?:your|the|our|their|its|his|her) (?:\\w+ )?(?:experience|game|brand|workflow|productivity|content|business|skills?|performance|presence|strategy|understanding|standards?|quality|efforts?|work)', ['narrative']),
    entry('navigat(?:e|es|ed|ing) (?:the |this |these |those |your |through )?(?:complex\\w*|challeng\\w*|landscape|world|waters|maze|nuances?|intricac\\w+|ever|changing|uncertain\\w*|difficult\\w*|journey|terrain|labyrinth)', ['ui']),
  ],
  soft: [
    entry('practical'),
    entry('steady'),
    entry('clearer'),
    entry('dependable'),
    entry('quietly'),
    entry('universally'),
    entry('echoed'),
    entry('rich', ['ui']),
    entry('diverse'),
    entry('profound'),
    entry('significant(?:ly)?'),
    entry('key (?:role|factor|insights?|aspects?|components?|takeaways?|considerations?|elements?)'),
  ],
};

export function compileVocab(profile) {
  const compiled = [];
  for (const [tier, entries] of Object.entries(AI_VOCAB)) {
    for (const { pattern, skip } of entries) {
      if (skip.includes(profile)) continue;
      compiled.push({ tier, re: new RegExp(`\\b${pattern}\\b`, 'gi') });
    }
  }
  return compiled;
}

// A capital letter in the middle of a sentence marks a name: the Pivotal Tracker board, a Beacon app.
function isNameUse(text, index) {
  if (!/^\p{Lu}/u.test(text.slice(index, index + 1))) return false;
  return /[\p{Ll}\p{N},]$/u.test(text.slice(Math.max(0, index - 40), index).trimEnd());
}

export function findVocab(text, compiled) {
  const found = [];
  for (const { tier, re } of compiled) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      if (isNameUse(text, match.index)) continue;
      found.push({ tier, index: match.index, length: match[0].length, word: match[0].toLowerCase() });
    }
  }
  found.sort((a, b) => a.index - b.index || b.length - a.length);
  const kept = [];
  let end = -1;
  for (const item of found) {
    if (item.index < end) continue;
    kept.push(item);
    end = item.index + item.length;
  }
  return kept;
}

export const PLAIN_WORDS = {
  utilize: 'use',
  utilise: 'use',
  utilizes: 'uses',
  utilizing: 'using',
  utilization: 'use',
  leverage: 'use',
  leverages: 'uses',
  leveraging: 'using',
  commence: 'start',
  commences: 'starts',
  initiate: 'start',
  initiates: 'starts',
  terminate: 'end',
  terminates: 'ends',
  endeavor: 'try',
  endeavour: 'try',
  facilitate: 'help',
  facilitates: 'helps',
  demonstrate: 'show',
  demonstrates: 'shows',
  subsequently: 'then',
  numerous: 'many',
  assist: 'help',
  assists: 'helps',
  obtain: 'get',
  obtains: 'gets',
  ascertain: 'find out',
  necessitate: 'need',
  necessitates: 'needs',
  whilst: 'while',
  amongst: 'among',
  optimal: 'best',
  regarding: 'about',
  'prior to': 'before',
  'subsequent to': 'after',
  'in conjunction with': 'with',
  'in the event that': 'if',
  'with regard to': 'about',
  'with respect to': 'about',
  'in regard to': 'about',
  'pertaining to': 'about',
  'the majority of': 'most',
  'in close proximity to': 'near',
  'in the vicinity of': 'near',
};

export const WORDY_PHRASES = [
  ['in order to', 'to'],
  ['so as to', 'to'],
  ['due to the fact that', 'because'],
  ['owing to the fact that', 'because'],
  ['in spite of the fact that', 'although'],
  ['despite the fact that', 'although'],
  ['at this point in time', 'now'],
  ['at the present time', 'now'],
  ['at the present moment', 'now'],
  ['in the near future', 'soon'],
  ['until such time as', 'until'],
  ['has the ability to', 'can'],
  ['have the ability to', 'can'],
  ['is able to', 'can'],
  ['are able to', 'can'],
  ['is capable of', 'can'],
  ['for the purpose of', 'for, to'],
  ['on a (?:daily|weekly|monthly|yearly|regular|consistent|continual|continuous) basis', 'daily, weekly, often, regularly'],
  ['whether or not', 'whether'],
  ['as a result of', 'because of'],
  ['with the exception of', 'except'],
  ['each and every', 'each'],
  ['first and foremost', 'first'],
  ['at all times', 'always'],
  ['a wide (?:range|variety|array) of', 'many'],
  ['a (?:large|great|significant) number of', 'many'],
  ['take(?:s|n)? into (?:consideration|account)', 'consider'],
  ['make(?:s)? use of', 'use'],
  ['give(?:s)? consideration to', 'consider'],
  ['come(?:s)? to the conclusion', 'conclude'],
  ['it is (?:important|worth|essential|crucial) to (?:note|mention|remember|understand|recognize) that', '(delete)'],
  ['it should be noted that', '(delete)'],
  ['it (?:goes|went) without saying that', '(delete)'],
  ['needless to say', '(delete)'],
  ['at the end of the day', '(delete)'],
  ['(?:going|moving) forward', '(delete)'],
  ['when it comes to', 'for, with, about'],
  ['in terms of', '(rephrase)'],
  ['the fact that', '(rephrase)'],
];

export const NOMINALIZATIONS = {
  decision: 'decide',
  analysis: 'analyze',
  attempt: 'try',
  assessment: 'assess',
  evaluation: 'evaluate',
  investigation: 'investigate',
  determination: 'determine',
  improvement: 'improve',
  adjustment: 'adjust',
  modification: 'change',
  selection: 'select',
  comparison: 'compare',
  contribution: 'contribute',
  consideration: 'consider',
  discussion: 'discuss',
  examination: 'examine',
  revision: 'revise',
  implementation: 'implement',
  explanation: 'explain',
  recommendation: 'recommend',
  conclusion: 'conclude',
  distinction: 'distinguish',
};

export const IDIOMS = [
  'low[- ]hanging fruit',
  'move the needle',
  'circle back',
  'touch base',
  'think outside the box',
  'hit the ground running',
  'boil the ocean',
  'paradigm shift',
  'win[- ]win',
  'on the same page',
  'tip of the iceberg',
  'silver bullet',
  'piece of cake',
  'ballpark (?:figure|estimate)',
  'drink from the firehose',
  'take it offline',
  'bring to the table',
  'reach out to',
  'loop in',
];
