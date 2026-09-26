# Change Rehearsal — Security, Data & Operations v2

## 1. Threat Model

Change Rehearsal executes code from repository snapshots. This is an untrusted-code execution surface.

Primary risks:

- repository code escaping its sandbox
- secret leakage into evidence
- accidental network access
- sensitive data captured in logs/evidence
- unsafe dependencies or build scripts

---

## 2. Execution Isolation

Baseline and candidate should run in disposable environments.

```text
BASELINE container
      X
CANDIDATE container
```

Requirements:

- no direct host filesystem access beyond the checked-out fixture/repo
- no access to Change Rehearsal credentials
- no access to the Evidence Store's parent directory except through controlled outputs
- CPU/memory/time limits
- disposable after execution

For the hackathon MVP, use local disposable containers or tightly controlled local processes only for known synthetic fixtures.

---

## 3. Network

Default:

```text
NO outbound network access
```

ShopFlow should not require external APIs.

Allow-listing is future scope unless a demo scenario absolutely requires a controlled local endpoint.

---

## 4. Secrets

Never place real credentials in:

```text
ShopFlow
fixtures
scenario files
benchmark repositories
GitHub comments
evidence artifacts
```

GitHub authentication for the PR workflow should use the developer's local `gh auth` or an environment variable.

Never commit tokens.

---

## 5. Evidence Scrubbing

Captured outputs should remove or mask obvious sensitive values such as:

```text
Authorization headers
API keys
bearer tokens
password fields
secret environment values
```

Synthetic data remains the primary hackathon strategy.

---

## 6. Dependency Safety

Install dependencies inside the isolated environment.

Use lockfiles.

Avoid relying on uncontrolled postinstall scripts or live third-party services in the MVP demo.

---

## 7. Data Policy

The hackathon rules require appropriate data and prohibit client data, company-confidential data, personal information, and social-media data. Our demo uses synthetic repositories and synthetic seed data.

Public data should only be used where its applicable terms permit the intended use. For this project, external data is unnecessary for the MVP.

---

## 8. Evidence Storage

Store evidence under a run-scoped directory:

```text
artifacts/
  <run-id>/
    scenarios/
    observations/
    diffs/
    capsule/
```

This directory should be gitignored by default.

Only deliberate summary artifacts should be committed.

---

## 9. GitHub Security

MVP GitHub permissions should be minimal:

```text
read repository
write PR comments
```

No organization-wide admin privileges.

---

## 10. Operational Failure Handling

Distinguish clearly between:

```text
Execution failure
≠
Behavioral regression
```

Examples:

```text
Candidate fails to build
→ execution failure

Candidate builds but journey behavior differs
→ behavioral difference

Protected behavior differs unexpectedly
→ regression
```

---

## 11. Future Hardening

```text
MVP
→ local execution
→ synthetic fixtures
→ minimal GitHub access
→ best-effort scrubbing

Future
→ hosted sandbox
→ multi-tenant isolation
→ formal secret scanning
→ scoped GitHub App
→ full audit trail
```
