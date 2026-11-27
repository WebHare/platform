import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { YAML } from "@webhare/deps";
import { openSite } from "@webhare/whfs";
import { spawnSync } from "node:child_process";

async function testSiteCli() {
  const testSite = await test.getTestSiteJS();

  // STORY: get data
  {
    const getResult = spawnSync("wh", ["site", "get", "--json", testSite.name], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
    test.eq(0, getResult.status, "export command should succeed");

    test.eq({
      id: testSite.id,
      name: testSite.name,
      cdnBaseURL: testSite.cdnBaseURL,
      webRoot: testSite.webRoot,
      webDesign: await testSite.getWebDesign(),
      webFeatures: await testSite.getWebFeatures(),
    }, JSON.parse(getResult.stdout));
  }

  // STORY: add web feature
  {
    const addResult = spawnSync("wh", ["site", "add-webfeature", testSite.name, "webhare_testsuite:actions"], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
    test.eq(0, addResult.status, "add-webfeature command should succeed");

    test.assert((await testSite.getWebFeatures())?.includes("webhare_testsuite:actions"));
  }

  // STORY: add unknown web feature
  {
    const addResult = spawnSync("wh", ["site", "add-webfeature", testSite.name, "unknown_feature"], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'pipe'] });
    test.eq(1, addResult.status, "add-webfeature command should fail for unknown feature");
    test.assert(addResult.stderr?.includes("unknown_feature"), "should output error for unknown feature");
  }

  // STORY: remove web feature
  {
    const addResult = spawnSync("wh", ["site", "remove-webfeature", testSite.name, "webhare_testsuite:actions"], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
    test.eq(0, addResult.status, "remove-webfeature command should succeed");

    test.assert(!(await testSite.getWebFeatures())?.includes("webhare_testsuite:actions"));
  }

  // STORY: update command with JSON
  const webFeatures = await testSite.getWebFeatures();
  const oldWebRoot = testSite.webRoot;
  console.log(oldWebRoot);
  {
    const input = JSON.stringify({
      webFeatures: [...webFeatures || [], "webhare_testsuite:actions"],
      webRoot: oldWebRoot + "deeper/",
    });
    const setResult = spawnSync("wh", ["site", "update", testSite.name, "-"], { shell: false, input, encoding: "utf-8" });
    test.eq(0, setResult.status, "update command should succeed");

    test.assert((await testSite.getWebFeatures())?.includes("webhare_testsuite:actions"));
    test.assert((await openSite(testSite.id)).webRoot === oldWebRoot + "deeper/");

    const setFeaturesFieldResult = spawnSync("wh", ["site", "update", testSite.name, "--field", "webFeatures", (webFeatures || []).join(",")], { shell: false });
    test.eq(0, setFeaturesFieldResult.status, "update command should succeed");

    const setFeaturesField2Result = spawnSync("wh", ["site", "update", testSite.name, "--field", "webRoot", oldWebRoot], { shell: false });
    test.eq(0, setFeaturesField2Result.status, "update command should succeed");
  }

  // STORY: update command with YAML data
  {
    let input = YAML.stringify({
      webFeatures: [...webFeatures || [], "webhare_testsuite:actions"],
      webRoot: oldWebRoot + "deeper/",
    });
    const setResult = spawnSync("wh", ["site", "update", testSite.name, "-"], { shell: false, input, encoding: "utf-8" });
    test.eq(0, setResult.status, "update command should succeed");

    test.assert((await testSite.getWebFeatures())?.includes("webhare_testsuite:actions"));
    test.assert((await openSite(testSite.id)).webRoot === oldWebRoot + "deeper/");

    input = YAML.stringify({
      webFeatures: webFeatures,
      webRoot: oldWebRoot,
    });
    const set2Result = spawnSync("wh", ["site", "update", testSite.name, "-"], { shell: false, input, encoding: "utf-8" });
    test.eq(0, set2Result.status, "update command should succeed");

    test.assert(!(await testSite.getWebFeatures())?.includes("webhare_testsuite:actions"));
    test.assert((await openSite(testSite.id)).webRoot === oldWebRoot);
  }

  // STORY: update the description
  {
    const setResult = spawnSync("wh", ["site", "update", testSite.name, "--field", "description", "Described by the CLI"], { shell: false });
    test.eq(0, setResult.status, "update command should succeed");
    test.eq("Described by the CLI", (await openSite(testSite.id)).description);
  }

  // STORY: refuse an output location that's already in use
  {
    const hsTestSite = await test.getTestSiteHS();
    const conflictResult = spawnSync("wh", ["site", "update", testSite.name, "--field", "webRoot", hsTestSite.webRoot], { shell: false, encoding: "utf-8" });
    test.eq(1, conflictResult.status, "update command should fail for a location that's in use");
    test.eq(/Site 'webhare_testsuite.testsite' is already published at/, conflictResult.stderr);
    test.eq(oldWebRoot, (await openSite(testSite.id)).webRoot);
  }

  // STORY: update command with schema-failing data
  {
    const input = YAML.stringify({
      webFeatures: "not-an-array",
      webRoot: 123,
    });
    const setResult = spawnSync("wh", ["site", "update", testSite.name, "-"], { shell: false, input, encoding: "utf-8" });
    test.assert(setResult.status !== 0, "update command should fail with schema-failing data");
  }

  // STORY: list webdesigns
  {
    const listResult = spawnSync("wh", ["site", "list-webdesigns", "--json"], { shell: false, encoding: "utf-8" });
    test.eq(0, listResult.status, "list-webdesigns command should succeed");
    const webDesigns = JSON.parse(listResult.stdout);
    test.assert(Array.isArray(webDesigns), "should return an array of webdesigns");
    test.assert(webDesigns.find(ws => ws.name === "webhare_testsuite:basetest"));
    test.assert(webDesigns.find(ws => ws.name === "webhare_testsuite:basetestjs"));
    test.assert(webDesigns.find(ws => ws.name === "tollium:webinterface"));
  }

  // STORY: list webfeatures
  {
    const listResult = spawnSync("wh", ["site", "list-webfeatures", "--json"], { shell: false, encoding: "utf-8" });
    test.eq(0, listResult.status, "list-webfeatures command should succeed");
    const webDesigns = JSON.parse(listResult.stdout);
    test.assert(Array.isArray(webDesigns), "should return an array of webfeatures");
    test.assert(webDesigns.find(wf => wf.name === "webhare_testsuite:actions"));
    test.assert(webDesigns.find(wf => wf.name === "webhare_testsuite:boundfeature"));
    test.assert(webDesigns.find(wf => wf.name === "platform:identityprovider"));

    const list2Result = spawnSync("wh", ["site", "list-webfeatures", "--json", testSite.name], { shell: false, encoding: "utf-8" });
    test.eq(0, list2Result.status, "list-webfeatures command should succeed");
    const webDesigns2 = JSON.parse(list2Result.stdout);
    test.assert(Array.isArray(webDesigns2), "should return an array of webfeatures");
    test.assert(!webDesigns2.find(wf => wf.name === "webhare_testsuite:boundfeature")); // only allows non-js testsite webdesign
    test.assert(webDesigns2.find(wf => wf.name === "platform:identityprovider"));
  }

}

test.runTests([
  test.resetWTS,
  testSiteCli,
]);
