// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/rpc" {
  export interface KnownRPCServices {
    /* Filled by generated services.ts files */
  }
}

import { debugFlags, backendBase } from "@webhare/env";
import { type StackTrace, parseTrace, prependStackTrace, type PromisifyFunctionReturnType } from "@webhare/js-api-tools";
import { omit, parseTyped, stringify } from "@webhare/std";

//Preload interface definitions. To solve this cleaner we would have to do some sort of auto-inject but how to robustly do that accross IDEs/Tscs ?

//@ts-ignore Ignore if it doesn't exist
import type { } from "@mod-platform/generated/ts/services.ts";
//@ts-ignore Ignore if it doesn't exist
import type { } from "wh:ts/services.ts";

function isAbsolute(url: string) {
  return url.startsWith("http:") || url.startsWith("https:");
}

function getBaseURL() {
  if (!backendBase)
    throw new Error(`You must set the baseUrl option when using the RPC Client outside Webhare`);
  return isAbsolute(backendBase) ? backendBase : new URL(backendBase, location.origin);
}

export interface RPCClientOptions {
  /** Custom request update. Use to eg. set keepalive or add debug variables to the URL */
  onBeforeRequest?: (url: URL, requestInit: RequestInit & { headers: Headers }) => void;
  /** Response callback. Use this if you need to capture details on the incoming respones. May be invoked multiple times per request, eg due to 429 errors! */
  onResponse?: (response: Response) => void;
  /** Call timeout */
  timeout?: number;
  /** Abort signal to cancel the RPC */
  signal?: AbortSignal;
  /** Retry on 429 */
  retry429?: boolean;
  /** Silent - do not log errors */
  silent?: boolean;
  /** Debug (Follows 'rpc' debugflag if not explicity specified) */
  debug?: boolean;
  /** Headers to submit (Eg Authorization) */
  headers?: Record<string, string>;
  /** Base URL for service paths */
  baseUrl?: string;
}

/** RPC Response format */
export type RPCResponse = ({
  /** Result. Not present if the function didn't return anything */
  result?: unknown;
} | {
  /** Error message */
  error: string;
  /** Captured stack trace (if 'etr' debugFlag is set) */
  trace?: StackTrace;
}) & {
  /** Captured console log entries (if 'etr' debugFlag is set) */
  consoleLog?: Array<{
    //TODO this is Serialized<ConsoleLogItem[]> - should probably rename it to SerializedToJSON and move to std or env ?
    /** Date when console function was called */
    when: string;
    /** `console` method that was called (eg 'log') */
    method: string;
    /** Logged data */
    data: string;
    /** Location of caller */
    location?: {
      filename: string;
      line: number;
      col: number;
      func: string;
    };
    /** Codecontext */
    codeContextId?: string;
  }>;
};

class ControlledCall {
  client: RPCClient;
  options: RPCClientOptions;
  abortcontroller?: AbortController;
  timeout?: number;
  _callurl: string;
  _fetchoptions: RequestInit;
  promise: Promise<unknown>;
  timedout?: boolean;
  aborted?: boolean;

  constructor(client: RPCClient, method: string, stack: StackTrace | null, options: RPCClientOptions, callurl: URL, fetchoptions: RequestInit) {
    this.client = client;
    this.options = options;

    if (options.timeout || options.signal) {
      this.abortcontroller = new AbortController;
      fetchoptions.signal = this.abortcontroller.signal;

      if (options.timeout && options.timeout > 0) {
        this.timeout = options.timeout;
        setTimeout(() => this._handleTimeout(), options.timeout);
      }
      if (options.signal) {
        options.signal.addEventListener("abort", () => this._abort());
      }
    }

    this._callurl = callurl.toString();
    this._fetchoptions = fetchoptions;

    const fetchpromise = fetch(this._callurl, this._fetchoptions);
    this.promise = this._completeCall(method, stack, fetchpromise) as Promise<unknown>;
  }
  _handleTimeout() {
    this.timedout = true;
    this.abortcontroller?.abort();
  }
  _abort() {
    this.aborted = true;
    this.abortcontroller?.abort();
  }

