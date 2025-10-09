import { db } from "@webhare/whdb";
import type { WHFSObject } from "./objects";
import * as crypto from "node:crypto";
import type { PlatformDB } from "@mod-platform/generated/db/platform";

function isNotExcluded<T extends string, K extends string>(t: T, excludes: K[]): t is Exclude<T, K> {
  return !excludes.includes(t as unknown as K);
}

export function excludeKeys<T extends string, K extends string>(t: T[], k: K[]): Array<Exclude<T, K>> {
  const result = new Array<Exclude<T, K>>;
  for (const a of t)
    if (isNotExcluded(a, k))
      result.push(a);
  return result;
}

/** Whether the name is acceptable for use in WHFS
 * @param name - The name to check
 * @param allowSlashes - Whether to allow slashes in the name (default: false)
*/
export function isValidName(name: string, { allowSlashes = false }: { allowSlashes?: boolean } = {}): boolean {
  if (typeof name !== "string" || !name)
    return false;

  //Don't permit filenames starting with a space, ^ or ! or ending in a dot or a space (this also filters "." and "..")
  if (['^', '!', ' '].includes(name[0]))
    return false;

  if (['.', ' '].includes(name.at(-1)!))
    return false;

  if (!allowSlashes && name.includes("/"))
    return false;

  // eslint-disable-next-line no-control-regex -- we really want to match control characters here
  if (name.match(/[\x00-\x1f\\:*?"<>|]/)) //non printable chars/wihtespcae
    return false;

  return true;
}

export const PublishedFlag_OncePublished = 100000;
export const PublishedFlag_Scheduled = 200000;
export const PublishedFlag_Warning = 400000;
export const PublishedFlag_HasWebDesign = 800000; //this file depends on a <webdesign> or template, so it needs to be republished even if template=0
export const PublishedFlag_StripExtension = 1600000; //strip the extension from the file's url
export const PublishedFlag_HasPublicDraft = 3200000; //there are drafts associated with the file
export const PublishedFlag_SubmittedForApproval = 6400000; //the draft has been submitted for approval (versioning)

export function testFlagFromPublished(published: number, flag_to_test: number) {
  return Math.floor((published % (flag_to_test * 2)) / flag_to_test) === 1;
}

export function getPrioOrErrorFromPublished(published: number) {
  return published % 100000;
}

function isPriority(prioOrError: number) { //related to IsQueuedForPublication
  return prioOrError > 0 && prioOrError <= 100;
}

/** @returns True if the file was ever succesfully published (its file.url cell is valid) */
function getOncePublishedFromPublished(published: number) {
  return testFlagFromPublished(published, PublishedFlag_OncePublished);
}

export function isPublish(published: number) {
  return getPrioOrErrorFromPublished(published) !== 0 || getOncePublishedFromPublished(published);
}

export function formatPathOrId(path: number | string) {
  return typeof path === "number" ? `#${path}` : `'${path}'`;
}

export function isReadonlyWHFSSpace(path: string) {
  path = path.toUpperCase();
  return path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS/SNAPSHOTS/") ||
    path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS-AUTOSAVES/") || //not so much readonly but requires setting a workflow flag
    path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS-VERSIONS/") ||
    path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS-DRAFTS/");
}

export const PubPrio_Scheduled = 6;  //put on queue because of a scheduled task
export const PubPrio_DirectEdit = 11;  //put on queue because of user action (edit, replace)
export const PubPrio_FolderRepub = 16;  //put on queue because of a republish on this folder (or root folder of a republish_all)
export const PubPrio_SubFolderRepub = 21;  //put on queue because of a republish of parent folder

type PubPrio = typeof PubPrio_Scheduled | typeof PubPrio_DirectEdit | typeof PubPrio_FolderRepub | typeof PubPrio_SubFolderRepub;


/** Converts publisher status to trigger a republish
    @param published - Current published status
    @param firsttime - Whether this is the first time the file is published at this place.
    @param enablePublishIfDisabled - If the file is currently not published (from the published parameter), and
           enable_publish_if_disabled is TRUE, the file will be republished
    @param setPrio - Priority to republish the file
    @returns New publisher status
*/
export function convertToWillPublish(published: number, firsttime: boolean, enablePublishIfDisabled: boolean, setPrio: PubPrio) {
  const curPrioOrError = getPrioOrErrorFromPublished(published);
  const oncePublished = getOncePublishedFromPublished(published);

  if (!isPublish(curPrioOrError) && !enablePublishIfDisabled)
    return published;

  // Never decrease existing priority
  if (isPriority(curPrioOrError) && curPrioOrError < setPrio) //is it a priority ?
    setPrio = curPrioOrError as PubPrio; //if the current priority is higher, keep it

  published = (published - curPrioOrError) + setPrio;
  if (firsttime && oncePublished)
    published -= PublishedFlag_OncePublished;

  return published;
}

/** Calculates an objects whfsref: its id plus its creationdate in 32bits so we can somewhat guarantee its the same original file/folder */
export function getWHFSObjRef(fsobj: WHFSObject) {
  const hash = crypto
    .createHash("sha1")
    .update(String(fsobj.creationDate.epochMilliseconds))
    .digest("base64url")
    .slice(-6);

  return fsobj.id + "." + hash;
}

/** Change a flag in a published cell
    @param published - A file.published cell
    @param flag_to_set - The flag to modify (eg. PublishedFlag_OncePublished or PublishedFlag_Scheduled)
    @param setflag - True to set the flag, false to reset the flag
    @returns The published parameter with the requested flags modified
*/
export function setFlagInPublished(published: number, flag_to_set: number, setflag: boolean) {
  const isSet = testFlagFromPublished(published, flag_to_set);
  if (isSet === setflag)
    return published; //nothing to do
  else if (isSet) // remove flag
    return published - flag_to_set;
  else
    return published + flag_to_set;
}

/** Get all ids from a specific starting point
    @param basefolder - Starting folder
    @param maximumdepth - Maximum depth. Depth=1 only gets the direct subfolders. Suggested
    @param returnfolders - Return folders too
    @returns The descendants - does not include the basefolders themselves */
export async function getWHFSDescendantIds(basefolders: number[], returnfolders: boolean, returnfiles: boolean, maximumdepth = 32) {
  if (!returnfiles && !returnfolders)
    return [];

  const allsubs = [];
  let currentlevel = [...basefolders];
  if (maximumdepth > 32)
    maximumdepth = 32; //safety against corrupted databases

  while (maximumdepth >= 1 && currentlevel.length > 0) {
    //If we're not returning files, don't even get them
    const currentsubsSQL = db<PlatformDB>().selectFrom("system.fs_objects").select(["id", "isfolder"])
      .where("parent", "in", currentlevel);
    if (!returnfiles)
      currentsubsSQL.where("isfolder", "=", true);

    const currentsubs = await currentsubsSQL.execute();
    currentlevel = currentsubs.filter(sub => sub.isfolder).map(sub => sub.id);
    allsubs.push(...currentsubs.filter(sub => returnfolders || !sub.isfolder).map(sub => sub.id));
    --maximumdepth;
  }
  return allsubs;
}
