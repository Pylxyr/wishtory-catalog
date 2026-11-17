// Prints the version that is published right now (0 when nothing is published yet), so a new
// publish always gets a higher one. Any other trouble stops the run instead of guessing.
//   node scripts/published-version.mjs <address of v1/own.envelope.json>
const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/published-version.mjs <address of own.envelope.json>');
  process.exit(2);
}
let response;
try {
  response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
} catch (error) {
  console.error(`Could not reach ${url} to read the published version (${error.message}). Stopping instead of guessing a version.`);
  process.exit(1);
}
if (response.status === 404) {
  console.log('0');
} else if (!response.ok) {
  console.error(`${url} answered ${response.status}. Stopping instead of guessing a version.`);
  process.exit(1);
} else {
  try {
    const envelope = await response.json();
    const document = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
    if (!Number.isSafeInteger(document.own_version) || document.own_version < 0) throw new Error('no version in it');
    console.log(String(document.own_version));
  } catch (error) {
    console.error(`The published file at ${url} could not be read (${error.message}). Stopping instead of guessing a version.`);
    process.exit(1);
  }
}
