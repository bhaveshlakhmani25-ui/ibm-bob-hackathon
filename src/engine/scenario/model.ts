/**
 * Change Rehearsal — Scenario Domain Model (R04)
 *
 * Defines the richer scenario planning model used for:
 *   - deterministic scenario generation from BehaviorJourney / BehaviorProtectedBehavior
 *   - traceability back to source journey, behavior, and journey steps
 *   - setup/preconditions before scenario execution
 *   - expected observations/assertions that define what "passing" means
 *   - explicit reporting of behaviors that cannot currently be exercised
 *
 * These types are DISTINCT from the pipeline-oriented Scenario type in types.ts.
 * That type is coupled to a change run and consumed by the execution layer.
 * The types here represent a richer, standalone planning model that is independently
 * testable and serializable without running the application.
 *
 * The generator produces ScenarioPlan objects; an adapter in planner.ts converts
 * them to the pipeline Scenario type without modifying either contract.
 *
 * Owner: Reuben (engine)
 * Phase: R04
 */

import type { BehaviorProvenance, ConfidenceLevel } from '../behavior/model.js';

// Re-export for consumers that want to stay within the scenario domain.
export type { ConfidenceLevel, BehaviorProvenance };

// ---------------------------------------------------------------------------
// Traceability
// ---------------------------------------------------------------------------

/**
 * Full traceability record for a generated ScenarioPlan.
 * Every plan must carry one of these; it must not be empty.
 */
export interface ScenarioTraceability {
  /** ID of the BehaviorJourney this scenario was generated from */
  sourceJourneyId: string;
  /** Human-readable name of the source journey (for logs and reports) */
  sourceJourneyName: string;
  /**
   * IDs of the BehaviorProtectedBehavior records that this scenario exercises.
   * May be empty when a journey has no directly associated protected behavior.
   */
  sourceBehaviorIds: string[];
  /**
   * IDs of the BehaviorJourneyStep records that were converted to ScenarioPlanSteps.
   * Ordered by sequence ascending. Enables step-level traceability.
   */
  sourceStepIds: string[];
}

// ---------------------------------------------------------------------------
// Scenario step — action and observation
// ---------------------------------------------------------------------------

/**
 * The kind of interaction a scenario plan step represents.
 * Mirrors BehaviorJourneyStepKind so steps convert cleanly.
 */
export type ScenarioPlanStepKind =
  | 'http'
  | 'auth'
  | 'db'
  | 'ui'
  | 'service_call'
  | 'state_transition'
  | 'function';

/**
 * A single executable step within a scenario plan.
 *
 * Inputs are carried as a plain-object payload (tool-agnostic).
 * Execution adapters interpret the payload; this model does not.
 *
 * `expectedObservation` is a non-binding, human-readable hint describing
 * what the execution result should look like. It is used for documentation,
 * reports, and later assertion scaffolding — NOT for driving comparison logic.
 */
export interface ScenarioPlanStep {
  /** Stable, deterministic identifier for this step */
  id: string;
  /** 1-based execution order within the scenario */
  sequence: number;
  /** The kind of interaction this step represents */
  kind: ScenarioPlanStepKind;
  /** Human-readable description of what this step does */
  description: string;
  /** Tool-agnostic input payload */
  input?: Record<string, unknown>;
  /**
   * Non-binding hint describing the expected outcome of this step.
   * Derived from BehaviorJourneyStep.expectedHint when available.
   */
  expectedObservation?: string;
  /** ID of the source BehaviorJourneyStep this was derived from */
  sourceStepId: string;
}

// ---------------------------------------------------------------------------
// Precondition
// ---------------------------------------------------------------------------

/**
 * A setup precondition that must be established before the scenario runs.
 *
 * For MVP, preconditions are expressed as prose + optional seedDataRef.
 * Later phases may introduce executable precondition steps.
 */
export interface ScenarioPrecondition {
  /** Human-readable description of the required precondition */
  description: string;
  /**
   * Reference to the seed data fixture that satisfies this precondition.
   * Format: "<namespace>/<fixture-name>", e.g. "shopflow/inventory-3-units".
   * Resolved to fixtures/<seedDataRef>/seed.json at execution time.
   */
  seedDataRef?: string;
}

