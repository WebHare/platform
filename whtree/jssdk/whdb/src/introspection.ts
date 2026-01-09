import { db } from "./impl";
import { pgTypeOid_bit, pgTypeOid_bpchar, pgTypeOid_varbit, pgTypeOid_varchar } from "./oids";
import type { PGMetaDB } from "./pgmetatables";
import { type RawBuilder, sql } from "kysely";

export async function getSchemas(): Promise<Array<{ schemaName: string; isSystemSchema: boolean }>> {
  return (await db<PGMetaDB>()
    .selectFrom("pg_catalog.pg_namespace")
    .select(["nspname"])
    .execute()).map(s => ({
      schemaName: s.nspname,
      isSystemSchema: s.nspname === "information_schema" || s.nspname.startsWith("pg_")
    }));
}

export async function getTables(schemaName: string): Promise<Array<{ oid: number; tableName: string; isView: boolean; primaryKeyName: string | null }>> {
  const tables = await db<PGMetaDB>()
    .selectFrom("pg_catalog.pg_namespace")
    .where("nspname", "=", schemaName)
    .innerJoin("pg_catalog.pg_class", (join) => join
      .onRef("pg_catalog.pg_namespace.oid", "=", "pg_catalog.pg_class.relnamespace")
    )
    .where("relkind", "in", ["r", "v", "m"])// table, view, materialized view
    // join with primary key contraints
    .leftJoin("pg_catalog.pg_constraint", (join) => join
      .onRef("conrelid", "=", "pg_catalog.pg_class.oid")
      .on("contype", "=", "p")
    )
    // join with attributes for primary key name
    .innerJoin("pg_catalog.pg_attribute",
      (join) => join
        .onRef("conrelid", "=", "attrelid")
        .onRef(sql`conkey[1]`, "=", "attnum")
    )
    .select(["pg_catalog.pg_class.oid", "relname", "relkind", "attname"])
    .execute();

  return tables.map(t => {
    return {
      oid: t.oid,
      tableName: t.relname,
      isView: ["v", "m"].includes(t.relkind),
      primaryKeyName: t.attname
    };
  });
}

function mapAction(indata: string): "no action" | "restrict" | "cascade" | "set null" | "set default" | null {
  switch (indata) {
    case "a": return "no action";
    case "r": return "restrict";
    case "c": return "cascade";
    case "n": return "set null";
    case "d": return "set default";
  }
  return null;
}

export type ColumnList = Array<{
  columnName: string;
  characterOctetLength: number;
  characterMaximumLength: number;
  isNullable: boolean;
  dataType: string;
  onDelete: "no action" | "restrict" | "cascade" | "set null" | "set default" | null;
  isUnique: boolean;
  referencedTableName: string | null;
  referencedTableSchema: string | null;
  referencedTableOid: number | null;
  autoNumberStart: number | null;
}>;

