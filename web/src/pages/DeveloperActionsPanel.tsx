import { useState } from "react";
import { getFixProposal, rerunRehearsal, FixProposal } from "../services/api";

export interface DeveloperActionsPanelProps {
  runId: string;
  journeyId: string;
  verdict: string;
  baselineObs?: { raw_output: string | Record<string, unknown> };
  candidateObs?: { raw_output: string | Record<string, unknown> };
  onViewEvidence: () => void;
}

export type DevActionType = "none" | "proposed_fix" | "intentional" | "ignored";

export interface DevActionState {
  type: DevActionType;
  note?: string;
  proposal?: FixProposal;
  isFixGenerating?: boolean;
  isRerunning?: boolean;
}

export function DeveloperActionsPanel({
  runId,
  journeyId,
  verdict,
  onViewEvidence,
}: DeveloperActionsPanelProps) {
  const [actionState, setActionState] = useState<DevActionState>({ type: "none" });
  const [noteInput, setNoteInput] = useState("");

  const handleGenerateFix = async () => {
    setActionState({ type: "proposed_fix", isFixGenerating: true });
    try {
      const proposal = await getFixProposal(runId, journeyId);
      setActionState({ type: "proposed_fix", proposal, isFixGenerating: false });
    } catch (err) {
      setActionState({ type: "none" });
      alert("Failed to generate fix");
    }
  };

  const handleRerun = async () => {
    setActionState((s) => ({ ...s, isRerunning: true }));
    try {
      const resp = await rerunRehearsal(runId, { candidate_ref: "HEAD", scope: "affected_only" });
      alert(`Started new rehearsal run: ${resp.new_run_id}`);
    } catch (err) {
      alert("Failed to start new rehearsal");
    } finally {
      setActionState((s) => ({ ...s, isRerunning: false }));
    }
  };

  const handleMarkIntentional = () => {
    if (!noteInput.trim()) {
      alert("Please provide a note for marking this intentional.");
      return;
    }
    setActionState({ type: "intentional", note: noteInput });
    setNoteInput("");
  };

  const handleIgnore = () => {
    setActionState({ type: "ignored", note: noteInput });
    setNoteInput("");
  };

  // Only show Developer Actions panel for Regression or Potentially Affected
  if (verdict !== "regression" && verdict !== "potentially_affected") {
    return null;
  }

  return (
    <tr className="developer-actions-row">
      <td colSpan={5} className="developer-actions-cell">
        <div className="dev-actions-panel" data-testid={`dev-actions-${journeyId}`}>
          <div className="dev-actions-header">
            <strong>DEVELOPER ACTIONS</strong>
            <span className="dev-actions-subtitle">
              {verdict === "regression" ? "Regression detected" : "Behavior potentially affected"}
            </span>
          </div>

          <div className="dev-actions-toolbar">
            <button className="btn-secondary" onClick={onViewEvidence} data-testid={`btn-evidence-${journeyId}`}>
              View Evidence
            </button>
            <button className="btn-secondary" onClick={handleGenerateFix} disabled={actionState.isFixGenerating} data-testid={`btn-fix-${journeyId}`}>
              {actionState.isFixGenerating ? "Generating..." : "Generate Fix"}
            </button>
            <div className="dev-action-input-group">
              <input
                type="text"
                placeholder="Reason / Note"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                className="dev-action-note-input"
              />
              <button className="btn-secondary" onClick={handleMarkIntentional} data-testid={`btn-intentional-${journeyId}`}>
                Mark Intentional
              </button>
              <button className="btn-secondary" onClick={handleIgnore} data-testid={`btn-ignore-${journeyId}`}>
                Ignore Finding
              </button>
            </div>
          </div>

          {actionState.type === "proposed_fix" && actionState.proposal && (
            <div className="dev-proposal-card" data-testid={`proposal-card-${journeyId}`}>
              <div className="dev-proposal-header">
                <strong>PROPOSED FIX</strong>
                <span className="dev-proposal-status">⚠ NOT VERIFIED</span>
              </div>
              <div className="dev-proposal-body">
                <div className="dev-proposal-item">
                  <span className="dev-proposal-label">Root issue:</span>
                  <span className="dev-proposal-value">{actionState.proposal.root_issue}</span>
                </div>
                <div className="dev-proposal-item">
                  <span className="dev-proposal-label">Suggested change:</span>
                  <span className="dev-proposal-value">{actionState.proposal.suggested_change}</span>
                </div>
                <div className="dev-proposal-item">
                  <span className="dev-proposal-label">Suggested test:</span>
                  <span className="dev-proposal-value">{actionState.proposal.suggested_regression_test}</span>
                </div>
                <div className="dev-proposal-item">
                  <span className="dev-proposal-label">Confidence:</span>
                  <span className="dev-proposal-value">{Math.round(actionState.proposal.confidence * 100)}%</span>
                </div>
              </div>
              <div className="dev-proposal-footer">
                <span className="dev-rerun-help">Run a new rehearsal to verify whether the proposed change resolves the behavioral regression.</span>
                <button className="primary" onClick={handleRerun} disabled={actionState.isRerunning} data-testid={`btn-rerun-${journeyId}`}>
                  {actionState.isRerunning ? "Starting..." : "Run Rehearsal Again"}
                </button>
              </div>
            </div>
          )}

          {actionState.type === "intentional" && (
            <div className="dev-decision-card">
              <strong>Marked Intentional:</strong> {actionState.note}
            </div>
          )}

          {actionState.type === "ignored" && (
            <div className="dev-decision-card">
              <strong>Ignored (Ignored ≠ Resolved):</strong> {actionState.note || "No reason provided"}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