  async _completeCall(method: string, requestStack: StackTrace | null, fetchpromise: Promise<Response>) {
    let response;
    for (; ;) { //loop to handle "429 Conflict"s
      try { //we should only guard the fetch call and specifically *not* the onResponse callback
        response = await fetchpromise;
      } catch (exception) {
        if (this.client.debug)
          console.log(`[rpc] Exception invoking '${method}'`, exception);

        if (this.aborted)
          throw new Error(`RPC Aborted`);
        else if (this.timedout)
          throw new Error(`RPC Timeout: timeout was set to ${this.timeout} milliseconds`);
        else
          throw new Error(`RPC Failed: exception: ` + exception);
      }

      this.options.onResponse?.(response); //allow hooks to capture headers

      if (response.status === 429 && !("retry429" in this.options && !this.options.retry429) && response.headers.get("Retry-After")) {
        const retryafter = parseInt(response.headers.get("Retry-After") || "");
        if (this.client.debug)
          console.warn(`[rpc] We are being throttled (429 Too Many Requests) - retrying after ${retryafter} seconds`);

        await new Promise(resolve => setTimeout(resolve, retryafter * 1000));
        fetchpromise = fetch(this._callurl, this._fetchoptions);
        continue;
      }
      break;
    }

    let jsonresponse: RPCResponse;
    try {
      jsonresponse = parseTyped(await response.text());
      if (jsonresponse.consoleLog) {
        for (const logitem of jsonresponse.consoleLog) {
          //should we log 'when'? it's getting more and more noisy then though....
          //TODO should we match the remote's method (after validating) or just keep everything at 'log' ?
          console.log(`[remote:${logitem.method}] ${logitem.location ? `${logitem.location.filename.split("/").at(-1)}:${logitem.location.line}: ` : ''}${logitem.data}`);
        }
      }

      if (this.client.debug)
        console.log(`[rpc] Received response to '${method}'`, omit(jsonresponse, ["consoleLog", "trace"]));
    } catch (exception) {
      if (this.client.debug)
        console.warn(`[rpc] Response was not valid JSON`, exception);
      throw new Error("RPC Failed: Invalid response received", { cause: exception });
    }

    if ("error" in jsonresponse) {
      const err = new Error(`RPC Error: ${jsonresponse.error}`);
      if (jsonresponse.trace) {
        try {
          prependStackTrace(err, jsonresponse.trace);
        } catch (err2) {
          //ignore stacktrace manipulation error
        }
      }

      if (this.options.debug) {
        console.group();
        console.warn("RPC failed:", err);
        if (requestStack) {
          console.warn("Stack at calling point");
          console.log(requestStack);
        }
        console.groupEnd();
      }

      throw err;
    }

    return jsonresponse.result;
  }
}

class RPCClient {
  readonly url: string;
  options: RPCClientOptions;

  constructor(url: string, options?: RPCClientOptions) {
    this.url = url;
    this.options = {
      timeout: 0,
      debug: false,
      ...options
    };
  }

  get debug() {
    return this.options.debug || debugFlags.rpc;
  }

  _tryLogError(requestStack: StackTrace | null, error: Error) {
  }

  invoke(method: string, params: unknown[]) {
    //build the URL, add profiling and function parameters where needed
    //We'll delay the baseurl calculation until the first call to allow for the backendBase to be set up
    const callurl = isAbsolute(this.url) ? new URL(this.url + method) : new URL(this.url + method, this.options.baseUrl || getBaseURL());

    let requestStack: StackTrace | null = null;

    const fetchoptions: RequestInit & { headers: Headers } = {
      method: "POST",
      headers: new Headers({
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
        ...this.options.headers
      }),
      body: stringify(params, { typed: true }),
    };

    if (typeof location !== "undefined")
      callurl.searchParams.set("pathname", location.pathname);

    if (this.debug) {
      requestStack = parseTrace(new Error);
      console.log(`[rpc] Invoking '${method}'`, params);
    }

    this.options.onBeforeRequest?.(callurl, fetchoptions);
    return new ControlledCall(this, method, requestStack, this.options, callurl, fetchoptions).promise;
  }
}

