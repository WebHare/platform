import type { DevToolsRequest, TestReport } from "@mod-system/web/systemroot/jstests/testsuite";
import { launchPuppeteer, type Puppeteer } from "@webhare/deps";
import { formatTrace } from "@webhare/js-api-tools/src/stacktracing";
import { broadcast, subscribeToEventStream } from "@webhare/services";
import { generateRandomId, sleep } from "@webhare/std";
import { storeDiskFile } from "@webhare/system-tools";
import type { KeyboardModifierOptions } from "dompack/testframework/keyboard";
import type { KeyInput } from "puppeteer";

let puppeteer: Puppeteer.Browser | null = null;

type Test = {
  tags: string[];
  env: unknown[];
  type: string;
  script: string;
  testname: string;
  skipauto: boolean;
  testscript: {
    args: string[];
    scriptpath: string;
  };
  baseurl: string;
  sitename: string;
  flaky: boolean;
  xfail: boolean;
  timeout: number;
  validationconfig: {
    excludemasks: unknown[];
    ignoremessages: unknown[];
    futuremodule: boolean;
    futuremodulewhy: string;
    perfectcompile: boolean;
    nomissingtids: boolean;
    nowarnings: boolean;
    eslintmasks: string[];
    formatmasks: string[];
    formatexcludemasks: unknown[];
  };
  compatibility: string;
};

type TestProgressEvent = {
  done: false;
  value: {
    name: string; // system:jstest.report.697408ae4d117b1bf9a1c917c0e4887a
    data: TestReport;
  };
};

type TestDevtoolsEvent = {
  done: false;
  value: {
    name: string; // system:jstest.devtools.697408ae4d117b1bf9a1c917c0e4887a
    data: DevToolsRequest;
  };
};

let debug = false;
let keepopen = false;

async function reportFailure(testinfo: Test, message: string, log: string[], page: Puppeteer.Page | null) {
  const outbase = `/tmp/jstests/${testinfo.testname}.${new Date().toISOString()}`;
  const logfile = `${outbase}.log`;
  const screenshotfile = `${outbase}.png`;

  console.log(`Test ${testinfo.testname} failed: ${message}`);
  console.log(`Writing log to ${logfile}`);
  await storeDiskFile(logfile, log.join("\n"), { mkdir: true });

  if (page) {
    console.log(`Writing screenshot to ${screenshotfile}`);
    await page.screenshot({ path: screenshotfile });
  }
}

export async function init(options: {
  debug: boolean;
  keepopen: boolean;
  showbrowser: boolean;
}) {

  debug = Boolean(options.debug);
  keepopen = Boolean(options.keepopen);
  puppeteer = await launchPuppeteer({
    headless: !(options.showbrowser || options.keepopen),
    defaultViewport: { height: 1024, width: 1280, deviceScaleFactor: 1 }
  });
}

export async function runTest(test: Test) {
  const reportid = generateRandomId("hex");
  const testurl = new URL(test.baseurl);
  testurl.searchParams.set("mask", test.testname);
  testurl.searchParams.set("reportid", reportid);

  // Begin listening for reports before setting the URL
  const events = subscribeToEventStream(["system:jstest.report." + reportid, "system:jstest.devtools." + reportid]);
  const timeout = sleep(test.timeout).then(() => "timeout");
  const log: string[] = [];
  let page;

  function addLogLine(text: string) {
    text = `[${new Date().toISOString()}] ${text}`;
    if (debug)
      console.log(text);
    log.push(text);
  }

  try {
    page = await puppeteer!.newPage();
    page.on('console', message => addLogLine(`${message.type().substring(0, 3).toUpperCase()} ${message.text()}`));
    page.on('pageerror', message => addLogLine(`PageError: ${message}`));
    // perhaps add these behind a debug flag? they're very noise especially for loading (data:) images
    // page.on('request', req => addLogLine(`Request: ${req.url()}`));
    // page.on('response', response => addLogLine(`Response: ${response.url()} ${response.status()} ${response.statusText()} ${response.headers()["content-type"] || "no content-type"}`));
    page.on('requestfailed', request => addLogLine(`Request failed: ${request.failure()?.errorText} ${request.url()}`));

    if (debug)
      console.log(`Opening test page ${testurl}`);

    await page.goto(testurl.toString());

    let lastReport: TestProgressEvent | null = null;
    while (!lastReport?.value.data.tests?.[0].finished) {
      const nextEvent = await Promise.race([events.next(), timeout]) as "timeout" | TestProgressEvent | TestDevtoolsEvent;
      if (nextEvent === "timeout") {
        await reportFailure(test, "Timeout waiting for test report", log, page);
        return { status: "fail" };
      }
      if ("type" in nextEvent.value.data && nextEvent.value.data.type === "pressKeys") {
        const keymap = { shiftkey: "Shift", ctrlkey: "Control", altkey: "Alt", metakey: "Meta" };
        for (const [flag, name] of Object.entries(keymap))
          if (nextEvent.value.data.options?.[flag as keyof KeyboardModifierOptions])
            await page.keyboard.down(name as KeyInput);

        for (const key of nextEvent.value.data.keys)
          await page.keyboard.press(key as KeyInput);

        for (const [flag, name] of Object.entries(keymap).reverse())
          if (nextEvent.value.data.options?.[flag as keyof KeyboardModifierOptions])
            await page.keyboard.up(name as KeyInput);

        broadcast("system:jstest.devresponse." + reportid);
        continue;
      }

      if (debug)
        console.dir(nextEvent, { depth: Infinity });
      lastReport = nextEvent as TestProgressEvent;
    }
    if (lastReport.value.data.tests[0].fails.length) {
      const trace = formatTrace(lastReport.value.data.tests[0].fails[0].trace);
      const msg = lastReport.value.data.tests[0].fails[0].text + "\n" + trace;
      await reportFailure(test, msg, log, page);
      return { status: "fail" };
    }

    await page.close();
    page = null;
    return { status: "ok" };
  } catch (e) {
    console.error("Internal error in foregroundrunner", e);
    return { status: "fail" };
  } finally {
    // Cleanup
    if (!keepopen)
      await page?.close();
    await events[Symbol.dispose]();
  }
}

export async function close() {
  if (!keepopen)
    await puppeteer?.close();
  puppeteer = null;
}

process.on("SIGINT", () => {
  void close();
});
