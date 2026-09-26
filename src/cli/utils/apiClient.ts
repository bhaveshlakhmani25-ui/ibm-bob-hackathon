/**
 * Thin HTTP client that wraps the Change Rehearsal engine API.
 *
 * In production this calls the real engine server.
 * During B02 development, REHEARSAL_API_URL can be pointed at the mock server.
 *
 * Contracts: src/shared/contracts.ts §4.1, §4.2
 */
import type {
  StartRehearsalRequest,
  StartRehearsalResponse,
  RehearsalStatusResponse,
  RehearsalReport,
} from "../../shared/contracts.js";

const DEFAULT_BASE_URL = process.env["REHEARSAL_API_URL"] ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly error_code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function doFetch<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    throw new ApiError(0, `Network error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    let body = "";
    let error_code: string | undefined;
    try {
      body = await response.text();
      // Attempt to parse as JSON to extract machine-readable error_code (error-contract.schema.json)
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (typeof parsed["error_code"] === "string") {
        error_code = parsed["error_code"];
      }
    } catch {
      // ignore parse failure — body is kept as raw text
    }
    throw new ApiError(response.status, `HTTP ${response.status}: ${body}`, error_code);
  }

  return response.json() as Promise<T>;
}

/**
 * POST /api/rehearsals — Start a new rehearsal run.
 * Corresponds to contract §4.1
 */
export async function startRehearsal(
  request: StartRehearsalRequest,
  baseUrl = DEFAULT_BASE_URL,
): Promise<StartRehearsalResponse> {
  return doFetch<StartRehearsalResponse>(`${baseUrl}/api/rehearsals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

/**
 * GET /api/rehearsals/:run_id/status — Poll run progress.
 * Corresponds to contract §4.2
 */
export async function getRehearsalStatus(
  runId: string,
  baseUrl = DEFAULT_BASE_URL,
): Promise<RehearsalStatusResponse> {
  return doFetch<RehearsalStatusResponse>(`${baseUrl}/api/rehearsals/${runId}/status`);
}

/**
 * GET /api/rehearsals/:run_id/report — Full behavioral diff report.
 * Corresponds to contract §4.3
 */
export async function fetchReport(
  runId: string,
  baseUrl = DEFAULT_BASE_URL,
): Promise<RehearsalReport> {
  return doFetch<RehearsalReport>(`${baseUrl}/api/rehearsals/${runId}/report`);
}
