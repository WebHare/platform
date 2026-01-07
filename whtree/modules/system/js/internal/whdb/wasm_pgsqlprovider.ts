import { beginWork, commitWork, db, rollbackWork, uploadBlob, isWorkOpen, overrideQueryArgType } from "@webhare/whdb";
import { getConnection, type WHDBConnectionImpl } from "@webhare/whdb/src/impl";
import { type AliasedRawBuilder, type RawBuilder, sql, type Expression, type SqlBool } from 'kysely';
import { VariableType, getTypedArray } from "../whmanager/hsmarshalling";
import type { FullPostgresQueryResult } from "@webhare/whdb/src/connection";
import { defaultDateTime, maxDateTime } from "@webhare/hscompat/src/datetime";
import type { Tid } from "@webhare/whdb/src/postgrejs-types";
import type { WASMModule } from "@webhare/harescript/src/wasm-modulesupport";
import type { HareScriptVM, HSVM_VariableId, HSVM_VariableType } from "@webhare/harescript/src/wasm-hsvm";
import { HSVMVar } from "@webhare/harescript/src/wasm-hsvmvar";
import type { Money } from "@webhare/std";
import { WebHareBlob } from "@webhare/services/src/webhareblob";

enum Fases {
  None = 0,
  Fase1 = 1,
  Fase2 = 2,
  Recheck = 4,
  Updated = 8,
}

enum ColumnFlags {
  None = 0x00000000,
  InternalFase1 = 0x00000001, ///< Retrieved in fase1; may NOT be used by database providers; other means for this are provided.
  InternalFase2 = 0x00000002, ///< Retrieved in fase2; may NOT be used by database providers; other means for this are provided.
  InternalUpdates = 0x00000004, ///< Marked for update; may NOT be used by database providers; other means for this are provided.
  Key = 0x00000008, ///< Is part of the key for this table
  TranslateNulls = 0x00000010, ///< Has NULL translation
  ReadOnly = 0x00000020, ///< Is readonly
  WarnUnindexed = 0x00000040, ///< This column cannot be indexed by the database
  MaskExcludeInternal = 0x00000078, ///< mask to mask out internal fields
  InternalUsedInCondition = 0x00000080, ///< Used within SQLLib handled conditions
  Binary = 0x00000100, ///< Column contains binary data
}

enum OID {
  unknown = 0,
  BOOL = 16,
  BYTEA = 17,
  CHAR = 18,
  NAME = 19,
  INT2VECTOR = 22,
  TEXT = 25,
  OIDVECTOR = 30,
  VARCHAR = 1043,
  INT8 = 20,
  INT2 = 21,
  INT4 = 23,
  REGPROC = 24,
  OID = 26, // eslint-disable-line @typescript-eslint/no-shadow
  TID = 27,
  XID = 28,
  CID = 29,
  CIDR = 650,
  FLOAT4 = 700,
  FLOAT8 = 701,
  INET = 869,
  BOOLARRAY = 1000,
  BYTEAARRAY = 1001,
  CHARARRAY = 1002,
  INT2ARRAY = 1005,
  INT4ARRAY = 1007,
  INT8ARRAY = 1016,
  TEXTARRAY = 1009,
  FLOAT8ARRAY = 1022,
  TIMESTAMPARRAY = 1115,
  OIDARRAY = 1028,
  TIDARRAY = 1010,
  TIMESTAMP = 1114,
  TIMESTAMPTZ = 1184,
  NUMERICARRAY = 1231,
  NUMERIC = 1700,
  ANY = 2276,
  ANYARRAY = 2277,
  RECORD = 2249,
  RECORDARRAY = 2287,
}

type Condition = "<" | "<=" | "=" | ">" | ">=" | "!=" | "LIKE" | "IN";

interface SingleCondition {
  single: true;
  handled: boolean;
  tableid: number;
  columnid: number;
  condition: Condition;
  casesensitive: boolean;
  match_null: boolean;
  value: unknown;
}

