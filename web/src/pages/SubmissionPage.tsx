import { useState, useEffect } from "react";
import { startRehearsal, getRehearsalStatus } from "../services/api";
import type { RehearsalStatusResponse } from "../../../src/shared/contracts";

const PHASES = [
  "loading_repository",
  "extracting_change",
  "compiling_journeys",
  "analyzing_impact",
  "resolving_protected_behaviors",
  "planning_scenarios",
  "running_baseline",
  "running_candidate",
  "comparing",
  "generating_report",
  "completed"
];

const PHASE_LABELS: Record<string, string> = {
  "loading_repository": "Loading repository",
  "extracting_change": "Extracting change",
  "compiling_journeys": "Compiling journeys",
  "analyzing_impact": "Analyzing impact",
  "resolving_protected_behaviors": "Resolving protected behaviors",
  "planning_scenarios": "Planning scenarios",
  "running_baseline": "Running baseline",
  "running_candidate": "Running candidate",
  "comparing": "Comparing behaviors",
  "generating_report": "Generating report",
  "completed": "Completed"
};

export const SubmissionPage = () => {
  const [intent, setIntent] = useState("");
  const [repo, setRepo] = useState("ShopFlow");
  const [changeSource, setChangeSource] = useState("working_tree");
  const [baseBranch, setBaseBranch] = useState("main");
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  
  const [status, setStatus] = useState<RehearsalStatusResponse | null>(null);

  useEffect(() => {
    if (!runId || (status && (status.status === "completed" || status.status === "failed" || status.status === "build_failed"))) {
      return;
    }

    const intervalId = setInterval(async () => {
      try {
        const currentStatus = await getRehearsalStatus(runId);
        setStatus(currentStatus);
      } catch (err) {
        console.error("Failed to poll status", err);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [runId, status]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await startRehearsal({
        repo_path: repo,
        base_ref: baseBranch,
        candidate_ref: changeSource,
        requirement: intent
      });
      
      setRunId(response.run_id);
      setStatus({
        run_id: response.run_id,
        status: response.status === "started" ? "running" : response.status as any,
        phase: "loading_repository",
        started_at: response.started_at,
        baseline_build_status: "pending",
        candidate_build_status: "pending"
      });
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred during submission.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetry = () => {
    setError(null);
  };

  const isFormValid = intent.trim().length > 0 && repo.trim().length > 0 && baseBranch.trim().length > 0;

  if (runId && status) {
    const currentPhaseIndex = PHASES.indexOf(status.phase) !== -1 ? PHASES.indexOf(status.phase) : -1;
    
    return (
      <div>
        <div className="brand">CHANGE REHEARSAL</div>
        <p className="subtitle">Don’t just review the diff. Rehearse the behavior.</p>
        
        <div className="progress-container">
          <div className="header">
            <span className="run-id">ID: {runId}</span>
            <span className={`status-badge status-${status.status}`}>
              {status.status}
            </span>
          </div>
          
          <ul className="phase-list">
            {PHASES.map((phase, idx) => {
              const isDone = status.status === "completed" || idx < currentPhaseIndex;
              const isActive = status.status === "running" && phase === status.phase;
              
              return (
                <li key={phase} className={`phase-item ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}>
                  {isDone ? (
                    <span style={{ color: "var(--success-text)" }}>✓</span>
                  ) : isActive ? (
                    <div className="spinner"></div>
                  ) : (
                    <span style={{ color: "var(--border-subtle)" }}>○</span>
                  )}
                  {PHASE_LABELS[phase] || phase}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="brand">CHANGE REHEARSAL</div>
      <p className="subtitle">Don’t just review the diff. Rehearse the behavior.</p>

      {error && (
        <div className="error-banner">
          <div>
            <strong>Submission Failed</strong>
            <div>{error}</div>
          </div>
          <button style={{ marginLeft: "auto", background: "none", border: "1px solid var(--danger-text)", color: "var(--danger-text)", borderRadius: "4px", cursor: "pointer", padding: "4px 8px" }} onClick={handleRetry}>Retry</button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group intent-field">
          <label htmlFor="intent">What were you trying to change?</label>
          <span className="description">Describe the requirement or intent behind your code changes.</span>
          <textarea
            id="intent"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="e.g. Add caching to Product API to improve response time."
            autoFocus
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="repo">Repository</label>
            <input
              type="text"
              id="repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="changeSource">Change Source (What changed?)</label>
            <select
              id="changeSource"
              value={changeSource}
              onChange={(e) => setChangeSource(e.target.value)}
            >
              <option value="working_tree">Working tree / diff</option>
              <option value="feature/product-cache">Current branch (feature/product-cache)</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="baseBranch">Base Branch</label>
            <input
              type="text"
              id="baseBranch"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
            />
          </div>
        </div>

        <div className="actions">
          <button
            type="submit"
            className="primary"
            disabled={!isFormValid || isSubmitting}
          >
            {isSubmitting ? (
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div className="spinner"></div>
                Starting...
              </span>
            ) : (
              "Start Rehearsal"
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
