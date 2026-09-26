/**
 * BehavioralDiffView — B04 Change Rehearsal Behavioral Diff experience.
 *
 * Answers: "What behavior changed because of this code change?"
 *
 * Displays:
 *  1. Rehearsal summary (run ID, original requirement)
 *  2. Behavioral diff summary scoreboard (counts per verdict + overall verdict)
 *  3. Behavioral diff rows — per-journey: protected behavior, verdict,
 *     confidence, baseline vs candidate output, explanation
 *  4. Empty / no-results state
 *  5. API failure state
 *
 * Contracts used:
 *  - RehearsalReport      (§4.3)
 *  - BehavioralDiffRow    (§4.3)
 *  - Verdict, ConfidenceLevel, FinalVerdict  (§4.3 enums)
 *  - ReportSummary        (§4.3)
 *  - Observation          (§4.3)
 *
 * All types are imported from src/shared/contracts.ts — no duplication.
 * The UI displays the deterministic verdict received from the backend.
 * AI summaries/explanations are clearly labelled as derived text.
 */
import { useEffect, useState } from "react";
import type {
  RehearsalReport,
  BehavioralDiffRow,
  Verdict,
  ConfidenceLevel,
  FinalVerdict,
} from "../../../src/shared/contracts";
import { getRehearsalReport } from "../services/api";
import { JourneyReplayView } from "./JourneyReplayView";

// ---------------------------------------------------------------------------
// Verdict display helpers
// ---------------------------------------------------------------------------

interface VerdictMeta {
  label: string;
  cssClass: string;
  symbol: string;
}

const VERDICT_META: Record<Verdict, VerdictMeta> = {
  preserved: { label: "Preserved", cssClass: "verdict-preserved", symbol: "✓" },
  intentional_change: { label: "Intentional Change", cssClass: "verdict-intentional", symbol: "~" },
  regression: { label: "Regression", cssClass: "verdict-regression", symbol: "✗" },
  potentially_affected: { label: "Potentially Affected", cssClass: "verdict-potential", symbol: "?" },
  not_exercised: { label: "Not Exercised", cssClass: "verdict-not-exercised", symbol: "○" },
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
  if (!source) return <span className="conf-none">—</span>;
  const meta = CONFIDENCE_META[source];
  return (
    <span className={`conf-pill ${meta.cssClass}`} title={`Confidence source: ${source}`}>
      {meta.label}
      {score !== undefined && (
        <span className="conf-score"> {Math.round(score * 100)}%</span>
      )}
    </span>
  );
}

function ObservationCell({
  label,
  rawOutput,
}: {
  label: string;
  rawOutput?: string | Record<string, unknown> | null;
}) {
  if (rawOutput === undefined || rawOutput === null) {
    return (
      <div className="obs-cell obs-empty">
        <span className="obs-label">{label}</span>
        <span className="obs-value obs-none">—</span>
      </div>
    );
  }
  const text =
    typeof rawOutput === "string"
      ? rawOutput
      : JSON.stringify(rawOutput, null, 2);
  return (
    <div className="obs-cell">
      <span className="obs-label">{label}</span>
      <pre className="obs-value">{text}</pre>
    </div>
  );
}

