/** The service is connected, but its managed file is temporarily unavailable. */
export class BackendBusyError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs = 50,
  ) {
    super(message);
    this.name = 'BackendBusyError';
  }
}
