export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(`${code}: ${message}`);
    this.name = "ApiError";
  }
}
export async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: method === "GET" ? undefined : { "Content-Type": "application/json", "X-Pathsmith-Client": "local" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload.error ?? payload;
    throw new ApiError(response.status, String(error.code ?? response.status), String(error.message ?? response.statusText), error.details);
  }
  return payload as T;
}
export function downloadText(content: string, filename: string, mediaType = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const query = (values: Record<string, string | number | undefined>) => {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") result.set(key, String(value));
  return result.toString();
};
