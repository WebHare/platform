import { whconstant_builtinmodules } from "../webhareconstants";
import { FileToUpdate, GenerateContext, generatorBanner } from "./shared";
import { encodeString } from "@webhare/std";
import { elements } from "./xmlhelpers";
import { getGeneratedFilePath } from "./generator";

function generateTableTypeName(str: string) {
  if (str.startsWith("wrd"))
    str = "WRD" + str.substring(3);
  else if (str.startsWith("webhare"))
    str = "WebHare" + str.substring(7);
  return str.split("_").map(e => e[0].toUpperCase() + e.substring(1)).join("");
}

/// Inner-XML implementation that keeps \n's intact. innerHTML doesn't seem to work with nodes returned from DOMParser
function getInnerXML(node: Element, withelt = false): string {
  if (!node.hasChildNodes())
    return `<${node.localName} />`;
  else {
    let retval = withelt ? `<${node.localName}>` : "";
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 1)
        retval += getInnerXML(child as Element, true);
      else if (child.nodeType === child.TEXT_NODE)
        retval += (child.nodeValue ?? "").split("\n").map(l => encodeString(l, "attribute")).join("\n");
    }
    return retval + (withelt ? `</${node.localName}>` : "");
  }
}

/** Format XML documentation into a comment */
function formatDocumentation(node: Element, indent: string): string {
  const doc = getInnerXML(node).trim();
  if (!doc)
    return "";

  // Calculate the indent in XML from first non-empty line after the first newline, remove that from all lines
  let cindent = "";
  let gotindent = false;
  let lines = [];
  for (let line of doc.split("\n")) {
    if (!lines.length) {
      // Always trim the first line
      line = line.trim();
    } else if (line.trim() && !gotindent) {
      // First non-empty line after first newline. Trim the end (we manually trim the start)
      cindent = /^( *)/.exec(line)?.[0] ?? "";
      gotindent = true;
      line = line.trimEnd();
    } else if (line.startsWith(cindent)) {
      // Remove XML comment indent if not shorter than default indent. Trim only at the end
      line = line.substring(cindent.length).trimEnd();
    }
    lines.push(line);
  }

  // Remove empty lines
  lines = lines.filter(l => l);

  // Single line comment?
  if (lines.length === 1)
    return `${indent}/// ${lines[0]}\n`;

  // Multi-line comment - make sure no trailing spaces are generated
  let retval = "";
  for (let idx = 0; idx <= lines.length; ++idx) {
    retval += `${indent}${idx === lines.length ? "*/" : ((idx === 0 ? "/** " : "    ") + lines[idx]).trimEnd()}\n`;
  }
  return retval;
}


export interface WHDBDefs {
  interface: string;
  library: string;
  schemas: Record<string, {
    tables: Record<string, {
      interface: string;
      documentation: string;
      columns: Record<string, {
        documentation: string;
        type: string;
        //TS Type definition (TODO store nullability etc separately and build TSType in generateKyselyDefs)
        tstype: string;
      }>;
    }>;
  }>;
}