function DiffRow({
  row,
  report,
  onReplayJourney,
}: {
  row: BehavioralDiffRow;
  report: RehearsalReport;
  onReplayJourney?: (journeyId: string) => void;
}) {
  const meta = VERDICT_META[row.verdict];
  const isRegression = row.verdict === "regression";

  // Locate protected behavior description for this row (if linked)
  const pb = row.protected_behavior_id
    ? report.protected_behaviors.find((p) => p.id === row.protected_behavior_id)
    : undefined;

  // Locate observations for this row via evidence_id → scenario_id chain
  let baselineObs: { raw_output: string | Record<string, unknown> } | undefined;
  let candidateObs: { raw_output: string | Record<string, unknown> } | undefined;

  if (row.evidence_id) {
    // evidence_id matches a Regression which holds a scenario_id reference
    const regression = report.regressions.find(
      (r) => r.id === row.evidence_id || r.evidence?.scenario_id === row.evidence_id,
    );
    if (regression) {
      baselineObs = regression.evidence?.baseline_observation;
      candidateObs = regression.evidence?.candidate_observation;
    }
  }

  // Explanation: deterministic from verdict + optional regression recommendation
  const regressionDetail = isRegression
    ? report.regressions.find((r) => r.journey_id === row.journey_id)
    : undefined;

  return (
    <tr
      className={`diff-row diff-row-${row.verdict}${isRegression ? " diff-row-regression-highlight" : ""}`}
      data-testid={`diff-row-${row.verdict}`}
      aria-label={`Behavior row: ${row.journey_name}, verdict: ${meta.label}`}
    >
      {/* Behavior / Journey name */}
      <td className="diff-cell diff-cell-behavior">
        <div className="behavior-name">{row.journey_name}</div>
        {pb && (
          <div className="protected-behavior-desc" title="Protected behavior">
            {pb.description}
          </div>
        )}
        {row.is_expected_change && (
          <span className="expected-tag">expected change</span>
        )}
        {onReplayJourney && (
          <button
            className="btn-replay-journey"
            onClick={() => onReplayJourney(row.journey_id)}
            data-testid={`btn-replay-${row.journey_id}`}
            aria-label={`Replay journey: ${row.journey_name}`}
          >
            Replay Journey
          </button>
        )}
      </td>

      {/* Verdict */}
      <td className="diff-cell diff-cell-verdict">
        <VerdictBadge verdict={row.verdict} />
        {/* Machine-readable data attribute preserves exact verdict */}
      </td>

      {/* Confidence */}
      <td className="diff-cell diff-cell-confidence">
        <ConfidencePill
          source={row.protected_behavior_source}
          score={row.protected_behavior_confidence}
        />
      </td>

      {/* Baseline vs Candidate */}
      <td className="diff-cell diff-cell-observations">
        <div className="obs-pair">
          <ObservationCell
            label="Baseline"
            rawOutput={baselineObs?.raw_output ?? null}
          />
          <ObservationCell
            label="Candidate"
            rawOutput={candidateObs?.raw_output ?? null}
          />
        </div>
      </td>

      {/* Explanation */}
      <td className="diff-cell diff-cell-explanation">
        <ExplanationCell
          verdict={row.verdict}
          regressionAction={regressionDetail?.recommended_action}
          regressionSeverity={regressionDetail?.severity}
        />
      </td>
    </tr>
  );
}

function ExplanationCell({
  verdict,
  regressionAction,
  regressionSeverity,
}: {
  verdict: Verdict;
  regressionAction?: string;
  regressionSeverity?: "critical" | "high" | "medium" | "low";
}) {
  const VERDICT_EXPLANATION: Record<Verdict, string> = {
    preserved: "Behavior is unchanged between baseline and candidate.",
    intentional_change: "This change was expected given the stated requirement.",
    regression: "Protected behavior was violated — candidate diverged unexpectedly from baseline.",
    potentially_affected: "Behavior may be affected but was not directly comparable.",
    not_exercised: "No scenario exercised this behavior in the rehearsal.",
  };

  const SEVERITY_CLASS: Record<string, string> = {
    critical: "sev-critical",
    high: "sev-high",
    medium: "sev-medium",
    low: "sev-low",
  };

  return (
    <div className="explanation-cell">
      <p className="explanation-text">{VERDICT_EXPLANATION[verdict]}</p>
      {verdict === "regression" && regressionSeverity && (
        <span className={`severity-tag ${SEVERITY_CLASS[regressionSeverity] ?? ""}`}>
          {regressionSeverity}
        </span>
      )}
      {verdict === "regression" && regressionAction && (
        <p className="regression-action">{regressionAction}</p>
      )}
    </div>
  );
}

function SummaryScoreboard({ report }: { report: RehearsalReport }) {
  const { summary } = report;
  const finalMeta = FINAL_VERDICT_META[summary.verdict];

  return (
    <div className={`diff-scoreboard ${finalMeta.cssClass}`}>
      <div className="scoreboard-verdict">
        <span className="scoreboard-verdict-label">Overall Result</span>
        <span className={`scoreboard-verdict-value ${finalMeta.cssClass}`}>
          {finalMeta.label}
        </span>
      </div>
      <div className="scoreboard-counts">
        <div className="score-item score-preserved" data-testid="score-preserved">
          <span className="score-num">{summary.preserved}</span>
          <span className="score-lbl">Preserved</span>
        </div>
        <div className="score-item score-intentional" data-testid="score-intentional">
          <span className="score-num">{summary.intentional_changes ?? 0}</span>
          <span className="score-lbl">Intentional</span>
        </div>
        <div
          className={`score-item score-regression${summary.regressions > 0 ? " score-regression-nonzero" : ""}`}
          data-testid="score-regression"
        >
          <span className="score-num">{summary.regressions}</span>
          <span className="score-lbl">Regressions</span>
        </div>
        <div className="score-item score-potential" data-testid="score-potential">
          <span className="score-num">{summary.potentially_affected ?? 0}</span>
          <span className="score-lbl">Potentially Affected</span>
        </div>
        <div className="score-item score-not-exercised" data-testid="score-not-exercised">
          <span className="score-num">{summary.not_exercised}</span>
          <span className="score-lbl">Not Exercised</span>
        </div>
      </div>
    </div>
  );
}

