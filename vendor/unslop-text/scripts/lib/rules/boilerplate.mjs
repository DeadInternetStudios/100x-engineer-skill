import { weightedHits, proseBlocks } from './helpers.mjs';

const PEOPLE_TEXT = ['docs', 'article', 'message', 'marketing'];
const STRONG_WEIGHT = 1.5;
const QUOTE_LIMIT = 170;

function located(block, hit) {
  const span = block.spans.find((s) => hit.index >= s.start && hit.index < s.end) ?? block.spans[0];
  const text = span ? span.text : block.text;
  return {
    line: block.locate(hit.index),
    quote: text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT - 3)}…` : text,
    text: hit.text,
    weight: hit.weight,
  };
}

function clusteredHits(entries, doc) {
  const strong = [];
  const mild = [];
  for (const block of proseBlocks(doc)) {
    for (const hit of weightedHits(entries, block.text)) (hit.weight >= STRONG_WEIGHT ? strong : mild).push(located(block, hit));
  }
  return mild.length >= 2 ? [...strong, ...mild] : strong;
}

const COURTESY = [
  { re: /\bthank(?:s| you) (?:so|very) much for (?:reaching out|contacting (?:us|me)|getting in touch|your (?:email|message|inquiry|enquiry|interest|feedback|report))\b/gi, weight: 1 },
  { re: /\bthank(?:s| you) (?:again )?for your (?:patience|understanding|cooperation|support)(?: and (?:patience|understanding|cooperation|support))?\b/gi, weight: 1 },
  { re: /\bthank you for taking the time to (?:consider|review|read|reach out|share|write|contact|respond)\b/gi, weight: 1 },
  { re: /\b(?:(?:i|we)(?: (?:truly|sincerely|deeply|really|do))? )?apologi[sz]e for (?:any|the|this) (?:inconvenience|confusion|frustration|trouble|disruption)(?: (?:this|that|it) (?:may have|might have|has) caused| caused)?\b/gi, weight: 2 },
  { re: /\b(?:sorry|apologies) for (?:any|the) (?:inconvenience|frustration|trouble)\b/gi, weight: 1.5 },
  { re: /\bi (?:completely|totally|fully|truly|really|can certainly|can definitely) understand how (?:frustrating|disappointing|confusing|stressful|annoying|upsetting|difficult|inconvenient|worrying)\b/gi, weight: 2 },
  { re: /\bi (?:completely |totally |fully |truly |really )?understand (?:your|the) (?:frustration|concern|disappointment|confusion)s?\b/gi, weight: 1.5 },
  { re: /\bi can (?:only )?imagine how (?:frustrating|difficult|stressful|upsetting|disappointing)\b/gi, weight: 1.5 },
  { re: /\brest assured\b/gi, weight: 1.5 },
  { re: /\bi (?:want|would like|wanted) to (?:assure|reassure) you\b/gi, weight: 1.5 },
  { re: /\bwe take (?:this|your|the) (?:\w+ ){0,3}?(?:very |extremely |incredibly )?seriously\b/gi, weight: 1.5 },
  { re: /\bwe (?:truly |really |deeply |greatly |highly |sincerely )?(?:value|appreciate) your (?:business|feedback|patience|input|loyalty|support|understanding)\b/gi, weight: 1.5 },
  { re: /\b(?:we(?:['’]re| are)|i(?:['’]m| am)) (?:fully |always |deeply |truly |strongly )?committed to (?:providing|delivering|ensuring|offering)(?: you(?: with)?)? (?:the best|an? (?:seamless|great|world-class|positive|better|high-quality|excellent|exceptional|outstanding)|excellent|exceptional|high[- ]quality)\b/gi, weight: 2 },
  { re: /\byour (?:satisfaction|feedback|experience|privacy|security|success) (?:is|are) (?:our|of) (?:top|utmost|highest|paramount) (?:priority|importance)\b/gi, weight: 2 },
  { re: /\bthe best possible (?:experience|service|support|solution|outcome)\b/gi, weight: 1.5 },
  { re: /\b(?:if|should|in case) you (?:have|need|require) any (?:further|additional|other|more) (?:questions|concerns|queries|issues|assistance|help)(?: or (?:questions|concerns|comments|feedback))?\b/gi, weight: 1.5 },
  { re: /\bwe look forward to (?:hearing from you|serving you|assisting you|helping you|working with you|welcoming you)\b/gi, weight: 1 },
  { re: /\bi hope (?:this (?:email|message|note) finds you(?: well)?|you(?:['’]re| are) (?:doing|having) (?:well|a (?:great|wonderful|good)))\b/gi, weight: 1.5 },
  { re: /\bi (?:am|['’]m) writing to express\b/gi, weight: 1.5 },
  { re: /\bi (?:am|['’]m) writing to (?:inquire|enquire|follow up|let you know|inform you|reach out)\b/gi, weight: 0.75 },
  { re: /\bi wanted to (?:reach out|touch base|circle back)\b/gi, weight: 1 },
  { re: /\bi wanted to (?:provide|share|give) (?:you |everyone |the team )?(?:with )?(?:an? )?(?:quick |brief |short )?(?:update|overview|summary)\b/gi, weight: 1.25 },
  { re: /\bi(?:['’]m| am) (?:so |really |truly |very |incredibly )?excited to (?:share|announce|introduce|present)\b/gi, weight: 1.25 },
  { re: /\bthanks? (?:for|to) (?:all )?(?:your|everyone['’]s|the team['’]s) (?:hard work|dedication|efforts|support)(?: and (?:hard work|dedication|efforts|support))?\b/gi, weight: 1.25 },
  { re: /\b(?:it['’]s|is) truly appreciated\b/gi, weight: 1 },
  { re: /\bany questions or concerns\b/gi, weight: 1 },
  { re: /\bi(?:['’]m| am) (?:so |really |truly |very )?sorry to hear (?:that|about)\b/gi, weight: 0.75 },
  { re: /\b(?:that|this|it) (?:must|has to|can) be (?:really |so |very |incredibly |extremely )?(?:frustrating|disappointing|stressful|upsetting|confusing|annoying)\b/gi, weight: 1.5 },
  { re: /\bwe['’]re here to help\b/gi, weight: 1 },
];

const SELF_PROMOTION = [
  { re: /\b(?:proven|demonstrated|consistent|strong|solid|impressive|extensive) track record\b/gi, weight: 1.5 },
  { re: /\b(?:results|detail|goal|customer)[- ](?:driven|oriented|focused)\b/gi, weight: 1.25 },
  { re: /\b(?:strong|excellent|exceptional|outstanding|effective) (?:communicator|communication skills|interpersonal skills|work ethic|problem[- ]solving skills|leadership skills|organi[sz]ational skills|analytical skills)\b/gi, weight: 1.5 },
  { re: /\b(?:collaborative )?team player\b/gi, weight: 1.5 },
  { re: /\b(?:thrives?|thriving|excel(?:s)?|flourish(?:es)?) in (?:an? )?(?:fast[- ]paced|dynamic|high[- ]pressure|collaborative|ever[- ]changing)(?: and (?:fast[- ]paced|dynamic|collaborative))? (?:environments?|settings?|workplaces?|teams?)\b/gi, weight: 1.5 },
  { re: /\b(?:passion|passionate|enthusiasm) (?:for|about) (?:solving|driving|building|delivering|creating|innovation|technology|helping|making|learning)\b/gi, weight: 1.25 },
  { re: /\b(?:driving|driven|drive|create|creating|deliver(?:ing)?|make|making|have|having) an? (?:meaningful|lasting|positive|significant|tangible) impact\b/gi, weight: 1.5 },
  { re: /\bdriving (?:meaningful|lasting|positive|significant|tangible) impact\b/gi, weight: 1.5 },
  { re: /\b(?:valuable|strong|great|excellent) (?:addition|asset|fit) (?:to|for) (?:your|the|any) (?:team|organi[sz]ation|company)\b/gi, weight: 1.5 },
  { re: /\b(?:my|the) (?:skills|experience|background|qualifications|expertise)(?: and (?:skills|experience|background|qualifications|expertise))? (?:align|aligns|match|matches) (?:perfectly|well|closely|seamlessly) with\b/gi, weight: 1.5 },
  { re: /\bi am (?:confident|certain|sure) that (?:i|my)\b/gi, weight: 1 },
  { re: /\bmy (?:enthusiastic|keen|strong|sincere|genuine|deep) (?:interest|enthusiasm|excitement)\b/gi, weight: 2 },
  { re: /\beager to contribute (?:to|my)\b/gi, weight: 1 },
  { re: /\bcontinued success\b/gi, weight: 1 },
  { re: /\b(?:i (?:would|['’]d) (?:welcome|love|appreciate)|i look forward to|looking forward to) the (?:opportunity|chance) to\b/gi, weight: 1 },
  { re: /\b(?:make|making|made) an? (?:meaningful|valuable|significant|positive|lasting) contribution\b/gi, weight: 1.5 },
  { re: /\bbridge the gap (?:between|from)\b/gi, weight: 1 },
  { re: /\bcontribute to (?:your|the) (?:team|company|organi[sz]ation)['’]s (?:success|growth|mission|goals)\b/gi, weight: 1.25 },
  { re: /\bbring (?:my|our) (?:skills|experience|expertise|passion)(?: and (?:skills|experience|expertise|passion))? to\b/gi, weight: 1.25 },
  { re: /\b(?:commitment|dedication) to (?:innovation|excellence|quality|sustainability|customer (?:satisfaction|success))\b/gi, weight: 1.25 },
];

export const BOILERPLATE_RULES = [
  {
    id: 'courtesy-padding',
    kind: 'slop',
    group: 'boilerplate',
    scope: 'doc',
    title: 'Stock courtesy and service boilerplate',
    fix: 'Keep one thank-you and one specific apology at most. Say what happened and what you did. Cut the reassurance and the closer.',
    weight: 1.5,
    applies: PEOPLE_TEXT,
    detect: ({ doc }) => clusteredHits(COURTESY, doc),
    examples: {
      hit: [
        'Thank you so much for reaching out to us. We look forward to hearing from you.',
        'We sincerely apologize for any inconvenience this may have caused.',
        'I completely understand how frustrating this must be.',
        'Rest assured, we fixed it.',
        'If you have any further questions, reply to this email.',
        'We are committed to providing you with the best support.',
        'I hope this email finds you well.',
      ],
      miss: [
        'Thanks for the report.',
        'Sorry about the double charge. I refunded it today.',
        'We refunded the duplicate charge on March 3.',
        'Contact support at help@example.com.',
        'I apologize for the delay.',
        'Thanks for your patience.',
      ],
    },
  },
  {
    id: 'self-promotion',
    kind: 'slop',
    group: 'boilerplate',
    scope: 'doc',
    title: 'Stock self-description',
    fix: 'Say what you did, with the number and the name. Cut the trait.',
    weight: 1.5,
    applies: PEOPLE_TEXT,
    detect: ({ doc }) => clusteredHits(SELF_PROMOTION, doc),
    examples: {
      hit: [
        'I have a proven track record of delivering results.',
        'I am a strong communicator and a team player who thrives in fast-paced environments.',
        'I would be a valuable addition to your team.',
        'My skills and experience align perfectly with this role.',
        'I am writing to express my enthusiastic interest in the role.',
      ],
      miss: [
        'I led five engineers through the payments migration.',
        'Latency fell 40% after the move.',
        'The track record page lists every release.',
        'She plays on a team in the city league.',
        'We ship results-driven dashboards.',
      ],
    },
  },
];
