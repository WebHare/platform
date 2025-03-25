//TODO port LookupPublisherURL to TS

import { loadlib } from "@webhare/harescript";

export type LookupURLOptions = {
  /** Optional ID of a specific webserver on which we should resolve this url. Should be the webserver which received the request (system.webservers id) */
  clientWebServer?: number;
  /** Also look up sites based on their production url (live synced versions) */
  matchProduction?: boolean;
  /** Only resolve the file if its published. This helps prevent leaking details about unpublised files (eg a 404 handler that uses LookupURL) */
  ifPublished?: boolean;
};

export type LookupURLResult = {
  /** ID of the webserver associated with the URL (table system.webservers). 0 if the URL is not hosted here */
  /** Site ID. 0 if no site's webroot starts with this URL (not even through aliases) */
  site: number | null;
  /** Folder ID containing the URL. 0 if no site was hosting this folder */
  folder: number | null;
  /** File ID. */
  file: number | null;
  /** Webserver hosting the URL */
  webServer: number | null;
};

/** LookupPublisherURL finds the associated URL and is the implementation between the Publisher's "Goto URL" function.
    Preview and imagecache URLs are resolved back to the original file or folder.
    @param url -  URL to look up
    @returns Our guess at the URL's location
*/
export async function lookupURL(url: string, options?: LookupURLOptions): Promise<LookupURLResult> {
  const lookupresult = await loadlib("mod::publisher/lib/publisher.whlib").LookupPublisherURL(url, options);
  return {
    site: lookupresult.site || null,
    folder: lookupresult.folder || null,
    file: lookupresult.file || null,
    webServer: lookupresult.webserver || null
  };
}
