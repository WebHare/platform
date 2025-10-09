/* @webhare/test-backend is a superset of @webhare/test with additional backend test support
 */

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/test-backend" {
}

import * as test from "@webhare/test";
import { beginWork, db } from "@webhare/whdb";
import { loadlib } from "@webhare/harescript";
import { lookupURL, openFileOrFolder, openFolder, type WHFSObject } from "@webhare/whfs";
import { convertWaitPeriodToDate, isDate, throwError, type WaitPeriod } from "@webhare/std";
import { createSchema, deleteSchema, listSchemas, WRDSchema } from "@webhare/wrd";
import { whconstant_wrd_testschema } from "@mod-system/js/internal/webhareconstants";
import type { SchemaTypeDefinition } from "@webhare/wrd/src/types";
import type { AuthAuditEvent, AuthEventData } from "@webhare/auth";
import { getAuditEvents } from "@webhare/auth/src/audit";
import { __closeDatabase } from "@webhare/geoip";
import { type IntExtLink, type Instance, openBackendService } from "@webhare/services";
import { isInstance } from "@webhare/services/src/richdocument";
import type { InstanceExport, WHFSTypeName, TypedInstanceExport, TypedInstanceData } from "@webhare/whfs/src/contenttypes";
import { getPrioOrErrorFromPublished, getWHFSDescendantIds } from "@webhare/whfs/src/support";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { selectFSPublish, selectFSWHFSPath } from "@webhare/whdb/src/functions";
import type { EventCompletionLink } from "@webhare/whfs/src/finishhandler";

export const passwordHashes = {
  //CreateWebharePasswordHash is SLOW. prepping passwords is worth the trouble. Using snakecase so the text exactly matches the password
  test: "WHBF:$2y$10$WiHCQT62TCzqcTLGURXPc.dU82JTaAyLizm4F5HAQO8hpnxg2qK4.",
  secret: "WHBF:$2y$10$V0b0ckLtUivNWjT/chX1OOljYgew24zn8/ynfbUNkgZO9p7eQc2dO",
  secret$: "WHBF:$2y$10$WUm2byXgMFDDa0nmSCLtUO0uNyMoHNmZhNm2YjWLNq8NmV15oFMDG",
};

export interface TestUserConfig {
  grantRights?: string[];
}

export interface TestUserDetails extends TestUserConfig {
  login: string;
  wrdId: number;
  password: string;
}

export interface ResetOptions {
  users?: Record<string, TestUserConfig>;
  wrdSchema?: string | null;
  schemaDefinitionResource?: string;
}

const users: Record<string, TestUserDetails> = {};

async function cleanupWRDTestSchemas() {
  for (const schema of await listSchemas())
    if (schema.tag === whconstant_wrd_testschema
      || schema.tag === whconstant_wrd_testschema + ".bak"
      || schema.tag.startsWith(whconstant_wrd_testschema + ".bak (")
      || schema.tag.startsWith("webhare_testsuite:"))
      await deleteSchema(schema.id);
}

/** Reset the test framework */
export async function reset(options?: ResetOptions) {
  const setupWrdAuth = Boolean(options?.users && Object.keys(options.users).length);
  const wrdSchema = options?.wrdSchema === null ? null : options?.wrdSchema ?? whconstant_wrd_testschema;

  if (setupWrdAuth) {
    const hstestoptions = {
      testusers: Object.entries(options?.users || []).map(([login, config]) => ({ login, grantrights: config.grantRights || [] })),
      wrdschema: Boolean(wrdSchema),
      wrdschematag: wrdSchema || "",
      schemaresource: options?.schemaDefinitionResource || ""
    };

    const testframeworkLib = loadlib("mod::system/lib/testframework.whlib");
    const testfw = await testframeworkLib.RunTestframework([], hstestoptions);

    for (const [name, config] of Object.entries(options?.users || [])) {
      const wrdId = await testfw.GetUserWRDId(name);
      const login = await testfw.GetUserLogin(name);
      const password = await testfw.GetUserPassword(name);
      users[name] = { ...config, wrdId, password, login };
    }
  }

  await using work = await beginWork();

  if (!setupWrdAuth) { //as setupWRDAuth still delegates to the HS testframwork
    await cleanupWRDTestSchemas();

    if (wrdSchema) {
      await createSchema(wrdSchema, {
        schemaDefinitionResource: options?.schemaDefinitionResource,
        userManagement: setupWrdAuth,
        description: "The webhare_testsuite WRD schema"
      });

      if (!setupWrdAuth) { //mark unit as not-required for compatibility with all existing tests
        const persontype = new WRDSchema(wrdSchema).getType("wrdPerson");
        if (await persontype.describeAttribute("whuserUnit"))
          await persontype.updateAttribute("whuserUnit", { isRequired: false });
      }
    }
  }

  for (const tmpfoldername of ["site::webhare_testsuite.testsite/tmp", "site::webhare_testsuite.testsitejs/tmp"]) {
    const tmpfolder = await openFolder(tmpfoldername, { allowMissing: true });
    if (tmpfolder) {
      for (const item of await tmpfolder.list()) {
        //FIXME openObjects would still be very useful
        const obj = await openFileOrFolder(item.id);
        await obj.recycle();
      }
    }
  }

  await work.commit();
}

