import { maskPlaceholders, cleanInline } from './blocks.mjs';
import { placeholdersOf } from './facts.mjs';

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'if', 'in', 'into', 'nor', 'of', 'on', 'onto', 'or', 'per', 'the', 'to', 'up', 'via', 'vs', 'with']);

const UNITS = new Set(['kg', 'g', 'mg', 'lb', 'lbs', 'oz', 'km', 'm', 'cm', 'mm', 'mi', 'ft', 'in', 's', 'ms', 'min', 'h', 'hr', 'kb', 'mb', 'gb', 'tb', 'px', 'pt', 'fps', 'hz', 'xp', 'hp', 'mp']);

const FAMILIES = [
  { name: 'leave the app', variants: ['quit', 'exit', 'leave'] },
  { name: 'settings', variants: ['settings', 'options', 'preferences', 'configuration'] },
  { name: 'remove', variants: ['delete', 'remove', 'erase', 'discard'] },
  { name: 'dismiss', variants: ['cancel', 'dismiss', 'abort', 'never mind'] },
  { name: 'confirm', variants: ['ok', 'okay', 'confirm', 'accept', 'got it'] },
  { name: 'go back', variants: ['back', 'return', 'previous'] },
  { name: 'go on', variants: ['next', 'continue', 'proceed'] },
  { name: 'try again', variants: ['retry', 'try again', 'reload'] },
  { name: 'sign in', variants: ['log in', 'login', 'sign in', 'log on'] },
  { name: 'sign out', variants: ['log out', 'logout', 'sign out'] },
  { name: 'person', variants: ['player', 'user', 'gamer'] },
  { name: 'input verb', variants: ['click', 'tap', 'press', 'hit'] },
  { name: 'email', variants: ['email', 'e-mail'] },
  { name: 'turn on', variants: ['enable', 'turn on', 'activate', 'switch on'] },
  { name: 'turn off', variants: ['disable', 'turn off', 'deactivate', 'switch off'] },
  { name: 'user name', variants: ['username', 'user name', 'nickname', 'display name'] },
  { name: 'problem', variants: ['error', 'failed', 'problem', 'oops', 'whoops', 'uh-oh', 'something went wrong'] },
];

const FAMILY_PATTERNS = FAMILIES.map((family) => ({
  ...family,
  patterns: family.variants.map((variant) => ({
    variant,
    re: new RegExp(`(?<![\\p{L}\\p{N}-])${variant.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&').replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}-])`, 'giu'),
  })),
}));

const EXAMPLE_LIMIT = 5;
const COLOR_MARKUP = /\[(?:\/?[a-z][\w-]*(?:[= ][^\]\n]*)?|#[0-9A-Fa-f]{3,8})?\]/g;

function prepare(entry) {
  const text = cleanInline(maskPlaceholders(entry.value, { icu: false })).replace(COLOR_MARKUP, '').replace(/\s+/g, ' ').trim();
  const words = text.split(' ').filter(Boolean);
  const label = words.length <= 1 || (words.length <= 4 && !/[.?!]$/.test(text) && !/[.!?]\s+\S/.test(text));
  return { ...entry, text, words, label };
}

function capitalization(all) {
  const outside = all.join(' ').replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean);
  const words = outside.length ? outside : all;
  const letters = words.join(' ').replace(/[^\p{L}]/gu, '');
  if (!letters) return null;
  if (/^\p{Ll}/u.test(words[0])) return 'lowercase';
  if (letters.length >= 2 && letters === letters.toUpperCase() && words.join(' ').length > 3) return 'uppercase';
  if (words.length === 1) return 'single';
  const rest = words.slice(1).filter((w) => /\p{L}/u.test(w) && !/^[X\W\d_]+$/.test(w) && !SMALL_WORDS.has(w.toLowerCase()) && !UNITS.has(w.toLowerCase().replace(/(?<!\W)\W+$/, '')) && !/^[A-Z0-9]{2,}\W*$/.test(w));
  const capitals = rest.filter((w) => /^\p{Lu}/u.test(w)).length;
  if (rest.length === 0) return 'single';
  if (capitals === 0) return 'sentence';
  return capitals === rest.length ? 'title' : 'mixed';
}

function ending(text) {
  if (/…$/.test(text) || /\.\.\.$/.test(text)) return 'ellipsis';
  if (/\.$/.test(text)) return 'period';
  if (/!$/.test(text)) return 'exclamation';
  if (/\?$/.test(text)) return 'question';
  if (/:$/.test(text)) return 'colon';
  return 'none';
}

