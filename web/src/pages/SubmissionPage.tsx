/**
 * SubmissionPage — Change Rehearsal submission flow (B02) +
 *                  Rehearsal progress experience wiring (B03).
 *
 * Responsibilities:
 *  - Collect repository, branch, and requirement from the developer.
 *  - POST /api/rehearsals via startRehearsal().
 *  - Hand off to RehearsalProgressView once a run_id is obtained.
 *  - Preserve all submission context (intent, repo, refs) throughout.
 */
import { useState } from "react";
import { startRehearsal } from "../services/api";
import { RehearsalProgressView } from "./RehearsalProgressView";

// ---------------------------------------------------------------------------
// Submission form
// ---------------------------------------------------------------------------

export const SubmissionPage = () => {
  const [intent, setIntent] = useState("");
  const [repo, setRepo] = useState("ShopFlow");
  const [changeSource, setChangeSource] = useState("working_tree");
  const [baseBranch, setBaseBranch] = useState("main");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once a run is started we store the run_id and the submitted requirement
  // so the progress view can display the developer's original intent.
  const [activeRun, setActiveRun] = useState<{
    runId: string;
    requirement: string;
  } | null>(null);

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
        requirement: intent,
      });

      // Preserve the developer's requirement text alongside the run_id so
      // RehearsalProgressView can display it throughout the lifecycle.
      setActiveRun({ runId: response.run_id, requirement: intent });
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred during submission.";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetry = () => {
    setError(null);
  };

  const handleNewRehearsal = () => {
    setActiveRun(null);
    setIntent("");
    setError(null);
  };

  const isFormValid =
    intent.trim().length > 0 &&
    repo.trim().length > 0 &&
    baseBranch.trim().length > 0;

  // -------------------------------------------------------------------------
  // Progress view — shown after a run is started
  // -------------------------------------------------------------------------

  if (activeRun) {
    return (
      <div>
        <div className="brand">CHANGE REHEARSAL</div>
        <p className="subtitle">Don't just review the diff. Rehearse the behavior.</p>
        <RehearsalProgressView
          runId={activeRun.runId}
          requirement={activeRun.requirement}
          onNewRehearsal={handleNewRehearsal}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Submission form — shown before a run is started
  // -------------------------------------------------------------------------

  return (
    <div>
      <div className="brand">CHANGE REHEARSAL</div>
      <p className="subtitle">Don't just review the diff. Rehearse the behavior.</p>

      {error && (
        <div className="error-banner" role="alert">
          <div>
            <strong>Submission Failed</strong>
            <div>{error}</div>
          </div>
          <button
            style={{
              marginLeft: "auto",
              background: "none",
              border: "1px solid var(--danger-text)",
              color: "var(--danger-text)",
              borderRadius: "4px",
              cursor: "pointer",
              padding: "4px 8px",
            }}
            onClick={handleRetry}
          >
            Retry
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group intent-field">
          <label htmlFor="intent">What were you trying to change?</label>
          <span className="description">
            Describe the requirement or intent behind your code changes.
          </span>
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
              <option value="feature/product-cache">
                Current branch (feature/product-cache)
              </option>
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
                <div className="spinner" />
                Starting…
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
