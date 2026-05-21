import * as test from "@webhare/test";
import * as services from "@webhare/services";
import type { GenericLogLine } from "@webhare/services/src/logging";
import { readJSONLogLines } from "@mod-system/js/internal/logging";
import { loadlib } from "@webhare/harescript";
import { addDuration, isTemporalInstant } from "@webhare/std";
import { storeDiskFile } from "@webhare/system-tools";
import { rm } from "node:fs/promises";
import { Timings } from "@mod-platform/js/logging/timings";

/** A sleep is not guaranteed to last at least as long as requested. This is: */
async function spinAtLeast(ms: number) {
  const start = performance.now();
  await test.sleep(ms);
  while (performance.now() - start < ms)
    await test.sleep(1);
}

async function gatherAsyncIterable<T>(itr: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of itr)
    result.push(item);
  return result;
}

// Blob that streams buffers of 1 byte at a time, useful for testing of chunk boundaries handling
class MiniChunkBlob implements Blob {
  data: Uint8Array;
  constructor(content: Uint8Array | string) {
    this.data = typeof content === "string" ? new TextEncoder().encode(content) as Uint8Array : content;
  }

  get size() { return this.data.length; }
  get type() { return ""; }

  stream(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start: (controller) => {
        for (const item of this.data)
          controller.enqueue(new Uint8Array([item]));
        controller.close();
      },
    });
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data.slice().buffer;
  }

  async bytes(): Promise<Uint8Array> {
    return this.data.slice();
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.data);
  }

  slice(start?: number, end?: number, contentType?: string): Blob {
    return new MiniChunkBlob(this.data.slice(start, end));
  }
}

async function readLog(name: string): Promise<GenericLogLine[]> {
  return readJSONLogLines(name, test.startTime, null);
}

async function testTimings() {
  const timingContext = new Timings;

  const tc1_start = performance.now();
  using tc1 = timingContext.startTimer("tc1");
  test.throws(/already started/, () => timingContext.startTimer("tc1"));

  await spinAtLeast(30);

  using tc1_1 = timingContext.startTimer("tc1_1");
  await spinAtLeast(20);
  using tc1_1_1 = timingContext.startTimer("tc1_1_1"); //level 3!
  test.throws(/is not the most recently started timer/, () => tc1.stop());
  await spinAtLeast(9);
  tc1_1_1.stop();
  await spinAtLeast(20);
  tc1_1.stop();

  await spinAtLeast(20);

  tc1.stop();
  const tc1_stop = performance.now();

  {
    using tc2 = timingContext.startTimer("tc2");
    void (tc2);
    await spinAtLeast(15);
  }

  test.throws(/has already run/, () => timingContext.startTimer("tc1"));

  const result = timingContext.getTimers();
  const totalTimeForTc1 = tc1_stop - tc1_start;
  test.cmp(totalTimeForTc1, ">", result.tc1 + result.tc1_1 + result.tc1_1_1, "tc1 should NOT include the time spent in tc1.1 or tc 1.1.1");

  test.cmp(result.tc1, ">=", 30 + 20);
  test.cmp(result.tc1_1, ">=", 20 + 20);
  test.cmp(result.tc1_1_1, ">=", 9);
  test.cmp(result.tc2, ">=", 15);
  test.eq(["tc1", "tc1_1", "tc1_1_1", "tc2"], Object.keys(result), "Should have the timers we created in creation order");
}

