//import type { Connection } from "./connection.ts";
import { omit } from "@webhare/std";
import type { PostgresPoolClient } from "kysely";

export function escapePGIdentifier(str: string): string {
  const is_simple = Boolean(str.match(/^[0-9a-zA-Z_"$]*$/));
  let retval: string;
  if (is_simple)
    retval = `"${str.replaceAll(`"`, `""`)}"`;
  else {
    retval = `U&"`;
    for (const char of str) {
      const code = char.charCodeAt(0);
      if (code >= 32 && code < 127) {
        if (char === "\\")
          retval += char;
        retval += char;
      } else {
        if (code < 65536)
          retval += `\\${code.toString(16).padStart(4, "0")}`;
        else
          retval += `\\+${code.toString(16).padStart(8, "0")}`;
      }
    }
    retval += `"`;
  }
  return retval;
}

export async function schemaExists(pg: PostgresPoolClient, schema: string) {
  const result = await pg.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`, [schema]);
  return Boolean(result.rows?.length);
}

export async function indexExists(pg: PostgresPoolClient, schema: string, table: string, index: string) {
  const result = await pg.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexname = $3`, [schema, table, index]);
  return Boolean(result.rows?.length);
}

export async function tableExists(pg: PostgresPoolClient, schema: string, table: string) {
  const result = await pg.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, [schema, table]);
  return Boolean(result.rows?.length);
}

