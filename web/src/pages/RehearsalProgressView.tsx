/**
 * RehearsalProgressView
 *
 * Developer-facing rehearsal progress experience (B03).
 *
 * Displays:
 *  - Rehearsal ID
 *  - Original requirement / intent
 *  - Current overall status (running / completed / failed / build_failed)
 *  - Current phase with visual progress list
 *  - Terminal state detail: success, regression, build failure, config error
 *  - Error messages for API/network failures
 *  - Retry / new rehearsal actions
 *
 * Contracts used:
 *  - RehearsalStatusResponse  (§4.2)
 *  - RunStatus, RehearsalPhase, BuildStatus  (§4 enums)
 *
 * All types are imported from src/shared/contracts.ts — no duplication.
 */
import { useEffect, useRef, useState } from "react";
import type { RehearsalStatusResponse, RunStatus } from "../../../src/shared/contracts";
import { getRehearsalStatus } from "../services/api";

// ---------------------------------------------------------------------------
// Phase metadata
// ---------------------------------------------------------------------------

// UI display steps mapping one or more backend phases
type UiStepId =
  | "queued"
  | "analyzing"
  | "understanding"
  | "identifying"
  | "building"
  | "running"
  | "comparing"
  | "completed";

interface UiStep {
  id: UiStepId;
  label: string;
  phases: string[]; // backend phases that map to this step
}

const UI_STEPS: UiStep[] = [
  { id: "queued", label: "Queued", phases: ["queued"] },
  { id: "analyzing", label: "Analyzing Change", phases: ["extracting_change"] },
  { id: "understanding", label: "Understanding Repository", phases: ["loading_repository"] },
  { id: "identifying", label: "Identifying Affected Behavior", phases: ["compiling_journeys", "analyzing_impact", "resolving_protected_behaviors"] },
  { id: "building", label: "Building Scenarios", phases: ["planning_scenarios"] },
  { id: "running", label: "Running Rehearsal", phases: ["running_baseline", "running_candidate"] },
  { id: "comparing", label: "Comparing Behavior", phases: ["comparing", "generating_report"] },
  { id: "completed", label: "Complete", phases: ["completed"] },
];

const TERMINAL_STATUSES: RunStatus[] = ["completed", "failed", "build_failed"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function getStepIndex(phase: string): number {
  return UI_STEPS.findIndex((step) => step.phases.includes(phase));
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: RunStatus | "queued" }) {
  const classMap: Record<string, string> = {
    running: "badge badge-running",
    queued: "badge badge-queued",
    completed: "badge badge-completed",
    failed: "badge badge-failed",
    build_failed: "badge badge-failed",
  };
  const labelMap: Record<string, string> = {
    running: "Running",
    queued: "Queued",
    completed: "Complete",
    failed: "Failed",
    build_failed: "Build Failed",
  };
  return (
    <span className={classMap[status] ?? "badge"}>
      {labelMap[status] ?? status}
    </span>
  );
}

function BuildStatusPill({
  label,
  value,
}: {
  label: string;
  value: "pending" | "success" | "failed";
}) {
  const cls =
    value === "success"
      ? "pill pill-success"
      : value === "failed"
        ? "pill pill-failed"
        : "pill pill-pending";
  const text = value === "success" ? "✓" : value === "failed" ? "✗" : "…";
  return (
    <span className={cls} title={`${label}: ${value}`}>
      {text} {label}
    </span>
  );
}

function PhaseRow({
  label,
  isActive,
  isDone,
  isFailed,
}: {
  label: string;
  isActive: boolean;
  isDone: boolean;
  isFailed: boolean;
}) {
  let icon: React.ReactNode;
  let rowClass = "phase-row";

  if (isFailed) {
    icon = <span className="phase-icon icon-failed">✗</span>;
    rowClass += " phase-failed";
  } else if (isDone) {
    icon = <span className="phase-icon icon-done">✓</span>;
    rowClass += " phase-done";
  } else if (isActive) {
    icon = <span className="phase-icon"><span className="spinner" /></span>;
    rowClass += " phase-active";
  } else {
    icon = <span className="phase-icon icon-pending">○</span>;
  }

  return (
    <li className={rowClass}>
      {icon}
      <span className="phase-label">{label}</span>
    </li>
  );
}

