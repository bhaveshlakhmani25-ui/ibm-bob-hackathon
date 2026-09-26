/**
 * ImpactAnalyzer — finds files, symbols, services, and workflows affected by the change.
 *
 * Owner: Reuben (engine)
 * Phase: 1
 */

import type {
  Change,
  RepositoryContext,
  ServiceMap,
  Journey,
  ImpactSet,
} from '../types.js';

/**
 * Analyze the impact of a change by combining:
 * 1. Within-service call/import graph (grep/AST walk for changed symbol references)
 * 2. Cross-service impact via the ServiceMap (declared dependencies)
 *
 * Never throws — on partial failure, sets crossServiceWarning on the result.
 */
export async function analyzeImpact(
  change: Change,
  repo: RepositoryContext,
  serviceMap: ServiceMap,
  journeys: Journey[],
): Promise<ImpactSet> {
  // TODO (Phase 1):
  // 1. Collect changed symbol names from change.diffSummary.symbolsChanged
  // 2. Grep the repository for references to those symbols → affectedFiles
  // 3. For each affected file, check which service it belongs to (by path convention or config)
  // 4. For each affected service, walk serviceMap.services[name].dependsOn → affectedServices
  // 5. Cross-reference journeys to find which workflow names are affected → affectedWorkflows
  // 6. If serviceMap has no entry for any changed service, set crossServiceWarning
  return {
    affectedFiles: [],
    affectedSymbols: [],
    affectedServices: [],
    affectedWorkflows: [],
    crossServiceWarning: 'analyzeImpact: not yet implemented',
  };
}

/**
 * Load the service map from the repository's change-rehearsal.yaml or service-map.yaml.
 * Returns an empty ServiceMap if no config file is found.
 */
export function loadServiceMap(repo: RepositoryContext): ServiceMap {
  // TODO (Phase 1):
  // Look for: <repo.localPath>/change-rehearsal.yaml
  //       or: <repo.localPath>/service-map.yaml
  // Parse YAML and validate against ServiceMap schema
  return { services: {} };
}
