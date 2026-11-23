const IMAGE = /!\[([^\[\]]*)\]\([^)\[\]]*\)/g;
const LINK = /\[([^\[\]]+)\]\([^)\[\]]*\)/g;
const REFERENCE_LINK = /\[([^\[\]]+)\]\[[^\[\]]*\]/g;

// An inline code span: a run of backticks, or one backtick pair that may cross the soft line breaks of a
// paragraph, as a hard-wrapped README writes it. A blank line ends it, so a stray backtick cannot swallow the page.
export const CODE_SPAN_SOURCE = "``[^`]*``|`[^`\\n]*(?:\\n(?![ \\t]*\\n)[^`\\n]*)*`";
export const codeSpans = () => new RegExp(CODE_SPAN_SOURCE, 'g');
// The spans of a text as CommonMark reads them: a line break inside a span is a space, so a re-wrap that
// moves the break does not change the code.
export const codeSpanTexts = (text) => (text.match(codeSpans()) ?? []).map((span) => span.replace(/(?<![ \t\r])[ \t\r]*\n[ \t\r]*/g, ' '));

export const unwrapLinks = (text) => text.replace(IMAGE, '$1').replace(LINK, '$1').replace(REFERENCE_LINK, '$1');

export function removeComments(text, replacement) {
  let result = '';
  let position = 0;
  for (;;) {
    const open = text.indexOf('<!--', position);
    const close = open === -1 ? -1 : text.indexOf('-->', open + 4);
    if (close === -1) return result + text.slice(position);
    result += text.slice(position, open) + replacement;
    position = close + 3;
  }
}
