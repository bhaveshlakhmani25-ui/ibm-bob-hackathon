/**
 * Change Rehearsal — R08 Repair Domain Serialization
 *
 * Deterministic serialization and deserialization for R08 domain models:
 *   - RepairRequest
 *   - RepairPlan
 *   - RehearsalRerunResult
 *
 * Serialization guarantees:
 *   - Same object always produces the same JSON string.
 *   - Fields are serialized in stable order.
 *   - Collections are sorted deterministically.
 *   - Timestamps are serialized verbatim (not re-parsed).
 *   - No secrets are introduced.
 *   - Schema version in envelope for future migration.
 *
 * Follows the same pattern as evidence/serialization.ts and scenario/serialization.ts.
 *
 * Owner: Reuben (engine)
 * Phase: R08
 */

import type {
  RepairRequest,
  RepairPlan,
  RepairAction,
  RehearsalRerunResult,
} from './model.js';
import { REPAIR_SCHEMA_VERSION } from './model.js';
import {
  validateRepairRequest,
  validateRepairPlan,
  validateRerunResult,
} from './validation.js';
import { EngineError } from '../errors.js';

// ---------------------------------------------------------------------------
// Envelope types
// ---------------------------------------------------------------------------

export interface SerializedRepairRequest {
  schemaVersion: string;
  request: RepairRequest;
}

export interface SerializedRepairPlan {
  schemaVersion: string;
  plan: RepairPlan;
}

export interface SerializedRerunResult {
  schemaVersion: string;
  rerunResult: RehearsalRerunResult;
}

// ---------------------------------------------------------------------------
// RepairRequest serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a RepairRequest to a deterministic JSON string.
 */
