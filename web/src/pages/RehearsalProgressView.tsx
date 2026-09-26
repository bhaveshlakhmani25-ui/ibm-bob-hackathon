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



function TerminalOutcome({
  status,
  errorMessage,
  errorCode,
  onNewRehearsal,
  onViewDiff,
}: {
  status: RunStatus;
  errorMessage?: string;
  errorCode?: string;
  onNewRehearsal: () => void;
  onViewDiff: () => void;
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
          <button className="btn-primary" onClick={onViewDiff}>
            View Behavioral Diff
          </button>
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
  /** Called when the user wants to open the Behavioral Diff view (B04). */
  onOpenDiff?: () => void;
}

export function RehearsalProgressView({
  runId,
  requirement,
  onNewRehearsal,
  onOpenDiff,
}: RehearsalProgressViewProps) {
  // Initialise with a queued state so the UI renders immediately on mount
  // before the first poll completes.
  const [statusData, setStatusData] = useState<RehearsalStatusResponse | null>(
    null,
  );
  const [pollError, setPollError] = useState<string | null>(null);
  const pollErrorCountRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Elapsed time tracker
  const [elapsedMs, setElapsedMs] = useState(0);
  const mountTimeRef = useRef(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - mountTimeRef.current);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
      {/* Flight Simulator Header */}
      <div className="pv-header-flight">
        <div className="pv-header-left">
          <div className="pv-status-indicator">
            <span className={`status-dot ${overallStatus === 'running' || overallStatus === 'queued' ? 'pulsing' : ''}`}></span>
            <span className="status-text">{overallStatus.replace('_', ' ')}</span>
          </div>
          <code className="run-id-badge">{runId}</code>
        </div>
        <div className="pv-header-right">
          <div className="pv-elapsed">
            <span className="pv-elapsed-label">ELAPSED</span>
            <span className="pv-elapsed-value">{(elapsedMs / 1000).toFixed(1)}s</span>
          </div>
        </div>
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

      {/* Intent */}
      <div className="pv-intent">
        <span className="pv-intent-label">Requirement</span>
        <span className="pv-intent-text">{requirement}</span>
      </div>

      {/* Current phase prominent display */}
      <div className="pv-active-phase">
        <span className="pv-active-phase-label">CURRENT ACTIVITY</span>
        <h3 className="pv-active-phase-title">
          {terminal ? (statusData?.status === "completed" ? "Execution Finished" : "Execution Halted") : `${UI_STEPS[currentStepIdx]?.label ?? "Initializing"}...`}
        </h3>
      </div>

      {/* Stage Timeline (Horizontal) */}
      <div className="pv-stage-timeline" role="list" aria-label="Rehearsal phases">
        {UI_STEPS.map((step, stepIdx) => {
          const isDone =
            !terminal
              ? stepIdx < currentStepIdx
              : statusData?.status === "completed"
                ? true
                : stepIdx < currentStepIdx;
          const isActive = !terminal && stepIdx === currentStepIdx;
          const isFailed = terminal && statusData?.status !== "completed" && stepIdx === currentStepIdx;

          return (
            <div role="listitem" key={step.id} className={`pv-stage-node ${isActive ? 'active phase-active' : ''} ${isDone ? 'done phase-done' : ''} ${isFailed ? 'failed phase-failed' : ''}`}>
              <div className="pv-stage-dot"></div>
              <div className="pv-stage-label">{step.label}</div>
            </div>
          );
        })}
      </div>

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
          onViewDiff={onOpenDiff ?? (() => {})}
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