function TerminalOutcome({
  status,
  errorMessage,
  errorCode,
  onNewRehearsal,
}: {
  status: RunStatus;
  errorMessage?: string;
  errorCode?: string;
  onNewRehearsal: () => void;
}) {
  if (status === "completed") {
    return (
      <div className="outcome-panel outcome-success">
        <div className="outcome-title">✓ Rehearsal complete</div>
        <p className="outcome-body">
          All phases finished. Report is ready. Open the full report to review
          behavioral diffs, coverage, and any regressions.
        </p>
        <div className="outcome-actions">
          <button className="btn-secondary" onClick={onNewRehearsal}>
            New Rehearsal
          </button>
        </div>
      </div>
    );
  }

  if (status === "build_failed") {
    return (
      <div className="outcome-panel outcome-failure">
        <div className="outcome-title">✗ Build Failed</div>
        {errorCode && <div className="outcome-error-code">Code: {errorCode}</div>}
        {errorMessage && (
          <pre className="outcome-error-detail">{errorMessage}</pre>
        )}
        <p className="outcome-body">
          The rehearsal could not proceed because a build step failed. Fix the
          compilation error above and start a new rehearsal.
        </p>
        <div className="outcome-actions">
          <button className="btn-secondary" onClick={onNewRehearsal}>
            New Rehearsal
          </button>
        </div>
      </div>
    );
  }

  // status === "failed" — could be regression or configuration error
  const isConfigError =
    errorMessage?.toLowerCase().includes("configuration error") ||
    errorMessage?.toLowerCase().includes("config");

  if (isConfigError) {
    return (
      <div className="outcome-panel outcome-config-error">
        <div className="outcome-title">⚠ Configuration Error</div>
        {errorCode && <div className="outcome-error-code">Code: {errorCode}</div>}
        {errorMessage && (
          <pre className="outcome-error-detail">{errorMessage}</pre>
        )}
        <p className="outcome-body">
          The rehearsal engine could not start. Check your environment
          configuration and try again.
        </p>
        <div className="outcome-actions">
          <button className="btn-secondary" onClick={onNewRehearsal}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Generic failure / regression
  return (
    <div className="outcome-panel outcome-failure">
      <div className="outcome-title">✗ Regression Detected</div>
      {errorCode && <div className="outcome-error-code">Code: {errorCode}</div>}
      {errorMessage && (
        <pre className="outcome-error-detail">{errorMessage}</pre>
      )}
      <p className="outcome-body">
        One or more protected behaviors were violated. Review the details above
        and address the regression before merging.
      </p>
      <div className="outcome-actions">
        <button className="btn-secondary" onClick={onNewRehearsal}>
          New Rehearsal
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 2000;

export interface RehearsalProgressViewProps {
  runId: string;
  /** The developer's original requirement text submitted with the change. */
  requirement: string;
  onNewRehearsal: () => void;
}

export function RehearsalProgressView({
  runId,
  requirement,
  onNewRehearsal,
}: RehearsalProgressViewProps) {
  // Initialise with a queued state so the UI renders immediately on mount
  // before the first poll completes.
  const [statusData, setStatusData] = useState<RehearsalStatusResponse | null>(
    null,
  );
  const [pollError, setPollError] = useState<string | null>(null);
  const pollErrorCountRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const data = await getRehearsalStatus(runId);
        if (cancelled) return;
        setStatusData(data);
        setPollError(null);
        pollErrorCountRef.current = 0;

        if (isTerminal(data.status)) {
          // Stop polling when a terminal state is reached.
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
        }
      } catch (err: unknown) {
        if (cancelled) return;
        pollErrorCountRef.current += 1;
        const msg =
          err instanceof Error ? err.message : "Network error while polling";
        setPollError(msg);

        // After 3 consecutive failures stop polling to avoid hammering.
        if (pollErrorCountRef.current >= 3) {
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
        }
      }
    }

    // Fire immediately on mount, then on the interval.
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [runId]);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const currentPhase = statusData?.phase ?? "queued";
  const currentStepIdx = getStepIndex(currentPhase);
  const overallStatus: RunStatus | "queued" = statusData?.status ?? "queued";
  const terminal = statusData ? isTerminal(statusData.status) : false;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="progress-view">
      {/* Header */}
      <div className="pv-header">
        <div className="pv-header-left">
          <code className="run-id-badge">{runId}</code>
          <StatusBadge status={overallStatus} />
        </div>
        {statusData && (
          <div className="build-pills">
            <BuildStatusPill
              label="Baseline"
              value={statusData.baseline_build_status}
            />
            <BuildStatusPill
              label="Candidate"
              value={statusData.candidate_build_status}
            />
          </div>
        )}
      </div>

      {/* Intent */}
      <div className="pv-intent">
        <span className="pv-intent-label">Requirement</span>
        <span className="pv-intent-text">{requirement}</span>
      </div>

      {/* Phase list */}
      <ul className="phase-list" aria-label="Rehearsal phases">
        {UI_STEPS.map((step, stepIdx) => {
          const isDone =
            !terminal
              ? stepIdx < currentStepIdx
              : statusData?.status === "completed"
                ? true // all phases done on success
                : stepIdx < currentStepIdx; // done phases before failure
          const isActive =
            !terminal && stepIdx === currentStepIdx;
          const isFailed =
            terminal &&
            statusData?.status !== "completed" &&
            stepIdx === currentStepIdx;

          return (
            <PhaseRow
              key={step.id}
              label={step.label}
              isActive={isActive}
              isDone={isDone}
              isFailed={isFailed}
            />
          );
        })}
      </ul>

      {/* Incomplete coverage notice */}
      {!terminal && currentPhase === "queued" && (
        <p className="coverage-notice">
          Waiting for the rehearsal engine to pick up this run…
        </p>
      )}

      {/* API / network error banner */}
      {pollError && (
        <div className="poll-error-banner" role="alert">
          <strong>Unable to reach rehearsal engine</strong>
          <span>{pollError}</span>
          {pollErrorCountRef.current >= 3 && (
            <span className="poll-error-hint">
              Polling paused after repeated failures. Reload the page to retry.
            </span>
          )}
        </div>
      )}

      {/* Terminal outcome panel */}
      {terminal && statusData && (
        <TerminalOutcome
          status={statusData.status}
          errorMessage={statusData.error}
          errorCode={statusData.error_code}
          onNewRehearsal={onNewRehearsal}
        />
      )}

      {/* Loading indicator — first poll hasn't returned yet */}
      {!statusData && !pollError && (
        <div className="pv-loading">
          <span className="spinner" />
          <span>Connecting to rehearsal engine…</span>
        </div>
      )}
    </div>
  );
}
