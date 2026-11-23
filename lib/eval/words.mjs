// The words a count or a time is printed in, once, so that the report, the status page, the terminal and the pictures cannot disagree.

export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// "is" or "are" for the same count.
export const are = (count) => (count === 1 ? 'is' : 'are');

// A run that took seconds says seconds. A run that took minutes says minutes, to one place at most.
export function duration(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return 'not recorded';
  if (minutes < 1) {
    const seconds = Math.round(minutes * 60);
    return seconds < 1 ? 'under 1 s' : `${seconds} s`;
  }
  return `${Number(minutes.toFixed(minutes < 10 ? 1 : 0))} min`;
}

// A long sentence broken at spaces for a terminal, every line after the first indented.
export function wrap(text, { width = 100, indent = '' } = {}) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map((text, index) => (index === 0 ? text : `${indent}${text}`)).join('\n');
}

// A path as a shell would need it written, so a command printed here can be pasted as it stands.
export const shellPath = (text) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`);
