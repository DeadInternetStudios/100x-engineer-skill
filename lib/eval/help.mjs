import { MAX_PICTURE } from './pictures.mjs';
import { WRONG_SHOWN } from './routing.mjs';
import { MIN_DECISIVE } from './tally.mjs';

// The help is split so that `100x eval --help` teaches the two things to try, and a command's own --help prints that command and no other.
const RECIPES = `Two things to try first.

Replay a routing result from one saved file, in under a second:
  100x eval triggers score --bundle <run.json>

Run a bake-off, in this order. The skill 100x-bakeoff does it for an agent:
  1. 100x eval bakeoff init <dir> --first 3 --pin     tasks, and an empty folder for each arm and brief
  2. each arm: 100x eval bakeoff mark <dir> <brief>/<arm> start, then 100x helper run ... --receipt <file>, then mark ... stop --receipt <file>
  3. 100x eval bakeoff pairs <dir>                    blind pairs, two controls, a sealed key
  4. one fresh judge for each folder under <dir>/judge, then mark <dir> judge/<folder> stop --receipt <file>
  5. 100x eval bakeoff score <dir>                    the word, the counts and the limits
  6. 100x eval bakeoff gallery <dir> --out <folder>   one picture for each pair

Both run from plain files, so any model or app can do the model's part. The rules and the threats are in evals/PROTOCOL.md.`;

const SECTIONS = [
  {
    id: 'triggers stage',
    synopsis: ['100x eval triggers stage <dir> [--set tune|holdout|all] [--file <triggers.json>]'],
    text: `Writes prompts.json (the messages, without their answers), skills.json (the skills and 8 distractors, in one list) and ask.md into <dir>.
Give <dir> to a model, or run evals/runners/ollama.mjs answer <dir> for a model on this machine. It writes answers.json.`,
  },
  {
    id: 'triggers score',
    synopsis: ['100x eval triggers score <answers.json> [--set tune|holdout|all] [--file <triggers.json>] [--min <accuracy>] [--all] [--json] [--save <run.json> [--model <label>]]', '100x eval triggers score --bundle <run.json> [--min <accuracy>] [--all] [--json]'],
    text: `Reads answers.json, which maps each message id to a skill name or "none". Prints accuracy, then precision and recall for every skill, then each wrong
answer with its whole message. A long list stops after ${WRONG_SHOWN} and says how many more there are. --all lists every one, and --json carries them all.
An answer that names no skill in the list is flagged as a typo, because it scores as a miss. Exits 1 when accuracy is under --min.
--save <run.json> also keeps the run as one file: the list the model read, the messages with the answers they needed, and the model's answers.
--model is a label for the answerer, written as given. --bundle <run.json> works the same numbers out again from such a file and nothing else.
It records no look at the holdout.
Sets. tune is for fixing descriptions. holdout was written by a model that never saw a description and should be scored once. Every score of it is
written to ~/.100x/evals/holdout-looks.tsv, and the output says which look it was. all holds the holdout too, so scoring it is a look at the holdout.
Each holdout score is written down, and a second one says it is a tuned number. Default is tune. The prompts live in evals/triggers.json.`,
  },
  {
    id: 'bakeoff init',
    synopsis: ['100x eval bakeoff init <dir> [--briefs <briefs.json>] [--first <n>] [--pin] [--arms skill-off,skill-on] [--seed <n>] [--minutes <n>] [--note <arm>=<file>]'],
    text: `Makes <dir> with one task file per brief and arm under tasks/, and an empty folder per brief and arm under arms/ (arm-1 is the first arm named, arm-2
the second, so the path says nothing about which arm it is). --briefs is a JSON list of { id, title, text } and defaults to the shipped evals/briefs.json.
--first 3 takes the first three, which is the pilot, and leaving it out runs all twenty. --pin copies the skill, as it is now, into <dir>/pinned
with a clean home and a 100x command that uses it, and gives the second arm a method paragraph that names them. --note <arm>=<file> sets the method
paragraph by hand instead. The order to run the arms in is drawn from the seed and printed, and so is a plan: the runs, the tokens and the time at
the pilot's rates, and how many decisive pairs to expect and what "ahead" needs of them.`,
  },
  {
    id: 'bakeoff mark',
    synopsis: ['100x eval bakeoff mark <dir> <brief>/<arm>|judge|judge/<folder> start|stop [--receipt <file>] [--model <asked>] [--ran <ran>] [--source sdk|app|self] [--tokens <n>]'],
    text: `Starts and stops the clock for one run, from this machine's clock. Also records the model that ran. Give it --receipt <file> at stop, the file
100x helper run --receipt wrote, and it takes the model asked for, the model and settings that ran (reasoning effort and context window) and the tokens
from it, keeps a copy under receipts/, and refuses a receipt that was not signed by this machine's 100x key or that already backs another run.
--ran, --model and --source record a name typed by hand, which score treats as the helper's word. The key judge/<folder> records the model that judged
one folder, and the key judge records one model for every folder. A judge key needs no start. score withholds the word unless the model that ran is on
record for every arm run and every judge folder, and says "ahead" only when a receipt backs every one of those records.`,
  },
  {
    id: 'bakeoff pairs',
    synopsis: ['100x eval bakeoff pairs <dir> [--no-capture] [--allow <word>] [--edit <what>] [--blank-missing]'],
    text: `Needs every arm folder to hold index.html, or --blank-missing. Builds the folders a judge is pointed at, each pair twice with A and B swapped, plus two
controls: a page beside a blurred copy of itself, and the same page twice. Scans them for the skill's name and the arm names, reading every file by what
it holds, and refuses, naming the file in the arm folder and the line, when it finds one. It also refuses a symbolic link and a file over 25 MB, which it
cannot check. Writes key.json outside the judge folders and its hash beside it, signed with this machine's 100x key, before any judge has a folder.
It scans the arm folders before it takes a single screenshot, so a leak refuses in seconds. Then it prints a line for each page it photographs, in the order of the briefs with the seconds so far, because a page takes 15 to 20 seconds.
--no-capture skips the screenshots, and then no page is run, so a name that a script builds in the browser is not looked for. --allow <word> lets one word through that is only plain English. --edit <what> says, once for each, a change a person made by hand to a finished arm page to clear a refusal, as "file:line what was removed"; the key keeps the list and the score says it in its caution. --blank-missing is for a run that is over and
left no index.html: it failed and stays in the count, the judge folder gets a blank page in its place (the arm's own folder is never touched), and the
report names the run.`,
  },
  {
    id: 'bakeoff status',
    synopsis: ['100x eval bakeoff status <dir>'],
    text: 'What is built, what is judged, and the next step. The runs are listed in the order to run them, which the seed drew.',
  },
  {
    id: 'bakeoff score',
    synopsis: ['100x eval bakeoff score <dir> [--json] [--no-write]'],
    text: `Needs a verdict.json in every judge folder: { "winner": "A" | "B" | "tie", "why": "...", "sealed": "<the hash prefix in ask.md>" }. Checks the key
against its hash and refuses a changed key. A key whose signature is not this machine's withholds the word, so score where the pairs were built.
Anywhere else the counts are a recount. A verdict that quotes the key's hash was written after the key was sealed, and one that does not is placed by
its file's time. A pair counts for an arm only when both orders pick it, and anything else is a tie. Prints the counts, the verdict, one line for each reason the
word was withheld or cautioned, the pairs, the median times, and where the whole report is. It writes report.md (the whole
report, with the interval and the limits) and result.json in <dir> unless --no-write, and prints the same when it cannot write them. The word is ahead
only with at least ${MIN_DECISIVE} decisive pairs, p under 0.05, a judge that passed both controls and a key sealed before the verdicts. Otherwise it is
not shown, with the reason.
Exit codes. 0 when it printed a verdict, ahead or not shown. 2 when it withheld the verdict (a verdict missing or void, a judge that failed a control,
a record or key it cannot trust). 1 when it could not run. Routing's --min is the same idea: a result that is not a pass is not exit 0.`,
  },
  {
    id: 'bakeoff gallery',
    synopsis: ['100x eval bakeoff gallery <dir> --out <folder>'],
    text: `Scores again and writes <folder>/report.md with one picture per real pair beside its result, the arms named now that the judging is over.
Each picture is a JPEG under ${MAX_PICTURE / 1024} KB with the phone and desktop screenshots the judge saw, each labelled with its arm and its size. It needs a browser and the
screenshots from pairs, and it refuses until every verdict is in, because it names the arms. It copies the full-size screens into <folder>/screens, so every link in the report works wherever <dir> is. It prints a line for each picture, then the same screen as score, and exits 2 when the verdict was withheld.`,
  },
];