// ---------------------------------------------------------------------------
// Scenario plan
// ---------------------------------------------------------------------------

/**
 * A deterministic, executable rehearsal scenario plan.
 *
 * ScenarioPlan is the R04 domain model — richer than the pipeline Scenario type
 * in types.ts. It carries full traceability, preconditions, and observation hints.
 *
 * IDs are stable and content-derived (no randomness, no timestamps).
 * Same normalized input always produces the same ScenarioPlan ID.
 */
export interface ScenarioPlan {
  /** Stable, deterministic identifier (scenario-<hex>) */
  id: string;
  /** Human-readable name derived from the source journey name */
  name: string;
  /** Prose description of what this scenario verifies */
  description: string;
  /**
   * Confidence level carried over from the source journey/behavior.
   * Never upgraded by the generator — provenance is preserved verbatim.
   */
  confidence: ConfidenceLevel;
  /** Provenance record from the source journey */
  provenance: BehaviorProvenance;
  /** Full traceability back to source journey, behavior(s), and steps */
  traceability: ScenarioTraceability;
  /** Preconditions / setup required before this scenario can be executed */
  preconditions: ScenarioPrecondition[];
  /** Ordered executable steps (sorted by sequence ascending) */
  steps: ScenarioPlanStep[];
  /**
   * Prose summary of the invariant this scenario is protecting.
   * Derived from the associated BehaviorProtectedBehavior.observable +
   * expectedOutcome, or from step expectedHints when no behavior is linked.
   */
  expectedInvariantSummary?: string;
  /**
   * Reference to the seed data fixture for this scenario.
   * Mirrors preconditions[*].seedDataRef for the primary precondition.
   * Carried here for direct access by the execution adapter.
   */
  seedDataRef: string;
  /** Always true — type-level guarantee that this plan is deterministically generated */
  readonly deterministic: true;
}

// ---------------------------------------------------------------------------
// Unexercised behavior report
// ---------------------------------------------------------------------------

/**
 * Explicit report of a behavior or journey that could not be converted into
 * an executable scenario plan.
 *
 * The reason field is mandatory — nothing is silently dropped.
 *
 * These are NOT BehavioralDifference records; they are a planning-time report
 * produced before execution. The pipeline may later convert them to
 * BehavioralDifference(verdict: 'not_exercised') when building the full result.
 */
export interface UnexercisedBehavior {
  /** ID of the source BehaviorJourney or BehaviorProtectedBehavior that could not be exercised */
  sourceId: string;
  /** Human-readable name or description of the unexercised journey/behavior */
  sourceName: string;
  /** Explicit machine-readable reason code */
  reason:
    | 'no_seed_data_ref'       // no fixture could be resolved for this journey
    | 'empty_steps'            // journey has no steps
    | 'unsupported_step_kind'; // one or more steps use a step kind not yet supported
  /** Human-readable explanation for logs and reports */
  explanation: string;
  /** Confidence level of the journey/behavior that was not exercised */
  confidence: ConfidenceLevel;
}

// ---------------------------------------------------------------------------
// Generation result
// ---------------------------------------------------------------------------

/**
 * The complete output of the ScenarioPlanGenerator.
 *
 * `plans` contains all successfully generated scenario plans.
 * `unexercised` contains explicit reports for every behavior/journey that
 * could not be converted — nothing is silently dropped.
 *
 * The generator guarantees:
 * - sourceJourneyIds covered by plans + sourceIds in unexercised = all input journeys
 * - same normalized input always produces the same plans (deterministic)
 */
export interface ScenarioPlanGenerationResult {
  /** Successfully generated scenario plans, sorted by id ascending */
  plans: ScenarioPlan[];
  /**
   * Behaviors/journeys that could not be exercised, with explicit reasons.
   * Sorted by sourceId ascending for deterministic output.
   */
  unexercised: UnexercisedBehavior[];
  /** IDs of source journeys that were covered by at least one generated plan */
  exercisedJourneyIds: string[];
  /** IDs of source behaviors that were covered by at least one generated plan */
  exercisedBehaviorIds: string[];
}
