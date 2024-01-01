import { debugFlags } from "./envbackend";
import { generateRandomId } from "@webhare/std";

let hookedfetch = false;

function sanitizeBody(body: unknown) {
  if (typeof body !== 'string') {
    return typeof body;
  }
  body = body.substring(0, 5000).replaceAll("\r", " ").replaceAll("\n", " ");
  return body;
}

function getResponseSummary(response: Response) {
  const toks = [];
  if (response.headers.get("Content-Type"))
    toks.push(response.headers.get("Content-Type"));
  if (response.headers.get("Content-Length"))
    toks.push(response.headers.get("Content-Length") + " bytes");
  if (response.headers.get("Transfer-Encoding"))
    toks.push(response.headers.get("Transfer-Encoding"));
  if (response.headers.get("Content-Encoding"))
    toks.push(response.headers.get("Content-Encoding"));

  return toks.length ? `(${toks.join(", ")})` : "";
}

function headersToString(headers: Headers) {
  return JSON.stringify(Object.fromEntries(headers.entries()));
}

async function debuggableFetch(originalfetch: typeof fetch, input: RequestInfo | URL, init?: RequestInit) {
  if (!debugFlags.wrq)
    return originalfetch(input, init);

  const method = (init?.method || "GET").padEnd(7);
  const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
  const headers = new Headers(typeof input === "object" && !(input instanceof URL) ? input.headers : init?.headers);
  const body = typeof input === "object" && !(input instanceof URL) ? input.body : init?.body;
  const debugrequestid = generateRandomId();

  console.log(`[wrq] ${debugrequestid} ${method} ${url}`);
  if (headers)
    console.log(`[wrq] ${debugrequestid} headers ${headersToString(headers)}`);
  if (body)
    console.log(`[wrq] ${debugrequestid} body    ${sanitizeBody(body)}`);

  const fetchresult = await originalfetch(input, init); //TODO log responses as well (if safe/applicable, eg not binary or Very Long... and we probably should wait for the first json()/text()/body() call? but at least log the status and time!)
  console.log(`[wrq] ${debugrequestid} result  ${fetchresult.status} ${fetchresult.statusText} ${getResponseSummary(fetchresult)}`);
  console.log(`[wrq] ${debugrequestid} headers ${headersToString(fetchresult.headers)}`);

  const ct = fetchresult.headers.get("Content-Type");
  if (ct && ["text/html", "text/plain", "application/json"].includes(ct?.split(';')[0])) {
    const responsebody = await fetchresult.clone().text();
    console.log(`[wrq] ${debugrequestid} body    ${sanitizeBody(responsebody)}`);
  }

  return fetchresult;
}

export function hookFetch() {
  if (hookedfetch)
    return;

  globalThis.fetch = debuggableFetch.bind(null, globalThis.fetch);
  hookedfetch = true;
}
