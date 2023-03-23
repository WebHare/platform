export interface FetchPoolOptions {
  timeout?: number;
  debug?: boolean;
}

export class Fetcher {
  async goFetch(url: string, options: RequestInit, pooloptions: FetchPoolOptions) {

    if (pooloptions?.timeout && pooloptions?.timeout >= 0)
      options.signal = AbortSignal.timeout(pooloptions.timeout);

    try {
      if (pooloptions?.debug)
        console.log(url, options, pooloptions);

      const response = await fetch(url, options);
      const retval = {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: [...response.headers.entries()],
        body: await response.arrayBuffer()
      };

      if (pooloptions?.debug)
        console.log(retval);
      return retval;
    } catch (e) {
      console.log("Fetch error", (e as Error).message);
      throw e;
    }
  }
}

export async function getFetcher(): Promise<Fetcher> {
  return new Fetcher;
}
