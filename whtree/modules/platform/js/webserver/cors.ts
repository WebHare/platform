import { isLike } from "@webhare/hscompat";
import type { WebRequest } from "@webhare/router";

// Methods which are allowed in HTTP access control requests (uppercase!)
const ACCESSCONTROL_ALLOWEDMETHODS = ["GET", "HEAD", "POST", "OPTIONS"];

// Custom headers which are allowed in HTTP access control requests (lowercase!)
const ACCESSCONTROL_ALLOWEDHEADERS = [
  "authorization",
  "content-type", // Required for Firefox
  "origin", // Required for Chrome
  "accept", "x-request", "x-requested-with" // Sent by the MooTools Request object
];

// Headers which may be accessed by the browser requesting a CORS resource, in addition to the 'simple response headers' which
// are allowed by default (see http://www.w3.org/TR/cors/#simple-response-header): Cache-Control, Content-Language,
// Content-Type, Expires, Last-Modified and Pragma (case doesn't matter, using lowercase for consistency with
// accesscontrol_allowedheaders)
const ACCESSCONTROL_EXPOSEDHEADERS = ["content-length", "date"];

// Caching for 5 mins should be safe, the only external change is module replace
const MAXSERVICEDEFINITIONAGE = 5 * 60;

export function handleCrossOriginResourceSharing(webreq: WebRequest, { crossdomainOrigins }: { crossdomainOrigins: string[] }) {
  // See http://www.w3.org/TR/cors/ and https://developer.mozilla.org/en/http_access_control
  const originHeaderValue = webreq.headers.get("Origin");
  if (!originHeaderValue)
    return null;

  const result = {
    success: false,
    origin: "",
    preflight: webreq.method === "OPTIONS",
    headers: {} as Record<string, string>,
    errorMsg: "",
  };
  const urlInfo = new URL(webreq.url);

  // Check if one the supplied origin is allowed by one of the cross-domain origins
  // For preflight requests (using method "OPTIONS"), only one origin is permitted
  for (let checkOrigin of result.preflight ? [originHeaderValue] : originHeaderValue.split(" ")) {
    const originInfo = new URL(checkOrigin);

    // Always allow current host
    if (urlInfo.host === originInfo.host && urlInfo.port === originInfo.port && urlInfo.protocol === originInfo.protocol) {
      result.origin = checkOrigin;
      result.success = true;
    } else {
      // Rewrite origin to remove default ports
      checkOrigin = originInfo.toString().slice(0, -1); // URL already clears default ports, just remove the trailing '/'
      const checkOriginHostPort = originInfo.host.toUpperCase() || (originInfo.port ? `:${originInfo.port}` : "");
      for (const originMask of crossdomainOrigins) {
        if (isLike(checkOrigin.toUpperCase(), originMask.toUpperCase()) || isLike(checkOriginHostPort, originMask.toUpperCase())) {
          result.origin = checkOrigin;
          result.success = true;
          break;
        }
      }
    }
    if (result.success)
      break;
  }
  if (!result.success) {
    result.errorMsg = `Cannot match origin '${originHeaderValue}' with list of origins`;
    // If this is a preflight request, add a custom header with the error message for debugging purposes
    if (result.preflight)
      result.headers["X-WebHare-CORS-Error"] = result.errorMsg;
    return result;
  }

  if (result.preflight) {
    // Check if the requested method is allowd
    const method = webreq.headers.get("Access-Control-Request-Method");
    if (!method || !ACCESSCONTROL_ALLOWEDMETHODS.includes(method)) {
      result.success = false;
      result.errorMsg = `Cannot match request method '${method || ""}' with list of methods`;
      // If this is a preflight request, add a custom header with the error message for debugging purposes
      if (result.preflight)
        result.headers["X-WebHare-CORS-Error"] = result.errorMsg;
      return result;
    }

    // Check if the requested headers are allowed
    const headers = webreq.headers.get("Access-Control-Request-Headers");
    if (headers) {
      for (const header of headers.split(",")) {
        if (!ACCESSCONTROL_ALLOWEDHEADERS.includes(header.trim().toLowerCase())) {
          result.success = false;
          result.errorMsg = `Cannot match request header '${header.trim()}' with list of headers`;
          // If this is a preflight request, add a custom header with the error message for debugging purposes
          if (result.preflight)
            result.headers["X-WebHare-CORS-Error"] = result.errorMsg;
          return result;
        }
      }
    }
  }
  // Add the necessary HTTP access control headers
  result.headers["Access-Control-Allow-Origin"] = result.origin;
  if (result.preflight) {
    result.headers["Access-Control-Allow-Methods"] = ACCESSCONTROL_ALLOWEDMETHODS.join(", ");
    result.headers["Access-Control-Allow-Headers"] = ACCESSCONTROL_ALLOWEDHEADERS.join(", ");
    result.headers["Access-Control-Expose-Headers"] = ACCESSCONTROL_EXPOSEDHEADERS.join(", ");
    result.headers["Access-Control-Allow-Credentials"] = "true"; // Allow, not require credentials, set just in case authentication is required
    result.headers["Access-Control-Max-Age"] = MAXSERVICEDEFINITIONAGE.toString();
  }
  return result;
}
