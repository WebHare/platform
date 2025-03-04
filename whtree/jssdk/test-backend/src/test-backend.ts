/* @webhare/test-backend is a superset of @webhare/test with additional backend test support
 */

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/test-backend" {
}

import * as test from "@webhare/test";
import { beginWork } from "@webhare/whdb";
import { loadlib } from "@webhare/harescript";
import { openFileOrFolder, openFolder, openSite } from "@webhare/whfs";
import { throwError } from "@webhare/std";
import { deleteSchema, listSchemas } from "@webhare/wrd";
import { whconstant_wrd_testschema } from "@mod-system/js/internal/webhareconstants";
import { wrdTestschemaSchema } from "@mod-platform/generated/wrd/webhare";

/// Get the dedicated 'tmp' folder from the webhare_testsuite test site (prepared by webhare_testsuite reset)
export async function getTestSiteHSTemp() {
  return await openFolder("site::webhare_testsuite.testsite/tmp");
}
export async function getTestSiteJSTemp() {
  return await openFolder("site::webhare_testsuite.testsitejs/tmp");
}

export async function getTestSiteHS() {
  return await openSite("webhare_testsuite.testsite");
}
export async function getTestSiteJS() {
  return await openSite("webhare_testsuite.testsitejs");
}

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
  wrdschema?: boolean;
  schemaresource?: string;
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
  const setupWrdAuth = options?.users && Object.keys(options.users).length;

  if (setupWrdAuth) {
    const hstestoptions = {
      testusers: Object.entries(options?.users || []).map(([login, config]) => ({ login, grantrights: config.grantRights || [] })),
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

    await loadlib("mod::wrd/lib/api.whlib").CreateWRDSchema(whconstant_wrd_testschema, {
      initialize: true,
      schemaresource: options?.schemaresource || "",
      usermgmt: setupWrdAuth,
      description: "The webhare_testsuite WRD schema"
    });

    if (!setupWrdAuth) { //mark unit as not-required for compatibility with all existing tests
      await wrdTestschemaSchema.getType("wrdPerson").updateAttribute("whuserUnit", { isRequired: false });
    }
  }

  for (const tmpfoldername of ["site::webhare_testsuite.testsite/tmp", "site::webhare_testsuite.testsitejs/tmp"]) {
    const tmpfolder = await openFolder(tmpfoldername, { allowMissing: true });
    if (tmpfolder) {
      for (const item of await tmpfolder.list()) {
        //FIXME openObjects would still be very useful
        const obj = await openFileOrFolder(item.id);
        await obj.delete(); //FIXME we desire recyle
      }
    }
  }

  //reset testsitejs to well known feature set (Some tests may modify it but crash and not restore it)
  const testsitejs = await getTestSiteJS();
  test.assert(testsitejs, "We need the JS testsite to exist");

  let updateres;
  if (JSON.stringify(await testsitejs.getWebFeatures()) !== JSON.stringify(["platform:identityprovider"]) || await testsitejs.getWebDesign() !== "webhare_testsuite:basetestjs") {
    updateres = await testsitejs.update({ webFeatures: ["platform:identityprovider"], webDesign: "webhare_testsuite:basetestjs" });
  }

  await work.commit();
  if (updateres)
    await updateres.applied();
}

/** Describe a created test user */
export function getUser(name: string): TestUserDetails {
  return users[name] ?? throwError("User not found: " + name);
}

//By definition we re-export all of whtest and @webhare/test
export * from "@mod-platform/js/testing/whtest";