type Query = {
  type: "SELECT" | "DELETE" | "UPDATE";
  query_limit: number;
  maxblockrows: number;
  has_fase1_hscode: boolean;
  tablesources: Array<{
    name: string;
    columns: Array<{
      name: string;
      dbase_name: string;
      type: VariableType;
      flags: ColumnFlags;
      fase: Fases;
      nulldefault: unknown;
      nulldefault_valid: boolean;
    }>;
  }>;//[ { name: 'SYSTEM.FS_OBJECTS', columns: [Array] } ],
  singleconditions: SingleCondition[];
  joinconditions: Array<{
    single: false;
    handled: boolean;
    table1_id: number;
    t1_columnid: number;
    table2_id: number;
    t2_columnid: number;
    condition: Condition;
    casesensitive: boolean;
    match_double_null: boolean;
  }>;
};

function buildComparison(left: RawBuilder<unknown>, condition: Condition, right: RawBuilder<unknown>): Expression<SqlBool> {
  switch (condition) {
    case "<": return sql`${left} < ${right}`;
    case "<=": return sql`${left} <= ${right}`;
    case "=": return sql`${left} = ${right}`;
    case ">": return sql`${left} > ${right}`;
    case ">=": return sql`${left} >= ${right}`;
    case "!=": return sql`${left} <> ${right}`;
    case "LIKE": return sql`${left} LIKE ${right}`;
    case "IN": return sql`${left} = ${right}`;
  }
}

function buildSwappedComparison(left: RawBuilder<unknown>, condition: Condition, right: RawBuilder<unknown>): Expression<SqlBool> {
  switch (condition) {
    case "<": return sql`${left} > ${right}`;
    case "<=": return sql`${left} >= ${right}`;
    case "=": return sql`${left} = ${right}`;
    case ">": return sql`${left} < ${right}`;
    case ">=": return sql`${left} <= ${right}`;
    case "!=": return sql`${left} <> ${right}`;
  }
  throw new Error(`Cannot swap arguments to ${condition}`);
}

function getConditionValue(query: Query, cond: SingleCondition, condidx: number, queryparam: HSVMVar) {
  const column = query.tablesources[cond.tableid].columns[cond.columnid];
  if (!(column.flags & ColumnFlags.Binary)) {
    if (cond.value instanceof Date)
      if (cond.value.getTime() === defaultDateTime.getTime())
        return sql`'-infinity'::timestamp`;
      else if (cond.value.getTime() === maxDateTime.getTime())
        return sql`'infinity'::timestamp`;

    return cond.value;
  }

  //get the binary value from the original HS value
  const originalvalue = queryparam.getCell("singleconditions")!.arrayGetRef(condidx)!.getCell("value")!;
  if (originalvalue.getType() === VariableType.String)
    return originalvalue.getStringAsBuffer();

  if (originalvalue.getType() === VariableType.StringArray) {
    const bufferarray = new Array<Buffer>;
    const len = originalvalue.arrayLength();
    for (let idx = 0; idx < len; ++idx)
      bufferarray.push(originalvalue.arrayGetRef(idx)!.getStringAsBuffer());

    return bufferarray;
  }

  throw new Error(`Unrecognized input type '${VariableType[originalvalue.getType()]}' for binary value`);
}

function encodePattern(mask: string) {
  return mask.replace(/([_%\\])/g, `\\$1`).replace(/\?/g, "_").replace(/\*/g, "%");
}

