// Checks the baskets and says, in plain words, what is wrong and in which file.
//   node scripts/validate.mjs [--root <folder>]
// Exit code 0 = everything is fine, 1 = problems found (nothing may be published).
import './lib/node-version.mjs'; // first: stops loudly on a Node.js too old for import.meta.main
import { appendFileSync } from 'node:fs';
import { validate } from './lib/validate.mjs';

export function printReport(result, { title = 'Check' } = {}) {
  const { problems } = result;
  const counts = `${result.items.length} item(s), ${result.banners.length} banner(s), ${result.schedule.books.length + result.schedule.weapons.length} farming series`;
  const lines = [];
  if (problems.length === 0) {
    lines.push(`${title}: everything is in order (${counts}).`);
  } else {
    lines.push(`${title}: ${problems.length} problem(s) found. Nothing will be published until they are fixed.`);
    problems.forEach((p, i) => {
      lines.push('', `Problem ${i + 1} of ${problems.length}`, `  File:  ${p.file}`, `  What:  ${p.message}`);
    });
  }
  console.log(lines.join('\n'));
  if (process.env.GITHUB_ACTIONS) {
    const escape = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    const prop = (s) => escape(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
    for (const p of problems) console.log(`::error file=${prop(p.file)},title=${prop('Wishtory data problem')}::${escape(p.message)}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = problems.length === 0
      ? `### ${title}: everything is in order\n${counts}.\n`
      : `### ${title}: ${problems.length} problem(s) found\nNothing was published. Fix these and push again:\n\n${problems.map((p) => `- **${p.file}**: ${p.message}`).join('\n')}\n`;
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const rootAt = args.indexOf('--root');
  const root = rootAt >= 0 ? args[rootAt + 1] : '.';
  const result = validate(root);
  printReport(result, { title: rootAt >= 0 ? `Check of ${root}` : 'Check' });
  process.exit(result.problems.length === 0 ? 0 : 1);
}