type ServiceBase<T> = {
  withOptions(options: RPCClientOptions): T & ServiceBase<T>;
};

class ServiceProxy<Service extends keyof KnownRPCServices | object> {
  client: RPCClient;

  constructor(client: RPCClient) {
    this.client = client;
  }

  get(target: object, prop: string, receiver: unknown) {
    if (["then", "catch", "finally"].includes(prop)) //do not appear like our object is a promise
      return undefined;

    if (prop === 'withOptions') { //create a withOptions function
      return (options: RPCClientOptions) => {
        const newoptions = {
          ...this.client.options,
          ...options,
          headers: { ...this.client.options.headers, ...options.headers }
        };
        return rpc(this.client.url as (Service extends keyof KnownRPCServices ? Service : string), newoptions);
      };
    }

    return (...args: unknown[]) => this.client.invoke(prop, args);
  }
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any -- need any to not worry about the actual first arg
type OmitFirstArg<F> = F extends (x: any, ...args: infer P) => infer R ? (...args: P) => R : never;

export type OmitRPCContextArgs<ServiceType> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- need any to not worry about the actual first arg
  [K in keyof ServiceType as ServiceType[K] extends (...a: any) => any ? K : never]: ServiceType[K] extends (...a: any[]) => void ? OmitFirstArg<ServiceType[K]> : never;
};

/** Creates an async version of the functions in a class, removes context parameters
 * @typeParam ServiceType - Type definition of the service class that implements this service.
*/
type ConvertToRPCInterface<ServiceType> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- using any is needed for this type definition
  [K in keyof ServiceType as ServiceType[K] extends (...a: any) => any ? K : never]: ServiceType[K] extends (...a: any[]) => void ? PromisifyFunctionReturnType<ServiceType[K]> : never;
};

type ExtractInterface<Service extends object> = ConvertToRPCInterface<Service> & ServiceBase<ConvertToRPCInterface<Service>>;

/** Get the client interface type as would be returned by createClient
 * @typeParam Service - either the `module:service` name or the interface to implement. If you want to pass the implementation's type you should wrap it into `OmitRPCContextArgs`.
*/
export type GetRPCClientInterface<Service extends (keyof KnownRPCServices) | object> = Service extends keyof KnownRPCServices ? ExtractInterface<OmitRPCContextArgs<KnownRPCServices[Service]>> : Service extends object ? ExtractInterface<Service> : never;

/** Create a WebHare RPC client
  @param service - URL (https://<ORIGIN>/.wh/rpc/module/service/) or service name (module:service) to invoke
*/
export function rpc<Service extends keyof KnownRPCServices>(service: Service extends keyof KnownRPCServices ? Service : string, options?: RPCClientOptions): GetRPCClientInterface<Service>;
export function rpc<Service extends object>(service: Service extends keyof KnownRPCServices ? Service : string, options?: RPCClientOptions): GetRPCClientInterface<Service>;

export function rpc<Service extends keyof KnownRPCServices | object>(service: Service extends keyof KnownRPCServices ? Service : string, options?: RPCClientOptions): GetRPCClientInterface<Service> {
  //NOTE: needed the separate overloads to get Intellisense to list the known services for createRPClient's first argument

  if (!service)
    throw new Error(`You must specify either a WebHare rpcService name or a full URL`);

  const servicematch = service.match(/^([a-z0-9_]+):([a-z0-9_]+)$/);
  if (servicematch)
    service = `/.wh/rpc/${servicematch[1]}/${servicematch[2]}/` as (Service extends keyof KnownRPCServices ? Service : string);
  else if (!service.endsWith('/'))
    throw new Error(`Service URL must end in a slash`);

  const rpcclient = new RPCClient(service, options);
  return new Proxy({}, new ServiceProxy<GetRPCClientInterface<Service>>(rpcclient)) as GetRPCClientInterface<Service>;
}
