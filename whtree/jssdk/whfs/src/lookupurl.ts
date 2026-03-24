import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { whconstant_webservertype_interface, whconstant_whfsid_webharebackend } from "@mod-system/js/internal/webhareconstants";
import { decryptForThisServer } from "@webhare/services";
import { db, sql } from "@webhare/whdb";
import { enumerateAllWebServers, getActualPort, lookupWebserver } from "@mod-platform/js/webserver/config";
import { selectFSHighestParent, selectFSLink, selectSitesWebRoot } from "@webhare/whdb/src/functions";
import { isPublish, PublishedFlag_StripExtension, testFlagFromPublished } from "./support";
import { parse } from "path";
import { whfsType } from "./contenttypes";
import { getUCPacketHash } from "@webhare/services/src/descriptor";

declare module "@webhare/services" {
  interface ServerEncryptionScopes {
    "publisher:preview": {
      id: number;
      c: Date;
      v: Date;
      p: string;
    };
  }
}

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
  /** Any additional path, query string and/or hash appended to the URL */
  append: string | null;
};

function getUnifiedURLTokenParts(token: string) {
  let datatype = 0;
  let extension = '';
  let filename = '';
  let urlpart = '';

  const qpos = token.indexOf('?');
  if (qpos >= 0)
    token = token.substring(0, qpos);

  let datatoken = '';
  urlpart = token;

  if (token.startsWith("i")) {
    datatype = 1;
  } else if (token.startsWith("f")) {
    datatype = 2;
  }

  if (datatype > 0) {
    // <i|f><token>/<filename><.extension>
    const slashpos = token.indexOf("/");
    datatoken = token.substring(1, slashpos);

    // Get extension from end of url part
    const extensionstart = token.lastIndexOf('.');
    if (extensionstart > slashpos) {
      extension = token.substring(extensionstart);
      token = token.substring(0, extensionstart);
    }

    // Get filename, and ignore slashes
    filename = decodeURIComponent(token.substring(slashpos + 1).split('/')[0] + extension); // ignore multiple slashes

    // Build a canonical url-part
    urlpart = token[0] + datatoken + "/" + filename;
  }
  return { datatoken, datatype, extension, filename, urlpart };
}

function analyzeUnifiedURLToken(token: string) {
  const data = getUnifiedURLTokenParts(token);
  if (!data.datatoken)
    return null;

  const tohash = Buffer.from(data.datatoken, 'hex').subarray(4);
  const expectedhash = getUCPacketHash(tohash, data.extension);
  if (expectedhash !== data.datatoken.substring(0, 8))
    return null;

  return decodeUnifiedData(tohash);
}

function decodeUnifiedData(imgtok: Uint8Array) {

  //TODO we have much more to decode than type + id.. See also getUCSubUrl
  const view = new DataView(imgtok.buffer, imgtok.byteOffset, imgtok.byteLength);
  if (view.getUint8(0) !== 1) //version 1
    return null;
  return { type: view.getUint8(1), id: view.getUint32(2, true) }; //type + id
}

export function getLongestValidDecodedString(url: string): string | null {
  let decoded: string | null = null;
  while (url) {
    try {
      decoded = decodeURIComponent(url);
      break;
    } catch (e) {
      // try peeling of percent-encodings until we get a valid string
      const lastPercent = url.lastIndexOf('%');
      if (lastPercent < 0)
        return null; // giving up
      url = url.substring(0, lastPercent);
    }
  }
  return decoded;
}

export function getPostfixAfterDecodedPrefix(url: string, prefix: string) {
  // Split the url in to normal, split by percent encoded characters (keeping them in the parts array). Remove empty parts.
  const parts = url.split(/(%[0-9a-fA-F]{2})/).filter(_ => _);

  // The prefix is already in url-decoded form
  let curEncoded = "";
  for (let part = 0; part < parts.length; part++) {
    curEncoded += parts[part];
    try {
      const decoded = decodeURIComponent(curEncoded);
      if (decoded.length >= prefix.length) {
        if (!decoded.startsWith(prefix))
          return null;
        return decoded.substring(prefix.length) + parts.slice(part + 1).join("");
      }
    } catch (e) {
      // partial utf-8 character, continue accumulating
    }
  }
  return null;
}

