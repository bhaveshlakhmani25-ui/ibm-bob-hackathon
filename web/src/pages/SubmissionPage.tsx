/**
 * SubmissionPage — Change Rehearsal submission flow (B02) +
 *                  Rehearsal progress experience wiring (B03) +
 *                  Behavioral Diff navigation wiring (B04).
 *
 * Responsibilities:
 *  - Collect repository, branch, and requirement from the developer.
 *  - POST /api/rehearsals via startRehearsal().
 *  - Hand off to RehearsalProgressView once a run_id is obtained.
 *  - Transition to BehavioralDiffView when the user opens the diff.
 *  - Preserve all submission context (intent, repo, refs) throughout.
 */
import { useState, useEffect } from "react";
import DecryptedText from "../components/DecryptedText";
import { startRehearsal } from "../services/api";
import { RehearsalProgressView } from "./RehearsalProgressView";
import { BehavioralDiffView } from "./BehavioralDiffView";
import LiquidEther from "../components/LiquidEther";
import TextType from "../components/TextType";

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

  // When the user opens the behavioral diff from the progress view.
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    // Only run this observer when the homepage form is shown (activeRun is null)
    if (activeRun) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    const elements = document.querySelectorAll('.animate-on-scroll');
    elements.forEach(el => observer.observe(el));

    return () => {
      elements.forEach(el => observer.unobserve(el));
    };
  }, [activeRun]);

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
    setShowDiff(false);
    setIntent("");
    setError(null);
  };

  const handleOpenDiff = () => {
    setShowDiff(true);
  };

  const isFormValid =
    intent.trim().length > 0 &&
    repo.trim().length > 0 &&
    baseBranch.trim().length > 0;

  const scrollToForm = () => {
    document.getElementById("rehearsal-form")?.scrollIntoView({ behavior: "smooth" });
  };

  // -------------------------------------------------------------------------
  // Progress view — shown after a run is started
  // -------------------------------------------------------------------------

  if (activeRun && showDiff) {
    return (
      <div>
        <div className="brand">CHANGE REHEARSAL</div>
        <p className="subtitle">Don't just review the diff. Rehearse the behavior.</p>
        <BehavioralDiffView
          runId={activeRun.runId}
          requirement={activeRun.requirement}
          onNewRehearsal={handleNewRehearsal}
        />
      </div>
    );
  }

  if (activeRun) {
    return (
      <div>
        <div className="brand">CHANGE REHEARSAL</div>
        <p className="subtitle">Don't just review the diff. Rehearse the behavior.</p>
        <RehearsalProgressView
          runId={activeRun.runId}
          requirement={activeRun.requirement}
          onNewRehearsal={handleNewRehearsal}
          onOpenDiff={handleOpenDiff}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Submission form — shown before a run is started
  // -------------------------------------------------------------------------

  return (
    <div className="homepage-container">
      <div className="landing-liquid-background">
        <LiquidEther
          colors={['#FF6B57', '#FFF3EC', '#1D304A']}
          mouseForce={14}
          cursorSize={90}
          isViscous={false}
          viscous={30}
          iterationsViscous={24}
          iterationsPoisson={24}
          resolution={0.45}
          isBounce={false}
          autoDemo={true}
          autoSpeed={0.35}
          autoIntensity={1.6}
          takeoverDuration={0.25}
          autoResumeDelay={3000}
          autoRampDuration={0.8}
        />
      </div>

      <main className="landing-content">
        {/* Hero Section */}
        <section className="hero-section">


        <div className="hero-text">
          <span className="eyebrow">
            CHANGE REHEARSAL
          </span>
          <TextType
            className="hero-headline"
            text="Rehearse your code changes before they become production problems."
            as="h1"
            typingSpeed={45}
            initialDelay={150}
            pauseDuration={1000}
            deletingSpeed={30}
            loop={false}
            showCursor={true}
            hideCursorWhileTyping={false}
            cursorCharacter="|"
            startOnVisible={true}
          />
          <p className="hero-supporting">
            Simulate the impact of a change, discover affected journeys, and understand behavioral risk before you ship.
          </p>
          <div className="hero-ctas">
            <button className="primary hero-btn" onClick={scrollToForm}>
              Start a Rehearsal
            </button>
            <button className="secondary hero-btn">
              View Demo
            </button>
          </div>
        </div>

        <div className="hero-visual">
          <div className="hero-preview-panel">
            <div className="preview-label">CHANGE REHEARSAL</div>
            <div className="preview-section-title">
              <span className="change-subtitle">Change detected</span>
              <strong>Add caching to Product API</strong>
            </div>
            <div className="preview-divider"></div>
            <div className="preview-label">BEHAVIORAL IMPACT</div>
            <div className="preview-section-title">
              <strong>3 user journeys affected</strong>
            </div>
            <div className="preview-impacts">
              <div className="preview-impact-row"><span>Checkout</span><span className="impact-badge high">HIGH</span></div>
              <div className="preview-impact-row"><span>Product Search</span><span className="impact-badge medium">MEDIUM</span></div>
              <div className="preview-impact-row"><span>Recommendations</span><span className="impact-badge low">LOW</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. KNOW THE IMPACT BEFORE YOU SHIP (Submission Form) */}
      <section className="final-cta-section" id="rehearsal-form">
        <div className="final-cta-text">
          <h2 className="final-cta-title">Know the impact<br/>before you ship.</h2>
          <p className="final-cta-desc">Turn every code change into a rehearsal.</p>
        </div>

        <div className="submission-form-container">
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

          <form onSubmit={handleSubmit} className="premium-form">
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
                className="primary submit-btn"
                disabled={!isFormValid || isSubmitting}
              >
                {isSubmitting ? (
                  <span style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center" }}>
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
      </section>

      {/* 3. HOW CHANGE REHEARSAL WORKS */}
      <section className="problem-section animate-on-scroll">
        <h2 className="section-title">How Change Rehearsal works</h2>

        <div className="features-section" style={{ width: '100%', marginTop: '1rem' }}>
          <div className="feature-card">
            <div className="feature-number">01</div>
            <h3 className="feature-title">Rehearse Changes</h3>
            <p className="feature-desc">Test changes in a simulated environment before merging.</p>
          </div>
          <div className="feature-card">
            <div className="feature-number">02</div>
            <h3 className="feature-title">Detect Behavioral Impact</h3>
            <p className="feature-desc">Identify regressions and affected journeys.</p>
          </div>
          <div className="feature-card">
            <div className="feature-number">03</div>
            <h3 className="feature-title">Replay User Journeys</h3>
            <p className="feature-desc">Visualize exactly what changed in user flows.</p>
          </div>
        </div>
      </section>

      {/* 4. EXAMPLE BEHAVIORAL IMPACT */}
      <section className="preview-section animate-on-scroll">
        <div className="preview-card">
          <div className="preview-header">
            <DecryptedText text="EXAMPLE BEHAVIORAL IMPACT" animateOn="view" sequential={true} revealDirection="start" speed={45} maxIterations={8} useOriginalCharsOnly={true} />
          </div>
          <div className="preview-list">
            <div className="preview-row"><span>Checkout Flow</span><span className="impact-level high">HIGH</span></div>
            <div className="preview-row"><span>Product Search</span><span className="impact-level medium">MEDIUM</span></div>
            <div className="preview-row"><span>Recommendations</span><span className="impact-level low">LOW</span></div>
          </div>
        </div>
      </section>

      {/* 5. FOOTER */}
      <footer className="main-footer">
        <div className="footer-content">
          <div className="footer-brand-section">
            <h2 className="footer-brand">
              CHANGE REHEARSAL
            </h2>
            <p className="footer-tagline">
              <DecryptedText
                text="Rehearse behavior. Verify change."
                animateOn="view"
                sequential={true}
                revealDirection="start"
                speed={45}
                maxIterations={8}
                useOriginalCharsOnly={true}
              />
            </p>
            <p className="footer-sub">
              Behavioral verification before you ship.
            </p>
          </div>

          <div className="footer-links-section">
            <div className="footer-col">
              <span className="footer-col-title">Product</span>
              <a href="#">How it Works</a>
              <a href="#">Rehearsal</a>
              <a href="#">Behavioral Impact</a>
            </div>
          </div>
        </div>
      </footer>
      </main>
    </div>
  );
};
