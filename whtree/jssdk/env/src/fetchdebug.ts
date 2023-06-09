import { flags } from "./envbackend";
import { generateRandomId } from "@webhare/std";

let hookedfetch = false;

function sanitizeBody(body: unknown) {
  if (typeof body !== 'string') {
    return typeof body;
  }
  body = body.substring(0, 5000).replaceAll("\r", " ").replaceAll("\n", " ");
  return body;
}

function getLength(response: Response) {
  const ce = response.headers.get("Content-Encoding");
  const cl = response.headers.get("Content-Length");
  if (cl)
    return "(" + cl + " bytes" + (ce ? ", " + ce : "") + ")";

  const te = response.headers.get("Transfer-Encoding");
  if (te)
    return "(" + te + (ce ? ", " + ce : "") + ")"; //eg "chunked, gzip"

  return "";
}

async function debuggableFetch(originalfetch: typeof fetch, input: RequestInfo | URL, init?: RequestInit) {
  if (!flags.wrq)
    return originalfetch(input, init);

  const method = (init?.method || "GET").padEnd(7);
  const url = input instanceof URL ? input.toString() : input;
  const debugrequestid = generateRandomId();

  console.log(`[wrq] ${debugrequestid} ${method} ${url}`);
  if (init?.headers)
    console.log(`[wrq] ${debugrequestid} headers ${JSON.stringify(init?.headers)}`);
  if (init?.body)
    console.log(`[wrq] ${debugrequestid} body    ${sanitizeBody(init.body)}`);

  const fetchresult = await originalfetch(input, init); //TODO log responses as well (if safe/applicable, eg not binary or Very Long... and we probably should wait for the first json()/text()/body() call? but at least log the status and time!)
  console.log(`[wrq] ${debugrequestid} result  ${fetchresult.status} ${fetchresult.statusText} ${getLength(fetchresult)}`);
  console.log(`[wrq] ${debugrequestid} headers ${JSON.stringify(fetchresult.headers)}`);

  const ct = fetchresult.headers.get("Content-Type");
  if (ct && ["text/html", "text/plain", "application/json"].includes(ct?.split(';')[0])) {
    const body = await fetchresult.clone().text();
    console.log(`[wrq] ${debugrequestid} body    ${sanitizeBody(body)}`);
  }

  return fetchresult;
}

export function hookFetch() {
  if (hookedfetch)
    return;

  globalThis.fetch = debuggableFetch.bind(null, globalThis.fetch);
  hookedfetch = true;
}
