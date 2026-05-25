import { runCli } from "@webhare/cli";
import type { StackTraceItem } from "@webhare/js-api-tools";
import * as child_process from "node:child_process";
import { sleep } from "@webhare/std";

type AutoExplainData = {
  codeContext: string;
  durationMs: number;
  jsDurationMs: number;
  plan: {
    "Query Text": string;
    plan: unknown;
  };
  stackTrace: StackTraceItem[];
};

const autoExplains: AutoExplainData[] = [];

runCli({
  flags: { "show-stack": "Show stack traces" },
  async main({ opts }) {
    const proc = child_process.spawn("wh", ["watchlog", "debug"]);
    let line = "";
    proc.stdout.on("data", data => {
      line += data.toString();
      const lines = line.split("\n");
      for (let i = 0; i < lines.length - 1; i++) {
        const l = lines[i].trim();
        try {
          const parsed = JSON.parse(l) as { "@timestamp": string; source: string; data: object };
          if (parsed.source !== "platform:pg-auto_explain")
            continue;
          const rec = parsed.data as AutoExplainData;
          autoExplains.push(rec);
        } catch (e) {

        }
      }
      line = lines[lines.length - 1] || "";
    });

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let nextKey = Promise.withResolvers<string>();
    const keys = [nextKey.promise];


    // on any data into stdin
    stdin.on('data', function (key: string) {
      // ctrl-c ( end of text )
      if (key === '\u0003' || key === 'q') {
        process.exit();
      }
      nextKey.resolve(key);
      nextKey = Promise.withResolvers<string>();
      keys.push(nextKey.promise);
    });


    await sleep(100);
    autoExplains.length = 0; // clear any explains that were captured during startup
    let toShow = autoExplains.slice();
    while (true) {
      const groups = Map.groupBy(toShow, r => r.codeContext);
      for (const group of groups) {
        console.log(`Code context: ${group[0]}, total queries: ${group[1].length}, total duration:${group[1].reduce((a, r) => a + r.durationMs, 0).toFixed(3).padStart(8)}ms`);
        const top10 = group[1].toSorted((a, b) => b.durationMs - a.durationMs).slice(0, 10);
        console.log(`Top ${top10.length} longest queries:`);
        for (const rec of top10) {
          console.log(`DBDuration:${rec.durationMs.toFixed(3).padStart(8)}ms, JSDuration:${rec.jsDurationMs.toFixed(3).padStart(8)}ms, query: ${rec.plan["Query Text"]}`);
          if (opts.showStack && rec.stackTrace)
            console.log(`  trace: ${rec.stackTrace.map(s => `${s.filename}:${s.line}:${s.col}:(${s.func}})`).join(",")}`);
        }
        const mostRepeated = Map.groupBy(group[1], r => r.plan["Query Text"]).values().toArray().toSorted((a, b) => b.length - a.length).slice(0, 10);
        console.log(`Top ${mostRepeated.length} most repeated queries: `);
        for (const recs of mostRepeated) {
          console.log(`Count: ${recs.length.toString().padStart(5)}, total dbtime: ${recs.reduce((a, r) => a + r.durationMs, 0).toFixed(3).padStart(8)}ms, total jstime: ${recs.reduce((a, r) => a + r.jsDurationMs, 0).toFixed(3).padStart(8)}ms, query: ${recs[0].plan["Query Text"]}`);
          if (opts.showStack && recs[0].stackTrace)
            console.log(`  trace: ${recs[0].stackTrace.map(s => `${s.filename}:${s.line}:${s.col}:(${s.func}})`).join(",")}`);
        }
      }

      console.log(`Press space or enter to show collected entries, Ctrl+C/q to exit, 's' toggles stack traces (now ${opts.showStack ? "on" : "off"})`);
      keyLoop:
      while (true) {
        const key = await keys.shift();
        switch (key) {
          case ' ':
          case '\n': {
            toShow = autoExplains.splice(0, autoExplains.length);

          } break keyLoop;
          case 's': opts.showStack = !opts.showStack; break keyLoop;
          case 'c': process.stdout.write('\x1bc'); break;
          default:
            console.log(`Unknown key: ${JSON.stringify(key)}. Press space or enter to show collected entries, Ctrl+C/q to exit.`);
        }
      }


    }
  }
});