async function cbExecuteQuery(vm: HareScriptVM, id_set: HSVMVar, queryparam: HSVMVar, newfields: HSVMVar) {
  //console.log(query);
  //console.log(query.tablesources[0].columns);
  const query = queryparam.getJSValue() as Query;
  const whdb = db();

  vm.wasmmodule._HSVM_SetDefault(vm.hsvm, id_set.id, VariableType.Record as HSVM_VariableType);
  const recarray_tabledata = vm.wasmmodule._HSVM_RecordCreate(vm.hsvm, id_set.id, vm.getColumnId("tabledata"));
  vm.wasmmodule._HSVM_SetDefault(vm.hsvm, recarray_tabledata, VariableType.RecordArray as HSVM_VariableType);
  const recarray_rowsdata = vm.wasmmodule._HSVM_RecordCreate(vm.hsvm, id_set.id, vm.getColumnId("rowsdata"));
  vm.wasmmodule._HSVM_SetDefault(vm.hsvm, recarray_rowsdata, VariableType.RecordArray as HSVM_VariableType);

  for (const cond of query.singleconditions) {
    const column = query.tablesources[cond.tableid].columns[cond.columnid];
    cond.handled = column.type !== VariableType.Blob;
    if (cond.condition === "IN" && ![VariableType.Integer, VariableType.Integer64, VariableType.String].includes(column.type)) //TODO readd VariableType.DateTime but we also need to deal with infinities then (see wh runtest wh.database.wasm.primitivevalues)
      cond.handled = false;
    if ((cond.condition === "LIKE" || !cond.casesensitive) && (column.flags & ColumnFlags.Binary))
      cond.handled = false;
    if (!cond.handled)
      column.fase = Fases.Fase1 | Fases.Recheck;
    else
      column.fase = column.fase | Fases.Recheck;
  }

  for (const cond of query.joinconditions) {
    const column1 = query.tablesources[cond.table1_id].columns[cond.t1_columnid];
    const column2 = query.tablesources[cond.table2_id].columns[cond.t2_columnid];
    cond.handled = cond.casesensitive &&
      cond.condition !== "LIKE" &&
      cond.condition !== "IN" &&
      column1.type !== VariableType.Blob &&
      column2.type !== VariableType.Blob;
    if (!cond.handled) {
      column1.fase = Fases.Fase1 | Fases.Recheck;
      column2.fase = Fases.Fase1 | Fases.Recheck;
    } else {
      column1.fase = column1.fase | Fases.Recheck;
      column2.fase = column2.fase | Fases.Recheck;
    }
  }

  const allhandled = query.singleconditions.every(c => c.handled) && query.joinconditions.every(c => c.handled);

  function getTableAndColumnExpression(tableidx: number, column: Query["tablesources"][number]["columns"][number]) {
    const tableid = `T${tableidx}`;
    let expr = sql.ref(`${tableid}.${column.dbase_name}`);
    switch (`${query.tablesources[tableidx].name.toLowerCase()}-${column.dbase_name.toLowerCase()}`) {
      case "system.sites-webroot": {
        expr = sql`webhare_proc_sites_webroot(${sql.table(tableid)}."outputweb", ${sql.table(tableid)}."outputfolder")`;
      } break;
      case "system.fs_objects-fullpath": {
        expr = sql`webhare_proc_fs_objects_fullpath(${sql.table(tableid)}."id", ${sql.table(tableid)}."isfolder")`;
      } break;
      case "system.fs_objects-highestparent": {
        expr = sql`webhare_proc_fs_objects_highestparent(${sql.table(tableid)}."id")`;
      } break;
      case "system.fs_objects-indexurl": {
        expr = sql`webhare_proc_fs_objects_indexurl(${sql.table(tableid)}."id", ${sql.table(tableid)}."name", ${sql.table(tableid)}."isfolder", ${sql.table(tableid)}."parent", ${sql.table(tableid)}."published", ${sql.table(tableid)}."type", ${sql.table(tableid)}."externallink", ${sql.table(tableid)}."filelink", ${sql.table(tableid)}."indexdoc")`;
      } break;
      case "system.fs_objects-isactive": {
        expr = sql`webhare_proc_fs_objects_isactive(${sql.table(tableid)}."id")`;
      } break;
      case "system.fs_objects-publish": {
        expr = sql`webhare_proc_fs_objects_publish(${sql.table(tableid)}."isfolder", ${sql.table(tableid)}."published")`;
      } break;
      case "system.fs_objects-url": {
        expr = sql`webhare_proc_fs_objects_url(${sql.table(tableid)}."id", ${sql.table(tableid)}."name", ${sql.table(tableid)}."isfolder", ${sql.table(tableid)}."parent", ${sql.table(tableid)}."published", ${sql.table(tableid)}."type", ${sql.table(tableid)}."externallink", ${sql.table(tableid)}."filelink")`;
      } break;
      case "system.fs_objects-whfspath": {
        expr = sql`webhare_proc_fs_objects_whfspath(${sql.table(tableid)}."id", ${sql.table(tableid)}."isfolder")`;
      } break;
    }
    return expr;
  }

  const resultcolumns: Array<{ exportName: string; tableid: number; queryName: string; type: VariableType; flags: ColumnFlags; expr: RawBuilder<unknown> | AliasedRawBuilder<unknown, string> }> = [];
  const resultcolumnsfase2: Array<{ exportName: string; tableid: number; queryName: string; type: VariableType; flags: ColumnFlags; expr: RawBuilder<unknown> | AliasedRawBuilder<unknown, string> }> = [];
  const updatecolumns: Array<{ colname: string; tableid: number; rename: string }> = [];
  let fase2keys = new Array<RawBuilder<unknown>>;
  let keycolumn: number | null = null;

  let usefase2 = false;


  if (query.type !== "SELECT") {
    // For updating queries, get the 'ctid' column as column 0
    resultcolumns.push({ tableid: -1, queryName: "ctid", exportName: "ctid", type: VariableType.Record, flags: 0, expr: sql.ref(`T0.ctid`) });
    resultcolumnsfase2.push({ tableid: -1, queryName: "ctid", exportName: "ctid", type: VariableType.Record, flags: 0, expr: sql.ref(`T0.ctid`) });
    // in fase2, the row position is returned as column 1

    for (const column of query.tablesources[0].columns) {
      if (column.flags & ColumnFlags.Key)
        fase2keys.push(getTableAndColumnExpression(0, column));
    }

    /* Only need fase2 if some conditions (HareScript code or single/joinconditions)
       can't be checked by PostgreSQL
    */
    const need_fase2 = query.has_fase1_hscode || !allhandled;

    /* Can't get lookups for multiple columns to work, so using fase2 is off in
       that case. Comparing anonymous records returns a 'comparison not implemented'
       error
    */
    if (fase2keys.length === 1 && need_fase2) {
      // querydata.keycolumn will be filled during result column building
      usefase2 = true;
    } else {
      fase2keys = [sql`T0.ctid`];
      keycolumn = 0;
    }
    //resultcolumnsfase2[1].expr = fase2keys[0];
    resultcolumnsfase2.push({ tableid: -1, queryName: "rowpos", exportName: "rowpos", type: VariableType.Integer, flags: 0, expr: sql``.as(sql`rowpos`) }); // filled in later!
  }

  // FIXME: Rob says: fase2 retrieval is not implemented, see if we really need it anyway
  usefase2 = false;

  const tables = new Array<AliasedRawBuilder<unknown, `T${number}`>>();
  //const select = new Array<AliasedRawBuilder<unknown, `c${number}`>>();
  //const selectfase2cols = new Array<AliasedRawBuilder<unknown, `c${number}`>>();

  let colIdCounter = 0;
  let updatingkey = false;

  for (const [idx, tbl] of query.tablesources.entries()) {
    tables.push(sql.table(tbl.name.toLowerCase()).as(`T${idx}`));
    for (const col of tbl.columns) {
      if (!usefase2) {
        // For SELECT or when fase2 isn't used, do everything in fase 1
        if (col.fase & Fases.Fase2) {
          col.fase |= Fases.Fase1;
          col.fase &= ~Fases.Fase2;
        }
      } else {
        if (col.flags & ColumnFlags.Key) {
          // for update and delete, we need the primary key in fase 1 for the fase2 lookup
          col.fase |= Fases.Fase1;
        }

        // We'll return everthing in fase2, registering that is needed for correct null translation
        if (col.fase & (Fases.Fase1 | Fases.Recheck))
          col.fase |= Fases.Fase2;
      }


      // Any interaction?
      if (col.fase & (Fases.Fase1 | Fases.Fase2 | Fases.Recheck)) {
        const queryName = `c${colIdCounter++}` as const;
        const expr = getTableAndColumnExpression(idx, col).as(queryName);

        const rcol = {
          tableid: idx,
          queryName,
          exportName: col.name,
          flags: col.flags,
          type: col.type,
          expr,
        };

        if (col.fase & Fases.Fase1) {
          if ((col.flags & ColumnFlags.Key) && usefase2) {
            // INV: exactly one key column present in list, and Fase1 is set for it
            keycolumn = resultcolumns.length;
          }

          resultcolumns.push(rcol);

          if (usefase2) {
            // We're abusing fase2 for re-getting locked rows, so always reget fase1 cols in fase2
            resultcolumnsfase2.push(rcol);
          }
        } else if (usefase2 && (col.fase & (Fases.Fase1 | Fases.Fase2 | Fases.Recheck))) {
          resultcolumnsfase2.push(rcol);
        }
      }

      if (col.fase & Fases.Updated) {
        const ucol = {
          colname: col.name,
          rename: col.dbase_name,
          tableid: idx,
        };
        updatecolumns.push(ucol);

        if (col.flags & ColumnFlags.Key)
          updatingkey = true;
      }
    }
  }

  const conditions = new Array<Expression<SqlBool>>();

  for (let condidx = 0; condidx < query.singleconditions.length; ++condidx) {
    const cond = query.singleconditions[condidx];
    if (!cond.handled)
      continue;
    const column = query.tablesources[cond.tableid].columns[cond.columnid];
    const value = getConditionValue(query, cond, condidx, queryparam);

    const colref = getTableAndColumnExpression(cond.tableid, column);
    let colexpr = colref;
    if (!cond.casesensitive)
      colexpr = sql`upper(${colexpr})`;

    let valueexpr = sql.val(cond.condition === "LIKE" ? encodePattern(value as string) : value);
    if (cond.condition === "IN") {
      valueexpr = sql`Any(${valueexpr})`;
      if ((cond.value as unknown[]).length === 0)
        return; //an IN with empty value will never match
    }
    if (!cond.casesensitive)
      valueexpr = sql`upper(${valueexpr})`;

    let expr = buildComparison(colexpr, cond.condition, valueexpr);
    if (cond.match_null)
      expr = sql`((${colref} IS NULL) OR (${expr}))`; //extra parentheses as we're normally embedded in x AND y AND z...

    conditions.push(expr);
  }

  for (const cond of query.joinconditions) {
    if (!cond.handled)
      continue;
    const column1 = query.tablesources[cond.table1_id].columns[cond.t1_columnid];
    const colref1 = getTableAndColumnExpression(cond.table1_id, column1);
    const column2 = query.tablesources[cond.table2_id].columns[cond.t2_columnid];
    const colref2 = getTableAndColumnExpression(cond.table2_id, column2);

    let expr = buildComparison(colref1, cond.condition, colref2);
    if (cond.match_double_null) {
      // A primary key can't be NULL, so when a key is involved, this comparison isn't necessary
      if (!(column1.flags & ColumnFlags.Key) && !(column2.flags & ColumnFlags.Key))
        expr = sql`((${expr}) OR (${colref1} IS NULL AND ${colref2} IS NULL))`;
    } else {
      // One column has no null default, or the defaults differ
      if (column2.flags & ColumnFlags.TranslateNulls && column2.nulldefault_valid) {
        expr = sql`((${expr}) OR (${colref2} IS NULL AND ${buildComparison(colref1, cond.condition, sql.value(column2.nulldefault))}))`;
      }
      if (column1.flags & ColumnFlags.TranslateNulls && column1.nulldefault_valid) {
        expr = sql`((${expr}) OR (${colref1} IS NULL AND ${buildSwappedComparison(colref2, cond.condition, sql.value(column1.nulldefault))}))`;
      }
    }
    conditions.push(expr);
  }

  let updatedtable = "";

  let modifyend: RawBuilder<unknown> | undefined;
  if (query.type === "UPDATE" || query.type === "DELETE") {
    const fornokeyupdate = query.type === "UPDATE" && !updatingkey;
    updatedtable = query.tablesources[0].name;
    if (usefase2) {
      //resultcolumnsfase2[1].expr = sql`array_position($1, ${fase2key})`
    } else {
      modifyend = fornokeyupdate ? sql`for no key update` : sql`for update`;
    }
  }

  let dbquery = whdb
    .selectFrom(tables)
    .select(resultcolumns.map(r => r.expr as AliasedRawBuilder<unknown, string>));
  for (const cond of conditions)
    dbquery = dbquery.where(cond);
  if (query.query_limit >= 0 && allhandled)
    dbquery = dbquery.limit(query.query_limit);
  if (modifyend)
    dbquery = dbquery.modifyEnd(modifyend);

  if (resultcolumns.length === 0) { //we need to select something or the driver will crash. TODO will @webhare/postgrease fix this?
    dbquery = dbquery.select(sql`1`.as('c0'));
  }

  const res = await dbquery.execute();

  const prepped_resultcolumns = resultcolumns.map(col => ({ ...col, exportId: vm.getColumnId(col.exportName) }));

  //TODO Both cbExecuteQuery and cbExecuteSQL need to do some return type postprocessing to align with HS types, share!
  for (const row of res) {
    const tablerows = new Array<HSVM_VariableId>;

    for (let idx = 0; idx < query.tablesources.length; ++idx)
      tablerows.push(vm.wasmmodule._HSVM_ArrayAppend(vm.hsvm, recarray_tabledata));
    const rowsdata = vm.wasmmodule._HSVM_ArrayAppend(vm.hsvm, recarray_rowsdata);

    for (const col of prepped_resultcolumns) {
      const value = row[col.queryName];
      if (value === null && col.type !== VariableType.Blob && col.type !== VariableType.Integer64 && col.type !== VariableType.DateTime)
        continue; //not storing this null

      let store: HSVM_VariableId;
      if (col.tableid >= 0)
        store = vm.wasmmodule._HSVM_RecordCreate(vm.hsvm, tablerows[col.tableid], col.exportId);
      else
        store = vm.wasmmodule._HSVM_RecordCreate(vm.hsvm, rowsdata, col.exportId);

      switch (col.type) {
        case VariableType.Integer:
          vm.wasmmodule._HSVM_IntegerSet(vm.hsvm, store, value as number);
          break;
        case VariableType.Integer64:
          vm.wasmmodule._HSVM_Integer64Set(vm.hsvm, store, BigInt(value as number || 0));
          break;
        case VariableType.String:
          new HSVMVar(vm, store).setString(value as string | Buffer);
          break;
        case VariableType.Record: //ctid
          new HSVMVar(vm, store).setJSValue(value as string | Buffer);
          break;
        case VariableType.Boolean:
          vm.wasmmodule._HSVM_BooleanSet(vm.hsvm, store, value ? 1 : 0);
          break;
        case VariableType.HSMoney:
          new HSVMVar(vm, store).setMoney(value as Money);
          break;
        case VariableType.Float:
          vm.wasmmodule._HSVM_FloatSet(vm.hsvm, store, value as number);
          break;
        case VariableType.DateTime:
          new HSVMVar(vm, store).setDateTime(value === -Infinity ? defaultDateTime : value === Infinity ? maxDateTime : value as Date);
          break;
        case VariableType.IntegerArray:
          new HSVMVar(vm, store).setJSValue(value);
          break;
        case VariableType.Blob:
          if (value === null) {
            vm.wasmmodule._HSVM_SetDefault(vm.hsvm, store, VariableType.Blob as HSVM_VariableType);
            break;
          }
          new HSVMVar(vm, store).setJSValue(value);
          break;
        default:
          throw new Error(`Unrecognized type ${VariableType[col.type]} for cell '${col.exportName}'`);

        /*
              if (col.type === VariableType.Blob && value === null)
                value = new HareScriptMemoryBlob;
        */
      }
    }
  }

  // FIXME: use these columns
  void (keycolumn);
  void (updatedtable);
}

