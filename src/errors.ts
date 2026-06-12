/** A user-facing error: printed cleanly (no stack trace) and exits non-zero. */
export class CliError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}
