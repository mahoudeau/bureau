// lib/backup-crypto.js: the off-server backup's encryption, node:crypto only.
// The hub holds only the public key, so a stolen server or a read of the
// Nextcloud folder gives nothing. The private key lives on the boss's Mac
// (bureau backup keygen) and in a password manager.
//
// Keys travel as one line of text:
//   public   x25519:<base64 of the 32-byte raw key>          BUREAU_BACKUP_PUBLIC_KEY
//   private  x25519-private:<base64 of the 32-byte raw key>  the Keychain, never the server
//
// Per file: a fresh X25519 key pair, ECDH with the hub's public key, HKDF-SHA256
// to a 256-bit key, AES-256-GCM over the bytes. The file:
//
//   offset  size  field
//   0       4     magic "BRBK"
//   4       1     format version, 1
//   5       8     key id: the first 8 bytes of SHA-256 of the recipient's raw public key
//   13      32    the ephemeral X25519 public key, raw
//   45      12    the GCM nonce
//   57      n     the ciphertext
//   57+n    16    the GCM tag
//
// The AES key: HKDF-SHA256(ikm = X25519(ephemeral private, recipient public),
// salt = ephemeral public || recipient public, info = "bureau-backup v1", 32).
// The 57 header bytes are the GCM additional data, so a changed header fails
// like a changed byte of ciphertext. connectors/cli/bureau.js holds a copy of
// the decrypt side (it is a standalone file); test/backup.test.js pins both.
'use strict';
const crypto = require('crypto');

const MAGIC = Buffer.from('BRBK', 'latin1');
const VERSION = 1;
const HEADER = 57;
const TAG = 16;
const INFO = Buffer.from('bureau-backup v1', 'latin1');
// The fixed DER wrappers around a raw X25519 key (RFC 8410).
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const PUB_TAG = 'x25519:';
const PRIV_TAG = 'x25519-private:';

class BackupCryptoError extends Error {}

function rawFrom(text, tag, what) {
  const s = String(text || '').trim();
  if (!s.startsWith(tag)) throw new BackupCryptoError(`${what} must start with ${tag}`);
  const raw = Buffer.from(s.slice(tag.length), 'base64');
  if (raw.length !== 32) throw new BackupCryptoError(`${what} must hold 32 bytes`);
  return raw;
}
const publicKeyObject = (raw) => crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
const privateKeyObject = (raw) => crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: 'der', type: 'pkcs8' });
const rawPublic = (keyObject) => keyObject.export({ format: 'der', type: 'spki' }).subarray(SPKI_PREFIX.length);
const rawPrivate = (keyObject) => keyObject.export({ format: 'der', type: 'pkcs8' }).subarray(PKCS8_PREFIX.length);
const keyId = (rawPub) => crypto.createHash('sha256').update(rawPub).digest().subarray(0, 8);

// A public key as BUREAU_BACKUP_PUBLIC_KEY holds it. Throws a plain message
// when it is not one.
function parsePublicKey(text) {
  const raw = rawFrom(text, PUB_TAG, 'the backup public key');
  try { publicKeyObject(raw); } catch { throw new BackupCryptoError('the backup public key is not an X25519 key'); }
  return raw;
}

// A new pair, as text. The private half must never reach the server.
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return { publicKey: PUB_TAG + rawPublic(publicKey).toString('base64'), privateKey: PRIV_TAG + rawPrivate(privateKey).toString('base64') };
}

// The public key that goes with a private key, as text.
function publicKeyOf(privateText) {
  const priv = privateKeyObject(rawFrom(privateText, PRIV_TAG, 'the backup private key'));
  return PUB_TAG + rawPublic(crypto.createPublicKey(priv)).toString('base64');
}

function aesKey(shared, ephPub, recipientPub) {
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.concat([ephPub, recipientPub]), INFO, 32));
}

function encrypt(plain, publicText) {
  const recipient = parsePublicKey(publicText);
  const eph = crypto.generateKeyPairSync('x25519');
  const ephPub = rawPublic(eph.publicKey);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: publicKeyObject(recipient) });
  const nonce = crypto.randomBytes(12);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), keyId(recipient), ephPub, nonce]);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey(shared, ephPub, recipient), nonce);
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([header, body, cipher.getAuthTag()]);
}

// Throws BackupCryptoError, with a plain reason, for anything but a whole,
// untouched file made for this key.
function decrypt(blob, privateText) {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length < HEADER + TAG || !buf.subarray(0, 4).equals(MAGIC)) throw new BackupCryptoError('not a Bureau backup file');
  if (buf[4] !== VERSION) throw new BackupCryptoError(`backup format ${buf[4]} is unknown here (this Bureau reads format ${VERSION}): upgrade it`);
  const priv = privateKeyObject(rawFrom(privateText, PRIV_TAG, 'the backup private key'));
  const recipient = rawPublic(crypto.createPublicKey(priv));
  if (!buf.subarray(5, 13).equals(keyId(recipient))) throw new BackupCryptoError('this file was encrypted for another key');
  const ephPub = buf.subarray(13, 45);
  const nonce = buf.subarray(45, HEADER);
  let shared;
  try { shared = crypto.diffieHellman({ privateKey: priv, publicKey: publicKeyObject(ephPub) }); } catch { throw new BackupCryptoError('the file is damaged: refused'); }
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey(shared, ephPub, recipient), nonce);
  decipher.setAAD(buf.subarray(0, HEADER));
  decipher.setAuthTag(buf.subarray(buf.length - TAG));
  try { return Buffer.concat([decipher.update(buf.subarray(HEADER, buf.length - TAG)), decipher.final()]); }
  catch { throw new BackupCryptoError('the file was changed or damaged: refused'); }
}

module.exports = { encrypt, decrypt, generateKeyPair, parsePublicKey, publicKeyOf, BackupCryptoError, MAGIC, VERSION, HEADER };
