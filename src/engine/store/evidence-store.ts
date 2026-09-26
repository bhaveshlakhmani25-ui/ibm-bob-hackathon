/**
 * EvidenceStore — persists all rehearsal artifacts to a run-scoped directory
 * and provides a read-back API for the CLI's `show` command.
 *
 * Owner: Reuben (engine)
 * Phase: 2
 *
 * Storage layout:
 *   artifacts/<run-id>/
 *     run.json
 *     change.json
 *     requirement.json          (if present)
 *     journeys.json
 *     protected-behaviors.json
 *     scenarios.json
 *     observations/
 *       baseline-<scenario-id>.json
 *       candidate-<scenario-id>.json
 *     diffs.json
 *     regressions.json
 *     evidence.json
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  RehearsalResult,
  Evidence,
  Observation,
} from '../types.js';
import { EngineError } from '../errors.js';

export class EvidenceStore {
  private readonly root: string;

  constructor(artifactsDir?: string) {
    this.root = resolve(artifactsDir ?? process.env['CR_ARTIFACTS_DIR'] ?? './artifacts');
  }

  /** Absolute path to the run directory (before it is created) */
  runDir(runId: string): string {
    return join(this.root, runId);
  }

  /**
   * Persist all result artifacts to artifacts/<run-id>/.
   * Returns the Evidence[] linking each BehavioralDifference to its stored files.
   *
   * @throws EngineError('EVIDENCE_WRITE_FAILED') on IO error
   */
  async persist(result: Omit<RehearsalResult, 'evidence' | 'artifactsDir'>): Promise<Evidence[]> {
    const dir = this.runDir(result.run.id);

    try {
      await mkdir(dir, { recursive: true });
      await mkdir(join(dir, 'observations'), { recursive: true });

      await this.write(dir, 'run.json', result.run);
      await this.write(dir, 'change.json', result.change);

      if (result.requirement) {
        await this.write(dir, 'requirement.json', result.requirement);
      }

      await this.write(dir, 'journeys.json', result.journeys);
      await this.write(dir, 'protected-behaviors.json', result.protectedBehaviors);
      await this.write(dir, 'scenarios.json', result.scenarios);
      await this.write(dir, 'diffs.json', result.behavioralDifferences);
      await this.write(dir, 'regressions.json', result.regressions);

      // Write observations split by side + scenario
      for (const obs of result.observations) {
        const filename = `${obs.side}-${obs.scenarioId}.json`;
        await this.write(join(dir, 'observations'), filename, obs);
      }

      // Build Evidence records
      const evidence: Evidence[] = result.behavioralDifferences.map((diff) => {
        const relatedObs = result.observations.filter(
          (o) => o.scenarioId === diff.scenarioId,
        );
        return {
          id: randomUUID(),
          behavioralDifferenceId: diff.id,
          observationRefs: relatedObs.map((o) => o.id),
          storagePath: dir,
          artifactRefs: [
            'run.json',
            'change.json',
            'diffs.json',
            ...relatedObs.map((o) => `observations/${o.side}-${o.scenarioId}.json`),
          ],
        };
      });

      await this.write(dir, 'evidence.json', evidence);

      return evidence;
    } catch (err) {
      throw new EngineError('EVIDENCE_WRITE_FAILED', `Failed to write artifacts to ${dir}`, err);
    }
  }

  /**
   * Read a previously persisted rehearsal run from disk.
   *
   * @throws EngineError('RUN_NOT_FOUND') if the run directory does not exist
   */
  async read(runId: string): Promise<RehearsalResult> {
    const dir = this.runDir(runId);

    try {
      const [run, change, journeys, protectedBehaviors, scenarios, diffs, regressions, evidence] =
        await Promise.all([
          this.readJson(dir, 'run.json'),
          this.readJson(dir, 'change.json'),
          this.readJson(dir, 'journeys.json'),
          this.readJson(dir, 'protected-behaviors.json'),
          this.readJson(dir, 'scenarios.json'),
          this.readJson(dir, 'diffs.json'),
          this.readJson(dir, 'regressions.json'),
          this.readJson(dir, 'evidence.json'),
        ]);

      const requirement = await this.readJsonOptional(dir, 'requirement.json');

      // Re-read all observation files
      const observations: Observation[] = await this.readObservations(dir);

      return {
        run,
        change,
        requirement,
        journeys,
        protectedBehaviors,
        scenarios,
        observations,
        behavioralDifferences: diffs,
        regressions,
        evidence,
        artifactsDir: dir,
      } as RehearsalResult;
    } catch (err) {
      if (err instanceof EngineError) throw err;
      throw new EngineError('RUN_NOT_FOUND', `Run ${runId} not found at ${dir}`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async write(dir: string, filename: string, data: unknown): Promise<void> {
    await writeFile(join(dir, filename), JSON.stringify(data, null, 2), 'utf-8');
  }

  private async readJson(dir: string, filename: string): Promise<unknown> {
    const raw = await readFile(join(dir, filename), 'utf-8');
    return JSON.parse(raw);
  }

  private async readJsonOptional(dir: string, filename: string): Promise<unknown | undefined> {
    try {
      return await this.readJson(dir, filename);
    } catch {
      return undefined;
    }
  }

  private async readObservations(dir: string): Promise<Observation[]> {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(join(dir, 'observations')).catch(() => []);
    return Promise.all(
      files.map(async (f) => {
        const raw = await readFile(join(dir, 'observations', f), 'utf-8');
        return JSON.parse(raw) as Observation;
      }),
    );
  }
}
