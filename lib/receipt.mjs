import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './errors.mjs';
import { maxWindow, pairsSelection } from './helper-lock.mjs';
import { sealFile, sealHasShape, sealState } from './seal.mjs';

// What the SDK said about one helper run, kept as a file that 100x signed the moment it came back. A model name that an agent types into
// a record is the agent's word. A receipt is the SDK's word, carried by a file the agent did not write, so a record that holds one can be
// believed at the level the tool can check. The signature is this machine's 100x key (see lib/seal.mjs), so it stops a receipt made by
// hand or edited since. It does not stop someone who reads this code and signs a file on purpose.

export function writeReceipt(file, result, sdkVersion) {
  const body = {
    version: 1,
    at: new Date().toISOString(),
    status: result.status,
    requested: result.requested,
    ran: result.ran,
    modelCheck: result.modelCheck,
    differences: result.differences,
    seconds: result.seconds,
    tokens: result.tokens,
    agentId: result.agentId,
    runId: result.runId,
    sdkVersion,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  sealFile(file);
}

// A run that the SDK reports in MAX mode, or at a 1m window, which is MAX mode on this account whether or not the result carries the flag. Nothing may stand for one.
export const ranInMax = (receipt) => {
  if (receipt?.ran?.maxMode === true) return true;
  const asked = pairsSelection((Array.isArray(receipt?.ran?.params) ? receipt.ran.params : []).map((p) => [p?.id ?? '', p?.value]));
  // A window that is a million tokens or more, one that is not a size and one that is not text are all a window nothing can vouch for.
  return maxWindow(asked.windows) !== null || asked.odd.length > 0;
};

// A receipt this tool wrote has a list of {id, value} for the settings that ran, or none.
const paramsListed = (receipt) => receipt?.ran?.params === undefined || (Array.isArray(receipt.ran.params) && receipt.ran.params.every((p) => typeof p?.id === 'string'));

// In one fixed order, so the same settings read the same wherever they are printed or compared.
export const receiptParams = (receipt) => Object.fromEntries((receipt.ran?.params ?? []).map((p) => [p.id, p.value]).sort(([a], [b]) => a.localeCompare(b)));

// The receipt as the tool can vouch for it, or a refusal that says why. `sha` identifies this exact file, so a record can say which one backs it.
export function readReceipt(file) {
  if (!fs.existsSync(file)) throw new CliError(`There is no receipt at ${file}. 100x helper run --receipt <file> writes one.`);
  if (sealState(file) !== 'ok') throw new CliError(`${file} is not a receipt this machine's 100x wrote, or it was edited since. A receipt comes from 100x helper run --receipt <file>, and it is signed there with the 100x key in the global folder.`);
  const text = fs.readFileSync(file, 'utf8');
  let receipt;
  try {
    receipt = JSON.parse(text);
  } catch (error) {
    throw new CliError(`${file} is not valid JSON: ${error.message}`);
  }
  const bad = (why) => new CliError(`${file} is not a receipt: ${why}.`);
  if (receipt?.version !== 1) throw bad('its version is not 1');
  if (typeof receipt.requested?.id !== 'string') throw bad('it names no model that was asked for');
  if (typeof receipt.ran?.id !== 'string') throw bad('the SDK reported no model that ran, so the model of this run is not known');
  // Another model is not refused here: the score reports a run on a model other than the one chosen as a mismatch. A run in MAX mode is refused, because nothing may stand for one.
  if (!paramsListed(receipt)) throw bad('the settings that ran are not a list of id and value, so the settings of this run are not known');
  if (ranInMax(receipt)) throw bad('the SDK reported MAX mode or a 1m window for this run, and a helper never runs in MAX mode, so it cannot back a record');
  if (typeof receipt.runId !== 'string' || typeof receipt.agentId !== 'string') throw bad('it names no run');
  return { receipt, sha: crypto.createHash('sha256').update(text).digest('hex') };
}

// What a saved receipt does for its record. `backed`: the file is there, is the one the record names and carries a seal this machine's key verifies.
// `other-machine`: it is the one the record names and carries a seal, which this machine cannot verify, so it was signed with another machine's key
// and is not a name typed by hand. `typed`: no receipt, a different file, or one with no seal.
export function receiptState(file, sha) {
  if (!sha || !fs.existsSync(file) || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== sha) return 'typed';
  // The score reads a receipt through here, not through readReceipt, so a run in MAX mode is refused here too, even when its seal is good.
  try {
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (ranInMax(receipt) || !paramsListed(receipt)) return 'typed';
  } catch {
    return 'typed';
  }
  if (sealState(file) === 'ok') return 'backed';
  // An empty or garbled seal is not a signature, so it does not lift a receipt above a typed one. A well-formed seal from a key this machine lacks cannot be told from another machine's, and still reads as other-machine.
  return sealHasShape(file) ? 'other-machine' : 'typed';
}

export const receiptBacks = (file, sha) => receiptState(file, sha) === 'backed';
