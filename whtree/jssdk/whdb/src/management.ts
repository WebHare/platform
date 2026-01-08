
import { getConnection, query, type WHDBConnectionImpl } from "./impl";
import { escapePGIdentifier } from "./metadata";

function decodePostgreSQLWHLogInfo(logline: string): {
  debuginfo: string;
  debuginfohint: string;
  debuginfotrace: { filename: string; line: number; col: number; func: string }[];
} {
  const retval = {
    debuginfo: "",
    debuginfohint: "",
    debuginfotrace: [] as { filename: string; line: number; col: number; func: string }[],
  };

  const r = new RegExp("^([^#]*)#([0-9]*)#([0-9]*)\\(([^)]*)\\)$");
  switch (logline.charAt(0)) {
    case "t": {
      const parts = logline.substring(2, logline.length - 1).split(",");
      retval.debuginfo = parts.find(p => p !== "mod::system/lib/database.whlib" && !p.startsWith("wh::dbase/") && !p.startsWith("wh::internal/trans")) ?? "";
      retval.debuginfohint = "Stack trace:\n" + parts.join("\n");
      for (const p of parts) {
        const matches = r.exec(p);
        if (matches) {
          retval.debuginfotrace.push({
            filename: matches[1],
            line: parseInt(matches[2], 10) || 1,
            col: parseInt(matches[3], 10) || 1,
            func: matches[4],
          });
        }
      }
      break;
    }
  }

  return retval;
}

export async function getDatabaseMonitorInfo() {
  const translist = (await query<{
    pid: number;
    usename: string;
    application_name: string;
    backend_start: string;
    query_start: string | null;
    xact_start: string | null;
    state: string;
    wait_event_type: string | null;
    query: string;
    backend_type: string | null;
  }>(`SELECT pid, usename, application_name, backend_start::text, query_start::text, xact_start::text, state, wait_event_type, query, backend_type
       FROM pg_stat_activity
   ORDER BY pid`)).rows.map(row => {
    let debuginfotxt = '';
    if (row.query?.startsWith('/?whlog:')) {
      const pos = row.query.indexOf('*/');
      debuginfotxt = row.query.substring(8, pos);
      row.query = row.query.substring(pos + 2);
    }
    return {
      pid: row.pid,
      state: row.state,
      query: row.query,
      owner: row.application_name || row.backend_type,
      backendStart: Temporal.Instant.from(row.backend_start).toString(),
      queryStart: row.query_start ? Temporal.Instant.from(row.query_start).toString() : null,
      transactionStart: row.xact_start ? Temporal.Instant.from(row.xact_start).toString() : null,
      ...decodePostgreSQLWHLogInfo(debuginfotxt)
    };
  });

  const locks = (await query<{
    locktype: string;
    database: number | null;
    relation: number | null;
    page: number | null;
    tuple: number | null;
    virtualxid: string | null;
    transactionid: number | null;
    classid: number | null;
    objid: number | null;
    objsubid: number | null;
    granted: boolean;
    pid: number;
  }>("SELECT * FROM pg_locks")).rows.map(lock => ({
    ...lock,
    hash: `${lock.locktype}.${lock.database}.${lock.relation}.${lock.page}.${lock.tuple}.${lock.virtualxid}.${lock.transactionid}.${lock.classid}.${lock.objid}.${lock.objsubid}`,
    transaction: translist.find(t => t.pid === lock.pid)
  }));

  const waitingLocks = locks.filter(l => !l.granted);
  const interestingTuples = locks.filter(_ => _.locktype === "tuple" && waitingLocks.some(dl => dl.pid === _.pid));
  const tupleTables = (await query<{
    relation: number;
    tablename: string;
  }>(`SELECT pg_class.oid AS relation, (pg_namespace.nspname || '.' || pg_class.relname) AS tablename
      FROM pg_class
      JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
      WHERE pg_class.oid = ANY($1::int[])
      ORDER BY pg_class.oid;`, [interestingTuples.map(t => t.relation!).filter(r => r !== null)])).rows;

  const blockingLocks = locks.filter(l => l.granted && waitingLocks.some(dl => dl.hash === l.hash));

  const finalBlockingLocks = [];
  for (const lock of blockingLocks) {
    const waiters = waitingLocks.filter(l => l.hash === lock.hash);

    finalBlockingLocks.push({
      owner: lock.transaction?.owner,
      backend: lock.pid,
      transactionStart: lock.transaction?.transactionStart,
      queryStart: lock.transaction?.queryStart,
      debuginfohint: lock.transaction?.debuginfohint,
      waiters: waiters.map(waiter => {
        const tuples = interestingTuples.filter(l => l.pid === waiter.pid).map(l => ({
          tuple: l.tuple,
          page: l.page,
          table: tupleTables.find(t => t.relation === l.relation)?.tablename,
        }));
        return {
          owner: waiter.transaction?.owner,
          backend: waiter.pid,
          transactionStart: waiter.transaction?.transactionStart,
          queryStart: waiter.transaction?.queryStart,
          debuginfohint: waiter.transaction?.debuginfohint,
          tuples
        };
      })
    });
  }


  //   RECORD ARRAY interesting_tuples:=
  //   SELECT *
  //   FROM alllocks
  //        WHERE locktype = "tuple"
  //          AND pid IN(SELECT AS INTEGER ARRAY pid FROM notgranted)
  //     ORDER BY pid;



  //   RECORD ARRAY alllocks:=
  //   SELECT TEMPORARY hash:= EncodeUFS(GetMD5Hash(EncodeHSON(CELL[locktype, database, relation, page, tuple, virtualxid, transactionid, classid, objid, objsubid])))
  //     , *
  //              , hash :=      hash
  //   , rowkey :=    `${pid},${hash}`
  //           FROM catalog.pg_locks
  //       ORDER BY hash;

  //   STRING ARRAY notgranted_hashes:= SELECT AS STRING ARRAY DISTINCT hash FROM alllocks WHERE NOT granted ORDER BY hash;

  //   RECORD ARRAY displaylocks:=
  //   SELECT *
  //   FROM alllocks
  //        WHERE hash IN notgranted_hashes;

  //   RECORD trans_default:=
  //   [usename := ""
  //     , application_name := ""
  //     , backend_start :=    DEFAULT DATETIME
  //     , query_start :=      DEFAULT DATETIME
  //     , xact_start :=       DEFAULT DATETIME
  //     , state :=            ""
  //     , wait_event_type :=  ""
  //     , query :=            ""
  //     , debuginfo :=        ""
  //     , debuginfohint :=    ""
  //     , debuginfotrace :=   RECORD[]
  //   ];

  // displaylocks:= JoinArrays(displaylocks, "pid", translist, trans_default);

  //   RECORD ARRAY notgranted:=
  //   SELECT *
  //   FROM displaylocks
  //        WHERE NOT granted
  //          AND hash IN notgranted_hashes;

  //   RECORD ARRAY blockinglocks:=
  //   SELECT *
  //   FROM displaylocks
  //        WHERE granted
  //          AND hash IN notgranted_hashes;


  //   RECORD ARRAY tupletables:=
  //   SELECT relation:= pg_class.oid
  //     , tablename :=   `${nspname}.${relname}`
  //         FROM catalog.pg_class
  //   , catalog.pg_namespace
  //        WHERE relnamespace = pg_namespace.oid
  //          AND pg_class.oid IN(SELECT AS INTEGER ARRAY relation FROM interesting_tuples)
  //     ORDER BY pg_class.oid;

  // interesting_tuples:= JoinArrays(interesting_tuples, "relation", tupletables, [tablename := ""]);

  // FOREVERY(RECORD rec FROM notgranted)
  // {
  //     RECORD ARRAY tuples:= RecordRange(interesting_tuples, rec, ["PID"]);
  //     STRING tables:= Detokenize(
  //   (SELECT AS STRING ARRAY DISTINCT tablename
  //            FROM tuples
  //        ORDER BY tablename), ", ");
  //     INSERT CELL tuples:= tuples INTO notgranted[#rec];
  //     INSERT CELL tables:= tables INTO notgranted[#rec];
  // }

  // blockinglocks:=
  //   SELECT *
  //            , waiters :=   RecordRange(notgranted, blockinglocks, ["HASH"])
  //         FROM blockinglocks;

  return {
    translist,
    blockingLocks: finalBlockingLocks,
    ownPid: (getConnection() as WHDBConnectionImpl).client?.getBackendProcessId(),
  };
}

