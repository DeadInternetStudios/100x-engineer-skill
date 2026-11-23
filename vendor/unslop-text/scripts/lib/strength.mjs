// Words that decide what a rule says without being a number, a name or a negation. "Managers must approve
// refunds. Interns may approve refunds." became "Managers may approve ... Interns must approve ...": every
// word is still there, and so is the one "may", so a count over the whole text sees nothing. Read sentence by
// sentence, the permission changed hands. The same holds for words that mean the opposite of each other:
// "If the payment fails, do not retry" became "If the payment succeeds, do not retry".

import { codeSpans } from './markdown.mjs';

const URL_RE = /https?:\/\/[^\s)\]>"'|]+/g;
const WORD = /[\p{L}\p{N}]+(?:['’]\p{L}+)?/gu;

// How strongly a rule binds, from the strongest to the weakest. The negated forms come first so "must not"
// is read as one thing, and "cannot" and "can't" stand with them. A word in one class may change to another
// word of the same class, and "may" and "can" are one class, as plain English uses them.
const CLASSES = [
  ['forbidden', String.raw`\b(?:must|shall|may)\s+not\b|\bmustn['’]t\b|\bshan['’]t\b|\b(?:is|are)\s+not\s+(?:allowed|permitted)\s+to\b|\bcannot\b|\bcan\s+not\b|\bcan['’]t\b`],
  ['discouraged', String.raw`\bshould\s+not\b|\bshouldn['’]t\b|\bought\s+not\s+to\b`],
  ['required', String.raw`\bmust\b|\bshall\b|\b(?:have|has|had)\s+to\b|\bneeds?\s+to\b|\brequired\s+to\b`],
  ['recommended', String.raw`\bshould\b|\bought\s+to\b|\bhad\s+better\b`],
  ['permitted', String.raw`\bmay\b|\bcan\b|\b(?:allowed|permitted)\s+to\b`],
];
const MODAL = new RegExp(CLASSES.map(([name, source]) => `(?<${name}>${source})`).join('|'), 'gi');

// Pairs of words that say opposite things. Each side lists its forms, so "fail" and "failed" are one word.
// A negated word stands on the other side: "does not succeed" says what "fails" says.
const OPPOSITES = [
  ['fail fails failed failing failure failures unsuccessful unsuccessfully', 'succeed succeeds succeeded succeeding success successes successful successfully'],
  ['enable enables enabled enabling allow allows allowed allowing permit permits permitted accept accepts accepted accepting approve approves approved approving turnon', 'disable disables disabled disabling disallow disallows disallowed forbid forbids forbidden prohibit prohibits prohibited deny denies denied reject rejects rejected rejecting refuse refuses refused blocked turnoff'],
  ['increase increases increased increasing raise raises raised raising grow grows grew growing rise rises rose', 'decrease decreases decreased decreasing reduce reduces reduced reducing lowers lowered shrink shrinks shrank fall falls fell'],
  ['above over exceed exceeds exceeded more greater higher larger bigger longer atleast minimum', 'below under fewer less lower smaller shorter atmost maximum'],
  ['before prior earlier', 'after later'],
  ['start starts started begin begins began', 'stop stops stopped halt halts halted'],
  ['open opens opened opening', 'close closes closed closing'],
  ['add adds added adding insert inserts inserted include includes included including', 'remove removes removed removing delete deletes deleted deleting exclude excludes excluded excluding'],
  ['show shows showed shown display displays displayed reveal reveals revealed', 'hide hides hid hidden conceal conceals concealed'],
  ['true', 'false'],
  ['required mandatory', 'optional'],
  ['valid', 'invalid'],
  ['available', 'unavailable'],
  ['supported', 'unsupported'],
  ['secure', 'insecure'],
  ['safe', 'unsafe'],
  ['active', 'inactive'],
  ['possible', 'impossible'],
  ['public', 'private'],
  ['visible', 'invisible'],
  ['lock locks locked', 'unlock unlocks unlocked'],
  ['encrypt encrypts encrypted', 'decrypt decrypts decrypted'],
  ['upload uploads uploaded', 'download downloads downloaded'],
  ['import imports imported', 'export exports exported'],
  ['send sends sent', 'receive receives received'],
  ['buy buys bought', 'sell sells sold'],
  ['push pushes pushed', 'pull pulls pulled'],
  ['win wins won', 'lose loses lost'],
  ['incoming inbound', 'outgoing outbound'],
  ['inside', 'outside'],
  ['internal', 'external'],
  ['local', 'remote'],
  ['same', 'different'],
  ['faster quicker', 'slower'],
];

const SIDES = new Map();
OPPOSITES.forEach(([first, second], pair) => {
  for (const word of first.split(' ')) SIDES.set(word, [pair, 0]);
  for (const word of second.split(' ')) SIDES.set(word, [pair, 1]);
});

const PHRASES = [
  [/\bat\s+least\b/gi, 'atleast'],
  [/\bat\s+most\b/gi, 'atmost'],
  [/\b(?:turn|turns|turned|turning|switch|switches|switched|switching)\s+on\b/gi, 'turnon'],
  [/\b(?:turn|turns|turned|turning|switch|switches|switched|switching)\s+off\b/gi, 'turnoff'],
];
const NEGATOR = /^(?:not|no|never|cannot|neither|nor|unable)$|n['’]t$/;
// How far back a negator reaches: "does not succeed", "is not always valid". "Without" reaches one word, as in "without success".
const NEGATION_REACH = 2;

function plainOf(text) {
  return PHRASES.reduce((rest, [pattern, word]) => rest.replace(pattern, word), text.replace(URL_RE, ' ').replace(codeSpans(), ' '));
}

// The modals a sentence uses, in order, each with the class that says how strongly it binds.
function modalsOf(text) {
  const plain = plainOf(text);
  return [...plain.matchAll(MODAL)]
    .filter((match) => !isMonth(plain, match))
    .map((match) => ({ name: Object.keys(match.groups).find((key) => match.groups[key] !== undefined), word: match[0].toLowerCase().replace(/\s+/g, ' ') }));
}

// "In May we ship" and "May 3" name a month. A capital "May" is read as the modal only where nothing says so.
function isMonth(text, match) {
  if (match[0] !== 'May') return false;
  // Only the words next to it matter, so a long text is not read again for every "May" in it.
  const after = text.slice(match.index + 3, match.index + 8);
  const before = text.slice(Math.max(0, match.index - 16), match.index);
  return /^\s+\d/.test(after) || /\b(?:in|on|of|since|until|by|from|during|last|next|early|late|mid|through|every)\s+$/i.test(before);
}

// The opposite-word pairs a sentence uses, each with the side it stands on and the word that put it there.
function oppositesOf(text) {
  const words = (plainOf(text).toLowerCase().match(WORD) ?? []);
  const found = [];
  words.forEach((word, k) => {
    const place = SIDES.get(word);
    if (!place) return;
    const negated = words.slice(Math.max(0, k - NEGATION_REACH), k).some((before) => NEGATOR.test(before)) || words[k - 1] === 'without';
    found.push({ pair: place[0], side: negated ? 1 - place[1] : place[1], word: negated ? `not ${word}` : word });
  });
  return found;
}

export function ruleWordsOf(text) {
  return { modals: modalsOf(text), opposites: oppositesOf(text) };
}

const quoted = (words) => [...new Set(words)].slice(0, 4).map((word) => `"${word}"`).join(', ');

// A modal that left and another that arrived, in one sentence or in the sentences that joined or split into it.
// "Must" for "need to" is the same class and says nothing; "must" for "may" is not.
function modalChange(had, has) {
  const room = new Map();
  for (const modal of had) {
    if (room.has(modal.name)) room.get(modal.name).push(modal);
    else room.set(modal.name, [modal]);
  }
  const arrived = [];
  for (const modal of has) {
    const same = room.get(modal.name);
    if (same?.length) same.pop();
    else arrived.push(modal);
  }
  const left = [...room.values()].flat();
  return left.length && arrived.length ? { was: quoted(left.map((modal) => modal.word)), now: quoted(arrived.map((modal) => modal.word)) } : null;
}

// A word that stood alone on one side of a pair, and the other side has taken its place.
function oppositeChanges(had, has) {
  const alone = (words, pair) => {
    const sides = new Set(words.filter((word) => word.pair === pair).map((word) => word.side));
    return sides.size === 1 ? [...sides][0] : null;
  };
  const changes = [];
  for (const pair of new Set(had.map((word) => word.pair))) {
    const was = alone(had, pair);
    if (was === null) continue;
    // The other side arrived while a word of the old side left. "Fails" for "succeeds" does it, and so does "add"
    // for "remove" in a sentence that also says "adding".
    const arrived = has.find((word) => word.pair === pair && word.side !== was);
    const left = had.filter((word) => word.pair === pair).length > has.filter((word) => word.pair === pair && word.side === was).length;
    if (!arrived || !left) continue;
    changes.push({ was: had.find((word) => word.pair === pair).word, now: arrived.word });
  }
  return changes;
}

// Warns once for a group whose modal changed class, and once for the pairs of words that now say the opposite.
// `where` names the sentence the group came from.
export function ruleChanges(had, has, c, where) {
  const modals = modalChange(had.modals, has.modals);
  if (modals) c.warn('modal-changed', `how strongly a rule binds changed: ${where} says ${modals.was}, and its rewrite says ${modals.now}. "must" requires, "should" recommends and "may" permits, so the rule may now bind someone else or bind less`);
  const opposites = oppositeChanges(had.opposites, has.opposites);
  if (opposites.length) {
    c.warn('opposite-word', `a word now says the opposite: ${where} uses ${quoted(opposites.map((change) => change.was))}, and its rewrite uses ${quoted(opposites.map((change) => change.now))}. Check that the rewrite still means what the original means`);
  }
}

// One sentence kept almost word for word whose modals trade places: "Managers must ... interns may ..." became
// "Managers may ... interns must ...". The classes are all still there, so only their order tells.
export function swappedModals(was, now) {
  if (was.length < 2 || was.length !== now.length) return null;
  const order = (modals) => modals.map((modal) => modal.name);
  const same = order(was).every((name, k) => name === order(now)[k]);
  const sameSet = [...order(was)].sort().join(' ') === [...order(now)].sort().join(' ');
  return !same && sameSet ? { was: quoted(was.map((modal) => modal.word)), now: quoted(now.map((modal) => modal.word)) } : null;
}
