import * as test from "@webhare/test-backend";
import { anonymizeIPAddress } from "@mod-platform/js/logging/parsersupport.ts";
import { parseAndValidateModuleDefYMLText } from "@mod-webhare_testsuite/js/config/testhelpers";
import { buildPxlParser, getYMLPxlConfigs, type PxlDocType } from "@mod-platform/js/logging/pxllog";
import { backendConfig, readLogLines, scheduleTimedTask } from "@webhare/services";
import { sendPxl, setPxlOptions } from "@webhare/frontend/src/pxl"; //we may be able to use @webhare/frontend iff it stops loading CSS
import { readJSONLogLines } from "@mod-system/js/internal/logging";
import { generateRandomId } from "@webhare/std";
import { beginWork, commitWork } from "@webhare/whdb";
import { openCatalog } from "@webhare/consilio";

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
          s: keyword
      yang:
        fields:
          s: integer
    `)));

  const config = getYMLPxlConfigs(await parseAndValidateModuleDefYMLText(`
    pxlEvents:
      an_event:
        fields:
          x: keyword
          y: boolean
      another_event: {}
      third_event:
        includeFields: an_event
        fields:
          z: integer
    `));

  test.eqPartial({
    "webhare_testsuite:an_event": { fields: { x: "keyword", y: "boolean" } },
    "webhare_testsuite:another_event": { fields: {} },
    "webhare_testsuite:third_event": { fields: { x: "keyword", y: "boolean", z: "integer" } }
  }, config);
}

const logfile = `
{"@timestamp":"2024-12-09T09:52:24.376Z","ip":"10.55.55.55","method":"HEAD","url":"https://webhare.moe.sf.webhare.dev/.wh/ea/pxl/?pe=webhare_testsuite%3Aaa&pp=sA6qasgIhzDLDgB2lI_UDA&pc=27&ob=123.abc&ps=apoANQ-2bFnGsxQ7DuZQig&pi=anonymous&bl=https%3A%2F%2Fwebhare.moe.sf.webhare.dev%2F.system%2Fjstests%2F%21%2Ftestpage%2Fconsilio.test_pxl&bt=mac-chrome-131&bd=desktop&bu=Mozilla%2F5.0+%28Macintosh%3B+Intel+Mac+OS+X+10_15_7%29+AppleWebKit%2F537.36+%28KHTML%2C+like+Gecko%29+Chrome%2F131.0.0.0+Safari%2F537.36&bs=2560x1440&bp=2&ds_s=string&dn_superfluous=123","statusCode":200,"userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36","mimeType":"text/plain","responseTime":0.000012}
{"@timestamp":"2024-12-10T11:31:37.583Z","ip":"81.2.69.142","method":"HEAD","url":"https://webhare.moe.sf.webhare.dev/.wh/ea/pxl/?pe=platform%3Aform_nextpage&pp=Rn1C-KVsOjpiY24Pi8ah8A&ob=456.abc&pc=6&ps=u8mnaiTWz8bBAOBDmjHuFA&pi=yz9MR2JybuzfsQcCm65K1w&bl=https%3A%2F%2Fwebhare.moe.sf.webhare.dev%2Ftestoutput%2Fwebhare_testsuite.testsite%2Ftestpages%2Fformtest%2F%3Fmultipage%3D1%26cookiebar%3D1&bt=mac-chrome-131&bd=desktop&bu=Mozilla%2F5.0+%28Macintosh%3B+Intel+Mac+OS+X+10_15_7%29+AppleWebKit%2F537.36+%28KHTML%2C+like+Gecko%29+HeadlessChrome%2F131.0.0.0+Safari%2F537.36&bs=2560x1440&bp=2&ds_formmeta_id=multipagetest&ds_formmeta_session=U29G-5qVQr5VHf9K9viRrQ&ds_formmeta_pagetitle=firstpage&dn_formmeta_targetpagenum=4&ds_formmeta_targetpagetitle=Last+Page&dn_formmeta_time=38&dn_formmeta_pagenum=1","statusCode":200,"userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36","mimeType":"text/plain","responseTime":0.000014}
`;

async function testPxlParser() {
  const parser = await buildPxlParser();
  const reader = readLogLines("platform:pxl", { content: logfile });

  {
    const sourceLine = (await reader.next()).value;
    const parsed = parser.parseLine(sourceLine);
    test.eq({
      _id: sourceLine["@id"],
      "@timestamp": Temporal.Instant.from("2024-12-09T09:52:24.376Z"),
      counter: 27,
      event: "webhare_testsuite:aa",
      location: "https://webhare.moe.sf.webhare.dev/.system/jstests/!/testpage/consilio.test_pxl",
      mod_webhare_testsuite: { s: "string" },
      pageid: "sA6qasgIhzDLDgB2lI_UDA",
      objref: "123.abc",
      referrer: "",
      remoteip: "10.55.55.0",
      screen: {
        height: 1440,
        pixelratio: 2,
        width: 2560
      },
      sessionid: "apoANQ-2bFnGsxQ7DuZQig",
      user_agent: {
        device: "desktop",
        major: 131,
        name: "chrome", os: "mac"
      }, userid: "anonymous"
    }, parsed);
  }

  {
    const sourceLine = (await reader.next()).value;
    const parsed = parser.parseLine(sourceLine);

    test.eq({
      _id: sourceLine["@id"],
      '@timestamp': Temporal.Instant.from("2024-12-10T11:31:37.583Z"),
      event: 'platform:form_nextpage',
      userid: 'yz9MR2JybuzfsQcCm65K1w',
      sessionid: 'u8mnaiTWz8bBAOBDmjHuFA',
      pageid: 'Rn1C-KVsOjpiY24Pi8ah8A',
      objref: "456.abc",
      counter: 6,
      location: 'https://webhare.moe.sf.webhare.dev/testoutput/webhare_testsuite.testsite/testpages/formtest/?multipage=1&cookiebar=1',
      referrer: '',
      user_agent: { os: 'mac', name: 'chrome', major: 131, device: 'desktop' },
      screen: { width: 2560, height: 1440, pixelratio: 2 },
      remoteip: '81.2.69.0',
      geoip: {
        city: 'London',
        country: 'GB',
        location: { lat: 51.5142, lon: -0.0931 },
        region: 'England'
      },
      mod_platform: {
        formmeta_id: "multipagetest",
        formmeta_session: "U29G-5qVQr5VHf9K9viRrQ",
        formmeta_pagetitle: "firstpage",
        formmeta_targetpagenum: 4,
        formmeta_targetpagetitle: "Last Page",
        formmeta_time: 38,
        formmeta_pagenum: 1
      }
    }, parsed);
  }
}

async function testPxlTrueEvents() {
  //readJSONLogLines is not really for TS but it's very convenient for tests, as we can't explicitly flush platform:pxl currently
  //Let's Log Some Things
  const teststring = "myString-" + generateRandomId();
  setPxlOptions({ url: backendConfig.backendURL + ".wh/ea/pxl/" });
  sendPxl("webhare_testsuite:aa", { s: teststring, n: 121277 });

  await test.wait(async () => {
    const lines = await readJSONLogLines("platform:pxl", test.startTime) as unknown as Array<{ url: string }>;
    return lines.find(line => line.url.includes(teststring));
  });

  await beginWork();
  const pxltask = await scheduleTimedTask("platform:updatepxllog");
  await commitWork();

  await pxltask.taskDone;

  //Find our event in consilio!  TODO Convert to TS RunConsilioSearch as soon as it exists
  const catalog = await openCatalog<PxlDocType>("platform:pxl");
  await catalog.refresh();
  const result = await catalog.search({
    body: {
      query: {
        match: {
          "mod_webhare_testsuite.s": teststring
        }
      }
    }
  });

  //verify we get exactly one hit
  test.eqPartial([
    {
      _source: {
        "event": "webhare_testsuite:aa",
        mod_webhare_testsuite: { s: teststring, n: 121277 }
      }
    }
  ], result.hits.hits);
}

test.runTests([
  testBasicAPIs,
  testPxlConfig,
  async function prepTestGeoip() {
    await test.setGeoIPDatabaseTestMode(true);
  },
  testPxlParser,
  testPxlTrueEvents,
  async function cleanup() {
    await test.setGeoIPDatabaseTestMode(false);
  }
]);
