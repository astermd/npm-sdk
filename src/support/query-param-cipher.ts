import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-128-cbc';
const IV_LENGTH = 16;

/**
 * Encrypts and decrypts URL query-parameter tokens using AES-128-CBC, with a
 * random 16-byte IV prepended to the ciphertext and the whole thing
 * base64url-encoded.
 *
 * Tracking parameters are encrypted so a browser extension cannot read them in
 * transit. The codec is parameter-agnostic: it carries no knowledge of what it
 * is transporting.
 *
 * Decryption is deliberately total. A malformed, truncated, tampered, or
 * wrongly-keyed token yields an empty object rather than raising, so a storefront
 * can fall back to plain parameters instead of failing a page load:
 *
 * ```ts
 * const params = QueryParamCipher.decrypt(
 *   request.query._amd ?? '',
 *   process.env.ASTERMD_PARAM_KEY!,
 * );
 * // => { aff_id: '123', utm_source: 'news' }   (or {} on any failure)
 * ```
 *
 * The AES key is **never** stored in this SDK. Supply it at every call site from
 * your own configuration - an environment variable, a secrets manager - and keep
 * it in step with whichever service mints the tokens. Contact info@astermd.com to
 * obtain or rotate the key for your organisation.
 *
 * **On integrity:** AES-CBC provides confidentiality but not authentication, so a
 * token cannot be proven unmodified. Treat decrypted parameters as untrusted
 * input and validate them before use.
 *
 * **On the wire format and the PHP SDK:** the encrypted payload is a JSON *list*
 * of `{ key, value }` objects, which is what the PHP SDK writes and reads, so a
 * token minted by either SDK is readable by the other. This class's own surface
 * differs from the PHP one, though: it takes and returns a plain object, since
 * that is what a JS caller wants, and converts at the boundary. A duplicate key
 * on the wire resolves to its last occurrence.
 */
export class QueryParamCipher {
  private constructor() {
    // Static-only.
  }

  /**
   * Decrypts a query-parameter token into tracking parameters.
   *
   * Call this at your storefront's entry point with the raw token from the URL
   * and the key from your own configuration. Any failure along the way - bad
   * encoding, wrong or malformed key, decryption error, non-list payload -
   * returns an empty object so the caller can fall back to plain parameters.
   *
   * @param token The base64url token, `iv(16) || ciphertext`.
   * @param keyHex 32 hex characters - a 16-byte AES-128 key. Supplied by you;
   *   the SDK ships no default.
   * @returns The decrypted parameters, or `{}` on any failure.
   */
  static decrypt(token: string, keyHex: string): Record<string, string> {
    if (token === '' || keyHex === '') {
      return {};
    }

    const key = decodeKey(keyHex);

    if (key === null) {
      return {};
    }

    let blob: Buffer;

    try {
      blob = Buffer.from(base64UrlToBase64(token), 'base64');
    } catch {
      return {};
    }

    if (blob.byteLength <= IV_LENGTH) {
      return {};
    }

    let json: string;

    try {
      const decipher = createDecipheriv(ALGORITHM, key, blob.subarray(0, IV_LENGTH));
      json = Buffer.concat([decipher.update(blob.subarray(IV_LENGTH)), decipher.final()]).toString('utf8');
    } catch {
      return {};
    }

    let decoded: unknown;

    try {
      decoded = JSON.parse(json);
    } catch {
      return {};
    }

    if (!Array.isArray(decoded)) {
      return {};
    }

    // The payload is [{ key, value }, …]; re-shape defensively and drop entries
    // that carry no usable key.
    const out: Record<string, string> = {};

    for (const entry of decoded) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }

      const { key: name, value } = entry as Record<string, unknown>;

      if (!isScalar(name)) {
        continue;
      }

      out[phpString(name)] = isScalar(value) ? phpString(value) : '';
    }

    return out;
  }

  /**
   * Encrypts tracking parameters into a token.
   *
   * Provided mainly for round-trip tests and local tooling. A fresh random IV is
   * generated on every call and prepended to the ciphertext before encoding, so
   * the same parameters never produce the same token twice.
   *
   * Unlike {@link QueryParamCipher.decrypt}, this is strict: a bad key raises
   * rather than being swallowed, because a failed encrypt is a programming error
   * and not untrusted input.
   *
   * @param params The parameters to encrypt. Written to the wire as the
   *   `[{ key, value }, …]` list the PHP SDK also reads.
   * @param keyHex 32 hex characters - a 16-byte AES-128 key.
   * @returns The base64url token, `iv(16) || ciphertext`.
   * @throws {TypeError} If `keyHex` is not a valid 16-byte hex key.
   */
  static encrypt(params: Record<string, string>, keyHex: string): string {
    const key = decodeKey(keyHex);

    if (key === null) {
      throw new TypeError('keyHex must be 32 hex chars (a 16-byte AES-128 key).');
    }

    const payload = JSON.stringify(Object.entries(params).map(([name, value]) => ({ key: name, value })));

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);

    return Buffer.concat([iv, ciphertext]).toString('base64url');
  }
}

/** Decodes a hex key, returning `null` for anything that is not exactly 16 bytes. */
function decodeKey(keyHex: string): Buffer | null {
  if (!/^[0-9a-fA-F]{32}$/.test(keyHex)) {
    return null;
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Restores the standard base64 alphabet and padding.
 *
 * `Buffer.from(s, 'base64')` tolerates the base64url alphabet already, but going
 * through the standard form keeps the behaviour identical to the PHP
 * implementation for inputs that mix alphabets.
 */
function base64UrlToBase64(value: string): string {
  const standard = value.replaceAll('-', '+').replaceAll('_', '/');
  const remainder = standard.length % 4;

  return remainder === 0 ? standard : standard + '='.repeat(4 - remainder);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/**
 * Renders a scalar the way PHP's `(string)` cast does, for the case that is
 * actually reachable here.
 *
 * `true` becomes `'1'` and `false` becomes the empty string, where JS's
 * `String()` would give `'true'`/`'false'`. This matters because
 * `QueryParamCipher::encrypt()` in the PHP SDK accepts any scalar, so a token
 * minted there can legitimately carry a JSON boolean - and the two SDKs must
 * render it the same way or they disagree on an untampered token.
 *
 * A fractional-valued float is deliberately **not** special-cased. PHP's
 * `(string)` cast on a float uses `%.*G`-style formatting keyed off the
 * `precision` ini setting (14 significant digits by default, but a deployment
 * can change it), which switches to exponential notation on a magnitude *and*
 * significant-digit threshold that does not line up with JS's own
 * number-to-string conversion - e.g. verified against a live PHP install,
 * `(string) 123456789012345.0` is `'1.2345678901234E+14'` (scientific,
 * despite a magnitude under 1e15) while `(string) 0.0001` stays `'0.0001'`
 * but `(string) 0.00001` already becomes `'1.0E-5'`. Reproducing that
 * precisely would mean re-implementing PHP's `precision`-aware float
 * formatter rather than a one-line fix, so it is left unhandled here - an
 * integer-valued float still round-trips correctly (`String(1)` and PHP's
 * `(string) 1.0` both give `'1'`), and only a genuinely fractional value sent
 * from a PHP encrypter can disagree.
 */
function phpString(value: string | number | boolean): string {
  if (typeof value === 'boolean') {
    return value ? '1' : '';
  }

  return String(value);
}
