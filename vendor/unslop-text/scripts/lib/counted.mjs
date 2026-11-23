// "1 error", "2 errors": a count with its noun in the right number.
export const counted = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
