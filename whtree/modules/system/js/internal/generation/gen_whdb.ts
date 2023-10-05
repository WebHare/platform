import fs from "node:fs";
import { DOMParser } from '@xmldom/xmldom';
import { config, updateConfig } from "../configuration";
import { whconstant_builtinmodules } from "../webhareconstants";
import { updateDir } from "./shared";
import { encodeString } from "@webhare/std";


function elements<T extends Element>(collection: HTMLCollectionOf<T>): T[] {
  const items: T[] = [];
  for (let i = 0; i < collection.length; ++i)
    items.push(collection[i]);
  return items;
}

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

/** Format XML documetation into a comment */
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


export function generateKyselyDefs(modulename: string, modules: string[]): string {
  const interfacename = modulename === "webhare" ? "WebHareDB" : `${generateTableTypeName(modulename)}DB`;
  const kyselyimportlib = modulename === "webhare" ? "kysely" : "wh:internal/whtree/node_modules/kysely";
  let tabledefs = "";
  let hasblobs = false;

  const tablemap = new Map<string, string>;
  for (const mod of Object.entries(config.module)) {
    if (!modules.includes(mod[0]))
      continue;

    const moduleroot = mod[1].root;

    const buffer = fs.readFileSync(moduleroot + "moduledefinition.xml");
    if (!buffer)
      continue;

    const doc = new DOMParser().parseFromString(buffer.toString("utf-8"), 'text/xml');

    for (const dbschema of elements(doc.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "databaseschema"))) {
      for (const dbtable of elements(dbschema.getElementsByTagNameNS("http://www.webhare.net/xmlns/whdb/databaseschema", "table"))) {
        const table_name = dbtable.getAttribute("name") ?? "";
        let tabledef = `export interface ${generateTableTypeName(mod[0])}_${generateTableTypeName(table_name)} {\n`;
        const primarykey = dbtable.getAttribute("primarykey");

        for (const col of Array.from(dbtable.childNodes).filter(elt => elt.nodeType === elt.ELEMENT_NODE) as Element[]) {
          const name = col.getAttribute("name");
          const isprimarykey = name === primarykey;
          const isInternalColumn = Boolean(col.getAttribute("internalcolumnname"));
          //Read nullable and noupdate settings. These default to true resp. false
          const col_nullable: boolean = ["1", "true"].includes(col.getAttribute("nullable") || "true");
          const col_noupdate: boolean = (["1", "true"].includes(col.getAttribute("noupdate") || "false"));
          let tstype: string;
          let nullable = false;

          let documentation: Element | undefined;
          for (const documentationnode of elements(col.getElementsByTagNameNS("http://www.webhare.net/xmlns/whdb/databaseschema", "documentation"))) {
            documentation = documentationnode;
          }

          switch (col.localName) {
            case "documentation": {
              tabledef = formatDocumentation(col, "") + tabledef;
              continue;
            }
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
              hasblobs = true;
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

          if (documentation) {
            tabledef += formatDocumentation(documentation, "  ");
          }

          tabledef += `  ${name}: ${tstype};\n`;

        }
        tablemap.set(`${mod[0]}.${table_name}`, `${generateTableTypeName(mod[0])}_${generateTableTypeName(table_name)}`);
        tabledef += `}\n\n`;
        tabledefs += tabledef;
      }
    }
  }

  // Don't export file if no table definitions are present
  if (!tablemap.size)
    return "";

  return `import type { ColumnType } from ${JSON.stringify(kyselyimportlib)};
${hasblobs ? `import type { WebHareBlob } from "@webhare/services";` : ""}

/* Contains the Kysely database definitions for ${modulename == "webhare" ? `the WebHare core modules` : `module ${modulename}`}
    Example usage:

\`\`\`
import { db, Selectable } from "@webhare/whdb";
import type { ${interfacename} } from "@mod-system/js/internal/generated/whdb/${modulename}";

let rows: Selectable<${interfacename}, "<tablename>">;
rows = db<${interfacename}>().selectFrom("<tablename>").selectAll().execute();
\`\`\`
*/

// This file is generated, don't try to modify this file. Regenerate using \`wh updategeneratedfiles\`

type IsGenerated<T> = ColumnType<T, T | undefined, never>;

${tabledefs}

export interface ${interfacename} {
${[...tablemap.entries()].map(entry => `  ${JSON.stringify(entry[0])}: ${entry[1]};`).join('\n')}
}
`;
}

function generateFile(file: string, { defname, modules }: { defname: string; modules: string[] }) {
  // Only process existing modules
  modules = modules.filter(module => config.module[module]);
  if (!modules.length) {
    return "";
  }

  return generateKyselyDefs(defname, modules);
}

export async function updateAllModuleTableDefs() {
  // Make sure the configuration is uptodate
  updateConfig();

  const storagedir = config.dataroot + "storage/system/generated/whdb/";
  const localdir = config.installationroot + "modules/system/js/internal/generated/whdb/";

  const noncoremodules = Object.keys(config.module).filter(m => !whconstant_builtinmodules.includes(m));
  await updateDir(storagedir, noncoremodules.map(m => ({ type: "file", name: m + ".ts", data: { defname: m, modules: [m] } })), true, generateFile);
  await updateDir(localdir, [{ type: "file", name: "webhare.ts", data: { defname: "webhare", modules: whconstant_builtinmodules } }], true, generateFile);
}

export async function updateSingleModuleTableDefs(name: string) {
  // Make sure the configuration is uptodate
  updateConfig();

  if (whconstant_builtinmodules.includes(name)) {
    const localdir = config.installationroot + "modules/system/js/internal/generated/whdb/";
    await updateDir(localdir, [{ type: "file", name: "webhare.ts", data: { defname: "webhare", modules: whconstant_builtinmodules } }], true, generateFile);
  } else {
    const storagedir = config.dataroot + "storage/system/generated/whdb/";
    await updateDir(storagedir, [{ type: "file", name: name + ".ts", data: { defname: name, modules: [name] } }], false, generateFile);
  }
}
