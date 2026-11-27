import { db, isWorkOpen } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { selectFSHighestParent, selectFSObjectBaseURL, selectFSPublish, selectFSWHFSPath } from "@webhare/whdb/src/functions";
import { convertWaitPeriodToDate, sleep, type WaitPeriod } from "@webhare/std";
import { openBackendService } from "@webhare/services";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { whfsFinishHandler, type EventCompletionLink } from "./finishhandler";
import { convertToWillPublish, getPrioOrErrorFromPublished, getWHFSDescendantIds, isQueuedForPublication, PublishedFlag_HasWebDesign, PubPrio_FolderRepub, PubPrio_Scheduled, PubPrio_SubFolderRepub, testFlagFromPublished } from "./support";
import { WHFSError } from "./error";
import type { WHFSObject } from "./objects";

/** Folder type of foreign folders, which are skipped when republishing recursively */
const foreignFolderType = 1;

export interface RepublishOptions {
  /** Also republish the files in subfolders. Defaults to false */
  recursive?: boolean;
  /** Which files in the folders to republish:
      - "webdesign" (default): files whose output depends on the web design, and files whose last publication failed
      - "all": every published file
      - "failed": only files whose last publication failed */
  which?: "webdesign" | "all" | "failed";
  /** Allow republishing from the WHFS root, which republishes all sites. The root contains no publishable files itself,
      so this only has an effect with `recursive: true`. Defaults to false */
  allowRoot?: boolean;
}

export interface WaitForPublicationOptions {
  /** Stop waiting after this time and return with `completed: false`. Defaults to waiting until publication finishes */
  deadline?: WaitPeriod;
  /** Abort the wait */
  signal?: AbortSignal;
}

export interface PublicationFailure {
  id: number;
  whfsPath: string;
  /** Publisher error code */
  error: number;
  /** Additional error information, if any */
  errorData: string;
}

export interface WaitForPublicationResult {
  /** True if all publication finished, false if the deadline expired first */
  completed: boolean;
  /** Published files whose (last) publication failed */
  failed: PublicationFailure[];
}

function hasFailed(published: number) {
  const code = getPrioOrErrorFromPublished(published);
  return code !== 0 && !isQueuedForPublication(published);
}

/** Queue files for republication if they're published. Only emits republish events for files whose state actually changed */
export async function republishFiles(fileIds: number[]) {
  if (!fileIds.length)
    return;

  const files = await db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .select(["id", "parent", "published", selectFSHighestParent().as("parentsite")])
    .where("id", "in", fileIds)
    .where("isfolder", "=", false)
    .execute();

  for (const file of files) {
    const newPublished = convertToWillPublish(file.published, false, false, PubPrio_Scheduled); //if you actually bother to republish a single file, expedite it
    if (newPublished !== file.published) {
      await db<PlatformDB>()
        .updateTable("system.fs_objects")
        .set({ published: newPublished })
        .where("id", "=", file.id)
        .execute();
      whfsFinishHandler().fileRepublish(file.parentsite, file.parent, file.id);
    }
  }
}

/** Queue the published files in a folder for republication */
async function republishFolderFiles(folderId: number, parentSite: number | null, toplevel: boolean, which: NonNullable<RepublishOptions["which"]>) {
  const prio = toplevel ? PubPrio_FolderRepub : PubPrio_SubFolderRepub;
  const files = await db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .select(["id", "published"])
    .where("parent", "=", folderId)
    .where("isfolder", "=", false)
    .where(selectFSPublish(), "=", true)
    .execute();

  //Group the updates by their new published value, there will only be a few different ones
  const updates = new Map<number, number[]>();
  for (const file of files) {
    if (which === "failed" && !hasFailed(file.published))
      continue;
    if (which === "webdesign" && !testFlagFromPublished(file.published, PublishedFlag_HasWebDesign) && getPrioOrErrorFromPublished(file.published) === 0)
      continue;

    const newPublished = convertToWillPublish(file.published, false, false, prio);
    if (newPublished !== file.published)
      (updates.get(newPublished) ?? updates.set(newPublished, []).get(newPublished)!).push(file.id);
  }

  for (const [published, ids] of updates)
    await db<PlatformDB>()
      .updateTable("system.fs_objects")
      .set({ published })
      .where("id", "in", ids)
      .execute();

  //Like HareScript we always fire the event. On commit it schedules the files queued above
  whfsFinishHandler().folderRepublish(parentSite, folderId);
}

