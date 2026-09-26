/**
 * JourneyReplayView — B05 Change Rehearsal Journey Replay experience.
 *
 * Answers: "Where exactly did the behavior diverge in this journey?"
 *
 * Displays:
 *  1. Header: "Journey Replay", rehearsal ID, requirement
 *  2. Journey summary: name, overall verdict, confidence
 *  3. Step timeline: ordered steps, divergent step visually marked
 *  4. Selected step panel: action, expected hint, baseline result, candidate
 *     result, verdict, explanation
 *  5. Empty / no-replay state
 *  6. API failure state
 *
 * Contracts used:
 *  - JourneyReplayDetail    (§4.4a)
 *  - ReplayStepResult       (§4.4a)
 *  - Verdict, ConfidenceLevel  (§4.3 enums)
 *
 * Source of truth: canonical `verdict` and `changed` fields from the engine.
 * The UI NEVER infers divergence from text comparison.
 */
import { useEffect, useState } from "react";
import type {
  JourneyReplayDetail,
  ReplayStepResult,
  Verdict,
  ConfidenceLevel,
} from "../../../src/shared/contracts";
import { getJourneyReplay } from "../services/api";
import { EvidenceCapsuleView } from "./EvidenceCapsuleView";

// ---------------------------------------------------------------------------
// Display helpers (same palette as B04)
// ---------------------------------------------------------------------------

interface VerdictMeta {
  label: string;
  cssClass: string;
  symbol: string;
}

const VERDICT_META: Record<Verdict, VerdictMeta> = {
  preserved: { label: "Preserved", cssClass: "verdict-preserved", symbol: "✓" },
  intentional_change: {
    label: "Intentional Change",
    cssClass: "verdict-intentional",
    symbol: "~",
  },
  regression: { label: "Regression", cssClass: "verdict-regression", symbol: "✗" },
  potentially_affected: {
    label: "Potentially Affected",
    cssClass: "verdict-potential",
    symbol: "?",
  },
  not_exercised: {
    label: "Not Exercised",
    cssClass: "verdict-not-exercised",
    symbol: "○",
  },
};

const CONFIDENCE_META: Record<ConfidenceLevel, { label: string; cssClass: string }> = {
  confirmed: { label: "confirmed", cssClass: "conf-confirmed" },
  test_derived: { label: "test-derived", cssClass: "conf-test" },
  contract_derived: { label: "contract-derived", cssClass: "conf-contract" },
  inferred: { label: "inferred", cssClass: "conf-inferred" },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const meta = VERDICT_META[verdict];
  return (
    <span className={`diff-verdict-badge ${meta.cssClass}`} data-verdict={verdict}>
      {meta.symbol} {meta.label}
    </span>
  );
}

function ConfidencePill({
  source,
  score,
}: {
  source?: ConfidenceLevel;
  score?: number;
}) {
  if (!source) return null;
  const meta = CONFIDENCE_META[source];
  return (
    <span className={`conf-pill ${meta.cssClass}`} title={`Confidence: ${source}`}>
      {meta.label}
      {score !== undefined && (
        <span className="conf-score"> {Math.round(score * 100)}%</span>
      )}
    </span>
  );
}

/** Journey summary bar shown below the header */
function JourneySummaryBar({ replay }: { replay: JourneyReplayDetail }) {
  return (
    <div className="jrv-summary" data-testid="jrv-summary">
      <div className="jrv-summary-name" data-testid="jrv-journey-name">
        {replay.journey.name}
      </div>
      <div className="jrv-summary-meta">
        <VerdictBadge verdict={replay.overall_verdict} />
        {replay.confidence_source && (
          <ConfidencePill
            source={replay.confidence_source}
            score={replay.confidence_score}
          />
        )}
      </div>
    </div>
  );
}

