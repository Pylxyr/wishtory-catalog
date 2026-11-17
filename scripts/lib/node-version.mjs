// Stops at once, with a plain message and a non-zero exit code, when Node.js is too old.
// Why this matters: the scripts start themselves with `import.meta.main`. On a Node.js without it
// that value is simply empty, so nothing would run and the exit code would still be 0 - a check
// that "passes" without checking anything. Import this file first in every script that starts
// itself that way. (A Node.js older than 22.2 fails earlier, with its own error, which is also loud.)
//
// import.meta.main exists from Node.js 22.18 and from 24.2 (all later versions have it too).
export const NODE_NEEDS = '22.18 or newer in the 22 line, or 24.2 or newer';

export function unsupportedNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  const fine = major >= 25 || (major === 24 && minor >= 2) || (major === 22 && minor >= 18);
  if (fine) return null;
  return `These scripts need Node.js ${NODE_NEEDS}, and this is Node.js ${version}. Install the current LTS from https://nodejs.org/ and run the command again. Stopping now, because on this version the scripts would do nothing and still report success.`;
}

const problem = unsupportedNode();
if (problem) {
  console.error(problem);
  process.exit(1);
}
