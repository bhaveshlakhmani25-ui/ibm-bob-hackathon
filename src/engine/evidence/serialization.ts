/**
 * Change Rehearsal — R07 Evidence Capsule Serialization
 *
 * Deterministic serialization for EvidenceCapsule in two formats:
 *   1. JSON — machine-readable, round-trippable
 *   2. Markdown — developer-readable report
 *
 * Serialization guarantees:
 *   - Same EvidenceCapsule always produces the same JSON string.
 *   - Same EvidenceCapsule always produces the same Markdown string.
 *   - Fields are serialized in stable order.
 *   - Collections are sorted deterministically.
 *   - Timestamps are serialized verbatim (not re-parsed).
 *   - No secrets are introduced — R05 scrubbing is preserved.
 *
 * Owner: Reuben (engine)
 * Phase: R07
 */

import type { EvidenceCapsule, EvidenceRecord } from './model.js';
import { EVIDENCE_CAPSULE_SCHEMA_VERSION } from './model.js';
import type { ComparisonVerdict } from '../comparison/model.js';
import { EngineError } from '../errors.js';

// ---------------------------------------------------------------------------
// JSON Serialization
// ---------------------------------------------------------------------------

/**
 * Envelope for a serialized EvidenceCapsule.
 */
export interface SerializedEvidenceCapsule {
  schemaVersion: string;
  capsule: EvidenceCapsule;
}

/**
 * Serialize an EvidenceCapsule to a deterministic JSON string.
 *
 * Field ordering is stable. Collections are sorted:
 *   - evidenceRecords by evidenceId ascending
 *   - scenarioSummaries by scenarioId ascending
 *   - journeyRefs by journeyId ascending
 *   - behaviorRefs by behaviorId ascending
 *   - fieldDiffs by field ascending
 */
