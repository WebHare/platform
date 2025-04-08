/* @webhare/test-backend is a superset of @webhare/test with additional backend test support
 */

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/test-backend" {
}

import { beginWork } from "@webhare/whdb";
import { loadlib } from "@webhare/harescript";
import { openFileOrFolder, openFolder } from "@webhare/whfs";
import { throwError } from "@webhare/std";
import { createSchema, deleteSchema, listSchemas, WRDSchema } from "@webhare/wrd";
import { whconstant_wrd_testschema } from "@mod-system/js/internal/webhareconstants";

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

//By definition we re-export all of whtest and @webhare/test
export * from "@mod-platform/js/testing/whtest";