export async function getDatabaseSequences() {
  const dbSeqs = await query<{
    nspname: string;
    relname: string;
  }>(`select n.nspname, c.relname
        from pg_class AS c,
              pg_namespace AS n
        where c.relkind='S' and n.oid = c.relnamespace
    order by n.nspname, c.relname;`);

  const sequences = [];

  for (const seq of dbSeqs.rows) {
    const seqinfo = await query<{
      last_value: string;
      is_called: boolean;
    }>(`SELECT * FROM ${escapePGIdentifier(seq.nspname)}.${escapePGIdentifier(seq.relname)}`);

    sequences.push({
      schema: seq.nspname,
      sequence: seq.relname,
      lastValue: seqinfo.rows[0]?.last_value,
      isCalled: seqinfo.rows[0]?.is_called,
    });
  }

  return sequences;
}

export async function restartAllSequences() {
  for (const seq of (await getDatabaseSequences())) {
    await query(`ALTER SEQUENCE ${escapePGIdentifier(seq.schema)}.${escapePGIdentifier(seq.sequence)} RESTART`);
  }
}

export async function cancelBackend(pid: number, options?: { kill?: boolean }) {
  if (options?.kill) {
    await query(`SELECT pg_terminate_backend($1)`, [pid]);
  } else {
    await query(`SELECT pg_cancel_backend($1)`, [pid]);
  }
}

export async function getCurrentPGVersion() {
  const res = await query<{ server_version_num: number }>("SHOW server_version_num");
  return { major: res.rows[0].server_version_num / 10000 | 0, minor: (res.rows[0].server_version_num % 10000) };
}
