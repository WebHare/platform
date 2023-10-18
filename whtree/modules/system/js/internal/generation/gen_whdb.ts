import { whconstant_builtinmodules } from "../webhareconstants";
import { FileToUpdate, GenerateContext } from "./shared";
import { encodeString } from "@webhare/std";
import { elements } from "./xmlhelpers";

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
  interfaceName: string;
  schemas: Array<{
    name: string;
    tables: Array<{
      name: string;
      interface: string;
      documentation: string;
      columns: Array<{
        name: string;
        documentation: string;
        type: string;
        //TS Type definition (TODO store nullability etc separately and build TSType in generateKyselyDefs)
        tstype: string;
      }>;
    }>;
  }>;
}

export function parseWHDBDefs(context: GenerateContext, modulename: string): WHDBDefs {
  const schemas = [];
  const mods = modulename === "platform" ? whconstant_builtinmodules : [modulename];
  for (const module of mods.sort()) {
    const doc = context.moduledefs.find(m => m.name === module)?.modXml;
    if (!doc)
      continue;

    for (const dbschema of elements(doc.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "databaseschema"))) {
      const schemainfo: WHDBDefs["schemas"][0] = {
        name: module,
        tables: []
      };

      for (const dbtable of elements(dbschema.getElementsByTagNameNS("http://www.webhare.net/xmlns/whdb/databaseschema", "table"))) {
        const table_name = dbtable.getAttribute("name") || "";
        const tableinfo: WHDBDefs["schemas"][0]["tables"][0] = {
          name: table_name,
          interface: `${generateTableTypeName(schemainfo.name)}_${generateTableTypeName(table_name)}`,
          documentation: "",
          columns: []
        };

        const primarykey = dbtable.getAttribute("primarykey");

        for (const col of Array.from(dbtable.childNodes).filter(elt => elt.nodeType === elt.ELEMENT_NODE) as Element[]) {
          if (col.localName == "documentation") {
            tableinfo.documentation = formatDocumentation(col, "");
            continue;
          }

          const name = col.getAttribute("name");
          const isprimarykey = name === primarykey;
          const isInternalColumn = Boolean(col.getAttribute("internalcolumnname"));
          //Read nullable and noupdate settings. These default to true resp. false
          const col_nullable: boolean = ["1", "true"].includes(col.getAttribute("nullable") || "true");
          const col_noupdate: boolean = (["1", "true"].includes(col.getAttribute("noupdate") || "false"));
          let tstype: string;
          let nullable = false;

          if (!name)
            continue;

          const colinfo = {
            documentation: "",
            name: "",
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
          if (isprimarykey || col_noupdate || isInternalColumn)
            tstype = `IsGenerated<${tstype}>`;

          if (documentation)
            colinfo.documentation = formatDocumentation(documentation, "  ");

          colinfo.name = name;
          colinfo.tstype = tstype;
          tableinfo.columns.push(colinfo);
        }

        schemainfo.tables.push(tableinfo);
      }
      if (schemainfo.tables.length)
        schemas.push(schemainfo);
    }
  }

  return {
    schemas,
    interfaceName: modulename === "webhare" ? "PlatformDB" : `${generateTableTypeName(modulename)}DB`
  };
}

export function generateKyselyDefs(context: GenerateContext, modulename: string): string {
  const whdbdefs = parseWHDBDefs(context, modulename);
  if (!whdbdefs.schemas.length)
    return '';

  const kyselyimportlib = modulename === "platform" ? "kysely" : "wh:internal/whtree/node_modules/kysely";
  const tablemap = new Map<string, string>;
  let hasblobs = false;
  let tabledefs = "";
  for (const schemainfo of whdbdefs.schemas) {
    for (const tableinfo of schemainfo.tables) {
      let tabledef = `${tableinfo.documentation}export interface ${tableinfo.interface} {\n`;
      for (const col of tableinfo.columns) {
        if (col.type == 'blob')
          hasblobs = true;

        tabledef += `${col.documentation}`;
        tabledef += `  ${col.name}: ${col.tstype};\n`;
      }

      tablemap.set(`${schemainfo.name}.${tableinfo.name}`, `${tableinfo.interface}`);
      tabledef += `}\n\n`;
      tabledefs += tabledef;
    }
  }

  return `/* This file is auto-generated, do not modify but regenerate using \`wh update-generated-files\`
   Use the dev module's browser for examples on how to use these types. */

import type { ColumnType } from ${JSON.stringify(kyselyimportlib)};
${hasblobs ? `import type { WebHareBlob } from "@webhare/services";` : ""}

type IsGenerated<T> = ColumnType<T, T | undefined, never>;

${tabledefs}

export interface ${whdbdefs.interfaceName} {
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
