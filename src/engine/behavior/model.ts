/**
 * Change Rehearsal — Behavior / Journey Domain Model (R03)
 *
 * Defines the structured behavior model used for:
 *   - impact analysis
 *   - scenario generation
 *   - journey rehearsal
 *   - behavioral comparison
 *   - regression detection
 *
 * These types are DISTINCT from the pipeline-oriented Journey/ProtectedBehavior
 * types in types.ts. Those are coupled to a specific change run (they carry
 * changeId). The types here represent reusable, standalone behavioral contracts
 * that can be registered, validated, and serialized independently of any run.
 *
 * Owner: Reuben (engine)
 * Phase: R03
 */

import type { ConfidenceLevel } from '../types.js';

// Re-export ConfidenceLevel so callers can import it from here without
// coupling to the pipeline types module.
export type { ConfidenceLevel };

// ---------------------------------------------------------------------------
// Provenance / Evidence
// ---------------------------------------------------------------------------

/**
 * The kind of source a behavior or journey was derived from.
 *
 * - test               — extracted from an existing test file
 * - contract           — extracted from an OpenAPI / JSON Schema contract
 * - requirement        — derived from a written requirement or acceptance criterion
 * - developer_declaration — explicitly declared by the developer (highest trust)
 * - inference          — inferred by an AI/LLM or heuristic (lowest trust)
 */
export type BehaviorSourceKind =
  | 'test'
  | 'contract'
  | 'requirement'
  | 'developer_declaration'
  | 'inference';

/**
 * Provenance record describing where a behavior or journey came from.
 *
 * Rules:
 * - Confidence ordering: confirmed > test_derived > contract_derived > inferred
 * - No downstream module may upgrade confidence without explicit developer action.
 * - `sourceRef` should be a human-readable reference (file path, URL, issue ID, etc.)
 */
export interface BehaviorProvenance {
  /** How confident we are in this behavior (maps to ConfidenceLevel ordering) */
  confidence: ConfidenceLevel;
  /**
   * Optional reference describing the origin.
   * Examples: "test/checkout.test.ts", "openapi.yaml#/paths/~1products", "JIRA-42"
   */
  sourceRef?: string;
  /** Categorical classification of the source */
  sourceKind?: BehaviorSourceKind;
}

// ---------------------------------------------------------------------------
// Journey Step
// ---------------------------------------------------------------------------

/**
 * The kind of interaction a journey step represents.
 * Tool-agnostic: does NOT imply a specific HTTP library, browser driver, or DB client.
 */
export type BehaviorJourneyStepKind =
  | 'http'
  | 'auth'
  | 'db'
  | 'ui'
  | 'service_call'
  | 'state_transition'
  | 'function';

/**
 * A single meaningful interaction or operation within a journey.
 *
 * The `input` field is intentionally untyped at the domain level so this
 * model remains tool-agnostic. Execution adapters interpret it.
 */
export interface BehaviorJourneyStep {
  /** Stable, deterministic identifier for this step */
  id: string;
  /** 1-based execution order within the journey */
  sequence: number;
  /** The kind of application interaction this step represents */
  kind: BehaviorJourneyStepKind;
  /** Human-readable description of what this step does */
  description: string;
  /** Tool-agnostic input payload (HTTP body, DB query, function args, etc.) */
  input?: Record<string, unknown>;
  /** Non-binding hint for comparators about the expected outcome */
  expectedHint?: string;
}

// ---------------------------------------------------------------------------
// Journey
// ---------------------------------------------------------------------------

/**
 * An ordered sequence of meaningful application steps representing a
 * user or system journey.
 *
 * IDs must be stable and deterministic (generated from name + description).
 * Steps must be non-empty and ordered by sequence.
 */
export interface BehaviorJourney {
  /** Stable, deterministic identifier for this journey */
  id: string;
  /** Short human-readable name, used as the primary key for deduplication */
  name: string;
  /** Prose description of the journey's purpose */
  description: string;
  /** Optional entry point (e.g. "POST /checkout", "LoginPage", "cron:nightly-sync") */
  entryPoint?: string;
  /** Ordered steps; must be non-empty */
  steps: BehaviorJourneyStep[];
  /** Free-form categorization tags */
  tags?: string[];
  /** Application areas this journey exercises (used for impact-area lookup) */
  affectedAreas?: string[];
  /** Where this journey definition came from */
  provenance: BehaviorProvenance;
  /** Rolled-up confidence level for the journey as a whole */
  confidence: ConfidenceLevel;
}

// ---------------------------------------------------------------------------
// Protected Behavior
// ---------------------------------------------------------------------------

/**
 * Severity of a protected behavior violation.
 * Used to prioritize regression triage.
 */
export type BehaviorSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * A behavior that Change Rehearsal must protect during a proposed change.
 *
 * A ProtectedBehavior is an invariant: if it is violated the change introduces a regression.
 * It may be exercised by one or more journeys (relatedJourneyIds).
 */
export interface BehaviorProtectedBehavior {
  /** Stable, deterministic identifier */
  id: string;
  /** Human-readable description of the invariant */
  description: string;
  /** What to observe to verify this behavior holds */
  observable: string;
  /** What the observed outcome must be for the behavior to be considered intact */
  expectedOutcome: string;
  /** Where this behavior definition came from */
  provenance: BehaviorProvenance;
  /** Rolled-up confidence level for this behavior */
  confidence: ConfidenceLevel;
  /** IDs of BehaviorJourney records that exercise this behavior */
  relatedJourneyIds: string[];
  /** How important this behavior is for prioritizing regressions */
  severity?: BehaviorSeverity;
}
