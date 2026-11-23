// The one place that decides what opens and closes a fenced code block in Markdown.

const START = /^([ \t]*)(`{3,}(?=[^`]*$)|~{3,})/;
const END = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/;

export const QUOTE_PREFIX = /^ {0,3}(?:>[ \t]?)+/;

export const indentWidth = (line) => /^[ \t]*/.exec(line)[0].replace(/\t/g, '    ').length;

export function unquote(line) {
  const prefix = QUOTE_PREFIX.exec(line);
  return prefix ? { quoted: true, rest: line.slice(prefix[0].length) } : { quoted: false, rest: line };
}

// Outside a list a fence may be indented by up to 3 spaces. Under a list item it may sit up to 3 spaces
// past the item's text, which makes 4 spaces or more in all, so `listIndent` is the column of that
// text. A caller that does not follow list items passes Infinity and takes any indent.
export function fenceOpener(line, { listIndent } = {}) {
  const { quoted, rest } = unquote(line);
  const match = START.exec(rest);
  if (!match) return null;
  const loose = listIndent !== undefined && !quoted;
  if (indentWidth(match[1]) > (loose ? listIndent + 3 : 3)) return null;
  return { char: match[2][0], length: match[2].length, quoted, loose };
}

export function closesFence(line, fence) {
  const match = END.exec(fence.quoted ? unquote(line).rest : line);
  return Boolean(match) && match[2][0] === fence.char && match[2].length >= fence.length && (fence.loose || indentWidth(match[1]) <= 3);
}
