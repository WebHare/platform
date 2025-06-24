import { buildPxlParser, type PxlDocType } from '@mod-platform/js/logging/pxllog';
import { openCatalog, type Catalog } from '@webhare/consilio';
import { lockMutex, readLogLines } from '@webhare/services';
import { beginWork, commitWork } from '@webhare/whdb';
import { run } from "@webhare/cli";

async function getContinueAfter(catalog: Catalog<PxlDocType>): Promise<string | undefined> {
  const lastinsertion = await catalog.search({
    body: {
      _source: ["@timestamp"],
      sort: [{ "@timestamp": { order: "desc" } }],
      size: 1
    }
  });

  return lastinsertion.hits.hits[0]?._id || undefined;
}

function pickFields(logline: PxlDocType) {
  return Object.fromEntries(Object.entries(logline).filter(([key]) => ["@timestamp", "event"].includes(key) || key.startsWith("mod_")));
}

run({
  description: "Index new pxl log lines",
  flags: {
    "fields": { description: "Show events and fields being indexed" },
    "rejected": { description: "Show rejected log lines" }
  },
  options: {
    "since": { description: "Reprocess loglines since this date" }
  },
  main: async ({ args, opts }) => {
    // Make sure only one instance of this script is running
    using lock = await lockMutex("platform:updatepxllog", { timeout: 0 });
    if (!lock) {
      console.error("Another updatepxllog script is already running");
      return;
    }

    const catalog = await openCatalog<PxlDocType>("platform:pxl");
    await beginWork();
    if ((await catalog.listAttachedIndices()).length === 0) //TODO merge this into applyConfiguration ?
      await catalog.attachIndex();
    await commitWork();

    const parser = await buildPxlParser();

    const inserter = catalog.startBulkAction();
    let start: Date | null = null;
    if (opts.since) {
      start = new Date(opts.since);
      if (!start.getTime()) {
        console.error(`Invalid date '${opts.since}' specified`);
        return;
      }
    }
    for await (const logline of readLogLines('platform:pxl', start ? { start } : { continueAfter: await getContinueAfter(catalog) })) {
      const parsed = parser.parseLine(logline);
      if (parsed) {
        if (opts.fields)
          console.log(JSON.stringify(pickFields(parsed)));

        const inzone = parsed['@timestamp'].toZonedDateTimeISO('UTC');
        const suffix = `${inzone.year}-${String(inzone.month).padStart(2, '0')}`;
        if (!suffix.match(/^\d{4}-\d{2}$/))
          throw new Error(`Internal error, calculated invalid suffix ${suffix}`);
        await inserter.index(parsed, { suffix });
      } else if (opts.rejected) {
        console.error(`Rejected: ${JSON.stringify(logline)}`);
      }
    }

    await inserter.finish();
  }
});
