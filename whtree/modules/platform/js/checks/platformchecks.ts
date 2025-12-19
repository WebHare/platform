import { backendConfig, type CheckResult } from "@webhare/services";
import { listDirectory } from "@webhare/system-tools";
import { query } from "@webhare/whdb";
import { getCurrentPGVersion } from "@webhare/whdb/src/management";
import { readPlatformConf } from "../configure/axioms";

async function checkPostgres(): Promise<CheckResult[]> {
  const issues: CheckResult[] = [];

  //warn if the transaction range shows vacuuming not working. you can also manually check this using `wh psql -c 'SELECT max(age(datfrozenxid)) FROM pg_database'`
  const maxidage = (await query<{ max: number }>("SELECT max(age(datfrozenxid)) as max FROM pg_database")).rows[0].max;
  if (maxidage >= 500_000_000) { //500 million is a good indication something is wrong
    issues.push({
      type: "system:checker.pg.toomanytransactionids",
      isCritical: true,
      messageText: `PostgreSQL reports ${maxidage} transaction ids in range, it may not be properly vacuuming`,
    });
  }

  const collation = (await query<{ datcollate: string }>("select datcollate from pg_database where datname=$1", [process.env.WEBHARE_DBASENAME])).rows[0].datcollate;
  if (collation !== "C") {
    issues.push({
      type: "system:checker.pg.collation",
      isCritical: true,
      messageText: `PostgreSQL reports it's in the '${collation}' collation, forcing a 'wh db upgrade' to the same vesrion may fix this`,
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

  const curVersion = (await getCurrentPGVersion()).major;
  const expectVersion = parseInt((await readPlatformConf())["postgres_recommended_major"]);
  if (curVersion <= 13 && process.platform === "darwin") { //then we assume you're using brew which has hard EOLed PG13: ' postgresql@13 has been deprecated! It will be disabled on 2026-03-01.'
    issues.push({
      type: "system:checker.pg.oldversion.brew",
      messageTid: { tid: /*tid*/ "platform:tolliumapps.dashboard.checks.errors.postgresql-oldversion-brew", params: [curVersion.toString()] },
      metadata: { currentVersion: curVersion },
      isCritical: true,
    });
  } else if (curVersion < expectVersion) {
    issues.push({
      type: "system:checker.pg.oldversion",
      messageTid: { tid: /*tid*/ "platform:tolliumapps.dashboard.checks.errors.postgresql-oldversion", params: [curVersion.toString(), expectVersion.toString()] },
      metadata: { currentVersion: curVersion, expectedVersion: expectVersion },
    });
  }

  for (const unusedDb of await listDirectory(backendConfig.dataRoot + "postgresql", { mask: "db.*" })) {
    if (unusedDb.name === "db.switchto") {
      issues.push({
        type: "system:checker.pg.switchto",
        messageTid: { tid: /*tid*/ "platform:tolliumapps.dashboard.checks.errors.postgresql-switchdb", params: [unusedDb.fullPath] },
        metadata: { path: unusedDb.fullPath }
      });
    } else if (!unusedDb.name.startsWith(`db.bak.`)) { //the db.bak.* archives will be removed automatically after some time
      issues.push({
        type: "system:checker.pg.unused",
        messageTid: { tid: /*tid*/ "platform:tolliumapps.dashboard.checks.errors.postgresql-unuseddb", params: [unusedDb.fullPath] },
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
