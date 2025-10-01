import { readPlatformConf } from "@mod-platform/js/configure/axioms";
import { intOption, run } from "@webhare/cli";
import { toFSPath } from "@webhare/services";
import { pick } from "@webhare/std";
import { runInWork } from "@webhare/whdb";
import { cancelBackend, getCurrentPGVersion, getDatabaseMonitorInfo, getDatabaseSequences, restartAllSequences } from "@webhare/whdb/src/management";
import { spawnSync } from "child_process";

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
        "dryrun": "Do not actually perform the upgrade, just run and time it"
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
          [...opts.dryrun ? "--dryrun" : [], "--set-version", expectVersion.toString()], { stdio: "inherit" });
        console.log(result.status);
        if (result.status === 0) {
          console.log("Total time: " + ((Date.now() - start) / 1000).toFixed(3) + " seconds");
        } else {
          console.error(opts.dryrun ? "Upgrade failed" : "Upgrade failed - you may need to restart WebHare to exit read-only mode! (wh service relaunch");
          process.exit(result.status || 1);
        }
      }
    }
  }
});
