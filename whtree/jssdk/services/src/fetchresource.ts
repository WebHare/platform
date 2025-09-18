import { listDirectory, storeDiskFile } from "@webhare/system-tools";
import { parseTyped, stringify } from "@webhare/std";
import * as crypto from "node:crypto";
import { mkdir, readFile, open, stat } from "node:fs/promises";
import { backendConfig } from "@webhare/services/src/config";
import { ResourceDescriptor } from "@webhare/services/src/descriptor";
import { basename } from "node:path";

function hashUrl(url: string) {
  return crypto.createHash("sha1").update(url).digest("base64url");
}

export type FetchedFileMetadata = {
  lastDownload: Date;
  status: number;
  headers: Record<string, string>;
  fileName?: string; // Added in WH5.9
};

async function returnResource(diskloc: string, metadata: FetchedFileMetadata) {
  return ResourceDescriptor.fromDisk(diskloc, {
    mediaType: metadata.headers["content-type"],
    fileName: metadata.fileName
  });
}

export async function getCachePaths(url: string) {
  //TODO should we set up a two level cache?
  const hash = hashUrl(url + "#wh5.9"); //reset hashes now that we store the fileName since WH5.9
  const cachedir = `${backendConfig.dataRoot}caches/platform/fetch/`;
  const diskloc = cachedir + hash + '.dat';
  const metaloc = cachedir + hash + '.json';

  return { cachedir, diskloc, metaloc };
}

export async function readCacheMetadata(metaloc: string) {
  return parseTyped(await readFile(metaloc, 'utf-8')) as FetchedFileMetadata;
}

/** Fetch a specific resource by URL, cache where possible
 * @param url - The URL to fetch
 * @returns A ResourceDescriptor for the fetched resource
*/
export async function fetchResource(url: string): Promise<ResourceDescriptor> {
  const { cachedir, diskloc, metaloc } = await getCachePaths(url);

  let fetched: Response | undefined;
  const startDownload = new Date;
  try {
    const metadata = await readCacheMetadata(metaloc);
    if (metadata.headers["last-modified"]) { //attempt a conditional fetch (TODO also support etag? but currently we mostly use this to fetch from WebHares and they don't etag static resources anyway)
      fetched = await fetch(url, { headers: { "if-modified-since": metadata.headers["last-modified"] } });
      if (fetched.status === 304) {
        //Open and close the stat file so we know it's been downloaded. FIXME this isn't truly race-free (if the cache cleanup has noted the older time before starting to cleanup?) and may still cause the file to be deleted by cache cleanup
        await (await open(metaloc, 'a')).close();
        return returnResource(diskloc, metadata);
      }
    }
  } catch (e) {
    // File does not exist or could not be fetched using If-Modified-Since. ignore, we'll retry
  }

  if (!fetched) //grab the file
    fetched = await fetch(url);

  if (fetched.status !== 200)
    throw new Error(`Failed to fetch ${url}: ${fetched.status}`);

  const metadata: FetchedFileMetadata = {
    lastDownload: startDownload,
    status: fetched.status,
    headers: Object.fromEntries(fetched.headers.entries().map(([k, v]) => [k.toLowerCase(), v])),
    fileName: basename(new URL(url).pathname) || undefined// Extract file name from URL path
  };

  await mkdir(cachedir, { recursive: true });
  await storeDiskFile(diskloc, await fetched.blob(), { overwrite: true });
  await storeDiskFile(metaloc, stringify(metadata, { space: 2, typed: true }), { overwrite: true });

  return returnResource(diskloc, metadata);
}

/** Find files to cleanup in the fetch cache older than cleanupAfterMs */
export async function getFetchResourceCacheCleanups(cleanupAfterMs: number, onDelete: (name: string) => Promise<void> | void) {
  const cutoff = Date.now() - cleanupAfterMs;
  //tracks .dat files
  const seenDats = new Set<string>();
  //tracks .json files
  const seenJsons = new Set<string>();

  const items = await listDirectory(`${backendConfig.dataRoot}caches/platform/fetch/`, { allowMissing: true });
  for (const file of items) {
    if (file.name.endsWith('.dat')) {
      seenDats.add(file.fullPath);
      continue;
    }
    if (!file.name.endsWith('.json')) {
      await onDelete(file.fullPath);
      continue;
    }

    seenJsons.add(file.fullPath);
    const stats = await stat(file.fullPath);
    if (stats.mtimeMs < cutoff) {
      await onDelete(file.fullPath);
      try {
        await onDelete(file.fullPath.replace(/\.json$/, '.dat'));
      } catch {
        //ignore not being able to delete the dat file, it might have been deleted already? or we'll deal with it on the next iteration
      }
    }
  }

  //Also delete any dat file without any matching json unless it's new (just added to the cache ?)
  for (const dat of seenDats) {
    if (!seenJsons.has(dat.replace(/\.dat$/, '.json'))) {
      const stats = await stat(dat);
      if (stats.mtimeMs < cutoff)
        await onDelete(dat);
    }
  }
}
