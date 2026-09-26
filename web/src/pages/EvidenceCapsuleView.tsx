/**
 * EvidenceCapsuleView — B06 Change Rehearsal Evidence Capsule experience.
 *
 * Answers: "What is the portable proof for this rehearsal?"
 *
 * Displays:
 *  1. CAPSULE HEADER  — Evidence Capsule label, run ID, capsule version, requirement
 *  2. CHANGE CONTEXT  — base branch, candidate/change source
 *  3. VERDICT         — canonical verdict, confidence, confidence source
 *  4. BEHAVIORAL EVIDENCE — baseline obs, candidate obs, changed flag, explanation
 *  5. JOURNEY REPLAY  — affected journey, ordered steps, divergent step highlighted
 *  6. REPRODUCTION    — engine-provided reproduction steps only (never invented)
 *  7. ERRORS / WARNINGS — error_code + human-readable message (F-05)
 *  8. EXPORT          — copy / download canonical JSON (same object shown in UI)
 *
 * Contracts used:
 *  - EvidenceCapsule       (§4.6, B06)
 *  - CapsuleReplayStep     (§4.6)
 *  - Verdict, ConfidenceLevel, FinalVerdict  (§4.3 enums)
 *
 * SOURCE OF TRUTH: verdict, confidence, changed, error_code are never inferred
 * by this component.  Every value displayed is taken directly from the capsule.
 *
 * EXPORT: The JSON downloaded by the user is produced by JSON.stringify() on
 * the same EvidenceCapsule object used to render the UI — no divergence.
 */
import { useEffect, useState } from "react";
import type {
  EvidenceCapsule,
  CapsuleReplayStep,
  Verdict,
  ConfidenceLevel,
  FinalVerdict,
} from "../../../src/shared/contracts";
import { getEvidenceCapsule } from "../services/api";

// ---------------------------------------------------------------------------
// Display helpers
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

const FINAL_VERDICT_META: Record<FinalVerdict, { label: string; cssClass: string }> = {
  ready_to_merge: { label: "Ready to Merge", cssClass: "final-ready" },
  review_required: { label: "Review Required", cssClass: "final-review" },
  build_failed: { label: "Build Failed", cssClass: "final-failed" },
};

const CONFIDENCE_META: Record<ConfidenceLevel, { label: string; cssClass: string }> = {
  confirmed: { label: "confirmed", cssClass: "conf-confirmed" },
  test_derived: { label: "test-derived", cssClass: "conf-test" },
  contract_derived: { label: "contract-derived", cssClass: "conf-contract" },
  inferred: { label: "inferred", cssClass: "conf-inferred" },
};