/** Left-side timeline showing all steps; divergent step marked */
function StepTimeline({
  steps,
  selectedIndex,
  onSelect,
}: {
  steps: ReplayStepResult[];
  selectedIndex: number;
  onSelect: (idx: number) => void;
}) {
  return (
    <ol className="jrv-timeline" data-testid="jrv-timeline" aria-label="Journey steps">
      {steps.map((step, idx) => {
        const meta = VERDICT_META[step.verdict];
        const isSelected = idx === selectedIndex;
        const isDivergent = step.changed;
        return (
          <li
            key={step.step_id}
            className={[
              "jrv-timeline-item",
              isSelected ? "jrv-timeline-selected" : "",
              isDivergent ? "jrv-timeline-divergent" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid={`jrv-step-${step.sequence}`}
            aria-selected={isSelected}
            role="option"
            onClick={() => onSelect(idx)}
          >
            <span className="jrv-step-seq" aria-hidden="true">
              {String(step.sequence).padStart(2, "0")}
            </span>
            <span className="jrv-step-connector" aria-hidden="true">─</span>
            <span className="jrv-step-name">{step.name}</span>
            {isDivergent && (
              <span
                className={`diff-verdict-badge ${meta.cssClass} jrv-divergent-badge`}
                title="Divergence detected at this step"
                data-testid={`jrv-divergent-badge-${step.sequence}`}
              >
                {meta.symbol}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Renders a single observation output panel */
function ObservationPanel({
  label,
  observation,
  side,
}: {
  label: string;
  observation: ReplayStepResult["baseline_result"];
  side: "baseline" | "candidate";
}) {
  const content =
    observation == null
      ? "—"
      : typeof observation.raw_output === "string"
        ? observation.raw_output
        : JSON.stringify(observation.raw_output, null, 2);

  return (
    <div className={`jrv-obs-panel jrv-obs-${side}`} data-testid={`jrv-obs-${side}`}>
      <div className="jrv-obs-label">{label}</div>
      <pre className="jrv-obs-output">{content}</pre>
    </div>
  );
}

/** The main step detail panel shown when a step is selected */
function StepDetailPanel({ step }: { step: ReplayStepResult }) {
  return (
    <div
      className={`jrv-step-panel${step.changed ? " jrv-step-panel-divergent" : ""}`}
      data-testid="jrv-step-panel"
    >
      {/* Step header */}
      <div className="jrv-step-panel-header">
        <span className="jrv-step-panel-seq">
          Step {String(step.sequence).padStart(2, "0")}
        </span>
        <span className="jrv-step-panel-name" data-testid="jrv-step-name">
          {step.name}
        </span>
        <VerdictBadge verdict={step.verdict} />
        {step.confidence_source && (
          <ConfidencePill
            source={step.confidence_source}
            score={step.confidence_score}
          />
        )}
      </div>

      {/* Action / request */}
      <div className="jrv-step-action-row">
        <span className="jrv-step-action-label">Action</span>
        <code className="jrv-step-action" data-testid="jrv-step-action">
          {step.action}
        </code>
      </div>

      {/* Expected / protected behavior hint */}
      {step.expected_hint && (
        <div className="jrv-step-hint" data-testid="jrv-step-hint">
          <span className="jrv-step-hint-label">Expected</span>
          <span>{step.expected_hint}</span>
        </div>
      )}

      {/* Baseline / Candidate split */}
      <div className="jrv-obs-split">
        <ObservationPanel
          label="BASELINE"
          observation={step.baseline_result}
          side="baseline"
        />
        <ObservationPanel
          label="CANDIDATE"
          observation={step.candidate_result}
          side="candidate"
        />
      </div>

      {/* What changed? — only when engine flagged divergence */}
      {step.changed && step.explanation && (
        <div className="jrv-step-divergence" data-testid="jrv-step-divergence">
          <span className="jrv-divergence-label">⚠ BEHAVIOR DIVERGED</span>
          <p className="jrv-divergence-text">{step.explanation}</p>
        </div>
      )}

      {/* Non-divergent steps: plain explanation */}
      {!step.changed && step.explanation && (
        <div className="jrv-step-explanation" data-testid="jrv-step-explanation">
          <p className="jrv-explanation-text">{step.explanation}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface JourneyReplayViewProps {
  /** The rehearsal run_id */
  runId: string;
  /** The journey to replay */
  journeyId: string;
  /** Developer's original requirement text */
  requirement: string;
  /** Navigate back to the Behavioral Diff without losing context */
  onBack: () => void;
  /** View the Evidence Capsule for this journey */
  onViewEvidence?: () => void;
}

export function JourneyReplayView({
  runId,
  journeyId,
  requirement,
  onBack,
  onViewEvidence,
}: JourneyReplayViewProps) {
  const [replay, setReplay] = useState<JourneyReplayDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const [showCapsule, setShowCapsule] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchReplay() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const data = await getJourneyReplay(runId, journeyId);
        if (!cancelled) {
          setReplay(data);
          // Auto-select the first divergent step, else first step
          const divergentIdx = data.steps.findIndex((s) => s.changed);
          setSelectedStepIndex(divergentIdx >= 0 ? divergentIdx : 0);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? err.message
              : "Failed to load journey replay.",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchReplay();
    return () => {
      cancelled = true;
    };
  }, [runId, journeyId]);

  // Navigate to Evidence Capsule view
  if (showCapsule) {
    return (
      <EvidenceCapsuleView
        runId={runId}
        requirement={requirement}
        onBack={() => setShowCapsule(false)}
      />
    );
  }

  return (
    <div className="jrv-view" data-testid="jrv-view">
      {/* Compact Header */}
      <div className="jrv-header">
        <div className="jrv-header-left">
          <button
            className="btn-secondary jrv-back-btn"
            onClick={onBack}
            data-testid="jrv-back-btn"
            aria-label="Back to Behavioral Diff"
          >
            ← BACK
          </button>
          <button
            className="btn-secondary jrv-capsule-btn"
            onClick={() => setShowCapsule(true)}
            data-testid="jrv-capsule-btn"
            aria-label="View Evidence Capsule"
          >
            Evidence Capsule
          </button>
          <div className="jrv-header-meta">
            <span className="jrv-header-label">JOURNEY REPLAY</span>
            <code className="run-id-badge" data-testid="jrv-run-id">{runId}</code>
          </div>
        </div>
        <div className="jrv-header-right" style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <div className="jrv-header-requirement" data-testid="jrv-requirement">
            <span className="jrv-req-label">REQ</span>
            <span className="jrv-req-text">{requirement}</span>
          </div>
          {onViewEvidence && (
            <button
              className="btn-secondary"
              onClick={onViewEvidence}
              data-testid="jrv-evidence-btn"
            >
              View Evidence
            </button>
          )}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="bdiff-loading" data-testid="jrv-loading">
          <span className="spinner" />
          <span>Loading journey replay…</span>
        </div>
      )}

      {/* API / network error */}
      {!isLoading && loadError && (
        <div
          className="poll-error-banner"
          role="alert"
          data-testid="jrv-error"
        >
          <strong>Failed to load journey replay</strong>
          <span>{loadError}</span>
        </div>
      )}

      {/* No steps */}
      {!isLoading && !loadError && replay && replay.steps.length === 0 && (
        <div className="diff-empty" data-testid="jrv-empty">
          <p className="diff-empty-title">No replay steps</p>
          <p className="diff-empty-body">
            The rehearsal engine did not produce any step results for this
            journey. This may mean the journey was not exercised.
          </p>
        </div>
      )}

      {/* Main replay layout */}
      {!isLoading && !loadError && replay && replay.steps.length > 0 && (
        <>
          <JourneySummaryBar replay={replay} />

          <div className="jrv-body">
            <StepTimeline
              steps={replay.steps}
              selectedIndex={selectedStepIndex}
              onSelect={setSelectedStepIndex}
            />

            <div className="jrv-step-detail-container">
              <div className="jrv-step-nav">
                <button
                  className="btn-nav"
                  disabled={selectedStepIndex === 0}
                  onClick={() => setSelectedStepIndex((prev) => Math.max(0, prev - 1))}
                >
                  ↑ Previous Step
                </button>
                <button
                  className="btn-nav"
                  disabled={selectedStepIndex === replay.steps.length - 1}
                  onClick={() => setSelectedStepIndex((prev) => Math.min(replay.steps.length - 1, prev + 1))}
                >
                  Next Step ↓
                </button>
              </div>
              <StepDetailPanel step={replay.steps[selectedStepIndex]} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
