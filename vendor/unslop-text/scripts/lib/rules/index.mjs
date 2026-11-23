import { STAGING_RULES } from './staging.mjs';
import { INFLATION_RULES } from './inflation.mjs';
import { CLARITY_RULES } from './clarity.mjs';
import { SURFACE_RULES } from './surfaces.mjs';
import { BOILERPLATE_RULES } from './boilerplate.mjs';

export const RULES = [...STAGING_RULES, ...INFLATION_RULES, ...BOILERPLATE_RULES, ...SURFACE_RULES, ...CLARITY_RULES];

const seen = new Set();
for (const rule of RULES) {
  if (seen.has(rule.id)) throw new Error(`Duplicate rule id: ${rule.id}`);
  seen.add(rule.id);
}

export const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

export function appliesAt(rule, profile, level) {
  if (rule.strict && level !== 'strict') return false;
  if (rule.kind === 'clarity' && level === 'light' && !rule.light) return false;
  if (rule.applies.includes('*') || rule.applies.includes(profile)) return true;
  return level === 'strict' && Boolean(rule.alsoStrict?.includes(profile));
}
