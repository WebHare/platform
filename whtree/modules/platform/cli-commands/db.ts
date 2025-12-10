import { readPlatformConf } from "@mod-platform/js/configure/axioms";
import { enumOption, intOption, run } from "@webhare/cli";
import { toFSPath } from "@webhare/services";
import { pick } from "@webhare/std";
import { db, runInWork, sql } from "@webhare/whdb";
import { getSchemas, getTables } from "@webhare/whdb/src/introspection";
import { cancelBackend, getCurrentPGVersion, getDatabaseMonitorInfo, getDatabaseSequences, restartAllSequences } from "@webhare/whdb/src/management";
import { spawnSync } from "child_process";
import type { SelectQueryBuilder } from "kysely";

run({
  description: "Database management commands",
  flags: {
    // "v,verbose": "Show more info",
    "json": "Output in JSON format"
  },
  subCommands: {
    transactions: {
      description: "Show current database transactions",
      main: async function main({ opts, args }) {
        const info = await getDatabaseMonitorInfo();
        if (opts.json) {
          console.log(JSON.stringify(info.translist, null, 2));
        } else if (!info.translist.length) {
          console.log("No active transactions");
        } else {
          console.table(pick(info.translist, ["pid", "owner", "backendStart", "state"]));
        }
      }
    },
    locks: {
      description: "Manage database locks",
      main: async function main({ opts, args }) {
        const info = await getDatabaseMonitorInfo();
        if (opts.json) {
          console.log(JSON.stringify(info.blockingLocks, null, 2));
        } else if (!info.blockingLocks.length) {
          console.log("No blocking locks");
        } else {
          for (const lock of info.blockingLocks) {
            console.log(`Owner: ${lock.owner}`);
            console.log(` Transaction start: ${lock.transactionStart?.toString()}`);
            console.log(` Query start: ${lock.queryStart?.toString()}`);
            console.log(` PostgreSQL backend pid: ${lock.backend}`);
            if (lock.debuginfohint)
              console.log(` Debug info: ${lock.debuginfohint.split("\n").map((l, i) => (i === 0 ? "" : "             ") + l).join("\n")}`);
            for (const waiter of lock.waiters) {
              console.log(`  Waiter: ${waiter.owner}`);
              console.log(`   Transaction start: ${waiter.transactionStart?.toString()}`);
              console.log(`   Query start: ${waiter.queryStart?.toString()}`);
              console.log(`   PostgreSQL backend pid: ${waiter.backend}`);
              if (waiter.tuples.length)
                console.log(`    Locking row in table ${waiter.tuples.map(t => t.table).filter(t => t).join(", ")}`);
              if (waiter.debuginfohint)
                console.log(`   Debug info: ${waiter.debuginfohint.split("\n").map((l, i) => (i === 0 ? "" : "               ") + l).join("\n")}`);
            }
          }
        }
      }
    },
    sequences: {
      description: "List or reset sequences",
      flags: {
        "restart": "Restart all sequences to their start value"
      },
      main: async function main({ opts, args }) {
        if (opts.restart)
          await runInWork(() => restartAllSequences());

        const sequences = await getDatabaseSequences();
        if (opts.json) {
          console.log(JSON.stringify(sequences, null, 2));
        } else {
          console.table(sequences);
        }
      }
    },
    cancel: {
      description: "Cancel a running transaction (graceful)",
      flags: {
        "kill": "Kill the transaction instead of cancelling it"
      },
      arguments: [
        {
          name: "<pid>",
          description: "The PostgreSQL backend pid of the transaction to cancel",
          type: intOption({ start: 2 })
        }
      ],
      main: async function main({ opts, args }) {
        await cancelBackend(args.pid, { kill: opts.kill });
      }
    },
    upgrade: {
      description: "Upgrade the database to the latest version (if needed)",
      flags: {
        "dry-run": "Do not actually perform the upgrade, just run and time it"
      },
      options: {
        "set-version": {
          description: "The new major version to upgrade to, if not the recommended one",
          type: intOption({ start: 11 }),
        }
      },
      main: async function main({ opts, args }) {
        const curVersion = (await getCurrentPGVersion()).major;
        const expectVersion = opts.setVersion || parseInt((await readPlatformConf())["postgres_recommended_major"]);
        if (!opts.setVersion && curVersion >= expectVersion) { //ignore same-version if you explicitly select a version
          console.log(`Your database is already at PostgreSQL ${curVersion}, no upgrade needed`);
          return;
        }

        const start = Date.now();
        const result = spawnSync(toFSPath("mod::platform/cli-commands/lib/dump-restore-database.sh"),
          [...opts.dryRun ? ["--dry-run"] : [], "--set-version", expectVersion.toString()], { stdio: "inherit" });

        if (result.status === 0) {
          console.log("Total time: " + ((Date.now() - start) / 1000).toFixed(3) + " seconds");
        } else {
          console.error(opts.dryRun ? "Upgrade failed" : "Upgrade failed - you may need to restart WebHare to exit read-only mode! (wh service relaunch)");
          process.exit(result.status || 1);
        }
      }
    },
    showusage: {
      description: "Show database usage and size per table (deduplicates blobs only within tables)",
      options: {
        format: {
          type: enumOption(["table", "json"]),
          description: "Output format",
          default: "table",
        }
      },
      async main({ opts }) {
        const results: {
          tableName: string;
          totalsize: number;
          tablesize: number;
          indexessize: number;
          liverowestimate: number;
          blobSize: number;
          dedupBlobSize: number;
          blobCount: number;
        }[] = [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const blobType = await db<any>()
          .selectFrom("pg_catalog.pg_type as t")
          .innerJoin("pg_catalog.pg_namespace as n", "t.typnamespace", "n.oid")
          .innerJoin("pg_catalog.pg_proc as p", "t.typinput", "p.oid")
          .select(["t.oid", "t.typname"])
          .where("n.nspname", "=", "webhare_internal")
          .where("t.typname", "=", "webhare_blob")
          .where("p.proname", "=", "record_in")
          .executeTakeFirst();


        for (const schema of await getSchemas()) {
          for (const table of await getTables(schema.schemaName)) {
            const size = await db()
              .selectNoFrom([
                sql<number>`pg_total_relation_size(${table.oid})`.as("totalsize"),
                sql<number>`pg_relation_size(${table.oid})`.as("tablesize"),
                sql<number>`pg_indexes_size(${table.oid})`.as("indexessize"),
                sql<number>`pg_stat_get_live_tuples(${table.oid})`.as("liverowestimate"),
              ])
              .executeTakeFirst();

            if (size) {
              let blobSize = 0, dedupBlobSize = 0, blobCount = 0;
              if (blobType) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const attrs = await db<any>()
                  .selectFrom("pg_attribute")
                  .select(["attname", "atttypid"])
                  .where("attrelid", "=", table.oid)
                  .where("attnum", ">", 0)
                  .where("attisdropped", "=", false)
                  .where("atttypid", "=", blobType.oid)
                  .execute();

                type AttrQuery = SelectQueryBuilder<{ t: unknown }, "t", {
                  data: { id: string; size: number };
                }>;

                const attrUnionQuery = attrs.reduce((dbQuery: AttrQuery | null, attr) => {
                  const attrQuery = db()
                    .selectFrom(sql.table(schema.schemaName + "." + table.tableName).as("t"))
                    .select(sql.ref<{ id: string; size: number }>(attr.attname).as("data"))
                    .where(sql.ref(attr.attname), `is not`, null);
                  return dbQuery ? dbQuery.unionAll(attrQuery) : attrQuery;
                }, null);

                if (attrUnionQuery) {
                  // Deduplicated blobs by id
                  const allBlobsQuery = db()
                    .selectFrom(attrUnionQuery.as("allblobs"))
                    .select([
                      sql<number>`SUM((data).size)`.as("size"),
                      sql<number>`MIN((data).size)`.as("dedupsize"),
                      sql<number>`COUNT(*)`.as("count"),
                    ])
                    .groupBy(sql`(data).id`);

                  // And get the sums
                  const blobSizeRec = await db()
                    .selectFrom(allBlobsQuery.as("sub"))
                    .select([
                      sql<number>`SUM(size)::int8`.as("totalsize"),
                      sql<number>`SUM(dedupsize)::int8`.as("dedupsize"),
                      sql<number>`COUNT(*)`.as("blobcount"),
                    ])
                    .executeTakeFirst();

                  if (blobSizeRec) {
                    size.totalsize += blobSizeRec.dedupsize || 0;
                    blobSize += blobSizeRec.totalsize || 0;
                    dedupBlobSize += blobSizeRec.dedupsize || 0;
                    blobCount += blobSizeRec.blobcount || 0;
                  }
                }
              }

              results.push({
                tableName: `${schema.schemaName}.${table.tableName}`,
                ...size,
                blobSize,
                dedupBlobSize,
                blobCount,
              });
            }
          }
        }
        results.sort((a, b) => b.totalsize - a.totalsize);
        if (opts.format === "json")
          console.log(JSON.stringify(results, null, 2));
        else {
          console.table(results.map(r => ({
            tableName: r.tableName,
            totalSizeMB: (r.totalsize / (1024 * 1024)).toFixed(3) + " MB",
            tableSizeMB: (r.tablesize / (1024 * 1024)).toFixed(3) + " MB",
            indexesSizeMB: (r.indexessize / (1024 * 1024)).toFixed(3) + " MB",
            blobSizeMB: (r.blobSize / (1024 * 1024)).toFixed(3) + " MB",
            dedupBlobSizeMB: (r.dedupBlobSize / (1024 * 1024)).toFixed(3) + " MB",
            liveRowEstimate: r.liverowestimate
          })));
        }
      }
    }
  }
});