function cbIsWorkOpen(vm: HareScriptVM, id_set: HSVMVar) {
  id_set.setBoolean(isWorkOpen());
}

function cbHasMutex(vm: HareScriptVM, id_set: HSVMVar) {
  id_set.setBoolean(isWorkOpen());
}

async function cbDoBeginWork(vm: HareScriptVM, locks: HSVMVar) {
  await beginWork({ mutex: locks.getJSValue() as string[], __skipNameCheck: true });
}

//this needs to go through a syscall so we can WaitForPromise the commit. otherwise whdb.ts cannot invoke finish handlers in this VM
export async function cbDoFinishWork(vm: HareScriptVM, commit: boolean): Promise<void> {
  if (commit)
    await commitWork();
  else
    await rollbackWork();
}

export async function cbExecuteSQL(vm: HareScriptVM, id_set: HSVMVar, sqlquery: HSVMVar, options: HSVMVar) {
  const argencodings = options.getCell("argencodings")?.getJSValue() as string[] ?? [];
  const hsargs = options.getCell("args");
  const numhsargs = hsargs?.arrayLength() ?? 0;
  const args = [];

  for (let i = 0; i < numhsargs; ++i) {
    const hsarg = hsargs!.arrayGetRef(i)!;
    const type = hsarg.getType();
    const asBinary = i < argencodings.length && argencodings[i] === "binary";

    if (type === VariableType.String && asBinary)
      args.push(hsarg.getStringAsBuffer());
    else if (type === VariableType.StringArray && asBinary)
      args.push(hsarg.arrayContents().map(s => s.getStringAsBuffer()));
    else if (type === VariableType.Float)
      args.push(overrideQueryArgType(hsarg.getFloat(), "float8"));
    else {
      const val = hsarg.getJSValue();
      if (WebHareBlob.isWebHareBlob(val))
        await uploadBlob(val);

      args.push(val);
    }
  }

  const connection = getConnection() as WHDBConnectionImpl;
  type ResultRowType = Record<string, unknown>;
  const result = await connection.query(sqlquery.getString(), args) as FullPostgresQueryResult<ResultRowType>;

  //TODO Both cbExecuteQuery and cbExecuteSQL need to do some return type postprocessing to align with HS types, share!
  id_set.setDefault(VariableType.RecordArray);
  for (const row of result.rows) {
    const outrow = id_set.arrayAppend();

    for (const field of result.fields || []) {
      let value = row[field.fieldName];
      const store = outrow.ensureCell(field.fieldName);

      switch (field.dataTypeId) {
        case OID.BOOL:
          if (value === null)
            value = false;
          break;
        case OID.BYTEA:
        case OID.CHAR:
        case OID.NAME:
        case OID.TEXT:
        case OID.VARCHAR:
          if (value === null)
            value = "";
          break;
        case OID.INT2:
        case OID.CID:
        case OID.OID:
        case OID.REGPROC:
        case OID.XID:
        case OID.INT4:
          if (value === null)
            value = 0;
          break;
        case OID.FLOAT4:
        case OID.FLOAT8:
          store.setFloat(value as number || 0);
          continue; //SKIPS the usual 'just setJSValue'
        case OID.INT8:
          store.setInteger64(value as bigint | number || 0);
          continue; //SKIPS the usual 'just setJSValue'
        case OID.INT8ARRAY:
          if (value === null)
            value = [];
          value = getTypedArray(VariableType.Integer64Array, value as bigint[]);
          break;
        case OID.INT2VECTOR:
        case OID.OIDVECTOR:
          if (value === null)
            value = [];
          value = getTypedArray(VariableType.IntegerArray, value as number[]);
          break;

        // FIXME: port the rest too
      }
      store.setJSValue(value);
    }
  }
}

