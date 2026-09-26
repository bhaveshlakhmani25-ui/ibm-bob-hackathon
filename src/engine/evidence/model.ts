/**
 * Change Rehearsal — R07 Evidence Capsule Domain Model
 *
 * Defines the typed model for the Evidence Capsule and Regression Report.
 *
 * Design constraints:
 *   - R07 NEVER changes R06 verdicts. ComparisonVerdict is preserved verbatim.
 *   - R07 NEVER invents observations. All evidence traces back to R05/R06 inputs.
 *   - R07 NEVER invents protected behavior. Provenance is preserved verbatim.
 *   - Deterministic IDs: content-derived, no randomness.
 *   - No secrets: sensitive values must remain scrubbed from R05 observations.
 *
 * Owner: Reuben (engine)
 * Phase: R07
 */

import type { ComparisonVerdict, ConfidenceLevel, BehaviorProvenance, ExecutionStatus, ObservationFieldDiff } from '../comparison/model.js';
import type { NormalizedObservation } from '../execution/model.js';

// Re-export these for downstream consumers of the evidence module.
export type { ComparisonVerdict, ConfidenceLevel, BehaviorProvenance };

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Increment when the capsule format changes in a breaking way. */
export const EVIDENCE_CAPSULE_SCHEMA_VERSION = '1.0' as const;

// ---------------------------------------------------------------------------
// Baseline / Candidate Observation Snapshot
// ---------------------------------------------------------------------------

/**
 * A captured observation snapshot for one side of a scenario execution.
 *
 * Contains only the normalized (scrubbed) output — raw sensitive values are
 * never included. This preserves the safety boundary established by R05.
 */
export interface ObservationSnapshot {
  /** Step ID the observation belongs to */
  stepId: string;
  /** 1-based sequence of the step */
  sequence: number;
  /** Execution status of this step */
  status: ExecutionStatus;
  /**
   * Normalized observations captured during this step.
   * Sensitive values (auth headers, secrets) are already scrubbed by R05.
   * Raw unstable values (timestamps, UUIDs) are already replaced with placeholders.
   */
  observations: NormalizedObservation[];
}

// ---------------------------------------------------------------------------
// Evidence Record
// ---------------------------------------------------------------------------

/**
 * A single evidence record linking a behavioral difference back to its
 * concrete execution observations.
 *
 * Every field is traceable back to R05/R06 inputs. Nothing is fabricated.
 */
export interface EvidenceRecord {
  /**
   * Stable, deterministic ID for this evidence record.
   * Format: "evidence-<hex>" derived from (differenceId + scenarioId).
   */
  evidenceId: string;

  /** ID of the R06 BehavioralDifferenceRecord this evidence supports */
  differenceId: string;

  /** ID of the scenario that was executed */
  scenarioId: string;

  /** ID of the source journey */
  journeyId: string;

  /**
   * ID of the primary step where the difference was detected.
   * Undefined when the difference spans multiple steps or is at scenario level.
   */
  primaryStepId?: string;

  /**
   * ID of the protected behavior that was violated (for REGRESSION).
   * Undefined when no protected behavior is linked.
   */
  protectedBehaviorId?: string;

  /** The R06 verdict — preserved exactly, never reinterpreted */
  verdict: ComparisonVerdict;

  /**
   * Baseline step observations (normalized, scrubbed).
   * Ordered by sequence ascending.
   */
  baselineObservations: ObservationSnapshot[];

  /**
   * Candidate step observations (normalized, scrubbed).
   * Ordered by sequence ascending.
   */
  candidateObservations: ObservationSnapshot[];

  /** Field-level diffs extracted from R06 step results */
  fieldDiffs: ObservationFieldDiff[];

  /** One-sentence prose reason for the verdict (from R06 summary) */
  reason: string;

  /** Detailed reasoning (from R06 detail) */
  detail: string;

  /**
   * Confidence level — preserved verbatim from R06.
   * NEVER upgraded by R07.
   */
  confidence: ConfidenceLevel;

