export class Fetcher {
  async goFetch(url: string, options: RequestInit) {

    try {
      const response = await fetch(url, options);
      const retval = {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: response.headers.entries(),
        body: await response.arrayBuffer()
      };
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
