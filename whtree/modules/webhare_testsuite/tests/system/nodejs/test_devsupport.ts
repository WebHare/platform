import * as test from "@webhare/test";
import * as devbridge from "@mod-platform/js/devsupport/devbridge";
import { backendConfig } from "@webhare/services";
import { readFile } from "fs/promises";
import { convertCompilerOptionsFromJson } from "typescript";
import { basename, dirname, resolve } from "path";
import { pick } from "@webhare/std";
import { enableDevKit } from "@mod-system/js/internal/generation/gen_config";

async function testDevBridge() {
  test.eq("wh:wrd/example", devbridge.getImportPath(backendConfig.dataroot + "storage/system/generated/wrd/example.ts"));
  test.eq("@mod-platform/generated/whdb/platform", devbridge.getImportPath(backendConfig.installationroot + "modules/platform/generated/whdb/platform.ts"));

  const test_platform_files = await devbridge.getGeneratedFiles({ module: "platform" });
  test.eqPartial({ importPath: '@mod-platform/generated/whdb/platform' }, test_platform_files.find(_ => _.type === "whdb"));

  const platform_whdb_defs = await devbridge.getDatabaseDefs({ module: "platform" });
  //TODO establish whether we want Arrays or Record<>s for schemas, columns etc and decide which format to nail down
  // console.log(JSON.stringify(platform_whdb_defs, null, 2));
  test.eqPartial({
    interface: "PlatformDB",
    importPath: '@mod-platform/generated/whdb/platform'
  }, platform_whdb_defs);
  test.assert(platform_whdb_defs.schemas.consilio.tables.catalogs.columns.id);

  const platform_wrd_defs = await devbridge.getWRDDefs({ module: "platform" });
  test.eqPartial({
    importPath: '@mod-platform/generated/wrd/webhare'
  }, platform_wrd_defs);

  //TODO establish whether we want Arrays or Record<>s for schemas, columns etc and decide which format to nail down
  const usermgmt = platform_wrd_defs.schemas.find(_ => _.wrdschema === "system:usermgmt");
  test.assert(usermgmt);
  test.eqPartial({
    schemaObject: "systemUsermgmtSchema"
  }, usermgmt);
  test.eqPartial({ typeName: "System_Usermgmt_WHUserAnnouncement" }, usermgmt.types.whuserAnnouncement);

  const test_whts_files = await devbridge.getGeneratedFiles({ module: "webhare_testsuite" });
  // console.log(test_whts_files);
  test.eqPartial({ importPath: 'wh:wrd/webhare_testsuite' }, test_whts_files.find(_ => _.type === "wrd"));
  test.eqPartial({ importPath: 'wh:whdb/webhare_testsuite' }, test_whts_files.find(_ => _.type === "whdb"));

  const parseresult = await devbridge.getParsedSiteProfile("mod::publisher/data/siteprofiles/shorturl.siteprl.xml");
  test.eq("publisher:siteprofile.shorturl", parseresult.gid);
}

async function readTSConfig(path: string) {
  const config = JSON.parse(await readFile(path, 'utf8'));
  return {
    ...pick(config, ["extends"]),
    compilerOptions: convertCompilerOptionsFromJson(config.compilerOptions, dirname(path), basename(path)).options
  };
}

async function testTSConfig() {
  const whdata_tsconfig = await readTSConfig(`${backendConfig.dataroot}tsconfig.json`);
  const whtree_tsconfig = await readTSConfig(`${backendConfig.installationroot}tsconfig.json`);

  // Test paths from whtree/tsconfig.json
  const whdata_paths = whdata_tsconfig.compilerOptions.paths;
  const baseurl = whdata_tsconfig.compilerOptions.baseUrl;

  test.assert(whtree_tsconfig.compilerOptions.paths);
  test.assert(whdata_paths);
  test.assert(baseurl);

  if (!enableDevKit()) {
    //If devkit is not activated its path will be in whtree/tsconfig.json (unavoidable as this needs to be constant for the image) but not in whdata/tsconfig.json
    delete whtree_tsconfig.compilerOptions.paths["@mod-devkit/*"];
    delete whtree_tsconfig.compilerOptions.paths["@mod-devkit"];
  }

  const expect_paths: Record<string, [string]> = {};
  for (const [name, paths] of Object.entries(whdata_paths)) {
    const abspath = resolve(baseurl, paths[0]);
    if (!abspath.startsWith(backendConfig.installationroot))
      continue;
    if (abspath.startsWith(backendConfig.installationroot + "node_modules/"))
      continue;
    if (name === "@mod-webhare_testsuite" || name.startsWith("@mod-webhare_testsuite/"))
      continue;

    if ((name === "@mod-devkit" || name.startsWith("@mod-devkit/")) && !enableDevKit())
      continue;

    const relpath = abspath.replace(backendConfig.installationroot, "");
    expect_paths[name] = [relpath];
  }

  const got_paths = whtree_tsconfig?.compilerOptions.paths;
  test.eq(expect_paths, got_paths, "whtree/tsconfig.json should have all paths from whdata/tsconfig.json, minus whtree/node_modules/* and whdata/* paths");

  // Test paths from whtree/tsconfig.json
  test.eq(`${backendConfig.installationroot}tsconfig.json`, resolve(baseurl, whdata_tsconfig.extends), "whdata/tsconfig.json should extend whtree/tsconfig.json");
}

test.runTests([
  testDevBridge,
  testTSConfig
]);