export async function columnExists(pg: PostgresPoolClient, schema: string, table: string, column: string) {
  const result = await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`, [schema, table, column]);
  return Boolean(result.rows?.length);
}

export async function getPGType(pg: PostgresPoolClient, schema: string, type: string): Promise<{ oid: number; typname: string } | null> {
  const result = await pg.query<{ oid: number; typname: string }>(`
    SELECT t.oid, t.typname
      FROM pg_catalog.pg_type t
           JOIN pg_catalog.pg_namespace n ON t.typnamespace = n.oid
           JOIN pg_catalog.pg_proc p ON t.typinput = p.oid
     WHERE nspname = $1 AND t.typname = $2 AND proname = 'record_in'`, [schema, type]);

  return result.rows?.length ? result.rows[0] : null;
}


export type ColumnDef = {
  name: string;
  dbType: string;
  maxLength?: number;
  autoNumberStart?: number;
  nullable?: boolean;
  isUnique?: boolean;
  noUpdate?: boolean;
  referencesSchema?: string;
  referencesTable?: string;
  onDelete?: string;
  internalColumnName?: string;
  documentation?: string;
  location?: string;
};

export type TableDef = {
  name: string;
  primaryKey: string;
  columns: ColumnDef[];
};

export type SchemaDef = {
  name: string;
  tables: TableDef[];
};

type Command = {
  cmd: string;
  params?: unknown[];
};

class ChangeContext {
  constructor(public pg: PostgresPoolClient) {

  }

  // List of current commands
  commands = new Array<Command>;

  errors = new Array<string>();

  /* Add a function ptr to execute
      @param cmd - Function ptr to execute

      TOOD why do we need this?

  PUBLIC MACRO AddTransOp(FUNCTION PTR cmd)
{
    INSERT CELL[type := "transop", cmd ] INTO this -> commands AT END;
}
  */

  /** Add an SQL command to execute
      @param cmd - SQL command
  */
  addCommand(cmd: string, params?: unknown[]) {
    this.commands.push({ cmd, params });
  }
  /** Add an error
      @param err - Error text
  */
  addError(err: string) {
    this.errors.push(err);
  }

  /** Return results
      @returns Modification commands/errors
  */
  resultsSoFar() {
    return {
      commands: this.commands,
      errors: this.errors
    };
  }
}

function getColumnBaseDef(colrec: ColumnDef) {
  let def = `${escapePGIdentifier(colrec.name)} ${colrec.dbType}`;
  if (colrec.dbType === "varchar")
    def += `(${colrec.maxLength})`;
  if (colrec.isUnique)
    def += " UNIQUE";
  if (!colrec.nullable)
    def += " NOT NULL";
  if (colrec.autoNumberStart && colrec.autoNumberStart > 0)
    def += ` DEFAULT ${colrec.autoNumberStart}`;
  if (colrec.referencesSchema && colrec.referencesTable)
    def += ` REFERENCES ${escapePGIdentifier(colrec.referencesSchema)}.${escapePGIdentifier(colrec.referencesTable)}`;
  return def;
}


/** Transforms a WebHare column definition into PostgreSQL column attrs
    @param context - Change context
    @param table_schema - Table schema
    @param table_name - Table name
    @param colrec - WebHare column record
    @param primarykey - Name of the primary key
    @returns PostgreSQL Column record
*/
function transformColumnDef(context: ChangeContext, table_schema: string, table_name: string, inrec: ColumnDef, primarykey: string) {
  const colrec = {
    defVal: "",
    ...omit(inrec, ["internalColumnName", "noUpdate", "documentation", "location"]),
    sequencename: "",
    autonumbersfuncname: "",
    check: ""
  };

  colrec.dbType = colrec.dbType.toLowerCase();
  if (colrec.name === primarykey)
    colrec.isUnique = true;

  // Type-specific conversions
  let validated_defval = false;
  switch (colrec.dbType) {
    case "integer":
    case "integer64":
    case "__longkey":
    case "number":
      if (colrec.autoNumberStart && colrec.autoNumberStart > 0) {
        if (colrec.defVal !== "")
          context.addError(`Column ${table_schema}.${table_name}(${colrec.name}) cannot have an autonumber and a default value`);
        else {
          colrec.sequencename = `${table_schema}.webhare_seq_${table_name}_${colrec.name}`;

          // Lowercasing the column name because MakeAutoNumber is called with uppercase column names
          colrec.autonumbersfuncname = `${escapePGIdentifier(table_schema)}.${escapePGIdentifier(`webhare_autonrs_${table_name}_${colrec.name.toLowerCase()}`)}`;
          colrec.defVal = `(${colrec.autonumbersfuncname}(1))[1]`;
          validated_defval = true;
        }
      }

      if (colrec.dbType !== "integer")
        colrec.dbType = "int8";
      else
        colrec.dbType = "int4";

      break;

    case "boolean":
      colrec.dbType = "bool";
      break;

    case "datetime":
      colrec.dbType = "timestamp"; //FIXME should have used timestap with tz type?
      break;
    case "string":
      colrec.dbType = "varchar";
      break;
    case "float":
      colrec.dbType = "float8";
      break;
    case "money":
      colrec.dbType = "numeric";
      break;
    case "blob":
      colrec.dbType = "webhare_internal.webhare_blob";

      // No foreign key for webhare_internal.webhare_blob table as that's the one we're pointing to
      if (!(table_schema === "webhare_internal" && table_name === "blob")) {
        colrec.referencesSchema = "webhare_internal";
        colrec.referencesTable = "blob";
        colrec.onDelete = "no action";
      } else {

        colrec.referencesSchema = "";
        colrec.referencesTable = "";
        colrec.onDelete = "";
      }
      break;
  }

  if (colrec.isUnique)
    colrec.nullable = false;

  // Default/references handling
  let defaultvalue = '';
  let nullcheck = '';
  if (!colrec.referencesTable) { // non-referencing column
    switch (colrec.dbType) {
      case "serial":
      case "bigserial":
        defaultvalue = "";
        nullcheck = `((${escapePGIdentifier(colrec.name)} <> 0))`;
        break;

      case "int4":
      case "int8":
      case "float8":
      case "numeric":
        defaultvalue = "0";
        nullcheck = `((${escapePGIdentifier(colrec.name)} <> 0))`;
        break;

      case "varchar":
        defaultvalue = "''::text";
        nullcheck = `(((${escapePGIdentifier(colrec.name)})::text <> ''::text))`;
        break;
      case "bool":
        defaultvalue = "false";
        nullcheck = `((${escapePGIdentifier(colrec.name)} <> false))`;
        break;
      case "bytea":
        defaultvalue = "'\\x'::bytea";
        nullcheck = `((${escapePGIdentifier(colrec.name)} <> '\\x'::bytea))`;
        break;
      case "timestamp":
        defaultvalue = "'-infinity'::timestamp without time zone";
        nullcheck = `((${escapePGIdentifier(colrec.name)} <> '-infinity'::timestamp without time zone))`;
        break;
      case "webhare_internal.webhare_blob":
        defaultvalue = "";
        break;
      default:
        throw new Error(`No default value for type '${colrec.dbType}'`);
    }

    if (!colrec.defVal) {
      colrec.defVal = defaultvalue;
      validated_defval = true;
    }

    if (!colrec.nullable) {
      if (colrec.check) {
        // checks are in the form ( expr ). expr is (value op value op value op value)
        if (!colrec.check.match(/^\(\(.*\) AMD \(.*\)\)$/)) //NOT LIKE "((*) AND (*))")
          colrec.check = `(${colrec.check})`;
        if (!nullcheck.match(/^\(\(.*\) AMD \(.*\)\)$/)) //NOT LIKE "((*) AND (*))")
          nullcheck = `(${nullcheck})`;
        colrec.check = `${colrec.check.substring(0, colrec.check.length - 2)} AND ${nullcheck.substring(2)}`;
      } else
        colrec.check = nullcheck;
    }
  } else { // reference to other table
    // colrec.nullable can be used directly
    // Default value is NULL, standard insert behaviour
  }

  if (colrec.defVal && !validated_defval) {
    if (colrec.defVal !== defaultvalue) {
      // if(['bool','int4','varchar'].includes(colrec.dbType)) { //not sure if we should copy this check.. it missed int8 and make the default case useless, surely we would want to validate ANY default?
      switch (colrec.dbType) {
        case "bool":
          if (['true', 'false'].includes(colrec.defVal.toLowerCase()))
            colrec.defVal = colrec.defVal.toLowerCase();
          else
            context.addError(`Invalid default value ${colrec.defVal} for column ${table_schema}.${table_name}.${colrec.name}`);
          break;
        case "int4":
        case "int8": {
          const decoded = JSON.parse(colrec.defVal);
          if (typeof decoded === "number")
            colrec.defVal = decoded.toString();
          else
            context.addError(`Invalid default value ${colrec.defVal} for column ${table_schema}.${table_name}.${colrec.name}`);
          break;
        }
        case "varchar": {
          const decoded = JSON.parse(colrec.defVal);
          if (typeof decoded === "string") //TODO this feels fishy. probably should just generate command with parameters for this stuff
            colrec.defVal = `'${decoded.substring(1, decoded.length - 1)}'`;
          else
            context.addError(`Invalid default value ${colrec.defVal} for column ${table_schema}.${table_name}.${colrec.name}`);
          break;
        }
        default:
          context.addError(`Cannot validate default values of database type ${colrec.dbType} for column ${table_schema}.${table_name}.${colrec.name}`);
          break;
      }
    }
  }

  return colrec;
}

async function generateDependentSQLCommands(pg: PostgresPoolClient, schemadefs: SchemaDef[]) {
  const context = new ChangeContext(pg);
  // const fkeys_to_update = [];

  // CREATE and ALTER tables (but do NOT set foreign keys)
  for (const schemaspec of schemadefs) {
    //        RECORD ARRAY current_tables := SELECT table_name, object_id FROM GetTables(trans, schemaspec.name);
    for (const tabledef of schemaspec.tables) {
      //RECORD curtab := SELECT * FROM current_tables WHERE table_name = tablerec.name;

      //STRING ARRAY dropped_constraints;
      // Internal columns aren't stored in PostgreSQL
      // DELETE FROM tablerec.cols WHERE internalcolumnname != "";

      // Convert to stuff we can update
      const cols = tabledef.columns.map(c => transformColumnDef(context, schemaspec.name, tabledef.name, c, tabledef.primaryKey));

      /*

              IF (RecordExists(curtab))
              {
                //FIXME: Verify that columns have the proper properties
                RECORD ARRAY curcols := GetColumns(trans, schemaspec.name, tablerec.name);

                FOREVERY(RECORD coldef FROM tablerec.cols)
                {
                  RECORD curcol := SELECT * FROM curcols WHERE column_name = coldef.name;
                  IF(RecordExists(curcol))
                  {
                    //foreign key mismatch?
                    IF (curcol.referenced_table_schema != coldef.references_schema
                        OR curcol.referenced_table_name != coldef.references_table
                        OR (ToUppercase(curcol.on_delete) ?? "NO ACTION") != (ToUppercase(coldef.ondelete) ?? "NO ACTION"))
                    {
                      IF (curcol.referenced_table_name != "")
                        INSERT DropColumnFkey(context, schemaspec.name, tablerec.name, curcol) INTO dropped_constraints AT END;
                      IF(coldef.references_table != "")
                        INSERT INTO fkeys_to_update(schemaname, tablename, colrec) VALUES(schemaspec.name, tablerec.name, coldef) AT END;
                    }

                    STRING expect_data_type := coldef.dbType;
                    IF (expect_data_type = "varchar")
                      expect_data_type := `${expect_data_type}(${coldef.maxlength})`;

                    // Convert data types
                    IF (expect_data_type != curcol.data_type)
                    {
                      STRING alterbase := `ALTER TABLE ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)} ALTER COLUMN ${escapePGIdentifier(coldef.name)}`;
                      IF(curcol.column_default != "")
                      {
                        // Conversion will fail when the column default can't be converted automatically, so just drop it
                        // It will be re-initialized later
                        // USING does not convert the default, see https://www.postgresql.org/docs/current/sql-altertable.html
                        context->AddCommand(`${alterbase} DROP DEFAULT`);
                        curcol.column_default := "";
                      }

                      STRING cmd := `${alterbase} TYPE ${expect_data_type}`;
                      IF(expect_data_type = "bytea")
                      {
                        // conversion to bytea needs an explicit conversion function
                        cmd := `${cmd} USING convert_to(${escapePGIdentifier(coldef.name)}, 'UTF-8')`;
                      }
                      context->AddCommand(cmd);

                      IF(coldef.defval != "")
                        context->AddCommand(`${alterbase} SET DEFAULT ${coldef.defval}`);
                    }

                    IF(coldef.nullable != curcol.is_nullable)
                      context->AddCommand(`ALTER TABLE ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)} ALTER COLUMN ${escapePGIdentifier(coldef.name)}${coldef.nullable ? " DROP NOT NULL" : " SET NOT NULL"}`);
                    IF(coldef.isunique != curcol.is_unique)
                      IF(coldef.isunique)
                      {
                        context->AddCommand(`ALTER TABLE ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)} ADD UNIQUE (${escapePGIdentifier(coldef.name)})`);
                      }
                      ELSE
                      {
                        context->AddCommand(`ALTER TABLE ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)} DROP CONSTRAINT ${escapePGIdentifier(curcol.is_unique_constraint_name)}`);
                      }

                    IF (NOT AreExpressionsEquivalent(curcol.check_expression, coldef.check = "" ? "" : `CHECK ${coldef.check}`))
                    {

                      IF (curcol.check_expression != "")
                        context->AddCommand(`ALTER TABLE ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)} DROP CONSTRAINT ${escapePGIdentifier(curcol.check_constraint_name)}`);
                      IF (coldef.check != "")
                        context->AddCommand(`ALTER TABLE ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)} ADD CHECK ${coldef.check}`);
                    }

                    BOOLEAN rebuildautonumberconfig;
                    IF (NOT AreExpressionsEquivalent(curcol.column_default, coldef.defval))
                    {
                      IF (curcol.column_default != "")
                        context->AddCommand(`ALTER TABLE ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)} ALTER COLUMN ${escapePGIdentifier(coldef.name)} DROP DEFAULT`);
                      IF (coldef.defval != "")
                      {
                        IF (coldef.autonumbersfuncname != "")
                          rebuildautonumberconfig := TRUE;
                        ELSE
                          context->AddCommand(`ALTER TABLE ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)} ALTER COLUMN ${escapePGIdentifier(coldef.name)} SET DEFAULT ${coldef.defval}`);
                      }
                    }

                    IF (NOT rebuildautonumberconfig AND coldef.autonumbersfuncname != "" AND TestNeedReplaceFunction(coldef.autonumbersfuncname, autonumberfunc_procid))
                      rebuildautonumberconfig := TRUE;

                    IF (rebuildautonumberconfig)
                      RebuildColumnAutonumberConfig(context, schemaspec.name, tablerec.name, coldef);

                    IF(coldef.dbType = "varchar" AND coldef.maxlength > curcol.character_maximum_length)
                      context->AddCommand(`ALTER TABLE ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)} ALTER COLUMN ${escapePGIdentifier(coldef.name)} SET DATA TYPE VARCHAR(${coldef.maxlength})`);
                  }
                  ELSE
                  {
                    IF(coldef.name = tablerec.primarykey)
                    {
                      context->AddError(`Cannot change the primary column of table ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)}`);
                      CONTINUE;
                    }

                    STRING cmd := `ALTER TABLE ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)} ADD COLUMN `;
                    cmd := cmd || GetColumnBaseDef(coldef);
                    IF(coldef.references_table != "")
                      INSERT INTO fkeys_to_update(schemaname, tablename,colrec) VALUES(schemaspec.name, tablerec.name, coldef) AT END;
                    context->AddCommand(cmd);
                  }
                }

                RECORD ARRAY kill_columns := SELECT obsoletecols.*
                                               FROM tablerec.obsoletecols AS obsoletecols, curcols
                                              WHERE ToUppercase(obsoletecols.name) = ToUppercase(curcols.column_name);
                FOREVERY(RECORD coldef FROM kill_columns)
                {
                  STRING cmd := `ALTER TABLE ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)} DROP COLUMN ${escapePGIdentifier(coldef.name)}`;
                  context->AddCommand(cmd);
                }

                RECORD ARRAY triggers := SELECT * FROM GetTriggers(trans) WHERE table_schema = schemaspec.name AND table_name = tablerec.name;
                IF (tablerec.legacy_writeaccessmgr != "")
                {
                  STRING name := `webhare_${tablerec.name}_writeaccess`;
                  IF (NOT RecordExists(SELECT FROM triggers WHERE triggername = name))
                  {
                    context->AddCommand(`
                        CREATE TRIGGER ${escapePGIdentifier("webhare_" || tablerec.name || "_writeaccess")}
                        BEFORE INSERT OR UPDATE OR DELETE ON ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)}
                           FOR EACH ROW
                       EXECUTE FUNCTION ${escapePGIdentifier(`webhare_trigger_${schemaspec.name}_${tablerec.name}_writeaccess`)}()`);
                  }
                  DELETE FROM triggers WHERE triggername = name;
                }

                FOREVERY (RECORD trigger FROM triggers)
                  context->AddCommand(`DROP TRIGGER ${escapePGIdentifier(trigger.triggername)} ON ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)}`);

                RenameConstraints(context, schemaspec, tablerec, curtab, dropped_constraints);
              }
              ELSE
              */
      { //Create a table creation command
        let cmd = `CREATE TABLE ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tabledef.name)}`;
        let coldefs = '';
        for (const col of cols) {
          coldefs += (coldefs !== "" ? "\n, " : "") + getColumnBaseDef(col);
          if (col.name === tabledef.primaryKey)
            coldefs += " PRIMARY KEY";
        }
        cmd += "\n( " + coldefs + ")";
        context.addCommand(cmd);

        /* TODO
          // Create/update sequences
          FOREVERY(RECORD col FROM tablerec.cols)
          {
            IF(col.sequencename != "")
            RebuildColumnAutonumberConfig(context, schemaspec.name, tablerec.name, col);

            IF(col.references_table != "")
                  INSERT INTO fkeys_to_update(schemaname, tablename, colrec) VALUES(schemaspec.name, tablerec.name, col) AT END;
          }

          FOREVERY(RECORD col FROM tablerec.cols)
          IF(CellExists(col, "autonumberstart") AND col.autonumberstart > 0) // autonumberstart must be handled elsewhere
          context -> AddCommand(`ALTER SEQUENCE ${col.sequencename} START WITH ${col.autonumberstart} RESTART`);

          IF(tablerec.legacy_writeaccessmgr != "")
          {
            context -> AddCommand(`
                    CREATE TRIGGER ${escapePGIdentifier("webhare_" || tablerec.name || "_writeaccess")}
                    BEFORE INSERT OR UPDATE OR DELETE ON ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(tablerec.name)}
                       FOR EACH ROW
                   EXECUTE FUNCTION ${escapePGIdentifier(`webhare_trigger_${schemaspec.name}_${tablerec.name}_writeaccess`)}()`);
          }
        }

        {
              // Get current indices for this table (index names are scoped to their schema)
              RECORD ARRAY current_wh_indices:=
            SELECT *
                       , used :=      FALSE
                    FROM GetIndices(trans) AS indices
                   WHERE table_schema = schemaspec.name
                     AND table_name = tablerec.name
          AND(index_name LIKE "*_wh_*" OR index_name LIKE "*_whnp_*" OR index_name LIKE "*_whfk_*");

          tablerec.indices :=
          SELECT *
                       , null_partial := FALSE
            , useindexname :=    `${tablerec.name}_wh_${name}`
                    FROM tablerec.indices;

          /* Multi-column unique indices have the problem that when at least one NULL is
             present in their columns, they won't enforce uniqueness of the other columns
             anymore. To solve this we create null-partial indices for all those indices.
             It will contain only rows with at least one NULL, and coalesces those NULLs
             to the default value for their type.
          * /
          FOREVERY (RECORD ind FROM tablerec.indices)
          {
            IF (NOT ind.is_unique OR ind.nonullstores)
              CONTINUE;

            BOOLEAN have_nullable;
            FOREVERY (RECORD col FROM ind.columns)
            {
              RECORD colrec := SELECT * FROM tablerec.cols WHERE COLUMN name = col.name;
              IF (NOT RecordExists(colrec))
                THROW NEW Exception(`Column '${col.name}' in index ${schemaspec.name}.${tablerec.name}.${ind.name} could not be found in table definition`);

              IF (colrec.nullable)
                have_nullable := TRUE;
            }

            IF (NOT have_nullable)
              CONTINUE;

            INSERT CELL
                [ ...ind
                , null_partial :=   TRUE
                , useindexname :=    `${tablerec.name}_whnp_${ind.name}`
                ] INTO tablerec.indices AT END;
          }

          // Add indices for all non-unique foreign keys
          FOREVERY (RECORD col FROM SELECT * FROM tablerec.cols WHERE references_table != '' AND NOT isunique ORDER BY name)
          {
            RECORD declared :=
                SELECT *
                  FROM tablerec.indices
                 WHERE NOT nonullstores
                   AND columns[0].name = col.name;

            IF (NOT RecordExists(declared))
            {
              INSERT
                  [ useindexname :=     `${tablerec.name}_whfk_${col.name}`
                  , is_unique :=        FALSE
                  , is_uppercase :=     FALSE
                  , nonullstores :=     FALSE
                  , null_partial :=     FALSE
                  , columns :=          [ CELL[ col.name, len := 0 ] ]
                  ] INTO tablerec.indices AT END;
            }
          }

          // Calculate the index predicate and column expressions for the indexes
          FOREVERY (RECORD ind FROM tablerec.indices)
          {
            INSERT CELL method := "btree" INTO tablerec.indices[#ind];
            FOREVERY (RECORD col FROM ind.columns)
            {
              RECORD colrec := SELECT * FROM tablerec.cols WHERE COLUMN name = col.name;
              IF (NOT RecordExists(colrec))
                THROW NEW Exception(`Column '${col.name}' in index ${schemaspec.name}.${tablerec.name}.${ind.name} could not be found in table definition`);
              INSERT CELL expr := GetIndexColumnExpression(colrec, ind) INTO tablerec.indices[#ind].columns[#col];
            }
            INSERT CELL predicate := GetIndexPredicateExpression(schemaspec, tablerec, ind) INTO tablerec.indices[#ind];
          }

          // Match indices on name. Drop if the name match hasn't got the same definition
          RECORD ARRAY notfound;
          FOREVERY (RECORD ind FROM tablerec.indices)
          {
            RECORD old_index := SELECT * FROM current_wh_indices WHERE index_name = ind.useindexname;
            IF (NOT RecordExists(old_index))
            {
              INSERT ind INTO notfound AT END;
              CONTINUE;
            }

            UPDATE current_wh_indices SET used := TRUE WHERE index_name = ind.useindexname;
            IF (CompareIndexDef(schemaspec, tablerec, ind, old_index))
              CONTINUE;

            STRING cmd := `DROP INDEX ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(old_index.index_name)}`;
            context->AddCommand(cmd);

            INSERT ind INTO notfound AT END;
          }

          // Check if any of the remaining indexes has the same definition.
          FOREVERY (RECORD ind FROM notfound)
          {
            RECORD match :=
                SELECT *
                  FROM current_wh_indices
                 WHERE NOT used
                   AND CompareIndexDef(schemaspec, tablerec, ind, current_wh_indices);

            IF (RecordExists(match))
            {
              UPDATE current_wh_indices SET used := TRUE WHERE index_name = match.index_name;
              STRING cmd := `ALTER INDEX ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(match.index_name)} RENAME TO ${escapePGIdentifier(ind.useindexname)}`;
              context->AddCommand(cmd);
            }
            ELSE
            {
              // Create the new index
              STRING cmd := GenerateCreateIndexCommandFromSpec(schemaspec, tablerec, ind, ind.useindexname);
              context->AddCommand(cmd);
            }
          }

          STRING ARRAY obsolete_index_unames;
          FOREVERY (RECORD rec FROM schemaspec.obsoletetables)
          {
            // Add the regular _wh_ and the _whnp_ names to the list of names
            INSERT ToUppercase(`${tablerec.name}_wh_${rec.name}`) INTO obsolete_index_unames AT END;
            INSERT ToUppercase(`${tablerec.name}_whnp_${rec.name}`) INTO obsolete_index_unames AT END;
          }

          // Remove indices explicityly obsoleted or with old names (this drops old non-mentioned indexes on table rename!)
          RECORD ARRAY kill_indices :=
              SELECT *
                FROM current_wh_indices
               WHERE NOT used
                 AND ((ToUppercase(index_name) NOT LIKE ToUppercase(`${tablerec.name}_wh_*`) AND
                          ToUppercase(index_name) NOT LIKE ToUppercase(`${tablerec.name}_whnp_*`))
                      OR (ToUppercase(index_name) IN obsolete_index_unames));

          FOREVERY(RECORD indexdef FROM kill_indices)
          {
            // Index might be already dropped when this command executes, so use "IF EXISTS"
            STRING cmd := `DROP INDEX IF EXISTS ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(indexdef.index_name)}`;
            context->AddCommand(cmd);
          }
        }

        IF (RecordExists(curtab))
          DropUnusedSequences(context, schemaspec, tablerec, curtab);
          */
      }

      /* Reduce impact of obsoleted tables (but physical drop will wait till the real end) * /
      FOREVERY(RECORD tablerec FROM schemaspec.obsoletetables)
        IF(RecordExists(SELECT FROM current_tables WHERE table_name = tablerec.name))
        {
          RECORD ARRAY refercolumns := SELECT *
                                         FROM GetColumns(trans, schemaspec.name, tablerec.name)
                                        WHERE referenced_table_name!="";
          FOREVERY(RECORD refcol FROM refercolumns)
            DropColumnFkey(context, schemaspec.name, tablerec.name, refcol);

          // Get current indices for the current table
          RECORD ARRAY referindices := SELECT index_name
                                         FROM GetIndices(trans)
                                        WHERE table_schema = schemaspec.name
                                              AND table_name = tablerec.name
                                GROUP BY index_name;
          FOREVERY(RECORD ind FROM referindices)
          {
            IF (ind.index_name LIKE "*_pkey" OR ind.index_name LIKE "*_key") // primary key / normal constraint will prevent delete
              CONTINUE;
            STRING cmd := `DROP INDEX ${escapePGIdentifier(schemaspec.name)}.${escapePGIdentifier(ind.index_name)}`;
            context->AddCommand(cmd);
          }
        }
    }

      // Apply all foreign key contraints
      /*
      FOREVERY(RECORD fkey FROM fkeys_to_update)
        SetColumnFkey(context, fkey.schemaname, fkey.tablename, fkey.colrec);
  */
    }
  }
  return context.resultsSoFar();
}

export async function executeSQLUpdates(pg: PostgresPoolClient, cmds: Command[]) {
  for (const cmd of cmds) {
    //TODO: IF a command caused an error, store that with the command for better error reporting
    await pg.query(cmd.cmd, cmd.params ?? []);
  }
  //TODO IF(Length(cmds) > 0)
  // TODO  ClearAllSchemaCaches();
}

export async function createTableImmediately(pg: PostgresPoolClient, schema: string, table: TableDef) {
  // Translate to schema definition, run to table updater
  const schemadef = { name: schema, tables: [table] };
  const cmd = await generateDependentSQLCommands(pg, [schemadef]);
  if (cmd.errors?.length)
    throw new Error(cmd.errors[0]);

  await executeSQLUpdates(pg, cmd.commands);
}