function tally(items, pick) {
  const counts = {};
  for (const item of items) {
    const value = pick(item);
    if (value) counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

const uniqueByKey = (items) => items.filter((item, i) => items.findIndex((other) => other.key === item.key) === i);
const sample = (items) => items.slice(0, EXAMPLE_LIMIT).map(({ key, value }) => ({ key, value }));

function minority(entries, classify) {
  const groups = new Map();
  for (const entry of entries) {
    const kind = classify(entry);
    if (!kind) continue;
    groups.set(kind, [...(groups.get(kind) ?? []), entry]);
  }
  if (groups.size < 2) return null;
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const [top, ...rest] = ordered;
  return { majority: top[0], counts: Object.fromEntries(ordered.map(([k, v]) => [k, v.length])), minority: rest.flatMap(([, list]) => list) };
}

function terminologyFindings(entries) {
  const findings = [];
  for (const family of FAMILY_PATTERNS) {
    const used = [];
    for (const { variant, re } of family.patterns) {
      const hits = entries.filter((entry) => {
        re.lastIndex = 0;
        return re.test(entry.text);
      });
      if (hits.length) used.push({ variant, count: hits.length, hits });
    }
    if (used.length < 2 || new Set(used.flatMap((u) => u.hits)).size < 2) continue;
    findings.push({
      id: 'terminology',
      title: `Mixed words for "${family.name}": ${used.map((u) => `${u.variant} ×${u.count}`).join(', ')}`,
      advice: 'Pick one word for this action and use it everywhere. Check that the others are not different concepts.',
      examples: uniqueByKey(used.flatMap((u) => sample(u.hits).slice(0, 2))),
    });
  }
  return findings;
}

function placeholderStyle(token) {
  if (/^\{\{/.test(token)) return 'double braces {{x}}';
  if (/^\$\{/.test(token)) return 'dollar braces ${x}';
  if (/^\{\d+\}$/.test(token)) return 'numbered {0}';
  if (/^\{/.test(token)) return 'named {x}';
  if (/^__/.test(token)) return 'double underscores __x__';
  if (/^%[A-Za-z_]\w*%$/.test(token)) return 'percent pairs %x%';
  if (/^%\d{1,2}(?:![^!]+!)?$/.test(token)) return 'numbered %1';
  if (/^%/.test(token)) return 'printf %s %d';
  if (/^\$[A-Z][A-Z0-9_]*\$$/.test(token)) return 'dollar pairs $X$';
  if (/^\\[VNPvnpGg]/.test(token)) return 'RPG Maker codes \\V[1]';
  if (/^\$t\(/.test(token)) return 'nesting $t(key)';
  return null;
}

export function auditEntries(entries, { prose = false } = {}) {
  const prepared = entries.map(prepare).filter((entry) => entry.words.length);
  const findings = [];
  const labels = prepared.filter((entry) => entry.label);
  const messages = prepared.filter((entry) => !entry.label);
  const report = { strings: prepared.length, prose, findings };

  if (!prose) {
    const phraseCase = (e) => {
      const kind = capitalization(e.words);
      return kind === 'single' ? null : kind;
    };
    const labelCase = minority(labels.filter((e) => e.words.length >= 2 || /^\p{Ll}/u.test(e.words[0])), phraseCase);
    const labelCaseAll = tally(labels, (e) => capitalization(e.words));
    report.labels = { count: labels.length, capitalization: labelCaseAll, endings: tally(labels, (e) => ending(e.text)) };
    report.messages = { count: messages.length, endings: tally(messages, (e) => ending(e.text)) };

    if (labelCase) {
      findings.push({
        id: 'label-case',
        title: `Labels mix capitalization: ${Object.entries(labelCase.counts).map(([k, v]) => `${k} ×${v}`).join(', ')}`,
        advice: `Unify the labels. ${labelCase.majority} is the most common style here, so move the others to it unless the product has a written rule.`,
        examples: sample(labelCase.minority),
      });
    }

    const labelEnd = minority(labels.filter((e) => ['none', 'period'].includes(ending(e.text))), (e) => ending(e.text));
    if (labelEnd) {
      findings.push({
        id: 'label-punctuation',
        title: `Labels disagree on a final period: ${Object.entries(labelEnd.counts).map(([k, v]) => `${k} ×${v}`).join(', ')}`,
        advice: 'Labels and buttons take no final period.',
        examples: sample(labelEnd.minority),
      });
    }

    const messageEnd = minority(messages.filter((e) => ['none', 'period'].includes(ending(e.text)) && e.words.length >= 3), (e) => ending(e.text));
    if (messageEnd) {
      findings.push({
        id: 'message-punctuation',
        title: `Messages disagree on a final period: ${Object.entries(messageEnd.counts).map(([k, v]) => `${k} ×${v}`).join(', ')}`,
        advice: 'Pick one rule for full-sentence messages. A period on every full sentence is the safe choice.',
        examples: sample(messageEnd.minority),
      });
    }

    const lowerStarts = messages.filter((e) => /^\p{Ll}/u.test(e.words[0]) && !/^[a-z]+[A-Z]/.test(e.words[0]));
    if (lowerStarts.length) {
      findings.push({ id: 'starts-lowercase', title: `${lowerStarts.length} messages start with a lowercase letter`, advice: 'Start sentences with a capital unless it is a deliberate style.', examples: sample(lowerStarts) });
    }

    const shouting = messages.filter((e) => ending(e.text) === 'exclamation');
    if (shouting.length >= 3 && shouting.length / Math.max(messages.length, 1) > 0.25) {
      findings.push({ id: 'exclamations', title: `${shouting.length} of ${messages.length} messages end in "!"`, advice: 'Keep "!" for real celebration. Errors and neutral status never take one.', examples: sample(shouting) });
    }

    const polite = messages.filter((e) => /\bplease\b/i.test(e.text));
    if (polite.length >= 3 && polite.length / Math.max(messages.length, 1) > 0.2) {
      findings.push({ id: 'please', title: `${polite.length} of ${messages.length} messages contain "please"`, advice: 'Use "please" only where you ask for a real effort or apologize for a delay.', examples: sample(polite) });
    }

    const overlong = prepared.filter((e) => (e.label && e.text.length > 30) || e.text.length > 160);
    if (overlong.length) {
      findings.push({ id: 'length', title: `${overlong.length} strings are long for their role (label over 30 characters, or message over 160)`, advice: 'Check the layout. Shorten labels first.', examples: sample(overlong.sort((a, b) => b.text.length - a.text.length)) });
    }

    const groups = new Map();
    for (const entry of prepared) {
      const normal = entry.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      if (normal) groups.set(normal, [...(groups.get(normal) ?? []), entry]);
    }
    const near = [...groups.values()].filter((list) => new Set(list.map((e) => e.text)).size > 1);
    if (near.length) {
      findings.push({
        id: 'near-duplicates',
        title: `${near.length} strings appear in several spellings`,
        advice: 'Use one spelling for the same text. Keep the keys: they may mean different places.',
        examples: near.slice(0, EXAMPLE_LIMIT).flatMap((list) => sample(list).slice(0, 3)),
      });
    }
  }

  const ellipsisDots = prepared.filter((e) => /\.\.\./.test(e.text));
  const ellipsisChar = prepared.filter((e) => /…/.test(e.text));
  if (ellipsisDots.length && ellipsisChar.length) {
    findings.push({ id: 'ellipsis-style', title: `Two ellipsis styles: "..." ×${ellipsisDots.length}, "…" ×${ellipsisChar.length}`, advice: 'Use one. The single character "…" is the typographic choice.', examples: sample(ellipsisDots.length <= ellipsisChar.length ? ellipsisDots : ellipsisChar) });
  }

  const straight = prepared.filter((e) => /\w'\w/.test(e.text));
  const curly = prepared.filter((e) => /\w’\w/.test(e.text));
  if (straight.length && curly.length) {
    findings.push({ id: 'apostrophe-style', title: `Two apostrophe styles: straight ×${straight.length}, curly ×${curly.length}`, advice: 'Use one style everywhere.', examples: sample(straight.length <= curly.length ? straight : curly) });
  }

  const styles = new Map();
  for (const entry of entries) {
    for (const token of placeholdersOf(entry.value, { strings: true })) {
      const style = placeholderStyle(token);
      if (style) styles.set(style, [...(styles.get(style) ?? []), entry]);
    }
  }
  if (styles.size > 1) {
    const ranked = [...styles.entries()].sort((a, b) => b[1].length - a[1].length);
    findings.push({ id: 'placeholder-style', title: `Mixed placeholder styles: ${ranked.map(([k, v]) => `${k} ×${v.length}`).join(', ')}`, advice: 'This may be a code constraint. Report it. Do not change placeholders.', examples: uniqueByKey(sample(ranked.slice(1).flatMap(([, list]) => list))) });
  }

  findings.push(...terminologyFindings(prepared));

  if (!prose) {
    const we = prepared.filter((e) => /\b(?:we|our|us|we're|we've)\b/i.test(e.text)).length;
    const you = prepared.filter((e) => /\b(?:you|your|you're|you've)\b/i.test(e.text)).length;
    report.voice = { you, we };
    if (we >= 3 && you >= 3) {
      findings.push({ id: 'voice', title: `Voice mixes "we" (${we} strings) and "you" (${you} strings)`, advice: 'Choose who speaks. Product voice is usually "you" for the reader and no "we" except for support contact lines.', examples: sample(prepared.filter((e) => /\bwe\b|\bour\b/i.test(e.text))) });
    }
  }

  return report;
}
