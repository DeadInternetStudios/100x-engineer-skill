import { commands, helpGroups } from './commands/index.mjs';
import { CliError } from './errors.mjs';
import { versionLine } from './version.mjs';

// A command with a help() of its own prints the page for the words after its name (100x eval bakeoff score --help), and the others print their usage.
function help(topic, words = []) {
  if (topic) {
    const command = commands.find((c) => c.name === topic);
    if (!command) throw new CliError(`unknown command "${topic}". Run \`100x help\`.`);
    const page = command.help ? command.help(words.filter((word) => !word.startsWith('-'))) : command.usage.trim();
    console.log(`100x ${command.name}\n\n${command.summary}\n\n${page}`);
    return;
  }
  const width = Math.max(...commands.map((c) => c.name.length));
  console.log('100x. One-thread prototype pipeline.\n\nUsage: 100x <command> [options]');
  for (const [heading, names] of helpGroups) {
    console.log(`\n${heading}`);
    for (const name of names) console.log(`  ${name.padEnd(width)}  ${commands.find((c) => c.name === name).summary}`);
  }
  console.log('\nRun `100x <command> --help` for flags.');
}

export async function main(argv) {
  const [name, ...rest] = argv;
  if (!name || ['help', '--help', '-h'].includes(name)) return help(rest[0], rest.slice(1));
  if (['version', '--version', '-v'].includes(name)) {
    console.log(versionLine());
    return undefined;
  }
  const command = commands.find((c) => c.name === name);
  if (!command) throw new CliError(`unknown command "${name}". Run \`100x help\`.`);
  // Everyone types `100x night --help`. A pass-through command hands the flag to the tool it runs, which has its own help.
  if (!command.passThrough && rest.some((arg) => arg === '--help' || arg === '-h')) return help(name, rest);
  return command.run(rest);
}