async function republishFolder(folderId: number, parentSite: number | null, toplevel: boolean, options: RepublishOptions) {
  const which = options.which ?? "webdesign";
  if (folderId) //the root folder itself contains no publishable files
    await republishFolderFiles(folderId, parentSite, toplevel, which);
  if (!options.recursive)
    return;

  if (parentSite) {
    //Inside a site: republish all published subfolders, but skip foreign folders
    const subFolders = await db<PlatformDB>()
      .selectFrom("system.fs_objects")
      .select(["id"])
      .where("parent", "=", folderId)
      .where("isfolder", "=", true)
      .where(qb => qb("type", "is", null).or("type", "!=", foreignFolderType))
      .where(selectFSObjectBaseURL(), "!=", "")
      .execute();
    for (const sub of subFolders)
      await republishFolder(sub.id, parentSite, false, options);
  } else {
    //Outside a site: republish all published sites below this folder. Below the root, that's every site
    const descendants = folderId ? await getWHFSDescendantIds([folderId], true, false) : null;
    if (descendants?.length === 0)
      return;

    const sites = await db<PlatformDB>()
      .selectFrom("system.sites")
      .innerJoin("system.fs_objects", "system.fs_objects.id", "system.sites.id")
      .select(["system.sites.id"])
      .$if(descendants !== null, qb => qb.where("system.sites.id", "in", descendants!))
      .where(selectFSObjectBaseURL("system.fs_objects"), "!=", "")
      .execute();
    for (const site of sites)
      await republishFolder(site.id, site.id, false, options);
  }
}

