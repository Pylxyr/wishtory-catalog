// Signs and verifies "envelopes" exactly the way the Wishtory app expects them: an Ed25519
// signature over the payload bytes, stored as { payload: base64, signature: base64 }.
// This is the scheme of scripts/sign-catalog.mjs in the Wishtory repository.
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

// The public key the app pins. Signing refuses to run with any other key.
export function pinnedPublicKey(file = process.env.WISHTORY_PUBLIC_KEY_FILE ?? 'public-key.txt') {
  return readFileSync(file, 'utf8').trim();
}

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function loadPrivateKey(pem, pinned = pinnedPublicKey()) {
  if (!pem || !pem.trim()) {
    throw new Error('No signing key was given. Set the CATALOG_SIGNING_KEY secret (see docs/signing-key.md).');
  }
  let privateKey;
  try {
    privateKey = createPrivateKey(pem);
  } catch {
    throw new Error('The signing key could not be read. It must be the full PEM text, including the BEGIN and END lines (see docs/signing-key.md).');
  }
  const raw = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  if (raw !== pinned) {
    throw new Error('The signing key does not match the public key the Wishtory app pins (public-key.txt). Nothing was signed. Use the same key as the Wishtory repository (see docs/signing-key.md).');
  }
  return privateKey;
}

export function signEnvelope(payload, privateKey) {
  const signature = sign(null, payload, privateKey).toString('base64');
  return Buffer.from(`${JSON.stringify({ payload: payload.toString('base64'), signature })}\n`);
}

// Returns the payload bytes when the signature is valid for the pinned key, otherwise null.
export function openEnvelope(envelope, pinned = pinnedPublicKey()) {
  try {
    const parsed = JSON.parse(envelope.toString('utf8'));
    const payload = Buffer.from(parsed.payload, 'base64');
    const publicKey = createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(pinned, 'base64')]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, payload, publicKey, Buffer.from(parsed.signature, 'base64')) ? payload : null;
  } catch {
    return null;
  }
}