export function parseWHDBDefs(context: GenerateContext, modulename: string): WHDBDefs {
  const schemas: WHDBDefs["schemas"] = {};
  const mods = modulename === "platform" ? whconstant_builtinmodules : [modulename];
  for (const module of mods.sort()) {
    const doc = context.moduledefs.find(m => m.name === module)?.modXml;
    if (!doc)
      continue;

    for (const dbschema of elements(doc.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "databaseschema"))) {
      const schemainfo: typeof schemas[string] = {
        tables: {}
      };

      for (const dbtable of elements(dbschema.getElementsByTagNameNS("http://www.webhare.net/xmlns/whdb/databaseschema", "table"))) {
        const table_name = dbtable.getAttribute("name") || "";
        const tableinfo: WHDBDefs["schemas"][0]["tables"][0] = {
          interface: `${generateTableTypeName(module)}_${generateTableTypeName(table_name)}`,
          documentation: "",
          columns: {}
        };

        const primarykey = dbtable.getAttribute("primarykey");

        for (const col of Array.from(dbtable.childNodes).filter(elt => elt.nodeType === elt.ELEMENT_NODE) as Element[]) {
          if (col.localName === "documentation") {
            tableinfo.documentation = formatDocumentation(col, "");
            continue;
          }
          if (col.getAttribute("internalcolumnname"))
            continue; //Internal columns aren't used in TS - we rely on the WHFS APIs to provide them (and may move their logic to the WHFS API completely)

          const name = col.getAttribute("name");
          const isprimarykey = name === primarykey;
          //Read nullable and noupdate settings. These default to true resp. false
          const col_nullable: boolean = ["1", "true"].includes(col.getAttribute("nullable") || "true");
          const col_noupdate: boolean = (["1", "true"].includes(col.getAttribute("noupdate") || "false"));
          let tstype: string;
          let nullable = false;

          if (!name)
            continue;

          const colinfo: typeof tableinfo["columns"][number] = {
            documentation: "",
            tstype: "",
            type: col.localName
          };

          let documentation: Element | undefined;
          for (const documentationnode of elements(col.getElementsByTagNameNS("http://www.webhare.net/xmlns/whdb/databaseschema", "documentation"))) {
            documentation = documentationnode;
          }

          switch (col.localName) {
            case "integer":
            case "__longkey":
            case "number": {
              tstype = "number";

              if (col.getAttribute("references")) {
                //we store HS-default integers as '0' but referencing HS integers as 'null'. so we only honour !col_nullable for references
                nullable = true;
                if (!col_nullable)
                  nullable = false;
              }
            } break;
            case "integer64": {
              tstype = "bigint";

              if (col.getAttribute("references")) {
                nullable = true;
                if (col_nullable)
                  nullable = false;
              }
            } break;
            case "float": {
              tstype = "number";
            } break;
            case "blob": {
              nullable = col_nullable;
              tstype = "WebHareBlob";
            } break;
            case "boolean": {
              tstype = "boolean";
            } break;
            case "datetime": {
              tstype = "Date";
            } break;
            case "money": {
              tstype = "unknown";
            } break;
            case "varchar": {
              tstype = "string";
            } break;
            case "bytea": {
              tstype = "Buffer";
            } break;
            default: {
              continue;
            }
          }
          if (nullable)
            tstype = `${tstype} | null`;
          if (isprimarykey || col_noupdate)
            tstype = `IsGenerated<${tstype}>`;

          if (documentation)
            colinfo.documentation = formatDocumentation(documentation, "  ");

          colinfo.tstype = tstype;
          tableinfo.columns[name] = colinfo;
        }

        schemainfo.tables[table_name] = tableinfo;
      }

      schemas[module] = schemainfo;
    }
  }

  return {
    schemas,
    library: getGeneratedFilePath(modulename, "whdb", `whdb/${modulename}.ts`),
    interface: `${generateTableTypeName(modulename)}DB`
  };
}

export function generateKyselyDefs(context: GenerateContext, modulename: string): string {
  const whdbdefs = parseWHDBDefs(context, modulename);
  if (!Object.keys(whdbdefs.schemas).length)
    return '';

  const kyselyimportlib = modulename === "platform" ? "kysely" : "wh:internal/whtree/node_modules/kysely";
  const tablemap = new Map<string, string>;
  let hasblobs = false;
  let tabledefs = "";
  for (const [schemaname, schemainfo] of Object.entries(whdbdefs.schemas)) {
    for (const [tablename, tableinfo] of Object.entries(schemainfo.tables)) {
      let tabledef = `${tableinfo.documentation}export interface ${tableinfo.interface} {\n`;
      for (const [name, col] of Object.entries(tableinfo.columns)) {
        if (col.type === 'blob')
          hasblobs = true;

        tabledef += `${col.documentation}`;
        tabledef += `  ${name}: ${col.tstype};\n`;
      }

      tablemap.set(`${schemaname}.${tablename}`, `${tableinfo.interface}`);
      tabledef += `}\n\n`;
      tabledefs += tabledef;
    }
  }

  return `${generatorBanner}
import type { ColumnType } from ${JSON.stringify(kyselyimportlib)};
${hasblobs ? `import type { WebHareBlob } from "@webhare/services";` : ""}

type IsGenerated<T> = ColumnType<T, T | undefined, never>;

${tabledefs}

export interface ${whdbdefs.interface} {
${[...tablemap.entries()].map(entry => `  ${JSON.stringify(entry[0])}: ${entry[1]};`).join('\n')}
}
`;
}

export async function listAllModuleTableDefs(mods: string[]): Promise<FileToUpdate[]> {
  return mods.map(module => ({
    path: `whdb/${module}.ts`,
    module,
    type: "whdb",
    generator: (context: GenerateContext) => generateKyselyDefs(context, module)
  }));
}
