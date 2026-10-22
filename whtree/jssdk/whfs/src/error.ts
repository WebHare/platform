/** WHFS Error codes for WHFSError
 * "invalid-argument" is a placeholder for situations where we might still add a more specific error code in the future
*/
export type WHFSErrorCode = "invalid-argument" | "object-exists" | "object-not-found" | "access-denied";

/** WHFS Errors for messages that are safe to pass through the API (a normal Error will not be revealed) */
export class WHFSError extends Error {
  readonly code: WHFSErrorCode;

  constructor(code: WHFSErrorCode, message: string) {
    super(`${message} (${code})`); //do we need to prefix it with th e
    this.code = code;
  }
}