// ---------------------------------------------------------------------------
// Small shared sub-components
// ---------------------------------------------------------------------------

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const meta = VERDICT_META[verdict];
  return (
    <span
      className={`diff-verdict-badge ${meta.cssClass}`}
      data-verdict={verdict}
    >
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

// ---------------------------------------------------------------------------
// Section: Capsule Header
// ---------------------------------------------------------------------------

function CapsuleHeader({
  capsule,
}: {
  capsule: EvidenceCapsule;
}) {
  return (
    <div className="ecv-header" data-testid="ecv-header">
      <div className="ecv-header-title-row">
        <span className="ecv-header-label">EVIDENCE CAPSULE</span>
        <span className="ecv-version-badge" data-testid="ecv-version">
          v{capsule.metadata.capsule_format_version}
        </span>
      </div>
      <div className="ecv-header-meta-row">
        <code className="run-id-badge" data-testid="ecv-run-id">
          {capsule.metadata.run_id}
        </code>
        {capsule.metadata.generated_at && (
          <span className="ecv-generated-at" data-testid="ecv-generated-at">
            Generated: {capsule.metadata.generated_at}
          </span>
        )}
      </div>
      <div className="ecv-requirement-row" data-testid="ecv-requirement">
        <span className="ecv-req-label">REQ</span>
        <span className="ecv-req-text">{capsule.requirement.text}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Change Context
// ---------------------------------------------------------------------------

function ChangeContextSection({ capsule }: { capsule: EvidenceCapsule }) {
  return (
    <section className="ecv-section" data-testid="ecv-change-context">
      <h2 className="ecv-section-title">CHANGE CONTEXT</h2>
      <div className="ecv-kv-grid">
        <span className="ecv-key">Base</span>
        <code className="ecv-val" data-testid="ecv-base-ref">
          {capsule.change.base_ref}
        </code>
        <span className="ecv-key">Candidate</span>
        <code className="ecv-val" data-testid="ecv-candidate-ref">
          {capsule.change.candidate_ref}
        </code>
        {capsule.change.pr_number !== undefined && (
          <>
            <span className="ecv-key">PR</span>
            <span className="ecv-val" data-testid="ecv-pr-number">
              #{capsule.change.pr_number}
            </span>
          </>
        )}
        {capsule.change.diff_summary && (
          <>
            <span className="ecv-key">Summary</span>
            <span className="ecv-val" data-testid="ecv-diff-summary">
              {capsule.change.diff_summary}
            </span>
          </>
        )}
        {capsule.change.affected_files && capsule.change.affected_files.length > 0 && (
          <>
            <span className="ecv-key">Affected Files</span>
            <span className="ecv-val" data-testid="ecv-affected-files">
              {capsule.change.affected_files.join(", ")}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Verdict
// ---------------------------------------------------------------------------

function VerdictSection({ capsule }: { capsule: EvidenceCapsule }) {
  const { verdict } = capsule;
  const finalMeta = FINAL_VERDICT_META[verdict.final_verdict];
  return (
    <section className="ecv-section" data-testid="ecv-verdict-section">
      <h2 className="ecv-section-title">VERDICT</h2>
      <div className="ecv-verdict-block">
        <div className="ecv-verdict-row">
          <span className="ecv-key">Journey Verdict</span>
          <VerdictBadge verdict={verdict.verdict} />
        </div>
        <div className="ecv-verdict-row">
          <span className="ecv-key">Overall Result</span>
          <span
            className={`diff-verdict-badge ${finalMeta.cssClass}`}
            data-testid="ecv-final-verdict"
          >
            {finalMeta.label}
          </span>
        </div>
        {verdict.confidence_source && (
          <div className="ecv-verdict-row">
            <span className="ecv-key">Confidence</span>
            <ConfidencePill
              source={verdict.confidence_source}
              score={verdict.protected_behavior_confidence}
            />
          </div>
        )}
        {verdict.severity && (
          <div className="ecv-verdict-row">
            <span className="ecv-key">Severity</span>
            <span
              className={`severity-tag sev-${verdict.severity}`}
              data-testid="ecv-severity"
            >
              {verdict.severity}
            </span>
          </div>
        )}
        {verdict.recommended_action && (
          <div className="ecv-verdict-action" data-testid="ecv-recommended-action">
            <span className="ecv-key">Recommended Action</span>
            <p className="ecv-action-text">{verdict.recommended_action}</p>
          </div>
        )}
        {capsule.protected_behavior && (
          <div className="ecv-protected-behavior" data-testid="ecv-protected-behavior">
            <span className="ecv-key">Protected Behavior</span>
            <p className="ecv-pb-desc">{capsule.protected_behavior.description}</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Behavioral Evidence
// ---------------------------------------------------------------------------

function BehavioralEvidenceSection({ capsule }: { capsule: EvidenceCapsule }) {
  const ev = capsule.behavioral_evidence;
  const formatObs = (raw: unknown) =>
    typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);

  return (
    <section className="ecv-section" data-testid="ecv-behavioral-evidence">
      <h2 className="ecv-section-title">BEHAVIORAL EVIDENCE</h2>

      {/* Engine-authoritative changed flag */}
      <div className="ecv-changed-flag" data-testid="ecv-changed-flag">
        <span className="ecv-key">Changed</span>
        <span
          className={ev.changed ? "ecv-changed-true" : "ecv-changed-false"}
          data-changed={String(ev.changed)}
        >
          {ev.changed ? "YES — divergence detected by engine" : "NO — no divergence"}
        </span>
      </div>

      {/* Explanation */}
      {ev.explanation && (
        <div className="ecv-explanation" data-testid="ecv-explanation">
          <span className="ecv-key">Explanation</span>
          <p className="ecv-explanation-text">{ev.explanation}</p>
        </div>
      )}

      {/* Diff detail */}
      {ev.diff_detail && (
        <div className="ecv-diff-detail" data-testid="ecv-diff-detail">
          <span className="ecv-key">Diff Detail</span>
          <p className="ecv-diff-text">{ev.diff_detail}</p>
        </div>
      )}

      {/* Baseline / Candidate observations */}
      <div className="jrv-obs-split">
        <div className="jrv-obs-panel jrv-obs-baseline" data-testid="ecv-obs-baseline">
          <div className="jrv-obs-label">BASELINE</div>
          <pre className="jrv-obs-output">
            {formatObs(ev.baseline_observation.raw_output)}
          </pre>
        </div>
        <div className="jrv-obs-panel jrv-obs-candidate" data-testid="ecv-obs-candidate">
          <div className="jrv-obs-label">CANDIDATE</div>
          <pre className="jrv-obs-output">
            {formatObs(ev.candidate_observation.raw_output)}
          </pre>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Journey Replay
// ---------------------------------------------------------------------------

function ReplayStepRow({ step }: { step: CapsuleReplayStep }) {
  const meta = VERDICT_META[step.verdict];
  return (
    <tr
      className={`ecv-step-row${step.changed ? " ecv-step-row-divergent" : ""}`}
      data-testid={`ecv-step-${step.sequence}`}
      data-changed={String(step.changed)}
    >
      <td className="ecv-step-seq">
        {String(step.sequence).padStart(2, "0")}
      </td>
      <td className="ecv-step-name">{step.name}</td>
      <td className="ecv-step-action">
        <code>{step.action}</code>
      </td>
      <td className="ecv-step-verdict">
        <span className={`diff-verdict-badge ${meta.cssClass}`} data-verdict={step.verdict}>
          {meta.symbol} {meta.label}
        </span>
        {step.changed && (
          <span className="ecv-divergent-marker" data-testid={`ecv-divergent-${step.sequence}`}>
            ⚠ DIVERGED
          </span>
        )}
      </td>
      <td className="ecv-step-confidence">
        {step.confidence_source ? (
          <ConfidencePill source={step.confidence_source} score={step.confidence_score} />
        ) : (
          <span className="conf-none">—</span>
        )}
      </td>
      <td className="ecv-step-explanation">
        {step.explanation ?? "—"}
      </td>
    </tr>
  );
}

function JourneyReplaySection({ capsule }: { capsule: EvidenceCapsule }) {
  return (
    <section className="ecv-section" data-testid="ecv-journey-replay">
      <h2 className="ecv-section-title">JOURNEY REPLAY</h2>
      <div className="ecv-journey-name" data-testid="ecv-journey-name">
        {capsule.journey.journey_name}
        {capsule.journey.journey_description && (
          <span className="ecv-journey-desc">
            {" — "}{capsule.journey.journey_description}
          </span>
        )}
      </div>

      {capsule.replay_steps.length === 0 ? (
        <div className="diff-empty" data-testid="ecv-replay-empty">
          <p className="diff-empty-title">No replay steps</p>
          <p className="diff-empty-body">
            The rehearsal engine did not produce replay steps for this journey.
          </p>
        </div>
      ) : (
        <div className="diff-table-wrapper" role="region" aria-label="Journey replay steps">
          <table className="diff-table ecv-replay-table" data-testid="ecv-replay-table">
            <thead>
              <tr>
                <th className="diff-th">#</th>
                <th className="diff-th">Step</th>
                <th className="diff-th">Action</th>
                <th className="diff-th">Verdict</th>
                <th className="diff-th">Confidence</th>
                <th className="diff-th">Explanation</th>
              </tr>
            </thead>
            <tbody>
              {capsule.replay_steps.map((step) => (
                <ReplayStepRow key={step.step_id} step={step} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Reproduction
// ---------------------------------------------------------------------------

function ReproductionSection({ capsule }: { capsule: EvidenceCapsule }) {
  if (!capsule.reproduction || capsule.reproduction.steps.length === 0) return null;
  return (
    <section className="ecv-section" data-testid="ecv-reproduction">
      <h2 className="ecv-section-title">REPRODUCTION</h2>
      {capsule.reproduction.scenario_id && (
        <div className="ecv-kv-grid" style={{ marginBottom: "0.75rem" }}>
          <span className="ecv-key">Scenario ID</span>
          <code className="ecv-val" data-testid="ecv-scenario-id">
            {capsule.reproduction.scenario_id}
          </code>
        </div>
      )}
      <ol className="ecv-repro-steps" data-testid="ecv-repro-steps">
        {capsule.reproduction.steps.map((step, i) => (
          <li key={i} className="ecv-repro-step">
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Errors / Warnings
// ---------------------------------------------------------------------------

function ErrorsSection({ capsule }: { capsule: EvidenceCapsule }) {
  if (!capsule.errors || capsule.errors.length === 0) return null;
  return (
    <section className="ecv-section" data-testid="ecv-errors">
      <h2 className="ecv-section-title">ERRORS / WARNINGS</h2>
      <ul className="ecv-error-list">
        {capsule.errors.map((err, i) => (
          <li key={i} className="ecv-error-item" data-testid={`ecv-error-${i}`}>
            <code className="ecv-error-code" data-testid={`ecv-error-code-${i}`}>
              {err.error_code}
            </code>
            <span className="ecv-error-message">{err.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Export panel: Copy / Download JSON
// ---------------------------------------------------------------------------

function ExportPanel({ capsule }: { capsule: EvidenceCapsule }) {
  const [copied, setCopied] = useState(false);

  const json = JSON.stringify(capsule, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text in the hidden textarea
      const el = document.createElement("textarea");
      el.value = json;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evidence-capsule-${capsule.metadata.run_id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="ecv-section ecv-export-section" data-testid="ecv-export">
      <h2 className="ecv-section-title">EXPORT</h2>
      <p className="ecv-export-desc">
        The JSON below is the exact canonical capsule object shown in this view.
      </p>
      <div className="ecv-export-actions">
        <button
          className="btn-secondary ecv-btn-copy"
          onClick={handleCopy}
          data-testid="ecv-btn-copy"
          aria-label="Copy capsule JSON to clipboard"
        >
          {copied ? "✓ Copied" : "Copy JSON"}
        </button>
        <button
          className="btn-secondary ecv-btn-download"
          onClick={handleDownload}
          data-testid="ecv-btn-download"
          aria-label={`Download evidence-capsule-${capsule.metadata.run_id}.json`}
        >
          Download JSON
        </button>
      </div>
      <pre className="ecv-json-preview" data-testid="ecv-json-preview">
        {json}
      </pre>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface EvidenceCapsuleViewProps {
  /** The rehearsal run_id */
  runId: string;
  /** Developer's original requirement text */
  requirement: string;
  /** Navigate back to Journey Replay */
  onBack: () => void;
}

export function EvidenceCapsuleView({
  runId,
  requirement,
  onBack,
}: EvidenceCapsuleViewProps) {
  const [capsule, setCapsule] = useState<EvidenceCapsule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchCapsule() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const data = await getEvidenceCapsule(runId);
        if (!cancelled) setCapsule(data);
      } catch (err: unknown) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? err.message
              : "Failed to load evidence capsule.",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchCapsule();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <div className="ecv-view" data-testid="ecv-view">
      {/* Navigation header */}
      <div className="jrv-header">
        <div className="jrv-header-left">
          <button
            className="btn-secondary jrv-back-btn"
            onClick={onBack}
            data-testid="ecv-back-btn"
            aria-label="Back to Journey Replay"
          >
            ← BACK
          </button>
          <div className="jrv-header-meta">
            <span className="jrv-header-label">EVIDENCE CAPSULE</span>
            <code className="run-id-badge" data-testid="ecv-header-run-id">
              {runId}
            </code>
          </div>
        </div>
        <div className="jrv-header-requirement" data-testid="ecv-header-requirement">
          <span className="jrv-req-label">REQ</span>
          <span className="jrv-req-text">{requirement}</span>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="bdiff-loading" data-testid="ecv-loading">
          <span className="spinner" />
          <span>Loading evidence capsule…</span>
        </div>
      )}

      {/* API / network error */}
      {!isLoading && loadError && (
        <div
          className="poll-error-banner"
          role="alert"
          data-testid="ecv-error"
        >
          <strong>Failed to load evidence capsule</strong>
          <span>{loadError}</span>
        </div>
      )}

      {/* Empty capsule — no steps */}
      {!isLoading && !loadError && capsule && capsule.replay_steps.length === 0 && (
        <div data-testid="ecv-empty-notice" className="diff-empty">
          <p className="diff-empty-title">No evidence available</p>
          <p className="diff-empty-body">
            The rehearsal engine produced a capsule with no replay steps.
            Metadata, change context, and verdict are still shown below.
          </p>
        </div>
      )}

      {/* Main capsule content */}
      {!isLoading && !loadError && capsule && (
        <>
          <CapsuleHeader capsule={capsule} />
          <ChangeContextSection capsule={capsule} />
          <VerdictSection capsule={capsule} />
          <BehavioralEvidenceSection capsule={capsule} />
          <JourneyReplaySection capsule={capsule} />
          <ReproductionSection capsule={capsule} />
          <ErrorsSection capsule={capsule} />
          <ExportPanel capsule={capsule} />
        </>
      )}
    </div>
  );
}
