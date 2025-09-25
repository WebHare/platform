/* @webhare/test-backend is a superset of @webhare/test with additional backend test support
 */

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/test-backend" {
}

import * as test from "@webhare/test";
import { beginWork } from "@webhare/whdb";
import { loadlib } from "@webhare/harescript";
import { lookupURL, openFileOrFolder, openFolder } from "@webhare/whfs";
import { convertWaitPeriodToDate, throwError, type WaitPeriod } from "@webhare/std";
import { createSchema, deleteSchema, listSchemas, WRDSchema } from "@webhare/wrd";
import { whconstant_wrd_testschema } from "@mod-system/js/internal/webhareconstants";
import type { SchemaTypeDefinition } from "@webhare/wrd/src/types";
import type { AuthAuditEvent, AuthEventData } from "@webhare/auth";
import { getAuditEvents } from "@webhare/auth/src/audit";
import { __closeDatabase } from "@webhare/geoip";
import type { IntExtLink, Instance } from "@webhare/services";
import { isInstance } from "@webhare/services/src/richdocument";
import type { InstanceExport, WHFSType, TypedInstanceExport, TypedInstanceData } from "@webhare/whfs/src/contenttypes";

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

/** Wait for publication to complete!
    @param startingpoint - Folder or file we're waiting to complete republishing (recursively)
    @param options - Options for waiting
    @param options.deadline - Maximum time to wait (defaults to 5 minutes)
    @param options.reportFrequency - If set, frequency (in ms) to report we're still waiting
    @param options.skipEventCompletion - Do not wait for publisher (republish) events to complete processing
    @param options.acceptErrors - Accept any error in the publication (WebHare 4.33+)
    @param options.expectErrorsFor - Explicit file IDs we accept and expect an error for */
export async function waitForPublishCompletion(startingpoint: number | string, options: {
  deadline?: WaitPeriod;
  reportFrequency?: number;
  skipEventCompletion?: boolean;
  acceptErrors?: boolean;
  expectErrorsFor?: number[];
} = {}): Promise<void> {
  const deadline = convertWaitPeriodToDate(options.deadline ?? 5 * 60 * 1000);

  let target;
  if (typeof startingpoint === "string" && startingpoint.match(/^https?:/)) {
    const urlinfo = await lookupURL(new URL(startingpoint));
    if (!urlinfo?.folder)
      throw new Error(`Invalid URL ${startingpoint}`);
    target = await openFolder(urlinfo.folder);
  } else {
    target = await openFileOrFolder(startingpoint);
  }

  const opts = { ...options, deadline };
  if (!await loadlib("mod::publisher/lib/control.whlib").WaitForPublishCompletion(target.id, opts))
    throw new Error(`Publication of ${target.whfsPath} (#${startingpoint}) isn't completing`);
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
export function expectInstance<Type extends WHFSType>(expectType: Type, expectData: test.RecursivePartialTestable<TypedInstanceData<NoInfer<Type>>>, options: { partial: true }): (instance: Pick<Instance, "whfsType" | "data"> | null) => true;
export function expectInstance<Type extends WHFSType>(expectType: Type, expectData?: test.RecursiveTestable<TypedInstanceData<NoInfer<Type>>>, options?: { partial?: false }): (instance: Pick<Instance, "whfsType" | "data"> | null) => true;
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
export function expectInstanceExport<Type extends WHFSType>(expectType: Type, expectData: test.RecursivePartialTestable<TypedInstanceExport<NoInfer<Type>>["data"]>, options: { partial: true }): (instance: InstanceExport | null) => true;
export function expectInstanceExport<Type extends WHFSType>(expectType: Type, expectData?: test.RecursiveTestable<TypedInstanceExport<NoInfer<Type>>["data"]>, options?: { partial?: false }): (instance: InstanceExport | null) => true;
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
