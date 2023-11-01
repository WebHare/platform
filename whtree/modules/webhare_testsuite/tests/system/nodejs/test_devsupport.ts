import * as test from "@webhare/test";
import * as devbridge from "@mod-platform/js/devsupport/devbridge";
import { backendConfig } from "@webhare/services";

async function testDevBridge() {
  test.eq("wh:wrd/example", devbridge.getImportPath(backendConfig.dataroot + "storage/system/generated/wrd/example.ts"));
  test.eq("@mod-system/js/internal/generated/whdb/platform", devbridge.getImportPath(backendConfig.installationroot + "modules/system/js/internal/generated/whdb/platform.ts"));

  const test_platform_files = await devbridge.getGeneratedFiles({ module: "platform" });
  test.eqProps({ importPath: '@mod-system/js/internal/generated/whdb/platform' }, test_platform_files.find(_ => _.type == "whdb"));

  const platform_whdb_defs = await devbridge.getDatabaseDefs({ module: "platform" });
  //TODO establish whether we want Arrays or Record<>s for schemas, columns etc and decide which format to nail down
  // console.log(JSON.stringify(platform_whdb_defs, null, 2));
  test.eqProps({
    interface: "PlatformDB",
    importPath: '@mod-system/js/internal/generated/whdb/platform'
  }, platform_whdb_defs);
  test.assert(platform_whdb_defs.schemas.consilio.tables.catalogs.columns.id);

  const platform_wrd_defs = await devbridge.getWRDDefs({ module: "platform" });
  //TODO establish whether we want Arrays or Record<>s for schemas, columns etc and decide which format to nail down
  const usermgmt = platform_wrd_defs.schemas.find(_ => _.wrdschema === "system:usermgmt");
  test.assert(usermgmt);
  test.eqProps({ typeName: "System_Usermgmt_WHUserAnnouncement" }, usermgmt.types.whuserAnnouncement);

  const test_whts_files = await devbridge.getGeneratedFiles({ module: "webhare_testsuite" });
  // console.log(test_whts_files);
  test.eqProps({ importPath: 'wh:wrd/webhare_testsuite' }, test_whts_files.find(_ => _.type == "wrd"));
  test.eqProps({ importPath: 'wh:whdb/webhare_testsuite' }, test_whts_files.find(_ => _.type == "whdb"));
}

test.run([testDevBridge]);
