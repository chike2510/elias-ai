export type ApiFailure = {
  code?: string;
  message: string;
  details?: unknown;
};

export async function readApiResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let payload: unknown = null;

  if (raw.trim()) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(response.ok ? "The server returned an unreadable response." : raw.slice(0, 500));
    }
  }

  if (!response.ok) {
    const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const error = value.error;
    const message = error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : typeof error === "string" ? error : `Request failed (${response.status}).`;
    throw new Error(message);
  }

  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (value.ok === false) {
    const error = value.error;
    throw new Error(error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message) : "Request failed.");
  }

  return (value.ok === true ? value : payload) as T;
}
