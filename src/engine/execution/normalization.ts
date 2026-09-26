/**
 * Change Rehearsal — R05 Observation Normalization
 *
 * Pure, stateless normalization functions for converting raw step output
 * into deterministic NormalizedObservation values.
 *
 * NORMALIZATION PRINCIPLES:
 *   1. Explicit: only known unstable patterns are replaced; nothing else changes.
 *   2. Deterministic: the same input always produces the same output.
 *   3. Preserving: meaningful business values are NEVER altered.
 *      Example: inventory quantity = 3 remains 3.
 *   4. Secure: sensitive values (auth headers, secrets) are redacted.
 *   5. Ordered: object keys are sorted for deterministic serialization.
 *
 * What IS normalized (replaced with placeholders):
 *   - ISO 8601 timestamps in string values → "<timestamp>"
 *   - UUID-like identifiers in string values → "<id>"
 *   - Sensitive HTTP headers (Authorization, X-Api-Key, Cookie, Set-Cookie) → "<scrubbed>"
 *   - Sensitive body fields (password, token, secret, api_key, …) → "<scrubbed>"
 *
 * What is NOT normalized:
 *   - Numeric business values (quantities, prices, counts, HTTP status codes)
 *   - Named string values (product names, order states, error messages)
 *   - Array lengths or ordering (unless explicitly sorted by the normalization step)
 *   - Any value not matching a pattern listed above
 *
 * Owner: Reuben (engine)
 * Phase: R05
 */

import type { NormalizedObservation } from './model.js';

// ---------------------------------------------------------------------------
// Patterns — only listed patterns are replaced
// ---------------------------------------------------------------------------

/**
 * ISO 8601 timestamp pattern.
 * Matches: 2024-01-15T10:30:00Z, 2024-01-15T10:30:00.123Z, 2024-01-15T10:30:00+05:30
 */
const ISO_TIMESTAMP_PATTERN =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})/g;

/**
 * UUID v4-like pattern (all variants).
 * Matches: 550e8400-e29b-41d4-a716-446655440000
 */
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Sensitive HTTP header names (lower-cased for comparison).
 */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'x-auth-token',
  'proxy-authorization',
]);

/**
 * Sensitive JSON body field names.
 */
const SENSITIVE_BODY_FIELDS = new Set([
  'password',
  'token',
  'secret',
  'api_key',
  'apikey',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'authorization',
  'credential',
  'credentials',
  'private_key',
  'privatekey',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a NormalizedObservation for an HTTP response.
 *
 * Normalizes:
 *   - Sensitive headers → "<scrubbed>"
 *   - Timestamp and UUID strings in the body → "<timestamp>"/"<id>"
 *   - Sensitive body fields → "<scrubbed>"
 *
 * Preserves:
 *   - HTTP status code (numeric)
 *   - All non-sensitive headers
 *   - All non-sensitive, non-timestamp body values (including numeric business values)
 */
export function normalizeHttpObservation(
  status: number,
  headers: Record<string, string>,
  body: unknown,
  source: string,
): NormalizedObservation {
  const rawValue = { status, headers, body };
  const normalizedValue = {
    status, // status codes are NOT normalized — they are meaningful execution signals
    headers: normalizeHeaders(headers),
    body: normalizeBody(body),
  };

  return {
    kind: 'http_response',
    value: rawValue,
    normalizedValue,
    source,
    metadata: { httpStatus: status },
  };
}

/**
 * Build a NormalizedObservation for a database snapshot.
 *
 * Normalizes:
 *   - Timestamp strings in snapshot values → "<timestamp>"
 *   - UUID strings in snapshot values → "<id>"
 *   - Sensitive field names → "<scrubbed>"
 *
 * Preserves:
 *   - All numeric values (quantities, prices, counts)
 *   - All non-sensitive, non-timestamp string values
 */
export function normalizeDbObservation(
  snapshot: Record<string, unknown>,
  source: string,
): NormalizedObservation {
  return {
    kind: 'db_snapshot',
    value: snapshot,
    normalizedValue: normalizeBody(snapshot),
    source,
  };
}

/**
 * Build a NormalizedObservation for stdout/stderr output.
 *
 * Normalizes:
 *   - ISO timestamps in the text → "<timestamp>"
 *   - UUID strings in the text → "<id>"
 *
 * Preserves:
 *   - All non-matching text
 */
export function normalizeTextObservation(
  text: string,
  kind: 'stdout' | 'stderr',
  source: string,
): NormalizedObservation {
  return {
    kind,
    value: text,
    normalizedValue: normalizeString(text),
    source,
  };
}

/**
 * Build a NormalizedObservation for a function return value.
 */
export function normalizeFunctionObservation(
  result: unknown,
  source: string,
): NormalizedObservation {
  return {
    kind: 'function_result',
    value: result,
    normalizedValue: normalizeBody(result),
    source,
  };
}

// ---------------------------------------------------------------------------
// Internal normalization primitives
// ---------------------------------------------------------------------------

/**
 * Normalize HTTP headers: redact sensitive headers, preserve all others.
 * Keys are sorted for deterministic serialization.
 */
export function normalizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const sortedKeys = Object.keys(headers).sort();
  for (const key of sortedKeys) {
    result[key] = SENSITIVE_HEADERS.has(key.toLowerCase())
      ? '<scrubbed>'
      : headers[key];
  }
  return result;
}

/**
 * Recursively normalize a body value.
 *
 * Numbers, booleans, and null pass through unchanged.
 * Strings have timestamps and UUIDs replaced.
 * Object keys are sorted for deterministic output.
 * Arrays are recursively normalized but NOT reordered
 *   (ordering is meaningful application state).
 * Sensitive object fields are redacted.
 */
export function normalizeBody(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'number' || typeof value === 'boolean') {
    // Numeric and boolean values are preserved verbatim.
    // inventory quantity = 3 MUST remain 3.
    return value;
  }

  if (typeof value === 'string') {
    return normalizeString(value);
  }

  if (Array.isArray(value)) {
    // Recursively normalize each element. Array ordering is preserved.
    return value.map(normalizeBody);
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    // Sort keys for deterministic serialization
    const sortedKeys = Object.keys(obj).sort();
    for (const key of sortedKeys) {
      result[key] = SENSITIVE_BODY_FIELDS.has(key.toLowerCase())
        ? '<scrubbed>'
        : normalizeBody(obj[key]);
    }
    return result;
  }

  return value;
}

/**
 * Normalize a string by replacing unstable patterns:
 *   - ISO timestamps → "<timestamp>"
 *   - UUIDs → "<id>"
 *
 * All other content is preserved exactly.
 */
export function normalizeString(value: string): string {
  return value
    .replace(ISO_TIMESTAMP_PATTERN, '<timestamp>')
    .replace(UUID_PATTERN, '<id>');
}
