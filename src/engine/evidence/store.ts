/**
 * Change Rehearsal — R07 Evidence Capsule Store
 *
 * Persists EvidenceCapsule artifacts to the run-scoped artifacts directory.
 * Reuses the existing EvidenceStore infrastructure for directory management.
 *
 * Storage layout (within artifacts/<run-id>/):
 *   rehearsal-report.json     — JSON-serialized EvidenceCapsule
 *   rehearsal-report.md       — Markdown developer-readable report
 *
 * The capsule_ref field in RehearsalReport points to these paths.
 *
 * Security: Only scrubbed/normalized data is written. Raw sensitive values
 * remain in R05's domain and are never written by R07.
 *
 * Owner: Reuben (engine)
 * Phase: R07
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvidenceCapsule } from './model.js';
import { serializeCapsuleToJson, deserializeCapsuleFromJson, serializeCapsuleToMarkdown } from './serialization.js';
import { validateCapsule } from './validation.js';
import { EngineError } from '../errors.js';

// ---------------------------------------------------------------------------
// File name constants
// ---------------------------------------------------------------------------

export const CAPSULE_JSON_FILENAME = 'rehearsal-report.json';
export const CAPSULE_MARKDOWN_FILENAME = 'rehearsal-report.md';

// ---------------------------------------------------------------------------
// CapsuleStore
// ---------------------------------------------------------------------------

/**
 * Stores and retrieves EvidenceCapsule artifacts for a rehearsal run.
 *
 * Works alongside the existing EvidenceStore — does not replace it.
 * The existing EvidenceStore handles raw run/change/journey artifacts.
 * CapsuleStore handles the R07-specific JSON capsule and Markdown report.
 */
export class CapsuleStore {
  /**
   * @param artifactsDir Absolute path to the artifacts root directory.
   *                     Defaults to ./artifacts (or CR_ARTIFACTS_DIR env var).
   */
  constructor(private readonly artifactsDir: string = process.env['CR_ARTIFACTS_DIR'] ?? './artifacts') {}

  /**
   * Return the absolute path to the run directory.
   */
  runDir(runId: string): string {
    return join(this.artifactsDir, runId);
  }

  /**
   * Return the absolute path to the JSON capsule file.
   */
  jsonPath(runId: string): string {
    return join(this.runDir(runId), CAPSULE_JSON_FILENAME);
  }

  /**
   * Return the absolute path to the Markdown report file.
   */
  markdownPath(runId: string): string {
    return join(this.runDir(runId), CAPSULE_MARKDOWN_FILENAME);
  }

  /**
   * Return the capsule_ref paths (relative to the run directory).
   * These are the paths that go into RehearsalReport.capsule_ref.
   */
  capsuleRef(runId: string): { json_path: string; markdown_path: string } {
    return {
      json_path: CAPSULE_JSON_FILENAME,
      markdown_path: CAPSULE_MARKDOWN_FILENAME,
    };
  }

  /**
   * Persist an EvidenceCapsule to disk.
   *
   * Writes:
   *   artifacts/<run-id>/rehearsal-report.json
   *   artifacts/<run-id>/rehearsal-report.md
   *
   * @throws EngineError('EVIDENCE_WRITE_FAILED') on IO error or validation failure
   */
  async persist(capsule: EvidenceCapsule): Promise<{
    json_path: string;
    markdown_path: string;
  }> {
    const validation = validateCapsule(capsule);
    if (!validation.valid) {
      throw new EngineError(
        'EVIDENCE_WRITE_FAILED',
        `Cannot persist invalid EvidenceCapsule: ${validation.errors.join('; ')}`,
      );
    }

    const dir = this.runDir(capsule.rehearsalRunId);

    try {
      await mkdir(dir, { recursive: true });

      const jsonContent = serializeCapsuleToJson(capsule);
      const markdownContent = serializeCapsuleToMarkdown(capsule);

      const jsonFilePath = join(dir, CAPSULE_JSON_FILENAME);
      const mdFilePath = join(dir, CAPSULE_MARKDOWN_FILENAME);

      await writeFile(jsonFilePath, jsonContent, 'utf-8');
      await writeFile(mdFilePath, markdownContent, 'utf-8');

      return {
        json_path: CAPSULE_JSON_FILENAME,
        markdown_path: CAPSULE_MARKDOWN_FILENAME,
      };
    } catch (err) {
      if (err instanceof EngineError) throw err;
      throw new EngineError(
        'EVIDENCE_WRITE_FAILED',
        `Failed to write evidence capsule to ${dir}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  /**
   * Read a previously persisted EvidenceCapsule from disk.
   *
   * @throws EngineError('RUN_NOT_FOUND') if the capsule file does not exist
   * @throws EngineError('EVIDENCE_WRITE_FAILED') if the file is malformed
   */
  async read(runId: string): Promise<EvidenceCapsule> {
    const filePath = this.jsonPath(runId);

    try {
      const raw = await readFile(filePath, 'utf-8');
      return deserializeCapsuleFromJson(raw);
    } catch (err) {
      if (err instanceof EngineError) throw err;
      throw new EngineError(
        'RUN_NOT_FOUND',
        `Evidence capsule for run "${runId}" not found at ${filePath}`,
        err,
      );
    }
  }

  /**
   * Read the Markdown report for a run.
   *
   * @throws EngineError('RUN_NOT_FOUND') if the file does not exist
   */
  async readMarkdown(runId: string): Promise<string> {
    const filePath = this.markdownPath(runId);

    try {
      return await readFile(filePath, 'utf-8');
    } catch (err) {
      throw new EngineError(
        'RUN_NOT_FOUND',
        `Markdown report for run "${runId}" not found at ${filePath}`,
        err,
      );
    }
  }
}
