import * as test from "@webhare/test-backend";
import { anonymizeIPAddress } from "@mod-platform/js/logging/parsersupport.ts";
import { parseAndValidateModuleDefYMLText } from "@mod-webhare_testsuite/js/config/testhelpers";
import { getYMLPxlConfigs } from "@mod-platform/js/logging/accesslog.ts";

async function testBasicAPIs() {
  test.eq("12.214.31.0", anonymizeIPAddress("12.214.31.144"));
  test.eq("2001:67c:2564::", anonymizeIPAddress("2001:67c:2564:a102::1:1"));
  test.eq("2001:67c:2564::", anonymizeIPAddress("2001:67c:2564:a102:1:2:3:4"));
}

async function testPxlConfig() {
  await test.throws(/Circular includeFields/, async () => getYMLPxlConfigs(await parseAndValidateModuleDefYMLText(`
    pxlEvents:
      yin:
        includeFields: yang
      yang:
        includeFields: yin
    `)));

  await test.throws(/is declared as both/, async () => getYMLPxlConfigs(await parseAndValidateModuleDefYMLText(`
    pxlEvents:
      yin:
        fields:
          s: string
      yang:
        fields:
          s: number
    `)));

  const config = getYMLPxlConfigs(await parseAndValidateModuleDefYMLText(`
    pxlEvents:
      an_event:
        fields:
          x: string
          y: boolean
      another_event: {}
      third_event:
        includeFields: an_event
        fields:
          z: number
    `));

  test.eqPartial({
    "webhare_testsuite:an_event": { fields: { x: "string", y: "boolean" } },
    "webhare_testsuite:another_event": { fields: {} },
    "webhare_testsuite:third_event": { fields: { x: "string", y: "boolean", z: "number" } }
  }, config);
}

test.run([
  testBasicAPIs,
  testPxlConfig,
]);
