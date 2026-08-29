export class SocialApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
    public readonly retryable = status === 429 || status >= 500
  ) {
    super(message);
    this.name = "SocialApiError";
  }
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, provider = "Social API") {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) {
    throw new SocialApiError(`${provider} request failed (${response.status}): ${body.slice(0, 900)}`, response.status, body);
  }

  if (!body) return {} as T;
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new SocialApiError(`${provider} returned invalid JSON: ${body.slice(0, 500)}`, response.status, body, false);
  }
}

export function expiresAt(seconds?: number | null) {
  return seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;
}
