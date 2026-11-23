// The unit written after a number, or after "per": "100 requests per minute" became "per hour". The number
// kept its value, so only the unit word shows that the quantity changed.

const GROUPS = {
  millisecond: ['ms', 'millisecond', 'milliseconds'],
  second: ['s', 'sec', 'secs', 'second', 'seconds'],
  minute: ['min', 'mins', 'minute', 'minutes'],
  hour: ['h', 'hr', 'hrs', 'hour', 'hours'],
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
  year: ['yr', 'yrs', 'year', 'years'],
  milligram: ['mg', 'milligram', 'milligrams'],
  gram: ['g', 'gram', 'grams'],
  kilogram: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'],
  pound: ['lb', 'lbs', 'pound', 'pounds'],
  ounce: ['oz', 'ounce', 'ounces'],
  tonne: ['tonne', 'tonnes', 'ton', 'tons'],
  millimeter: ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'],
  centimeter: ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'],
  meter: ['m', 'meter', 'meters', 'metre', 'metres'],
  kilometer: ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres'],
  inch: ['inch', 'inches'],
  foot: ['ft', 'foot', 'feet'],
  yard: ['yd', 'yds', 'yard', 'yards'],
  mile: ['mi', 'mile', 'miles'],
  byte: ['b', 'byte', 'bytes'],
  kilobyte: ['kb', 'kib', 'kilobyte', 'kilobytes'],
  megabyte: ['mb', 'mib', 'megabyte', 'megabytes'],
  gigabyte: ['gb', 'gib', 'gigabyte', 'gigabytes'],
  terabyte: ['tb', 'tib', 'terabyte', 'terabytes'],
  celsius: ['°c', 'celsius'],
  fahrenheit: ['°f', 'fahrenheit'],
};

const CANONICAL = new Map();
for (const [unit, aliases] of Object.entries(GROUPS)) for (const alias of aliases) CANONICAL.set(alias, unit);
const RATE_UNITS = ['millisecond', 'second', 'minute', 'hour', 'day', 'week', 'month', 'year'];

const AFTER_NUMBER = /\d(?:[\d,.]*\d)?[ \t]?(°?[A-Za-z]+)(?![\p{L}\p{N}_])/gu;
const RATE = /(?:\bper|\beach|\bevery|\ba|\ban|\/)[ \t]?([A-Za-z]+)(?![\p{L}\p{N}_])/giu;

// The units a text writes, one entry for each mention, in a form that does not depend on the spelling.
export function unitsOf(text) {
  if (!/\d/.test(text)) return [];
  const found = [];
  for (const match of text.matchAll(AFTER_NUMBER)) {
    const unit = CANONICAL.get(match[1].toLowerCase());
    if (unit) found.push(unit);
  }
  for (const match of text.matchAll(RATE)) {
    const unit = CANONICAL.get(match[1].toLowerCase());
    if (unit && RATE_UNITS.includes(unit)) found.push(`per ${unit}`);
  }
  return found.sort();
}