export function serializeCapsuleToJson(capsule: EvidenceCapsule): string {
  const normalized = normalizeCapsule(capsule);
  const envelope: SerializedEvidenceCapsule = {
    schemaVersion: EVIDENCE_CAPSULE_SCHEMA_VERSION,
    capsule: normalized,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Deserialize an EvidenceCapsule from a JSON string.
 *
 * @throws EngineError('EVIDENCE_DESERIALIZATION_FAILED') on parse or validation error
 */
export function deserializeCapsuleFromJson(raw: string): EvidenceCapsule {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new EngineError(
      'EVIDENCE_WRITE_FAILED',
      `Failed to parse evidence capsule JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new EngineError(
      'EVIDENCE_WRITE_FAILED',
      'Evidence capsule envelope must be a plain object',
    );
  }

  const envelope = parsed as Record<string, unknown>;

  if (envelope['schemaVersion'] !== EVIDENCE_CAPSULE_SCHEMA_VERSION) {
    throw new EngineError(
      'EVIDENCE_WRITE_FAILED',
      `Unsupported capsule schema version "${String(envelope['schemaVersion'])}". ` +
        `Expected "${EVIDENCE_CAPSULE_SCHEMA_VERSION}".`,
    );
  }

  if (envelope['capsule'] === null || typeof envelope['capsule'] !== 'object') {
    throw new EngineError(
      'EVIDENCE_WRITE_FAILED',
      'Evidence capsule envelope must contain a "capsule" object',
    );
  }

  // Return the capsule — full structural validation is in validation.ts
  return envelope['capsule'] as EvidenceCapsule;
}

// ---------------------------------------------------------------------------
// Normalization (stable field order + sorted collections)
// ---------------------------------------------------------------------------

function normalizeCapsule(capsule: EvidenceCapsule): EvidenceCapsule {
  return {
    capsuleId: capsule.capsuleId,
    rehearsalRunId: capsule.rehearsalRunId,
    createdAt: capsule.createdAt,
    changeSummary: capsule.changeSummary,
    ...(capsule.requirementSummary !== undefined
      ? { requirementSummary: capsule.requirementSummary }
      : {}),
    scenarioSummaries: [...capsule.scenarioSummaries]
      .sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))
      .map((s) => ({
        scenarioId: s.scenarioId,
        name: s.name,
        description: s.description,
        confidence: s.confidence,
        journeyId: s.journeyId,
        behaviorIds: [...s.behaviorIds].sort(),
      })),
    journeyRefs: [...capsule.journeyRefs]
      .sort((a, b) => a.journeyId.localeCompare(b.journeyId))
      .map((j) => ({
        journeyId: j.journeyId,
        journeyName: j.journeyName,
        description: j.description,
      })),
    behaviorRefs: [...capsule.behaviorRefs]
      .sort((a, b) => a.behaviorId.localeCompare(b.behaviorId))
      .map((b) => ({
        behaviorId: b.behaviorId,
        description: b.description,
        confidence: b.confidence,
        provenance: {
          confidence: b.provenance.confidence,
          ...(b.provenance.sourceRef !== undefined ? { sourceRef: b.provenance.sourceRef } : {}),
          ...(b.provenance.sourceKind !== undefined ? { sourceKind: b.provenance.sourceKind } : {}),
        },
      })),
    evidenceRecords: [...capsule.evidenceRecords]
      .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId))
      .map(normalizeEvidenceRecord),
    summary: { ...capsule.summary },
    schemaVersion: EVIDENCE_CAPSULE_SCHEMA_VERSION,
    ...(capsule.metadata !== undefined ? { metadata: capsule.metadata } : {}),
  };
}

function normalizeEvidenceRecord(r: EvidenceRecord): EvidenceRecord {
  return {
    evidenceId: r.evidenceId,
    differenceId: r.differenceId,
    scenarioId: r.scenarioId,
    journeyId: r.journeyId,
    ...(r.primaryStepId !== undefined ? { primaryStepId: r.primaryStepId } : {}),
    ...(r.protectedBehaviorId !== undefined
      ? { protectedBehaviorId: r.protectedBehaviorId }
      : {}),
    verdict: r.verdict,
    baselineObservations: [...r.baselineObservations].sort((a, b) => a.sequence - b.sequence),
    candidateObservations: [...r.candidateObservations].sort((a, b) => a.sequence - b.sequence),
    fieldDiffs: [...r.fieldDiffs].sort((a, b) => a.field.localeCompare(b.field)),
    reason: r.reason,
    detail: r.detail,
    confidence: r.confidence,
    provenance: {
      confidence: r.provenance.confidence,
      ...(r.provenance.sourceRef !== undefined ? { sourceRef: r.provenance.sourceRef } : {}),
      ...(r.provenance.sourceKind !== undefined ? { sourceKind: r.provenance.sourceKind } : {}),
    },
    baselineExecutionStatus: r.baselineExecutionStatus,
    candidateExecutionStatus: r.candidateExecutionStatus,
  };
}

// ---------------------------------------------------------------------------
// Markdown Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize an EvidenceCapsule to a developer-readable Markdown report.
 *
 * Markdown structure:
 *   # Change Rehearsal Report
 *   ## Summary
 *   ## Behavioral Differences       (sorted by verdict priority, then evidenceId)
 *   ### <protected_behavior_desc>
 *   ## Preserved Behaviors
 *   ## Execution
 *   ## Traceability
 *   ## Evidence Records
 */
export function serializeCapsuleToMarkdown(capsule: EvidenceCapsule): string {
  const lines: string[] = [];

  lines.push('# Change Rehearsal Report');
  lines.push('');

  // ---------------------------------------------------------------------------
  // Summary section
  // ---------------------------------------------------------------------------
  lines.push('## Summary');
  lines.push('');
  lines.push(`Run: ${capsule.rehearsalRunId}`);
  lines.push('');
  lines.push(`Result: ${capsule.summary.overallVerdict}`);
  lines.push('');
  lines.push(`Generated: ${capsule.createdAt}`);
  lines.push('');
  lines.push(`Change: ${capsule.changeSummary}`);
  lines.push('');
  if (capsule.requirementSummary) {
    lines.push(`Requirement: ${capsule.requirementSummary}`);
    lines.push('');
  }
  lines.push(`Total scenarios: ${capsule.summary.totalScenarios}`);
  lines.push(`Preserved: ${capsule.summary.preserved}`);
  lines.push(`Intentional changes: ${capsule.summary.intentionalChanges}`);
  lines.push(`Regressions: ${capsule.summary.regressions}`);
  lines.push(`Potential differences: ${capsule.summary.potentialDifferences}`);
  lines.push(`Inconclusive: ${capsule.summary.inconclusive}`);
  lines.push(`Execution failures: ${capsule.summary.executionFailures}`);
  lines.push('');

  // ---------------------------------------------------------------------------
  // Behavioral Differences section (REGRESSION and POTENTIAL_DIFFERENCE)
  // ---------------------------------------------------------------------------
  const nonPreservedRecords = [...capsule.evidenceRecords]
    .filter((r) => r.verdict !== 'PRESERVED' && r.verdict !== 'INTENTIONAL_CHANGE')
    .sort((a, b) => verdictPriority(a.verdict) - verdictPriority(b.verdict) || a.evidenceId.localeCompare(b.evidenceId));

  if (nonPreservedRecords.length > 0) {
    lines.push('## Behavioral Differences');
    lines.push('');

    for (const record of nonPreservedRecords) {
      const behaviorRef = record.protectedBehaviorId
        ? capsule.behaviorRefs.find((b) => b.behaviorId === record.protectedBehaviorId)
        : undefined;

      const title = behaviorRef?.description ?? record.reason;
      lines.push(`### ${title}`);
      lines.push('');
      lines.push(`Verdict: ${record.verdict}`);
      lines.push('');
      lines.push(`Confidence: ${record.confidence}`);
      lines.push('');

      // Baseline observations
      const baselineFields = getDisplayValues(record, 'baseline');
      if (baselineFields.length > 0) {
        lines.push('BASELINE:');
        for (const [field, value] of baselineFields) {
          lines.push(`  ${field} = ${formatValue(value)}`);
        }
        lines.push('');
      }

      // Candidate observations
      const candidateFields = getDisplayValues(record, 'candidate');
      if (candidateFields.length > 0) {
        lines.push('CANDIDATE:');
        for (const [field, value] of candidateFields) {
          lines.push(`  ${field} = ${formatValue(value)}`);
        }
        lines.push('');
      }

      lines.push(`Reason: ${record.reason}`);
      lines.push('');

      if (record.detail && record.detail !== record.reason) {
        lines.push(`Detail: ${record.detail}`);
        lines.push('');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Preserved Behaviors section
  // ---------------------------------------------------------------------------
  const preservedRecords = capsule.evidenceRecords
    .filter((r) => r.verdict === 'PRESERVED')
    .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));

  if (preservedRecords.length > 0) {
    lines.push('## Preserved Behaviors');
    lines.push('');

    for (const record of preservedRecords) {
      const journeyRef = capsule.journeyRefs.find((j) => j.journeyId === record.journeyId);
      const journeyName = journeyRef?.journeyName ?? record.journeyId;
      lines.push(`- ${journeyName}: PRESERVED (confidence: ${record.confidence})`);
    }
    lines.push('');
  }

  // ---------------------------------------------------------------------------
  // Intentional Changes section
  // ---------------------------------------------------------------------------
  const intentionalRecords = capsule.evidenceRecords
    .filter((r) => r.verdict === 'INTENTIONAL_CHANGE')
    .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));

  if (intentionalRecords.length > 0) {
    lines.push('## Intentional Changes');
    lines.push('');

    for (const record of intentionalRecords) {
      const journeyRef = capsule.journeyRefs.find((j) => j.journeyId === record.journeyId);
      const journeyName = journeyRef?.journeyName ?? record.journeyId;
      lines.push(`- ${journeyName}: INTENTIONAL_CHANGE (confidence: ${record.confidence})`);
      if (record.fieldDiffs.length > 0) {
        for (const fd of record.fieldDiffs) {
          lines.push(`    ${fd.field}: ${formatValue(fd.baselineValue)} → ${formatValue(fd.candidateValue)}`);
        }
      }
    }
    lines.push('');
  }

  // ---------------------------------------------------------------------------
  // Execution section
  // ---------------------------------------------------------------------------
  lines.push('## Execution');
  lines.push('');

  const allRecords = [...capsule.evidenceRecords].sort((a, b) =>
    a.evidenceId.localeCompare(b.evidenceId),
  );

  for (const record of allRecords) {
    lines.push(`Scenario: ${record.scenarioId}`);
    lines.push(`  BASELINE: ${record.baselineExecutionStatus}`);
    lines.push(`  CANDIDATE: ${record.candidateExecutionStatus}`);
    lines.push(`  Verdict: ${record.verdict}`);
  }
  lines.push('');

  // ---------------------------------------------------------------------------
  // Evidence section
  // ---------------------------------------------------------------------------
  if (allRecords.length > 0) {
    lines.push('## Evidence');
    lines.push('');

    for (const record of allRecords) {
      lines.push(`Scenario: ${record.scenarioId}`);

      if (record.primaryStepId) {
        lines.push(`Step: ${record.primaryStepId}`);
      }

      if (record.fieldDiffs.length > 0) {
        lines.push('Difference:');
        for (const fd of record.fieldDiffs) {
          lines.push(`  ${fd.field}: baseline=${formatValue(fd.baselineValue)}, candidate=${formatValue(fd.candidateValue)}`);
        }
      }
      lines.push('');
    }
  }

  // ---------------------------------------------------------------------------
  // Traceability section
  // ---------------------------------------------------------------------------
  lines.push('## Traceability');
  lines.push('');

  for (const record of allRecords) {
    const journeyRef = capsule.journeyRefs.find((j) => j.journeyId === record.journeyId);
    const behaviorRef = record.protectedBehaviorId
      ? capsule.behaviorRefs.find((b) => b.behaviorId === record.protectedBehaviorId)
      : undefined;

    lines.push(`Journey: ${journeyRef?.journeyName ?? record.journeyId}`);
    lines.push(`Scenario: ${record.scenarioId}`);
    if (behaviorRef) {
      lines.push(`Protected behavior: ${behaviorRef.description}`);
    }
    lines.push(`Difference: ${record.differenceId}`);
    lines.push(`Verdict: ${record.verdict}`);
    lines.push(`Confidence: ${record.confidence}`);
    if (record.provenance.sourceRef) {
      lines.push(`Provenance: ${record.provenance.sourceRef}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

/**
 * Priority ordering for verdict display in the report.
 * Lower number = higher priority (shown first).
 */
function verdictPriority(verdict: ComparisonVerdict): number {
  switch (verdict) {
    case 'REGRESSION': return 1;
    case 'POTENTIAL_DIFFERENCE': return 2;
    case 'INCONCLUSIVE': return 3;
    case 'INTENTIONAL_CHANGE': return 4;
    case 'PRESERVED': return 5;
    default: return 6;
  }
}

/**
 * Extract (field, value) pairs for display from an evidence record.
 * Uses fieldDiffs first, then falls back to observation data.
 */
function getDisplayValues(
  record: EvidenceRecord,
  side: 'baseline' | 'candidate',
): [string, unknown][] {
  if (record.fieldDiffs.length > 0) {
    return record.fieldDiffs.map((fd) => [fd.field, side === 'baseline' ? fd.baselineValue : fd.candidateValue]);
  }

  // Fallback: show the top-level observation normalized values
  const snapshots = side === 'baseline' ? record.baselineObservations : record.candidateObservations;
  const result: [string, unknown][] = [];

  for (const snapshot of snapshots.slice(0, 3)) {
    for (const obs of snapshot.observations.slice(0, 3)) {
      if (obs.normalizedValue !== null && obs.normalizedValue !== undefined) {
        result.push([`step-${snapshot.sequence}.${obs.kind}`, obs.normalizedValue]);
      }
    }
  }

  return result;
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
