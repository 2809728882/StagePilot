import { hmac } from '@noble/hashes/hmac.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export function createPasswordProof(password, challenge) {
  const verifier = pbkdf2(
    sha256,
    utf8ToBytes(password),
    hexToBytes(challenge.salt),
    { c: challenge.iterations, dkLen: 32 }
  );
  return bytesToHex(hmac(sha256, verifier, hexToBytes(challenge.nonce)));
}