const AREAS = {
  triggers: 'Routing. Does a model that reads only the names and descriptions of the skills pick the right one for a message?',
  bakeoff: 'Bake-off. Does an agent with a skill beat the same agent without it? Two arms make the same briefs. Each pair is judged twice, with the arms in swapped places, from folders that carry no arm name.',
};

const indent = (text) => text.split('\n').map((line) => `  ${line}`).join('\n');
const sectionText = (section) => `${section.synopsis.join('\n')}\n\n${section.text}`;
const synopses = (sections) => sections.flatMap((section) => section.synopsis).join('\n');

// Everything, for the check that every flag is written down in the README and the design notes.
export const usage = `\n${synopses(SECTIONS)}\n\nEvals of the skills. ${RECIPES}\n\n${Object.entries(AREAS).map(([area, intro]) => `${intro}\n${SECTIONS.filter((section) => section.id.startsWith(area)).map((section) => `${section.id}\n${indent(section.text)}`).join('\n')}`).join('\n\n')}\n`;

// 100x eval --help, 100x eval triggers --help, 100x eval bakeoff score --help: the page for the words asked about and no other.
export function evalHelp(words) {
  const [area, action] = words;
  const section = SECTIONS.find((candidate) => candidate.id === `${area} ${action}`);
  if (section) return sectionText(section);
  if (AREAS[area]) return `${AREAS[area]}\n\n${SECTIONS.filter((candidate) => candidate.id.startsWith(area)).map(sectionText).join('\n\n')}\n\nRun \`100x eval ${area} <command> --help\` for one command.`;
  return `${RECIPES}\n\n${synopses(SECTIONS)}\n\nRun \`100x eval triggers --help\` or \`100x eval bakeoff --help\` for the details, and \`100x eval bakeoff score --help\` for one command.`;
}
