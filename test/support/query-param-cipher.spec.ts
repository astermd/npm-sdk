import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QueryParamCipher } from '../../src/support/query-param-cipher.js';

const KEY = '000102030405060708090a0b0c0d0e0f';
const PHP_VECTOR =
  'EBESExQVFhcYGRobHB0eH3ABcXs0lVk6TxeOGqYLuMOts2okXBjRYrM0oFjHoeQg8JJPH9ClVx2spWt72PhHH_rgo6lBaR1myaX0ydgLoCFk0Uujd15K4ww8GwCOdb9U';

/** Builds a token from arbitrary plaintext, for the malformed-payload cases. */
function tokenFor(plaintext: string, keyHex = KEY, iv = randomBytes(16)): string {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(keyHex, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return Buffer.concat([iv, ciphertext]).toString('base64url');
}

describe('QueryParamCipher PHP compatibility', () => {
  it('decrypts a token minted by the PHP SDK', () => {
    expect(QueryParamCipher.decrypt(PHP_VECTOR, KEY)).toEqual({
      aff_id: '123',
      utm_source: 'news',
    });
  });

  it('produces the wire format PHP expects: base64url(iv || ciphertext) over a key/value list', () => {
    const token = QueryParamCipher.encrypt({ aff_id: '123' }, KEY);
    const blob = Buffer.from(token, 'base64url');

    expect(blob.byteLength).toBeGreaterThan(16);
    expect((blob.byteLength - 16) % 16).toBe(0);
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
    expect(token).not.toContain('=');
  });

  it('round-trips through its own encrypt and decrypt', () => {
    const params = {
      aff_id: '123',
      utm_source: 'news',
      utm_campaign: 'spring sale',
    };

    expect(QueryParamCipher.decrypt(QueryParamCipher.encrypt(params, KEY), KEY)).toEqual(params);
  });

  it('uses a fresh IV per call, so the same params never produce the same token', () => {
    const first = QueryParamCipher.encrypt({ aff_id: '123' }, KEY);
    const second = QueryParamCipher.encrypt({ aff_id: '123' }, KEY);

    expect(first).not.toBe(second);
    expect(QueryParamCipher.decrypt(first, KEY)).toEqual(QueryParamCipher.decrypt(second, KEY));
  });
});

describe('QueryParamCipher.decrypt totality', () => {
  it.each([
    ['an empty token', ''],
    ['a token shorter than the IV', 'YWJj'],
    ['exactly the IV and nothing more', Buffer.alloc(16).toString('base64url')],
    ['not base64 at all', '!!!not-base64!!!'],
    ['random bytes', randomBytes(64).toString('base64url')],
  ])('returns an empty object for %s', (_label, token) => {
    expect(QueryParamCipher.decrypt(token, KEY)).toEqual({});
  });

  it('returns an empty object for an empty key', () => {
    expect(QueryParamCipher.decrypt(PHP_VECTOR, '')).toEqual({});
  });

  it.each([
    ['too short', '0001020304'],
    ['too long', '000102030405060708090a0b0c0d0e0f10'],
    ['not hex', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'],
  ])('returns an empty object for a key that is %s', (_label, keyHex) => {
    expect(QueryParamCipher.decrypt(PHP_VECTOR, keyHex)).toEqual({});
  });

  it('returns an empty object for the wrong key', () => {
    expect(QueryParamCipher.decrypt(PHP_VECTOR, 'ffffffffffffffffffffffffffffffff')).toEqual({});
  });

  it.each([
    ['not JSON', 'nonsense'],
    ['a JSON scalar', '"a string"'],
    ['a JSON number', '42'],
  ])('returns an empty object for a payload that is %s', (_label, plaintext) => {
    expect(QueryParamCipher.decrypt(tokenFor(plaintext), KEY)).toEqual({});
  });

  it('drops malformed entries and keeps the rest', () => {
    const payload = JSON.stringify([
      { key: 'good', value: 'yes' },
      { value: 'no key' },
      'not an object',
      null,
      { key: 'coerced', value: 7 },
      { key: 'missing_value' },
      { key: 'object_value', value: { nested: true } },
    ]);

    expect(QueryParamCipher.decrypt(tokenFor(payload), KEY)).toEqual({
      good: 'yes',
      coerced: '7',
      missing_value: '',
      object_value: '',
    });
  });

  it("renders boolean and integer values the way PHP's (string) cast does", () => {
    // The PHP SDK's encrypt() accepts any scalar, so a token it mints can
    // legitimately carry a JSON boolean. PHP's (string) cast renders `true` as
    // '1' and `false` as '' - not JS's 'true'/'false' - and an integer-valued
    // number the same in both languages.
    const payload = JSON.stringify([
      { key: 'is_active', value: true },
      { key: 'is_archived', value: false },
      { key: 'attempt', value: 3 },
    ]);

    expect(QueryParamCipher.decrypt(tokenFor(payload), KEY)).toEqual({
      is_active: '1',
      is_archived: '',
      attempt: '3',
    });
  });

  it('resolves a duplicate key on the wire to the last occurrence', () => {
    const payload = JSON.stringify([
      { key: 'aff_id', value: 'first' },
      { key: 'aff_id', value: 'second' },
    ]);

    expect(QueryParamCipher.decrypt(tokenFor(payload), KEY)).toEqual({
      aff_id: 'second',
    });
  });

  it('accepts a token whose base64url padding was stripped', () => {
    const padded = Buffer.from(PHP_VECTOR, 'base64url').toString('base64');

    expect(QueryParamCipher.decrypt(padded.replace(/=+$/, ''), KEY)).toEqual({
      aff_id: '123',
      utm_source: 'news',
    });
  });
});

describe('QueryParamCipher.encrypt strictness', () => {
  it.each([
    ['too short', '0001'],
    ['too long', '000102030405060708090a0b0c0d0e0f10'],
    ['not hex', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'],
    ['empty', ''],
  ])('raises for a key that is %s', (_label, keyHex) => {
    expect(() => QueryParamCipher.encrypt({ a: 'b' }, keyHex)).toThrow(TypeError);
  });

  it('encrypts an empty parameter set to a decryptable empty list', () => {
    expect(QueryParamCipher.decrypt(QueryParamCipher.encrypt({}, KEY), KEY)).toEqual({});
  });
});