export function serializeRepairRequest(request: RepairRequest): string {
  const envelope: SerializedRepairRequest = {
    schemaVersion: REPAIR_SCHEMA_VERSION,
    request: normalizeRequest(request),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Deserialize a RepairRequest from a JSON string.
 *
 * @throws EngineError('REPAIR_DESERIALIZATION_FAILED') on parse or validation failure
 */
export function deserializeRepairRequest(raw: string): RepairRequest {
  const envelope = safeParse(raw);
  assertObject(envelope, 'repair request envelope');
  assertSchemaVersion((envelope as Record<string, unknown>)['schemaVersion']);

  const request = (envelope as Record<string, unknown>)['request'];
  const result = validateRepairRequest(request);
  if (!result.valid) {
    throw new EngineError(
      'REPAIR_DESERIALIZATION_FAILED',
      `Deserialized RepairRequest failed validation: ${result.errors.join('; ')}`,
    );
  }
  return request as RepairRequest;
}

// ---------------------------------------------------------------------------
// RepairPlan serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a RepairPlan to a deterministic JSON string.
 * Actions are sorted by sequence ascending.
 */
export function serializeRepairPlan(plan: RepairPlan): string {
  const envelope: SerializedRepairPlan = {
    schemaVersion: REPAIR_SCHEMA_VERSION,
    plan: normalizePlan(plan),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Deserialize a RepairPlan from a JSON string.
 *
 * @throws EngineError('REPAIR_DESERIALIZATION_FAILED') on parse or validation failure
 */
export function deserializeRepairPlan(raw: string): RepairPlan {
  const envelope = safeParse(raw);
  assertObject(envelope, 'repair plan envelope');
  assertSchemaVersion((envelope as Record<string, unknown>)['schemaVersion']);

  const plan = (envelope as Record<string, unknown>)['plan'];
  const result = validateRepairPlan(plan);
  if (!result.valid) {
    throw new EngineError(
      'REPAIR_DESERIALIZATION_FAILED',
      `Deserialized RepairPlan failed validation: ${result.errors.join('; ')}`,
    );
  }
  return plan as RepairPlan;
}

// ---------------------------------------------------------------------------
// RehearsalRerunResult serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a RehearsalRerunResult to a deterministic JSON string.
 */
export function serializeRerunResult(result: RehearsalRerunResult): string {
  const envelope: SerializedRerunResult = {
    schemaVersion: REPAIR_SCHEMA_VERSION,
    rerunResult: normalizeRerunResult(result),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Deserialize a RehearsalRerunResult from a JSON string.
 *
 * @throws EngineError('REPAIR_DESERIALIZATION_FAILED') on parse or validation failure
 */
export function deserializeRerunResult(raw: string): RehearsalRerunResult {
  const envelope = safeParse(raw);
  assertObject(envelope, 'rerun result envelope');
  assertSchemaVersion((envelope as Record<string, unknown>)['schemaVersion']);

  const rerunResult = (envelope as Record<string, unknown>)['rerunResult'];
  const result = validateRerunResult(rerunResult);
  if (!result.valid) {
    throw new EngineError(
      'REPAIR_DESERIALIZATION_FAILED',
      `Deserialized RehearsalRerunResult failed validation: ${result.errors.join('; ')}`,
    );
  }
  return rerunResult as RehearsalRerunResult;
}

// ---------------------------------------------------------------------------
// Normalization (stable field order + sorted collections)
// ---------------------------------------------------------------------------

function normalizeRequest(r: RepairRequest): RepairRequest {
  return {
    requestId: r.requestId,
    rehearsalRunId: r.rehearsalRunId,
    differenceId: r.differenceId,
    scenarioId: r.scenarioId,
    ...(r.protectedBehaviorId !== undefined
      ? { protectedBehaviorId: r.protectedBehaviorId }
      : {}),
    originalVerdict: r.originalVerdict,
    reason: r.reason,
    detail: r.detail,
    ...(r.evidenceRef !== undefined ? { evidenceRef: r.evidenceRef } : {}),
    createdAt: r.createdAt,
  };
}

function normalizeAction(a: RepairAction): RepairAction {
  return {
    actionId: a.actionId,
    sequence: a.sequence,
    operation: a.operation,
    ...(a.targetPath !== undefined ? { targetPath: a.targetPath } : {}),
    description: a.description,
    ...(a.expectedOldValue !== undefined ? { expectedOldValue: a.expectedOldValue } : {}),
    ...(a.proposedNewValue !== undefined ? { proposedNewValue: a.proposedNewValue } : {}),
  };
}

function normalizePlan(p: RepairPlan): RepairPlan {
  return {
    repairPlanId: p.repairPlanId,
    requestId: p.requestId,
    targetDifferenceId: p.targetDifferenceId,
    actions: [...p.actions]
      .sort((a, b) => a.sequence - b.sequence)
      .map(normalizeAction),
    rationale: p.rationale,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function normalizeRerunResult(r: RehearsalRerunResult): RehearsalRerunResult {
  return {
    rerunId: r.rerunId,
    repairPlanId: r.repairPlanId,
    requestId: r.requestId,
    originalDifferenceId: r.originalDifferenceId,
    scenarioId: r.scenarioId,
    originalVerdict: r.originalVerdict,
    ...(r.newVerdict !== undefined ? { newVerdict: r.newVerdict } : {}),
    // newComparisonResult is NOT serialized inline — it can be large and
    // contains R06 model types with their own serialization path.
    // Consumers who need the full comparison result should use the R06
    // serialization module directly.
    outcome: r.outcome,
    outcomeDetail: r.outcomeDetail,
    scenarioPlanRef: {
      id: r.scenarioPlanRef.id,
      name: r.scenarioPlanRef.name,
      seedDataRef: r.scenarioPlanRef.seedDataRef,
    },
    rerunAt: r.rerunAt,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new EngineError(
      'REPAIR_DESERIALIZATION_FAILED',
      `Failed to parse R08 JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function assertObject(value: unknown, context: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EngineError(
      'REPAIR_DESERIALIZATION_FAILED',
      `Expected an object for ${context}, got ${Array.isArray(value) ? 'array' : typeof value}`,
    );
  }
}

function assertSchemaVersion(version: unknown): void {
  if (version !== REPAIR_SCHEMA_VERSION) {
    throw new EngineError(
      'REPAIR_DESERIALIZATION_FAILED',
      `Unsupported R08 schema version "${String(version)}". Expected "${REPAIR_SCHEMA_VERSION}".`,
    );
  }
}