/** Describe a created test user */
export function getUser(name: string): TestUserDetails {
  return users[name] ?? throwError("User not found: " + name);
}

/** Get the last audit event generated in a WRD Schema */
export async function getLastAuthAuditEvent<S extends SchemaTypeDefinition, Type extends keyof AuthEventData>(
  w: WRDSchema<S>,
  filter?: {
    type?: Type;
    since?: Date | Temporal.Instant;
  }): Promise<AuthAuditEvent<Type>> {
  return (await getAuditEvents<S, Type>(w, { ...filter, limit: 1 }))[0] || throwError(`No audit event found for schema ${w.tag} with filter ${JSON.stringify(filter)}`);
}

/** Wait for all event completions to finish
    @param deadline Error out when the wait hasn't completed after this time
*/
export async function waitForEventCompletions(deadline: WaitPeriod) {
  deadline = convertWaitPeriodToDate(deadline).toTemporalInstant();
  const link = bridge.connect<EventCompletionLink>("system:eventcompletion", { global: true });
  try {
    await link.activate();
    while (true) {
      const rec = await link.doRequest({ type: "havependingcompletions" });
      if (!rec.result)
        break;
      if (Temporal.Instant.compare(Temporal.Now.instant(), deadline) >= 0)
        throw new Error("system:eventcompletion isn't completing");
      await test.sleep(10);

    }
  } finally {
    link.close();
  }
}

export async function isStillPublishing(folderIds: number[], onlyFileId: number, startingPoint: string, acceptErrors: boolean, expectErrorsFor: number[]): Promise<boolean> {
  const objects = await db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .select(["id", "isfolder", "published", "errordata", selectFSWHFSPath().as("whfspath"), selectFSPublish().as("publish"),])
    .$call(query => onlyFileId ?
      query.where("id", "=", onlyFileId) :
      query.where("isfolder", "=", false).where("parent", "in", folderIds))
    .execute();
  for (const o of objects) {
    if (o.publish && (o.published % 100000) > 0 && (o.published % 100000) < 100)
      return true;
  }

  let isScheduled = false;
  const service = await openBackendService("publisher:publication");
  try {
    const scheduled = await service.testFilesScheduled(objects.map(o => o.id));
    isScheduled = scheduled.length > 0;
  } finally {
    service.close();
  }

  for (const expected of expectErrorsFor) {
    const obj = objects.find(o => o.id === expected);
    if (!obj)
      throw new Error(`Expected publication of file #${expected} to fail but it's not inside ${startingPoint}`);
    if (getPrioOrErrorFromPublished(obj.published) === 0)
      throw new Error(`Publication of file ${obj.whfspath} (#${expected}) unexpectedly succeeded`);
  }
  if (!acceptErrors) {
    let firsterror: string | null = null;
    for (const o of objects) {
      if (expectErrorsFor.indexOf(o.id) === -1 && getPrioOrErrorFromPublished(o.published) !== 0) {
        const error = `Publication error for #${o.id} (${o.whfspath}): errorcode ${getPrioOrErrorFromPublished(o.published)}${o.errordata ? "," + o.errordata : ""}`;
        console.error(error);
        firsterror ??= error;
      }
    }
    if (firsterror)
      throw new Error(`${firsterror} - you may need to pass accepterrors := TRUE to WaitForPublishCompletion if this was intentional\n`);
  }

  return isScheduled;
}

function getMinWaitMs(until: Array<Temporal.Instant | Temporal.Duration | Date | number | undefined>) {
  const now = Date.now();
  return Math.min(...until.map(u => {
    if (u === undefined || u === null)
      return Infinity;
    if (isDate(u))
      return u.getTime() - now;
    if (typeof u === "number")
      return u;
    if ("epochMilliseconds" in u)
      return u.epochMilliseconds - now;
    return u.total({ unit: "milliseconds" });
  }));
}

/** Wait for publication to complete
    @param startingPoint Folder or file we're waiting to complete republishing (recursively)
    @return True if publication completed, false on timeout*/