function DiffTable({
  report,
  onReplayJourney,
}: {
  report: RehearsalReport;
  onReplayJourney?: (journeyId: string) => void;
}) {
  const rows = report.behavioral_diff;

  if (rows.length === 0) {
    return (
      <div className="diff-empty" data-testid="diff-empty">
        <p className="diff-empty-title">No behavioral diff results</p>
        <p className="diff-empty-body">
          The rehearsal did not produce any behavior comparisons. This may mean
          no journeys were exercised or the engine did not return results.
        </p>
      </div>
    );
  }

  // Regressions first, then by verdict order, then alphabetically
  const VERDICT_ORDER: Verdict[] = [
    "regression",
    "potentially_affected",
    "intentional_change",
    "preserved",
    "not_exercised",
  ];

  const sorted = [...rows].sort((a, b) => {
    const ai = VERDICT_ORDER.indexOf(a.verdict);
    const bi = VERDICT_ORDER.indexOf(b.verdict);
    if (ai !== bi) return ai - bi;
    return a.journey_name.localeCompare(b.journey_name);
  });

  return (
    <div className="diff-table-wrapper" role="region" aria-label="Behavioral diff results">
      <table className="diff-table" data-testid="diff-table">
        <thead>
          <tr>
            <th className="diff-th diff-th-behavior">Behavior</th>
            <th className="diff-th diff-th-verdict">Verdict</th>
            <th className="diff-th diff-th-confidence">Confidence</th>
            <th className="diff-th diff-th-observations">Baseline → Candidate</th>
            <th className="diff-th diff-th-explanation">Explanation</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <DiffRow
              key={`${row.journey_id ?? row.journey_name}-${row.verdict}`}
              row={row}
              report={report}
              onReplayJourney={onReplayJourney}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface BehavioralDiffViewProps {
  /** The run_id for which to fetch and display the report. */
  runId: string;
  /** The developer's original requirement text submitted with the change. */
  requirement: string;
  /** Navigate back to the submission form. */
  onNewRehearsal: () => void;
}

export function BehavioralDiffView({
  runId,
  requirement,
  onNewRehearsal,
}: BehavioralDiffViewProps) {
  const [report, setReport] = useState<RehearsalReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchReport() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const data = await getRehearsalReport(runId);
        if (!cancelled) {
          setReport(data);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "Failed to load behavioral diff report.",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchReport();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <div className="bdiff-view" data-testid="bdiff-view">
      {/* Header */}
      <div className="bdiff-header">
        <div className="bdiff-header-left">
          <code className="run-id-badge">{runId}</code>
          <span className="bdiff-title">Behavioral Diff</span>
        </div>
        <button className="btn-secondary" onClick={onNewRehearsal}>
          New Rehearsal
        </button>
      </div>

      {/* Original requirement */}
      <div className="pv-intent">
        <span className="pv-intent-label">Requirement</span>
        <span className="pv-intent-text">{requirement}</span>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="bdiff-loading" data-testid="bdiff-loading">
          <span className="spinner" />
          <span>Loading behavioral diff…</span>
        </div>
      )}

      {/* API / network error */}
      {!isLoading && loadError && (
        <div className="poll-error-banner" role="alert" data-testid="bdiff-error">
          <strong>Failed to load behavioral diff</strong>
          <span>{loadError}</span>
        </div>
      )}

      {/* Main content */}
      {!isLoading && report && !selectedJourneyId && (
        <>
          <SummaryScoreboard report={report} />
          <DiffTable report={report} onReplayJourney={setSelectedJourneyId} />
        </>
      )}

      {/* Journey Replay View */}
      {selectedJourneyId && (
        <JourneyReplayView
          runId={runId}
          requirement={requirement}
          journeyId={selectedJourneyId}
          onBack={() => setSelectedJourneyId(null)}
        />
      )}
    </div>
  );
}
