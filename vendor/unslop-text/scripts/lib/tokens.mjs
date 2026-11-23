const PRINTF_TYPE = 'sdifuxXeEgGcpn@';
const LENGTH_TYPE = 'sdifuxXeEgGcpn';
const NAME = String.raw`[A-Za-z_][\w.]*`;
const FORMAT = String.raw`[-+0#]*\d*(?:\.\d+)?`;

const PLACEHOLDERS = {
  printf: String.raw`(?<!%)%(?:\d+\$)?${FORMAT}(?:[${PRINTF_TYPE}]|(?:hh|h|ll|l|L|q|j|z|t)[${LENGTH_TYPE}](?![A-Za-z]))`,
  pythonNamed: String.raw`%\(${NAME}\)${FORMAT}[sdifuxXeEgGcr]`,
  rubyAngle: String.raw`%<${NAME}>${FORMAT}[${LENGTH_TYPE}]`,
  rubyBrace: String.raw`%\{${NAME}\}`,
  jsTemplate: String.raw`\$\{[^{}]*\}`,
  erb: String.raw`<%=?[^%>]*%>`,
  wikiTemplate: String.raw`\[\[[^\[\]]+\]\]`,
};

const STRING_PLACEHOLDERS = {
  doubleUnderscore: String.raw`(?<![A-Za-z0-9_])__[A-Za-z0-9][\w-]*(?:__[\w-]+)*__(?![A-Za-z0-9_])`,
  percentNamed: String.raw`(?<![\w%])%[A-Za-z_][A-Za-z0-9_]*%(?![\w%])`,
  percentNumbered: String.raw`(?<![\w%])%\d{1,2}(?:![^!\s]+!)?(?![\w%$])`,
  dollarNamed: String.raw`\$[A-Z][A-Z0-9_]*\$`,
  rpgVariable: String.raw`\\[VNPvnp]\[\d+\]`,
  rpgCurrency: String.raw`\\[Gg](?![A-Za-z])`,
  i18nextNesting: String.raw`\$t\([^()\n]*\)`,
};

const STRING_MARKUP = {
  sectionColor: '§[0-9A-Za-z!]',
  wowColor: String.raw`\|c[0-9A-Fa-f]{8}`,
  wowShort: String.raw`\|[rnh](?![a-z])`,
  wowLink: String.raw`\|H[^|\n]*\|h`,
  wowTexture: String.raw`\|T[^|\n]*\|t`,
  rpgColorIcon: String.raw`\\[CIci]\[\d+\]`,
  rpgControl: String.raw`\\[.|!^<>{}$]`,
};

const union = (...tables) => new RegExp(tables.flatMap((table) => Object.values(table)).join('|'), 'g');

const PLACEHOLDER_RE = union(PLACEHOLDERS);
export const STRING_PLACEHOLDER_RE = union(PLACEHOLDERS, STRING_PLACEHOLDERS);
export const STRING_MARKUP_RE = union(STRING_MARKUP);
export const TAG_RE = /<\/?[A-Za-z][^<>]*>|\[\/?(?:b|i|u|s|url|img|color|size|quote|code|list)(?:=[^\[\]]*)?\]/g;
export const CDATA_MARKS_RE = /<!\[CDATA\[|\]\]>/g;
export const BRACKET_MARKUP_RE = /\[(?:\/?[A-Za-z][\w.!-]*(?:[= ][^\[\]\n]*)?|#[0-9A-Fa-f]{3,8})?\]/g;

export const placeholderRe = (strings) => (strings ? STRING_PLACEHOLDER_RE : PLACEHOLDER_RE);
