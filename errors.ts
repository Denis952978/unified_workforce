/** Every error leaves the API as { code, message, details }. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, unknown> = {}) { super(message); }
}