/** LookupPublisherURL finds the associated URL and is the implementation between the Publisher's "Goto URL" function.
    Preview and imagecache URLs are resolved back to the original file or folder.

    @param url - URL to look up
    @returns Our guess at the URL's location
*/
export async function lookupURL(url: URL, options?: LookupURLOptions): Promise<LookupURLResult> {
  /* We specifically want a URL object (and not a string) so callers get to deal with Invalid URLs and
     will not be tempted to throw away all exceptions from lookupURL if they're passing untrusted input, eg referrers from a log file */

  if (!["http:", "https:"].includes(url.protocol))
    return {
      site: null,
      folder: null,
      file: null,
      webServer: null,
      append: "",
    };

  //Find the matching webserver
  const webserver = options?.clientWebServer === undefined ?
    await lookupWebserver(url.hostname, getActualPort(url)) :
    (await enumerateAllWebServers(false)).filter(ws => ws.id === options.clientWebServer).map(({ id, baseurl, type }) => ({ id, baseurl, isinterface: type === whconstant_webservertype_interface }))[0];

  const result: LookupURLResult = {
    site: null,
    folder: null,
    file: null,
    webServer: webserver?.id ?? null,
    append: url.pathname.slice(1) + url.search + url.hash,
  };

  if (!webserver) { //probably not even hosted here
    if (options?.matchProduction)
      return { ...result, ...await tryProductionURLLookup(url, options?.ifPublished) };

    return result;
  }

  if (url.pathname.startsWith("/.publisher/preview/")) {
    const baseurl = url.pathname.split('/')[3];
    const data = decryptForThisServer("publisher:preview", baseurl, { nullIfInvalid: true });
    if (data) {
      const info = await db<PlatformDB>().selectFrom("system.fs_objects").
        select(["parent", "isfolder", "indexdoc"]).
        select(selectFSHighestParent().as("parentsite")).
        where("id", "=", data.id).
        executeTakeFirst();
      if (info) {
        return {
          ...result,
          site: info.parentsite,
          folder: info.isfolder ? data.id : info.parent,
          file: info.isfolder ? info.indexdoc : data.id,
          // TODO is there still need for this?
          // __directfile: info.isfolder ? 0 : data.id,
          // ispreview: true
        };
      }
    }
  }

  if (url.pathname.startsWith("/.wh/ea/uc/")) {
    const tok = url.pathname.substring(11);
    const dec = analyzeUnifiedURLToken(tok);
    let objinfo;

    if (dec?.type === 2) { //WHFS Setting id
      objinfo = await db<PlatformDB>().selectFrom("system.fs_objects").
        select(["system.fs_objects.id", "isfolder", "system.fs_objects.parent"]).
        select(sql<number | null>`webhare_proc_fs_objects_highestparent(system.fs_objects.id, NULL)`.as("parentsite")).
        fullJoin("system.fs_instances", "system.fs_objects.id", "system.fs_instances.fs_object").
        fullJoin("system.fs_settings", "system.fs_instances.id", "system.fs_settings.fs_instance").
        where("system.fs_settings.id", "=", dec.id).
        executeTakeFirst();
    } else if (dec?.type === 1) { //WHFS Object id
      objinfo = await db<PlatformDB>().selectFrom("system.fs_objects").
        select(["id", "isfolder", "parent"]).
        select(selectFSHighestParent().as("parentsite")).
        where("system.fs_objects.id", "=", dec.id).
        executeTakeFirst();
    }
    if (objinfo) {
      return {
        ...result,
        site: objinfo.parentsite,
        folder: objinfo.isfolder ? objinfo.id : objinfo.parent,
        file: objinfo.isfolder ? 0 : objinfo.id,
        // __directfile: objinfo.isfolder ? 0 : objinfo.id
      };
    }
  }

  const lookup = getLongestValidDecodedString(url.pathname);
  if (!lookup)
    return result;

  let findwebservers: number[];
  if (webserver.isinterface)  //all interface webservers share the same output
    findwebservers = (await db<PlatformDB>().selectFrom("system.webservers").where("type", "=", whconstant_webservertype_interface).select("id").execute()).map(ws => ws.id);
  else
    findwebservers = [webserver.id];

  const best_match = await db<PlatformDB>().selectFrom("system.sites").
    select(["id"]).select(selectSitesWebRoot().as("webroot")).
    where("outputweb", "in", findwebservers).
    where(sql`upper(${lookup})`, "like", sql`upper(${sql`outputfolder`} || '%')`).
    orderBy(sql`length(${sql`outputfolder`})`, "desc").
    limit(1).
    executeTakeFirst();

  let pathname = url.pathname;
  if (best_match) {
    // Ignore host parts, they may differ (ports, http vs https)
    const res = getPostfixAfterDecodedPrefix(url.pathname, new URL(best_match.webroot).pathname);
    if (res === null)
      return result; //giving up, the url doesn't even start with the webroot once decoded
    pathname = res;
    result.site = best_match.id;
  } else {
    if (!webserver.isinterface)
      return result; //giving up

    //If we can't find a matching site but we know it's an interface webserver, assume the WebHare backend site is the proper match.
    result.site = whconstant_whfsid_webharebackend;
  }

  const retval = { ...result, ...await lookupPublisherURLByPath(result.site, pathname, url.pathname, options?.ifPublished ?? false) };
  retval.append += url.search + url.hash;
  return retval;
}