  /**
   * Provenance — preserved verbatim from R06.
   * NEVER upgraded or modified by R07.
   */
  provenance: BehaviorProvenance;

  /** Baseline execution status */
  baselineExecutionStatus: ExecutionStatus;

  /** Candidate execution status */
  candidateExecutionStatus: ExecutionStatus;
}

// ---------------------------------------------------------------------------
// Scenario Summary
// ---------------------------------------------------------------------------

/**
 * A lightweight summary of a scenario included in the capsule.
 */
export interface ScenarioSummary {
  scenarioId: string;
  name: string;
  description: string;
  confidence: ConfidenceLevel;
  /** ID of the source journey */
  journeyId: string;
  /** IDs of protected behaviors exercised */
  behaviorIds: string[];
}

// ---------------------------------------------------------------------------
// Journey Reference
// ---------------------------------------------------------------------------

/**
 * A lightweight reference to a journey included in the capsule.
 */
export interface JourneyRef {
  journeyId: string;
  journeyName: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Protected Behavior Reference
// ---------------------------------------------------------------------------

/**
 * A lightweight reference to a protected behavior included in the capsule.
 */
export interface BehaviorRef {
  behaviorId: string;
  description: string;
  confidence: ConfidenceLevel;
  provenance: BehaviorProvenance;
}

// ---------------------------------------------------------------------------
// Capsule Summary
// ---------------------------------------------------------------------------

/**
 * Aggregated summary counts for the capsule.
 */
export interface CapsuleSummary {
  totalScenarios: number;
  totalDifferences: number;
  preserved: number;
  intentionalChanges: number;
  regressions: number;
  potentialDifferences: number;
  inconclusive: number;
  executionFailures: number;
  /** Overall recommendation derived from verdict counts */
  overallVerdict: 'PASS' | 'REVIEW_REQUIRED' | 'REGRESSION_DETECTED';
}

// ---------------------------------------------------------------------------
// Evidence Capsule
// ---------------------------------------------------------------------------

/**
 * The primary R07 artifact — a compact, evidence-backed capsule representing
 * the full results of a rehearsal run.
 *
 * Answers:
 *  1. What changed?           → changeSummary
 *  2. Where did it change?    → scenarioSummaries, journeyRefs
 *  3. What behavior affected? → behaviorRefs
 *  4. What did BASELINE see?  → evidenceRecords[*].baselineObservations
 *  5. What did CANDIDATE see? → evidenceRecords[*].candidateObservations
 *  6. Why classified this way?→ evidenceRecords[*].reason + detail
 *  7. Confidence/provenance?  → evidenceRecords[*].confidence + provenance
 *  8. Can developer inspect?  → evidenceRecords, serialized JSON + Markdown
 */
export interface EvidenceCapsule {
  /**
   * Stable, deterministic capsule identifier.
   * Format: "capsule-<hex>" derived from (rehearsalRunId + sorted differenceIds).
   */
  capsuleId: string;

  /** The rehearsal run this capsule belongs to */
  rehearsalRunId: string;

  /** ISO 8601 timestamp when this capsule was created (runtime — not used for ID) */
  createdAt: string;

  /** Human-readable summary of what changed */
  changeSummary: string;

  /** Human-readable summary of the requirement (if present) */
  requirementSummary?: string;

  /** Lightweight scenario summaries — one per executed scenario */
  scenarioSummaries: ScenarioSummary[];

  /** Journey references — all journeys exercised */
  journeyRefs: JourneyRef[];

  /** Protected behavior references — all behaviors linked to scenarios */
  behaviorRefs: BehaviorRef[];

  /**
   * Evidence records — one per R06 BehavioralDifferenceRecord.
   * Sorted by evidenceId ascending for deterministic ordering.
   */
  evidenceRecords: EvidenceRecord[];

  /** Aggregated summary counts */
  summary: CapsuleSummary;

  /** Schema version for forward compatibility */
  readonly schemaVersion: typeof EVIDENCE_CAPSULE_SCHEMA_VERSION;

  /** Additional metadata for logging and diagnostics */
  metadata?: Record<string, unknown>;
}
