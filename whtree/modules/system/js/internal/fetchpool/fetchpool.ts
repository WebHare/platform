import { WebHareBlob } from "@webhare/services/src/webhareblob";

interface IncomingRequestInit extends Omit<RequestInit, "body"> {
  body?: WebHareBlob;
}

export interface FetchPoolOptions {
  timeout?: number;
  debug?: boolean;
}

export class Fetcher {
  async goFetch(url: string, options: IncomingRequestInit, pooloptions: FetchPoolOptions) {

    if (pooloptions?.timeout && pooloptions?.timeout >= 0)
      options.signal = AbortSignal.timeout(pooloptions.timeout);

    try {
      if (pooloptions?.debug)
        console.log(url, options, pooloptions);

      const transmitoptions: RequestInit = {
        ...options,
        body: options.body ? await options.body.arrayBuffer() : null
      };

      const response = await fetch(url, transmitoptions);
      const retval = {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: [...response.headers.entries()],
        body: WebHareBlob.from(Buffer.from(await response.arrayBuffer()))
      };

      if (pooloptions?.debug)
        console.log(retval);
      return retval;
    } catch (e) {
      // fetch adds a 'cause' Error to the thrown error if the fetch connection failed
      if ("cause" in (e as Error))
        (e as Error).message = (e as Error).message + ": " + (e as TypeError & { cause: Error }).cause.message;
      if (pooloptions?.debug)
        console.log("Fetch error", (e as Error).message);
      throw e;
    }
  }
}

export async function getFetcher(): Promise<Fetcher> {
  return new Fetcher;
}