export async function getColumns(schemaName: string, tableName: string): Promise<ColumnList> {
  const tableQuery = db<PGMetaDB>()
    .selectFrom("pg_catalog.pg_namespace as tblns")
    .where("tblns.nspname", "=", schemaName)
    .innerJoin("pg_catalog.pg_class as tbl", (join) => join
      .onRef("tblns.oid", "=", "tbl.relnamespace")
      .on("tbl.relname", "=", tableName)
    );

  const constraints = await tableQuery
    .innerJoin("pg_catalog.pg_constraint", (join) => join
      .onRef("tbl.oid", "=", "conrelid")
    )
    .leftJoin("pg_catalog.pg_class as ftbl", (join) => join
      .onRef("ftbl.oid", "=", "confrelid")
    ).leftJoin("pg_catalog.pg_namespace as ftblns", (join) => join
      .onRef("ftbl.relnamespace", "=", "ftblns.oid")
    )
    .select([
      "conrelid",
      "contype",
      "confrelid",
      "conkey",
      "conname",
      "confdeltype",
      sql`pg_get_constraintdef(pg_catalog.pg_constraint.oid)`.as("check_expression"),
      "ftbl.relname",
      "ftblns.nspname",
    ])
    .execute();

  const rawColumns = await tableQuery
    .innerJoin("pg_catalog.pg_attribute", (join) => join
      .onRef("tbl.oid", "=", "attrelid")
      .on("attnum", ">", 0)
    )
    .innerJoin("pg_catalog.pg_type as attributetype", (join) => join
      .onRef("attributetype.oid", "=", "atttypid")
    )
    .innerJoin("pg_catalog.pg_namespace as typnamespace", (join) => join
      .onRef("typnamespace.oid", "=", "attributetype.typnamespace")
    )
    .select(["attname", "attlen", "atttypid", "atttypmod", "attnum", "attnotnull", "typname", "typnamespace.nspname"])
    .execute();

  const isColumns = await db<PGMetaDB>()
    .selectFrom("information_schema.columns")
    .where("table_schema", "=", schemaName)
    .where("table_name", "=", tableName)
    .select(["column_name", "identity_minimum", "column_default"])
    .execute();

  const retval: ColumnList = [];

  for (const rawColumn of rawColumns) {
    const attrConstraints = constraints.filter(constraint => constraint.conkey?.[0] === rawColumn.attnum);
    const foreignKey = attrConstraints.find(constraint => constraint.contype === "f");
    const checkExpression = attrConstraints.find(constraint => constraint.contype === "c");
    const isColumn = isColumns.find(isc => isc.column_name === rawColumn.attname);

    let autoNumberStart: number | null = null;

    if (isColumn && isColumn.column_default) {
      const match = /^nextval\((.*)\)|\(([^.]*\.webhare_autonrs_.*)\(1\)\)\[1\]$/.exec(isColumn.column_default);
      if (match) {
        let sequenceName: RawBuilder<number> | string = match[1];
        if (!match[1]) {
          sequenceName = sql`CAST(${match[2].replace(".webhare_autonrs_", ".webhare_seq_")} AS regclass)`;
        }

        const seq = await db<PGMetaDB>()
          .selectFrom("pg_catalog.pg_sequence")
          // When comparing to seqrelid, PostgreSQL will auto-cast a string to the correct type, cast to RawBuilder<number> | number to reflect that
          .where("seqrelid", "=", sequenceName as unknown as RawBuilder<number> | number)
          .select(["seqstart"])
          .executeTakeFirst();
        if (seq) {
          autoNumberStart = Number(seq.seqstart);
        }
      }
    }

    const characterMaximumLength = [pgTypeOid_bpchar, pgTypeOid_varchar].includes(rawColumn.atttypid) ?
      rawColumn.atttypmod - 4 :
      [pgTypeOid_bit, pgTypeOid_varbit].includes(rawColumn.atttypid) ?
        rawColumn.atttypmod
        : 0; // https://stackoverflow.com/questions/52376045/why-does-atttypmod-differ-from-character-maximum-length

    retval.push({
      columnName: rawColumn.attname,
      characterOctetLength: rawColumn.attlen,
      characterMaximumLength,
      isNullable: foreignKey ? !rawColumn.attnotnull : !checkExpression,
      dataType: `${rawColumn.nspname === "pg_catalog" ? "" : rawColumn.nspname || "."}${rawColumn.typname}${(characterMaximumLength ? `(${characterMaximumLength})` : "")}`,
      onDelete: foreignKey ? mapAction(foreignKey.confdeltype) : null,
      isUnique: Boolean(attrConstraints.find(constraint => constraint.contype === "u" || constraint.contype === "p")),
      referencedTableName: (foreignKey && foreignKey.relname) ?? null,
      referencedTableSchema: (foreignKey && foreignKey.nspname) ?? null,
      referencedTableOid: (foreignKey && foreignKey.confrelid) ?? null,
      autoNumberStart,
    });
  }
  return retval;
}