/** Republish files and folders. Takes effect when the current work is committed.
    @param objects - Files and folders to republish (objects or their ids). Files are always republished,
           `republish` and `recursive` apply to the contents of the folders
    @param options - Which files in the folders to republish
*/
export async function republishWHFSObjects(objects: Array<number | WHFSObject>, options: RepublishOptions = {}): Promise<void> {
  const ids = [...new Set(objects.map(obj => typeof obj === "number" ? obj : obj.id))];
  if (ids.includes(0)) {
    if (!options.allowRoot)
      throw new WHFSError("invalid-argument", `Republishing the WHFS root republishes all sites, set allowRoot to allow this`);
    await republishFolder(0, null, true, options);
  }

  const otherIds = ids.filter(id => id !== 0);
  if (!otherIds.length)
    return;

  const recs = await db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .select(["id", "isfolder", selectFSHighestParent().as("parentsite")])
    .where("id", "in", otherIds)
    .execute();

  const missing = otherIds.filter(id => !recs.some(rec => rec.id === id));
  if (missing.length)
    throw new WHFSError("object-not-found", `No such file or folder: ${missing.map(id => `#${id}`).join(", ")}`);

  await republishFiles(recs.filter(rec => !rec.isfolder).map(rec => rec.id));
  for (const folder of recs.filter(rec => rec.isfolder))
    await republishFolder(folder.id, folder.parentsite, true, options);
}

/** Wait until there are no pending WHFS completion events (which schedule republished files on the publication queue)
    @param deadline - Stop waiting at this time
    @returns True if the events completed, false if the deadline expired first
*/
export async function waitForEventCompletions(deadline?: Temporal.Instant, signal?: AbortSignal): Promise<boolean> {
  const link = bridge.connect<EventCompletionLink>("system:eventcompletion", { global: true });
  try {
    await link.activate();
    while (true) {
      signal?.throwIfAborted();
      const rec = await link.doRequest({ type: "havependingcompletions" });
      if (!rec.result)
        return true;
      if (deadline && Temporal.Instant.compare(Temporal.Now.instant(), deadline) >= 0)
        return false;
      await sleep(10);
    }
  } finally {
    link.close();
  }
}

interface PublicationScopeRow {
  id: number;
  published: number;
  errordata: string;
  publish: boolean;
}

async function getPublicationScope(folderIds: number[], fileIds: number[]): Promise<PublicationScopeRow[]> {
  if (!folderIds.length && !fileIds.length)
    return [];

  return await db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .select(["id", "published", "errordata", selectFSPublish().as("publish")])
    .where("isfolder", "=", false)
    .where(qb => {
      const conds = [];
      if (folderIds.length)
        conds.push(qb("parent", "in", folderIds));
      if (fileIds.length)
        conds.push(qb("id", "in", fileIds));
      return qb.or(conds);
    })
    .execute();
}

/** Describe the failed files in the scope. Only looks up their paths, as that's too expensive to do for every file on every check */
async function getPublicationFailures(scope: PublicationScopeRow[]): Promise<PublicationFailure[]> {
  const failed = scope.filter(row => row.publish && hasFailed(row.published));
  if (!failed.length)
    return [];

  const paths = new Map((await db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .select(["id", selectFSWHFSPath().as("whfspath")])
    .where("id", "in", failed.map(row => row.id))
    .execute()).map(row => [row.id, row.whfspath]));

  return failed.map(row => ({
    id: row.id,
    whfsPath: paths.get(row.id) ?? "",
    error: getPrioOrErrorFromPublished(row.published),
    errorData: row.errordata
  }));
}

async function isStillPublishing(scope: PublicationScopeRow[]) {
  if (scope.some(row => row.publish && isQueuedForPublication(row.published)))
    return true;
  if (!scope.length)
    return false;

  const service = await openBackendService("publisher:publication");
  try {
    return (await service.testFilesScheduled(scope.map(row => row.id))).length > 0;
  } finally {
    service.close();
  }
}

export interface WaitForPublicationInternalOptions extends WaitForPublicationOptions {
  /** Do not wait for WHFS completion events (which schedule the republished files) to finish */
  skipEventCompletion?: boolean;
  /** Called periodically while still waiting */
  onWaiting?: () => void;
  /** Interval (in ms) for onWaiting */
  waitingIntervalMs?: number;
}

/** waitForPublication, with extra options for the test frameworks. Also returns the ids of all files it waited for */
export async function __waitForPublication(objects: Array<number | WHFSObject>, options: WaitForPublicationInternalOptions = {}): Promise<WaitForPublicationResult & { fileIds: number[] }> {
  if (isWorkOpen())
    throw new WHFSError("invalid-argument", `Cannot wait for publication while work is open`);

  const ids = [...new Set(objects.map(obj => typeof obj === "number" ? obj : obj.id))];
  const otherIds = ids.filter(id => id !== 0);
  const recs = otherIds.length ? await db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .select(["id", "isfolder", "parent"])
    .where("id", "in", otherIds)
    .execute() : [];

  const missing = otherIds.filter(id => !recs.some(rec => rec.id === id));
  if (missing.length)
    throw new WHFSError("object-not-found", `No such file or folder: ${missing.map(id => `#${id}`).join(", ")}`);

  const deadline = options.deadline !== undefined ? convertWaitPeriodToDate(options.deadline).toTemporalInstant() : undefined;
  //If the events don't complete before the deadline, we still report the current state, but not as completed
  const eventsCompleted = options.skipEventCompletion || await waitForEventCompletions(deadline, options.signal);

  const fileIds = recs.filter(rec => !rec.isfolder).map(rec => rec.id);
  const baseFolderIds = recs.filter(rec => rec.isfolder).map(rec => rec.id);
  if (ids.includes(0))
    baseFolderIds.push(0);

  //The publisher fires an event for the folder of every file it publishes
  const fileFolderIds = recs.filter(rec => !rec.isfolder).map(rec => rec.parent || 0);
  let eventFolderIds = new Set(fileFolderIds);
  let wait: PromiseWithResolvers<void> | null = null;
  const cb = bridge.on("event", data => {
    if (data.name.startsWith("publisher:publish.folder.") && eventFolderIds.has((data.data as { folder: number }).folder))
      wait?.resolve();
  });
  const onAbort = () => wait?.resolve();
  options.signal?.addEventListener("abort", onAbort);

  try {
    let nextWaiting = options.onWaiting && options.waitingIntervalMs ? Date.now() + options.waitingIntervalMs : undefined;
    while (true) {
      wait = Promise.withResolvers();
      options.signal?.throwIfAborted();

      //files and folders may be added or removed while we wait, so requery the scope every time
      const folderIds = baseFolderIds.length ? [...baseFolderIds.filter(id => id !== 0), ...await getWHFSDescendantIds(baseFolderIds, true, false)] : [];
      eventFolderIds = new Set([...folderIds, ...fileFolderIds]);
      const scope = await getPublicationScope(folderIds, fileIds);
      const stillPublishing = await isStillPublishing(scope);
      const timedOut = deadline && Temporal.Instant.compare(Temporal.Now.instant(), deadline) >= 0;
      if ((!stillPublishing && eventsCompleted) || timedOut)
        return {
          completed: !stillPublishing && eventsCompleted,
          failed: await getPublicationFailures(scope),
          fileIds: scope.map(row => row.id)
        };

      if (nextWaiting && Date.now() >= nextWaiting) {
        options.onWaiting!();
        nextWaiting = Date.now() + options.waitingIntervalMs!;
      }

      //Check at least every second, as the publisher queue doesn't tell us when files have completed. Retry immediately on a publish event
      const waitMs = Math.min(1000, ...[deadline ? deadline.epochMilliseconds - Date.now() : Infinity, nextWaiting ? nextWaiting - Date.now() : Infinity].map(ms => Math.max(ms, 0)));
      const currentWait = wait;
      const timer = setTimeout(() => currentWait.resolve(), waitMs);
      await wait.promise;
      clearTimeout(timer);
    }
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    bridge.off(cb);
  }
}

/** Wait until publication of files and folders (including their subfolders) has finished.
    Use this after committing a republish. You can't wait while work is open.
    @param objects - Files and folders to wait for (objects or their ids, 0 for the WHFS root)
    @returns Whether publication completed before the deadline, and the files whose publication failed
*/
export async function waitForPublication(objects: Array<number | WHFSObject>, options: WaitForPublicationOptions = {}): Promise<WaitForPublicationResult> {
  const { completed, failed } = await __waitForPublication(objects, { deadline: options.deadline, signal: options.signal });
  return { completed, failed };
}
