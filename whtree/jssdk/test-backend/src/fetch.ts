import { whconstant_webserver_trustedportoffset } from "@mod-system/js/internal/webhareconstants";
import { getBasePort } from "@webhare/services/src/config";
import * as undici from "undici";

export interface TrustedPortDispatcherOptions {
  /** IP address to report as the source IP of the request (sent as X-Forwarded-For) */
  sourceIP?: string;
}

function getHeaderEntries(headers: undici.Dispatcher.DispatchOptions["headers"]): Array<[string, string]> {
  if (!headers)
    return [];
  if (Array.isArray(headers)) { //flat [name, value, name, value, ...] list
    const entries = new Array<[string, string]>;
    for (let i = 0; i + 1 < headers.length; i += 2)
      entries.push([String(headers[i]), String(headers[i + 1])]);
    return entries;
  }
  if (headers instanceof Headers)
    return [...headers.entries()];

  return Object.entries(headers).flatMap(([name, value]) =>
    value === undefined || value === null ? []
      : Array.isArray(value) ? value.map((v): [string, string] => [name, String(v)])
        : [[name, String(value)] satisfies [string, string]]);
}


/** Build a dispatcher that sends all requests to our local trusted port over http, mimicking a trusted proxy
    (see SetupWebHareTrustedPort in mod::system/whlibs/internet/webbrowser.whlib)
*/
export function createTrustedPortDispatcher(options: TrustedPortDispatcherOptions = {}): undici.Dispatcher {
  const sourceIP = options.sourceIP ?? "127.0.0.1";
  const pool = new undici.Pool(`http://127.0.0.1:${getBasePort() + whconstant_webserver_trustedportoffset}`);

  return pool.compose(dispatch => (opts, handler) => {
    const origin = new URL(String(opts.origin));
    const defaultport = origin.protocol === "https:" ? "443" : "80";
    const host = origin.hostname + (origin.port && origin.port !== defaultport ? ":" + origin.port : "");

    const headers = getHeaderEntries(opts.headers)
      .filter(([name]) => !["host", "x-forwarded-for", "x-forwarded-proto"].includes(name.toLowerCase()));
    headers.push(["X-Forwarded-For", sourceIP]);
    headers.push(["X-Forwarded-Proto", origin.protocol.slice(0, -1)]);
    headers.push(["Host", host]);

    return dispatch({ ...opts, headers: headers.flat() }, handler);
  });
}