async function decodeNewFields(vm: HareScriptVM, query: Query, newfields: HSVMVar) {
  const values: Record<string, unknown> = {};
  for (const column of query.tablesources[0].columns)
    if (column.fase & Fases.Updated) {
      const cell = newfields.getCell(column.name);
      if (!cell)
        continue;

      //We'll manually get the individual cells so we can retrieve binary data where needed
      const setvalue = column.flags & ColumnFlags.Binary ? cell.getStringAsBuffer() : cell.getJSValue();
      if (WebHareBlob.isWebHareBlob(setvalue))
        await uploadBlob(setvalue);

      if (setvalue instanceof Date && setvalue.getTime() === defaultDateTime.getTime())
        values[column.dbase_name] = sql`'-infinity'::timestamp`;
      else
        values[column.dbase_name] = setvalue;
    }

  return values;
}

async function cbInsertRecord(vm: HareScriptVM, queryparam: HSVMVar, newfields: HSVMVar) {
  const query = queryparam.getJSValue() as Query;
  const values = await decodeNewFields(vm, query, newfields);

  const name = query.tablesources[0].name;
  const whdb = db<Record<string, unknown>>();
  await whdb.insertInto(name.toLowerCase()).values(values).execute();
}

async function cbInsertRecords(vm: HareScriptVM, queryparam: HSVMVar, newfields: HSVMVar) {
  const query = queryparam.getJSValue() as Query;
  const values = new Array<Promise<Record<string, unknown>>>;
  const len = newfields.arrayLength();
  for (let i = 0; i < len; ++i)
    values.push(decodeNewFields(vm, query, newfields.arrayGetRef(i) as HSVMVar));
  const resolvedValues = await Promise.all(values);

  const name = query.tablesources[0].name;
  const whdb = db<Record<string, unknown>>();
  await whdb.insertInto(name.toLowerCase()).values(resolvedValues).execute();
}