async function testLogs() {
  services.log("webhare_testsuite:test", { drNick: "Hi everybody!", patientsLost: BigInt("123456678901234567890123456678901234567890") });
  services.log("webhare_testsuite:test", {
    val: "1234567890".repeat(4000),
    f: function () { console.error("Cant log this"); },
    g: function g2() { console.error("Cant log this"); },
    u: undefined,
    s: Symbol(),
    [Symbol("artist")]: "Prince", //ignored in logs currently
    tafkap: Symbol("Prince")
  });
  await loadlib("mod::system/lib/logging.whlib").LogToJSONLog("webhare_testsuite:test", { hareScript: "I can speak JSON too!" });

  const logreader = services.readLogLines("webhare_testsuite:test", { start: test.startTime, limit: new Date(Date.now() + 1) });
  const logline = await logreader.next();
  test.eqPartial({ drNick: "Hi everybody!", patientsLost: "123456678901234567890123456678901234567890" }, logline.value);
  test.assert(isTemporalInstant(logline.value["@timestamp"]));
  test.assert(logline.value["@id"], "Should have an ID");

  const hardlogline = await logreader.next();
  test.assert(isTemporalInstant(hardlogline.value["@timestamp"]));
  test.eq(/1234567890… \(40000 chars\)/, hardlogline.value.val);
  // console.log(hardlogline);

  test.eq("[function f]", hardlogline.value.f);
  test.eq("[function g2]", hardlogline.value.g);
  test.eq(undefined, hardlogline.value.u);
  test.eq("[Symbol()]", hardlogline.value.s);
  test.eq("[Symbol(Prince)]", hardlogline.value.tafkap);

  const hsline = await logreader.next();
  test.assert(isTemporalInstant(hsline.value["@timestamp"]));
  test.eq("I can speak JSON too!", hsline.value.harescript);

  test.assert((await logreader.next()).done);

  const logreader2 = services.readLogLines("webhare_testsuite:test", { start: test.startTime, continueAfter: hardlogline.value["@id"] });
  test.eq(hsline.value["@id"], (await logreader2.next()).value["@id"], "ContinueAfter should have started after 'hardlogline'");

  try { //if betatest.20241205.log exists (ie you ran this test before) it will interfere with the logreader, so delete it
    await rm(services.backendConfig.dataRoot + "log/betatest.20241205.log");
  } catch (ignore) {
  }

  // Historic files reading. First write two lines:
  await storeDiskFile(services.backendConfig.dataRoot + "log/betatest.20241204.log",
    `{ "@timestamp": "2024-12-04T12:00:00.000Z", "line": 1 }\n{ "@timestamp": "2024-12-04T13:00:00.000Z", "line": 2 }\n`, { overwrite: true });

  const logreader_1204 = services.readLogLines<{ line: number }>("webhare_testsuite:test", { start: new Date("2024-12-04"), limit: new Date("2024-12-06") });
  test.eq(1, (await logreader_1204.next()).value.line);
  const logreader_1204_line2 = await logreader_1204.next();
  test.eq(2, logreader_1204_line2.value.line);
  test.eq(true, (await logreader_1204.next()).done);

  //Try to read more lines, none there yet
  const logreader_1204b = services.readLogLines<{ line: number }>("webhare_testsuite:test", { continueAfter: logreader_1204_line2.value["@id"], limit: new Date("2024-12-06") });
  test.eq(true, (await logreader_1204b.next()).done); //shouldn't find anything yet

  //Add line on the next day
  await storeDiskFile(services.backendConfig.dataRoot + "log/betatest.20241205.log",
    `{ "@timestamp": "2024-12-05T12:00:00.000Z", "line": 3 }\n{ "@timestamp": "2024-12-05T13:00:00.000Z", "line": 4 }\n`, { overwrite: true });

  //Try to read more lines, it's there now
  const logreader_1204c = services.readLogLines<{ line: number }>("webhare_testsuite:test", { continueAfter: logreader_1204_line2.value["@id"], limit: new Date("2024-12-06") });
  test.eq(3, (await logreader_1204c.next()).value.line);

  test.throws(/Invalid/, () => services.logDebug("services_test", { x: 42 }));
  services.logDebug("webhare_testsuite:services_test", { test: 42 });
  services.logError(new Error("Broken"));
  ///@ts-ignore we explicitly want to test for the exception when passing an incorrect name
  test.throws(/Invalid log type/, () => services.logNotice("debug", "message"));
  services.logNotice("error", "Foutmelding", { data: { extra: 43 } });
  services.logNotice("info", "Ter info");

  const mydebug = (await readLog("system:debug")).filter(_ => _.source === 'webhare_testsuite:services_test');
  test.eqPartial([{ data: { test: 42 } }], mydebug);

  const mygroupid = mydebug[0].groupid;

  const mynotices = (await readLog("system:notice")).filter(_ => _.groupid === mygroupid);
  test.eqPartial([
    {
      message: 'Broken',
      browser: { name: 'nodejs' },
      type: 'script-error'
    },
    {
      data: { extra: 43 },
      message: 'Foutmelding',
      type: 'error'
    },
    {
      message: 'Ter info',
      type: 'info'
    }
  ], mynotices);

  {
    function getLogLine(ms: number, offset: number) {
      const date = addDuration(test.startTime, { milliseconds: 0 });
      return {
        line: `{"@timestamp":"${date.toISOString()}","line":${ms + 1}}\n`,
        parsed: {
          "@timestamp": date.toTemporalInstant(),
          "@id": `A${date.toISOString().split('T')[0].replaceAll("-", "")}:${offset.toString().padStart(15, '0')}`,
          line: ms + 1
        },
      };
    }

    const logParts = [
      getLogLine(0, 0),
      getLogLine(1, 51),
      getLogLine(2, 102),
    ];

    const testLog = logParts.map(_ => _.line).join('');

    {
      const logreader3 = services.readLogLines("webhare_testsuite:test", {
        start: test.startTime, limit: new Date(Date.now() + 3),
        content: testLog,
      });
      const parsed3 = await gatherAsyncIterable(logreader3);
      test.eq(logParts.map(_ => _.parsed), parsed3);

      const logreader4 = services.readLogLines("webhare_testsuite:test", {
        start: test.startTime, limit: new Date(Date.now() + 3),
        content: testLog,
        continueAfter: parsed3[0]["@id"],
      });
      const parsed4 = await gatherAsyncIterable(logreader4);
      test.eq(logParts.slice(1).map(_ => _.parsed), parsed4);

      // Test with MiniChunkBlob (streams 1 byte at a time) - no continueAfter
      const logreader5 = services.readLogLines("webhare_testsuite:test", {
        start: test.startTime, limit: new Date(Date.now() + 3),
        content: new MiniChunkBlob(testLog),
      });
      const parsed5 = await gatherAsyncIterable(logreader5);
      test.eq(logParts.map(_ => _.parsed), parsed5);

      // Test with MiniChunkBlob (streams 1 byte at a time) - continueAfter first element
      const logreader6 = services.readLogLines("webhare_testsuite:test", {
        start: test.startTime, limit: new Date(Date.now() + 3),
        content: new MiniChunkBlob(testLog),
        continueAfter: parsed3[0]["@id"],
      });
      const parsed6 = await gatherAsyncIterable(logreader6);
      test.eq(logParts.slice(1).map(_ => _.parsed), parsed6);

      // Test with MiniChunkBlob (streams 1 byte at a time) - continueAfter second element (with seeking!)
      const logreader7 = services.readLogLines("webhare_testsuite:test", {
        start: test.startTime, limit: new Date(Date.now() + 3),
        content: new MiniChunkBlob(testLog),
        continueAfter: parsed3[1]["@id"],
      });
      const parsed7 = await gatherAsyncIterable(logreader7);
      test.eq(logParts.slice(2).map(_ => _.parsed), parsed7);
    }
  }
}

test.runTests(
  [
    testTimings,
    testLogs
  ]);
