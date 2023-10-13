import * as test from "@webhare/test";
import * as devbridge from "@mod-platform/js/devsupport/devbridge";
import { backendConfig } from "@webhare/services";

async function testDevBridge() {
  test.eq("wh:wrd/example", devbridge.getImportPath(backendConfig.dataroot + "storage/system/generated/wrd/example.ts"));
  test.eq("@mod-system/js/internal/generated/whdb/platform", devbridge.getImportPath(backendConfig.installationroot + "modules/system/js/internal/generated/whdb/platform.ts"));

  const test_platform_files = await devbridge.getGeneratedFiles({ module: "consilio" });
  test.eqProps({ importPath: '@mod-system/js/internal/generated/whdb/platform' }, test_platform_files.find(_ => _.type == "whdb"));

  const test_whts_files = await devbridge.getGeneratedFiles({ module: "webhare_testsuite" });
  test.eqProps({ importPath: 'wh:wrd/webhare_testsuite' }, test_whts_files.find(_ => _.type == "wrd"));
}

test.run([testDevBridge]);
