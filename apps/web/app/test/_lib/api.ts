// Basic test-UI fetch helper. Not the final UI — thin wrapper around the
// { data, error } envelope from @/lib/api/response so pages can just await
// a plain object instead of re-checking res.ok everywhere.
export type ApiResult<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
  status: number;
};

export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit,
): Promise<ApiResult<T>> {
  // FormData bodies must not get a manual Content-Type — the browser sets
  // the multipart boundary itself.
  const isFormData = options?.body instanceof FormData;
  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers: isFormData ? options?.headers : { "Content-Type": "application/json", ...options?.headers },
  });
  const json = await res.json().catch(() => ({ data: null, error: { code: "PARSE_ERROR", message: "Invalid JSON response" } }));
  return { data: json.data, error: json.error, status: res.status };
}