async function tryProductionURLLookup(url: URL, ifPublished?: boolean) {
  //Looking up by productionurl. Get best match:
  const siteIds = await db<PlatformDB>().selectFrom("system.sites").select("id").execute();
  const bestMatches = (await whfsType("platform:web.sitesettings").enrich(siteIds, "id", ["productionurl"]) as Array<{ productionurl: string; id: number }>)
    .map(s => { const path = getPostfixAfterDecodedPrefix(url.toString(), s.productionurl); return !s.productionurl || path === null ? null : { ...s, path }; })
    .filter(s => s !== null)
    .sort((a, b) => b.productionurl.length - a.productionurl.length); //longest production url that matches the start of the path is most likely the correct one
  const bestMatch = bestMatches[0];
  if (!bestMatch)
    return null;

  //we have a match!
  const site = bestMatch.id;
  return { site, ...await lookupPublisherURLByPath(site, bestMatch.path, url.pathname, ifPublished ?? false) };
}

async function lookupPublisherURLByPath(startroot: number, url: string, origurlpath: string, ifpublished: boolean) {
  const urlparts = url.split(/(\/|%2[fF])/);
  let cur = await db<PlatformDB>().selectFrom("system.fs_objects").select(["id", "indexdoc"]).where("id", "=", startroot).executeTakeFirstOrThrow();
  let folder: number | null = null, file: number | null = null, __directfile: number | null = null;
  let partNr = 0;
  for (; partNr < urlparts.length; partNr += 2) {
    let part: string;
    try {
      part = decodeURIComponent(urlparts[partNr]);
    } catch (e) {
      // malformed URI encoding
      return null;
    }
    if (part === "!")
      break;
    // Ignore double slashes in the URL
    if (part === "" || part.startsWith("!"))
      continue;

    const iscaretpart = part.startsWith("^");
    const searchpart = iscaretpart ? part.substring(1) : part;

    let candidates = await db<PlatformDB>().selectFrom("system.fs_objects").
      select(["id", "name", "published", "isfolder", "indexdoc", "type"]).
      where("parent", "=", cur.id).
      where(sql`upper(${sql`name`})`, "like", sql`upper(${sql`${part}`} || '%')`).
      orderBy(sql`length(${sql`name`})`).
      execute();

    if (ifpublished)
      candidates = candidates.filter(c => c.isfolder || isPublish(c.published));
    if (!candidates.length)
      break;

    if (candidates[0].name.toUpperCase() === searchpart.toUpperCase()) { //exact name match
      if (candidates.length >= 1 && candidates[0].isfolder && !iscaretpart) {
        //folder names must match exactly, and they did.
        cur = candidates[0];
        continue;
      }
      if (!candidates[0].isfolder) {
        __directfile = candidates[0].id;
        // If the file link ends with a '/', remove a slash from the append part
        const fileRec = await db<PlatformDB>().selectFrom("system.fs_objects")
          .select(selectFSLink().as("link"))
          .where("id", "=", __directfile)
          .executeTakeFirst();
        if (fileRec?.link.endsWith("/"))
          partNr += 2;
        else
          urlparts[partNr] = "";
      }
      break;
    }

    //not an exact match. second chance, match after extension stripping?
    const match = candidates.find(c => testFlagFromPublished(c.published, PublishedFlag_StripExtension) && parse(c.name).name.toUpperCase() === searchpart.toUpperCase());
    if (match) {
      __directfile = match.id;
      const fileRec = await db<PlatformDB>().selectFrom("system.fs_objects")
        .select(selectFSLink().as("link"))
        .where("id", "=", __directfile)
        .executeTakeFirst();
      if (fileRec?.link.endsWith("/"))
        partNr += 2;
      else
        urlparts[partNr] = "";
    }
    break;
  }
  const append = urlparts.slice(partNr).join('');
  folder = cur.id;
  let indexdocfallback: number | null = null;
  if (!__directfile
    && cur.indexdoc //no file yet matches, can we consider the index?
    && (ifpublished === false
      || isPublish((await db<PlatformDB>().selectFrom("system.fs_objects").select("published").where("id", "=", cur.indexdoc).executeTakeFirst())?.published || 0))) {
    indexdocfallback = cur.indexdoc;
  }

  file = __directfile ?? indexdocfallback;
  return { folder, file, append };
}
