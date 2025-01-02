import { debugFlags, registerDebugConfigChangedCallback } from "./envbackend";
import { generateRandomId } from "@webhare/std";

let hookedfetch = false;

function sanitizeBody(body: unknown) {
  if (body instanceof ArrayBuffer) {
    const view = new Uint8Array(body.slice(0, 5000)); //show the bytes but filter unprintable as '.'
    return Array.from(view).map(v => v >= 32 && v < 127 ? String.fromCharCode(v) : ".").join("");
  }
  if (typeof body !== 'string') {
    return `[${typeof body}]`;
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

  const method = (init?.method || (input as Request)?.method || "GET").padEnd(7);
  const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
  const headers = new Headers(typeof input === "object" && !(input instanceof URL) ? input.headers : init?.headers);
  let body = typeof input === "object" && !(input instanceof URL) ? input.body : init?.body;
  const debugrequestid = generateRandomId();

  console.log(`[wrq] ${debugrequestid} ${method} ${url}`);
  if (headers)
    console.log(`[wrq] ${debugrequestid} headers ${headersToString(headers)}`);
  if (body) {
    if (body instanceof ReadableStream) {
      //convert the ReadableStream to ArrayBuffer so we can print AND send it (TODO ideally 'tee' the stream and just grab the first 5K bytes)
      const reader = body.getReader();
      const chunks = [];
      for (; ;) {
        const { done, value } = await reader.read();
        if (done)
          break;
        chunks.push(value);
      }
      body = await new Blob(chunks).arrayBuffer();
      init = { ...init, body };
    }
    console.log(`[wrq] ${debugrequestid} body    ${sanitizeBody(body)}`);
  }

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

export function enableFetchDebugging() {
  // Hook global fetch if requested
  if (globalThis["fetch"]) {
    if (debugFlags.wrq)
      hookFetch();

    registerDebugConfigChangedCallback(() => {
      if (debugFlags.wrq)
        hookFetch();
    });
  }
}
