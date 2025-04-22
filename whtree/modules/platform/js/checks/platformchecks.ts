import { dtapStage } from "@webhare/env";
import { backendConfig, type CheckResult } from "@webhare/services";
import { listDirectory } from "@webhare/system-tools";
import { query } from "@webhare/whdb";
import { readFile } from "node:fs/promises";

async function readPlatformConf(): Promise<Record<string, string>> {
  const source = await readFile(backendConfig.installationRoot + "etc/platform.conf", "utf8");
  const result: Record<string, string> = {};
  for (const line of source.split("\n")) {
    const [key, value] = line.split("=");
    if (key.trim().startsWith("#") || !value || !value.trim())
      continue;

    result[key.trim()] = value.trim();
  }

  return result;
}

async function checkPostgres(): Promise<CheckResult[]> {
  const issues: CheckResult[] = [];

  //warn if the transaction range shows vacuuming not working. you can also manually check this using `wh psql -c 'SELECT max(age(datfrozenxid)) FROM pg_database'`
  const maxidage = (await query<{ max: number }>("SELECT max(age(datfrozenxid)) as max FROM pg_database")).rows[0].max;
  if (maxidage >= 500_000_000) { //500 million is a good indication something is wrong
    issues.push({
      type: "system:checker.pg.toomanytransactionids",
      messageText: `PostgreSQL reports ${maxidage} transaction ids in range, it may not be properly vacuuming`,
    });
  }

  const collation = (await query<{ datcollate: string }>("select datcollate from pg_database where datname=$1", [process.env.WEBHARE_DBASENAME])).rows[0].datcollate;
  if (collation !== "C") {
    issues.push({
      type: "system:checker.pg.collation",
      messageText: `PostgreSQL reports it's in the '${collation}' collation, you need to 'wh dump-restore-database' as soon as possible`,
    });
  }

  const connections = (await query<{ count: number }>("SELECT COUNT(*) FROM pg_stat_activity")).rows[0].count;
  const max_connections = (await query<{ max_connections: number }>("SHOW max_connections")).rows[0].max_connections;
  if (connections >= max_connections / 2) {
    issues.push({
      type: "system:checker.pg.toomanyconnections",
      messageText: `PostgreSQL reports ${connections}/${max_connections} active connections, it might be running out of connections soon`,
    });
  }

  const curVersion = parseInt(await readFile(backendConfig.dataRoot + "postgresql/db/PG_VERSION", "utf8"));
  const expectVersion = (await readPlatformConf());
  if (curVersion < parseInt(expectVersion["postgres_major"]) && dtapStage === "development") { //TODO stop limiting to development
    issues.push({
      type: "system:checker.pg.oldversion",
      messageText: `You are running PostgreSQL ${curVersion} but version ${expectVersion["postgres_major"]} is recommended, you should upgrade soon`,
    });
  }

  for (const unusedDb of await listDirectory(backendConfig.dataRoot + "postgresql", { mask: "db.*" })) {
    if (unusedDb.name === "db.switchto") {
      issues.push({
        type: "system:checker.pg.switchto",
        messageText: `Your database server needs to be restarted to activate a restored/migrated database in ${unusedDb.fullPath}`,
      });
    } else {
      issues.push({
        type: "system:checker.pg.unused",
        messageText: `It looks like a previous migration backup can be removed in ${unusedDb.fullPath} - use \`wh remove-old-databases\` to clean up`,
      });
    }
  }

  return issues;
}

/** Check essential platform things */
export async function checkPlatform(): Promise<CheckResult[]> {
  return [...await checkPostgres()];
}

// checkPlatform().then(issues => console.log({ issues }));
// readPlatformConf().then(console.log);