export async function cbUpdateRecord(vm: HareScriptVM, queryparam: HSVMVar, rowdataparam: HSVMVar, newfields: HSVMVar) {
  const query = queryparam.getJSValue() as Query;
  const rowdata = rowdataparam.getJSValue() as { ctid: Tid };
  const values = await decodeNewFields(vm, query, newfields);
  if (!Object.keys(values).length) //nothing to update!
    return;

  const whdb = db();
  await whdb
    .updateTable(sql.table(query.tablesources[0].name.toLowerCase()).as('T'))
    .set(values)
    .where(sql`ctid`, '=', rowdata.ctid)
    .execute();
}

export async function cbDeleteRecord(vm: HareScriptVM, queryparam: HSVMVar, rowdataparam: HSVMVar) {
  const query = queryparam.getJSValue() as Query;
  const rowdata = rowdataparam.getJSValue() as { ctid: Tid };

  const whdb = db();

  await whdb
    .deleteFrom(sql.table(query.tablesources[0].name.toLowerCase()).as('T'))
    .where(sql`ctid`, '=', rowdata.ctid)
    .execute();
}

export function registerPGSQLFunctions(wasmmodule: WASMModule) {
  wasmmodule.registerAsyncExternalMacro("__WASMPG_INSERTRECORD:::RR", cbInsertRecord);
  wasmmodule.registerAsyncExternalMacro("__WASMPG_INSERTRECORDS:::RRA", cbInsertRecords);
  wasmmodule.registerAsyncExternalMacro("__WASMPG_UPDATERECORD:::RRR", cbUpdateRecord);
  wasmmodule.registerAsyncExternalMacro("__WASMPG_DELETERECORD:::RR", cbDeleteRecord);
  wasmmodule.registerAsyncExternalFunction("__WASMPG_EXECUTEQUERY::R:R", cbExecuteQuery);
  wasmmodule.registerAsyncExternalFunction("__WASMPG_EXECUTESQL::RA:SR", cbExecuteSQL);
  wasmmodule.registerExternalFunction("__WASMPG_ISWORKOPEN::B:", cbIsWorkOpen);
  wasmmodule.registerExternalFunction("__WASMPG_HASMUTEX::B:S", cbHasMutex);
  wasmmodule.registerAsyncExternalMacro("__WASMPG_BEGINWORK:::SA", cbDoBeginWork);
}
