/**
 * The kind of identity check to run through {@link Verification.verifyIdentity}.
 *
 * Each value selects a different check at the configured provider, and each
 * expects a different payload alongside it - a cross-check of supplied details,
 * a date-of-birth confirmation, or a Social Security Number confirmation. The
 * required fields per check are in the API reference in your AsterMD dashboard.
 *
 * These calls carry PII, and `SsnVerify` in particular. The SDK never writes
 * their request bodies to a debug log.
 */
export const IdentityCheck = Object.freeze({
  /** Cross-check the supplied identity details against the provider's records. */
  Crosscheck: 'crosscheck',
  /** Confirm the supplied date of birth. */
  DobVerify: 'dob_verify',
  /** Confirm the supplied Social Security Number. */
  SsnVerify: 'ssn_verify',
} as const);

/** Any identity-check wire value. A bare string literal satisfies this type. */
export type IdentityCheck = (typeof IdentityCheck)[keyof typeof IdentityCheck];
