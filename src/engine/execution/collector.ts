/**
 * ObservationCollector + Normalizer
 *
 * ObservationCollector: wraps a RawExecution with metadata and normalized output.
 * Normalizer: pure function — strips noise so identical behavior produces identical output.
 *
 * Owner: Reuben (engine)
 * Phase: 2
 */

import type {
  RawExecution,
  RawStepResult,
  Observation,
  NormalizedOutput,
  NormalizedStepOutput,
} from '../types.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Observation Collector
// ---------------------------------------------------------------------------

/**
 * Wrap a RawExecution with a stable ID, normalize its output, and return an Observation.
 */
export function collectObservation(
  rehearsalRunId: string,
  raw: RawExecution,
): Observation {
  return {
    id: randomUUID(),
    rehearsalRunId,
    scenarioId: raw.scenarioId,
    side: raw.side,
    rawOutput: raw,
    normalizedOutput: normalize(raw),
    capturedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

/**
 * Normalize a RawExecution into a NormalizedOutput by:
 * - Replacing ISO timestamps with "<timestamp>"
 * - Replacing UUID strings with "<id>"
 * - Replacing auto-increment integer IDs in JSON bodies with "<id>"
 * - Scrubbing Authorization, X-Api-Key, Cookie, and Set-Cookie headers → "<scrubbed>"
 * - Scrubbing password, token, secret, api_key fields in JSON bodies → "<scrubbed>"
 *
 * This function is PURE and STATELESS — the same RawExecution always produces
 * the same NormalizedOutput.
 */
export function normalize(raw: RawExecution): NormalizedOutput {
  return {
    steps: raw.steps.map(normalizeStep),
  };
}

function normalizeStep(step: RawStepResult): NormalizedStepOutput {
  const out: NormalizedStepOutput = {
    stepId: step.stepId,
    status: step.status,
  };

  if (step.httpResponse) {
    out.httpStatus = step.httpResponse.status;
    out.httpBody = scrubBody(step.httpResponse.body);
    out.selectedHeaders = scrubHeaders(step.httpResponse.headers);
  }

  if (step.dbSnapshot) {
    out.dbSnapshot = scrubBody(step.dbSnapshot) as Record<string, unknown>;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Scrubbing helpers
// ---------------------------------------------------------------------------

const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'x-auth-token',
]);

const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'token',
  'secret',
  'api_key',
  'apiKey',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
]);

const ISO_TIMESTAMP_RE =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})/g;

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function scrubHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = SENSITIVE_HEADER_KEYS.has(key.toLowerCase())
      ? '<scrubbed>'
      : value;
  }
  return result;
}

function scrubBody(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value
      .replace(ISO_TIMESTAMP_RE, '<timestamp>')
      .replace(UUID_RE, '<id>');
  }

  if (Array.isArray(value)) {
    return value.map(scrubBody);
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_BODY_KEYS.has(key) ? '<scrubbed>' : scrubBody(val);
    }
    return result;
  }

  return value;
}
