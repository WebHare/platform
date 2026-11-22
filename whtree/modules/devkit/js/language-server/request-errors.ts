/* Handling of failed requests. Most requests need WebHare to be running, so whether a failure is fatal depends on
   whether we're connected to WebHare.

   Requests run in a separate code context, which holds the HSVM used by loadlib and the database connection. When
   WebHare goes down, these die with it (an HSVM is also shut down by a HareScript error), so the context is replaced by
   a fresh one when the connection to WebHare is restored or when a request fails while WebHare is down. */

import { CodeContext, getCodeContext } from "@webhare/services/src/codecontexts";

/// After the connection to WebHare was restored, request errors aren't fatal for this long, as WebHare may still be starting
const RESTORE_GRACE_PERIOD = 30_000; // Milliseconds

/// Whether we're currently connected to WebHare's devkit:lspservice
let whConnected = false;
/// Until when request errors aren't fatal after the connection to WebHare was restored
let restoreGraceUntil = 0;
/// The code context to run requests in
let requestContext = createRequestContext();

function createRequestContext() {
  return new CodeContext("devkit:languageserver requests");
}

/** Replace the request code context with a fresh one
    @param failedContext - If set, only replace the request context if it's still this context
*/
function replaceRequestContext(failedContext?: CodeContext) {
  if (failedContext && failedContext !== requestContext)
    return; // Already replaced

  const oldContext = requestContext;
  requestContext = createRequestContext();
  // Requests still running in the old context will fail
  oldContext.close().catch(e => console.error("Error closing request context", (e as Error)?.message));
}

/** Get the code context to run requests in */
export function getRequestContext(): CodeContext {
  return requestContext;
}

/** Update the WebHare connection state
    @param connected - Whether we're connected to WebHare
    @param restored - If connected, whether the connection was restored after it was lost
*/
export function setWebHareConnected(connected: boolean, restored = false) {
  whConnected = connected;
  if (connected && restored) {
    restoreGraceUntil = Date.now() + RESTORE_GRACE_PERIOD;
    // The HSVM and database connection have probably died while WebHare was down
    replaceRequestContext();
  }
}

/** Handle a failed request. If we're connected to WebHare, kill the LS (or perhaps only on out-of-date exceptions?).
    If we're not connected, WebHare is probably not running (or still starting, if the connection was only just restored),
    so we just let the request fail and keep running, so we'll pick up again when WebHare is back.
    @param context - The code context the request ran in, defaults to the current code context
    @returns Whether the LS is aborting */
export function handleRequestError(e: unknown, type: "exception" | "rejection", source?: string, context: CodeContext = getCodeContext()): boolean {
  if (!whConnected || Date.now() < restoreGraceUntil) {
    console.error(`** Failed ${type} ${source ? `from ${source} ` : ""}while ${whConnected ? "WebHare is starting" : "not connected to WebHare"}`, (e as Error)?.message);
    // The HSVM or database connection may have died, so have the next request start with fresh ones
    replaceRequestContext(context);
    return false;
  }
  console.error(`** Fatal ${type} ${source ? `from ${source} ` : ""}- will abort`, e);
  setTimeout(() => process.exit(1), 50); //allow some time to send/report dying screams
  return true;
}
