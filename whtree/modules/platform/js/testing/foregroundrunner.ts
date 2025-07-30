import type { DevToolsRequest, TestReport } from "@mod-system/web/systemroot/jstests/testsuite";
import { launchPuppeteer, type Puppeteer } from "@webhare/deps";
import { formatTrace } from "@webhare/js-api-tools/src/stacktracing";
import { broadcast, subscribeToEventStream } from "@webhare/services";
import { generateRandomId, sleep } from "@webhare/std";
import { storeDiskFile } from "@webhare/system-tools";
import type { KeyboardModifierOptions } from "dompack/testframework/keyboard";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { readFileSync } from "node:fs";
import { getBundleOutputPath } from "../assetpacks/support";

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

type LogEntry = {
  when: Date;
  msg: string;
  trace?: Puppeteer.ConsoleMessageLocation[];
};

let debug = false;
let keepopen = false;
let alwayslog = false;

async function remapLocation(loc: Puppeteer.ConsoleMessageLocation): Promise<Puppeteer.ConsoleMessageLocation> {
  if (!(loc.lineNumber && loc.columnNumber && loc.url))
    return loc;

  const packagename = loc.url?.split("/.wh/ea/ap/")[1];
  if (!packagename)
    return loc;

  const bundlename = packagename.split("/")[0].replace('.', ':');
  const filename = packagename.split("/").slice(1).join("/");
  const mapFile = getBundleOutputPath(bundlename) + filename + ".map";

  let source = '';
  //TODO cache the parsed sources
  try {
    source = readFileSync(mapFile, 'utf8');
  } catch {
  }

  if (!source)
    return loc;

  const tracer = new TraceMap(source);
  const traced = originalPositionFor(tracer, { line: loc.lineNumber, column: loc.columnNumber });
  return traced.line && traced.source ? { lineNumber: traced.line, columnNumber: traced.column, url: traced.source } : loc;
}

async function reportFailure(testinfo: Test, message: string | null, log: LogEntry[], page: Puppeteer.Page | null) {
  const outbase = `/tmp/jstests/${testinfo.testname}.${new Date().toISOString()}`;
  const logfile = `${outbase}.txt`;
  const jsonlogfile = `${outbase}.json`;
  const screenshotfile = `${outbase}.png` as const;

  console.log(`Test ${testinfo.testname} ${message ? `failed: ${message}` : "completed successfully"}`);
  console.log(`Writing log to ${logfile}`);

  for (const line of log)
    if (line.trace)
      for (const [idx, item] of line.trace.entries())
        line.trace[idx] = await remapLocation(item);

  await storeDiskFile(logfile, log.map(_ => `[${_.when.toISOString()}] ${_.msg}`).join("\n") + "\n", { mkdir: true });
  await storeDiskFile(jsonlogfile, log.map(_ => JSON.stringify(_)).join("\n") + "\n", { mkdir: true });

  if (page) {
    console.log(`Writing screenshot to ${screenshotfile}`);
    await page.screenshot({ path: screenshotfile });
  }
}

export async function init(options: {
  debug: boolean;
  keepopen: boolean;
  alwayslog: boolean;
  showbrowser: boolean;
}) {

  debug = Boolean(options.debug);
  keepopen = Boolean(options.keepopen);
  alwayslog = Boolean(options.alwayslog);
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
  const log: LogEntry[] = [];
  let page;

  function addLogLine(msg: string, trace?: Puppeteer.ConsoleMessageLocation[]) {
    const when = new Date();
    if (debug)
      console.log(`[${when.toISOString()}] ${msg}`);

    log.push({ when, msg, trace: structuredClone(trace) }); //copy trace just in case, we were receiving incorrect coordinates which appear to belong to later messages - is its being updated?
  }

  try {
    page = await puppeteer!.newPage();
    page.on('console', message => addLogLine(`${message.type().substring(0, 3).toUpperCase()} ${message.text()}`, message.stackTrace()));
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
            await page.keyboard.down(name as Puppeteer.KeyInput);

        for (const key of nextEvent.value.data.keys)
          await page.keyboard.press(key as Puppeteer.KeyInput);

        for (const [flag, name] of Object.entries(keymap).reverse())
          if (nextEvent.value.data.options?.[flag as keyof KeyboardModifierOptions])
            await page.keyboard.up(name as Puppeteer.KeyInput);

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

    if (alwayslog)
      await reportFailure(test, null, log, page);
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