export async function waitForPublishCompletion(startingPoint: number | string | null | WHFSObject, options: {
  /// Maximum time to wait (defaults to 1 hour)
  deadline?: WaitPeriod;
  /// If set, frequency (in ms) to report we're still waiting
  reportFrequencyMs?: number;
  /// Do not wait for publisher (republish) events to complete processing
  skipEventCompletion?: boolean;
  /// Accept any error in the publication (WebHare 4.33+)
  acceptErrors?: boolean;
  /// Explicit file IDs we accept and expect an error for
  expectErrorsFor?: number[];
} = {}): Promise<boolean> {
  options.deadline = convertWaitPeriodToDate(options.deadline ?? Temporal.Now.instant().add({ hours: 1 })).toTemporalInstant();
  if (!options.skipEventCompletion)
    await waitForEventCompletions(options.deadline);

  if (typeof startingPoint === "string" && startingPoint.match(/^https?:/)) {
    const urlinfo = await lookupURL(new URL(startingPoint));
    if (!urlinfo?.folder)
      throw new Error(`Invalid URL ${startingPoint}`);
    startingPoint = await openFolder(urlinfo.folder);
  } else if (typeof startingPoint !== "object" || startingPoint === null)
    startingPoint = await openFileOrFolder(startingPoint, { allowRoot: true });

  const folderIds = (startingPoint.isFolder ? [startingPoint.id, ...await getWHFSDescendantIds([startingPoint.id], true, false)] : [startingPoint.parent]).filter(_ => _ !== null);

  let wait: PromiseWithResolvers<boolean> | null = null;
  const cb = bridge.on("event", data => {
    if (data.name.startsWith("publisher:publish.folder.") && folderIds.includes((data.data as { folder: number }).folder))
      wait?.resolve(true);
  });

  try {
    let nextFeedback = options.reportFrequencyMs ? Temporal.Now.instant().add({ milliseconds: options.reportFrequencyMs }) : undefined;
    while (true) {
      wait = Promise.withResolvers();
      if (!await isStillPublishing(folderIds, startingPoint.isFolder ? 0 : startingPoint.id, startingPoint.whfsPath, options.acceptErrors ?? false, options.expectErrorsFor ?? []))
        break;

      if (options.deadline && Temporal.Instant.compare(Temporal.Now.instant(), options.deadline) >= 0)
        return false;

      if (nextFeedback && Temporal.Instant.compare(Temporal.Now.instant(), nextFeedback) >= 0) {
        console.error(`Publication of ${startingPoint.whfsPath} (#${startingPoint.id}) still isn't complete...`);
        nextFeedback = Temporal.Now.instant().add({ milliseconds: options.reportFrequencyMs! });
      }

      // Wait max 1 sec, retry immediately if we get a notification.
      const currentWait = wait;
      setTimeout(() => currentWait.resolve(false), getMinWaitMs([1000, options.deadline, nextFeedback]));
      await wait.promise;
    }

    return true;
  } finally {
    bridge.off(cb);
  }
}

/** Replace the system's geoip database with a test version - or revert that */
export async function setGeoIPDatabaseTestMode(testmode: boolean) {
  if (testmode)
    await loadlib("mod::system/lib/internal/tasks/geoipdownload.whlib").InstallTestGEOIPDatabases();
  else
    await loadlib("mod::system/lib/internal/tasks/geoipdownload.whlib").RestoreGEOIPDatabases();

  //TODO global refresh.
  //Flush geoip as they may have already been cached/loaded
  await __closeDatabase();
}

/** Build a test callback whether a field is an expected Instance */
export function expectInstance<Type extends WHFSTypeName>(expectType: Type, expectData: test.RecursivePartialTestable<TypedInstanceData<NoInfer<Type>>>, options: { partial: true }): (instance: Pick<Instance, "whfsType" | "data"> | null) => true;
export function expectInstance<Type extends WHFSTypeName>(expectType: Type, expectData?: test.RecursiveTestable<TypedInstanceData<NoInfer<Type>>>, options?: { partial?: false }): (instance: Pick<Instance, "whfsType" | "data"> | null) => true;
export function expectInstance(expectType: string, expectData?: object, { partial = false } = {}) {
  return ((instance: Pick<Instance, "whfsType" | "data"> | null) => {
    test.assert(instance);
    test.assert(isInstance(instance));
    test.eq(expectType, instance.whfsType);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- need to use 'any' here because we can't distinguish between partial and non-partial mode here
    test[partial ? 'eqPartial' : 'eq'](expectData || {} as any, instance.data);
    return true;
  });
}

/** Build a test callback whether a field is an expected Instance export */
export function expectInstanceExport<Type extends WHFSTypeName>(expectType: Type, expectData: test.RecursivePartialTestable<TypedInstanceExport<NoInfer<Type>>["data"]>, options: { partial: true }): (instance: InstanceExport | null) => true;
export function expectInstanceExport<Type extends WHFSTypeName>(expectType: Type, expectData?: test.RecursiveTestable<TypedInstanceExport<NoInfer<Type>>["data"]>, options?: { partial?: false }): (instance: InstanceExport | null) => true;
export function expectInstanceExport(expectType: string, expectData?: object, { partial = false } = {}) {
  return ((instance: InstanceExport | null) => {
    test.assert(instance);
    test.eq(expectType, instance.whfsType);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- need to use 'any' here because we can't distinguish between partial and non-partial mode here
    test[partial ? 'eqPartial' : 'eq']((expectData || {}) as any, instance.data, { annotation: `Testing instance export of type ${expectType}` });
    return true;
  });
}

/** Build a test callback whether a field is an expected IntExtLink */
export function expectIntExtLink(target: number | string, options?: { append?: string }) {
  return ((link: IntExtLink | null) => {
    test.assert(link);
    if (typeof target === "string")
      test.eq(target, link.externalLink);
    else
      test.eq(target, link.internalLink);

    test.eq(options?.append ?? "", link.append);
    return true;
  });
}

//By definition we re-export all of whtest and @webhare/test
export * from "@mod-platform/js/testing/whtest";
