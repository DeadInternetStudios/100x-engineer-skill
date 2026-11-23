// A model is named by its family plus an effort or mode word, for example claude-sonnet-5-5-max or composer-2.5-fast.
// Two names are the same model when they differ only by those words or by a bracket of options.
// A different version is a different model, so claude-sonnet-5 and claude-sonnet-5-5 are not the same.
const MODE_WORDS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'thinking', 'fast']);

export function baseModel(name) {
  const parts = String(name ?? '').trim().toLowerCase().replace(/\[.*\]$/, '').split('-');
  while (parts.length > 1 && MODE_WORDS.has(parts.at(-1))) parts.pop();
  return parts.join('-');
}

export const sameModel = (a, b) => {
  const first = baseModel(a);
  return first !== '' && first === baseModel(b);
};
