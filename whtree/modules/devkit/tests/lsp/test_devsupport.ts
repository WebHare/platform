import * as test from "@webhare/test";
import * as devbridge from "@mod-platform/js/devsupport/devbridge";
import { backendConfig } from "@webhare/services";
import { existsSync } from "node:fs";

async function testDevBridge() {
  test.eq("wh:wrd/example", devbridge.getImportPath(backendConfig.dataRoot + "config/wrd/example.ts"));
  test.eq("@mod-platform/generated/db/platform", devbridge.getImportPath(backendConfig.installationRoot + "modules/platform/generated/db/platform.ts"));

  const test_platform_files = await devbridge.getGeneratedFiles({ module: "platform" });
  test.eqPartial({ importPath: '@mod-platform/generated/db/platform' }, test_platform_files.find(_ => _.type === "db"));

  const platform_whdb_defs = await devbridge.getDatabaseDefs({ module: "platform" });
  //TODO establish whether we want Arrays or Record<>s for schemas, columns etc and decide which format to nail down
  // console.log(JSON.stringify(platform_whdb_defs, null, 2));
  test.eqPartial({
    interface: "PlatformDB",
    importPath: '@mod-platform/generated/db/platform'
  }, platform_whdb_defs);
  test.assert(platform_whdb_defs.schemas.consilio.tables.catalogs.columns.id);

  const platform_wrd_defs = await devbridge.getWRDDefs({ module: "platform" });
  test.eqPartial({
    importPath: '@mod-platform/generated/wrd/webhare'
  }, platform_wrd_defs);

  //TODO establish whether we want Arrays or Record<>s for schemas, columns etc and decide which format to nail down
  const usermgmt = platform_wrd_defs.schemas.find(_ => _.wrdSchema === "system:usermgmt");
  test.assert(usermgmt);
  test.eqPartial({
    schemaObject: "systemUsermgmtSchema"
  }, usermgmt);
  test.eqPartial({ typeName: "System_Usermgmt_WHUserAnnouncement" }, usermgmt.types.whuserAnnouncement);

  const test_whts_files = await devbridge.getGeneratedFiles({ module: "devkit" });
  // console.log(test_whts_files);
  test.eqPartial({ importPath: 'wh:wrd/devkit' }, test_whts_files.find(_ => _.type === "wrd"));
  test.eqPartial({ importPath: 'wh:db/devkit' }, test_whts_files.find(_ => _.type === "db"));

  const parseresult = await devbridge.getParsedSiteProfile("mod::devkit/tests/rewrite/data/rewritesiteprofile.propertyeditor.out.xml");
  test.eq("devkit:testtids.gid1", parseresult.gid);

  test.assert(existsSync(backendConfig.dataRoot + "node_modules/@types/node"), "The node symlink must exist, or modules may not get node builtin types");
  test.assert(existsSync(backendConfig.dataRoot + "node_modules/@types/node/buffer.d.ts"), "Test one of the expected files");
}


test.runTests([testDevBridge]);
