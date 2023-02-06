import fs from "node:fs";
import { DOMParser } from '@xmldom/xmldom';
import { calculateWebhareModuleMap, WebHareModuleMap } from "@mod-system/js/internal/configuration";
import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";
import { encodeValue } from "dompack/types/text";


function elements<T extends Element>(collection: HTMLCollectionOf<T>): T[] {
  const items: T[] = [];
  for (let i = 0; i < collection.length; ++i)
    items.push(collection[i]);
  return items;
}

function generateTableTypeName(str: string) {
  if (str.startsWith("wrd"))
    str = "WRD" + str.substring(3);
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
        retval += (child.nodeValue ?? "").split("\n").map(l => encodeValue(l)).join("\n");
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


function generateKyselyDefs(modulelist: WebHareModuleMap, modulename: string, modules: string[]): string {
  const interfacename = modulename === "webhare" ? "WebHareDB" : `${generateTableTypeName(modulename)}DB`;
  let genfile = `import type { ColumnType } from "kysely";

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

`;

  const tablemap = new Map<string, string>;
  for (const mod of Object.entries(modulelist)) {
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
          let tstype: string;
          let nullable = false;
          let canupdate = true;

          let documentation: Element | undefined;
          for (const documentationnode of elements(col.getElementsByTagNameNS("http://www.webhare.net/xmlns/whdb/databaseschema", "documentation"))) {
            documentation = documentationnode;
          }

          switch (col.localName) {
            case "documentation": {
              tabledef = formatDocumentation(col, "") + tabledef;
              continue;
            }
            case "integer": {
              tstype = "number";

              if (col.getAttribute("references")) {
                nullable = true;
                if (["0", "false"].includes(col.getAttribute("nullable") ?? "true"))
                  nullable = false;
              }
              if (nullable)
                if (["0", "false"].includes(col.getAttribute("noupdate") ?? "true"))
                  canupdate = false;
            } break;
            case "integer64":
            case "__longkey": {
              tstype = "bigint";
              if (col.getAttribute("references")) {
                nullable = true;
                if (["0", "false"].includes(col.getAttribute("nullable") ?? "true"))
                  nullable = false;
              }
              if (["0", "false"].includes(col.getAttribute("noupdate") ?? "true"))
                canupdate = false;
            } break;
            case "float": {
              tstype = "number";
            } break;
            case "blob": {
              tstype = "object";
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
          if (isprimarykey || !canupdate)
            tstype = `IsGenerated<${tstype}>`;

          if (documentation) {
            tabledef += formatDocumentation(documentation, "  ");
          }

          tabledef += `  ${name}: ${tstype};\n`;

        }
        tablemap.set(`${mod[0]}.${table_name}`, `${generateTableTypeName(mod[0])}_${generateTableTypeName(table_name)}`);
        tabledef += `}\n\n`;

        genfile += tabledef;
      }
    }
  }

  // Don't export file if no table definitions are present
  if (!tablemap.size)
    return "";

  genfile += `export interface ${interfacename} {\n`;
  for (const entry of tablemap)
    genfile += `  ${JSON.stringify(entry[0])}: ${entry[1]};\n`;
  genfile += `}\n`;
  return genfile;
}

function updateModuleTableDefs(modulelist: WebHareModuleMap, name: string) {
  const dir = modulelist.system.root + "js/internal/generated/whdb/";
  fs.mkdirSync(dir, { recursive: true });

  const modules = name === "webhare" ? whconstant_builtinmodules : [name];
  const defs = generateKyselyDefs(modulelist, name, modules);

  const filename = `${dir}${name}.d.ts`;
  try {
    const current = fs.readFileSync(filename).toString();
    if (defs && current === defs) {
      return;
    }
    if (!defs) {
      // remove the file if none should exist
      fs.rmSync(`${filename}`, { force: true });
      console.log(`removed ${filename}`);
      return;
    }
  } catch (e) {
    // file does not exist
    if (!defs)
      return;
  }

  fs.rmSync(`${filename}.tmp`, { force: true });
  fs.writeFileSync(`${filename}.tmp`, defs);
  fs.renameSync(`${filename}.tmp`, filename);
  console.log(`written ${filename}`);
}

export function updateAllModuleTableDefs() {
  const modulelist = calculateWebhareModuleMap();
  const dir = modulelist.system.root + "js/internal/generated/whdb/";
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith(".d.ts")).map(f => f.substring(0, f.length - 5));
  } catch (e) {
  }

  const todo = ["webhare"];
  for (const f of [ ...Object.keys(modulelist), ...files]) {
    if (!todo.includes(f) && !whconstant_builtinmodules.includes(f))
      todo.push(f);
  }

  for (const module of todo)
    updateModuleTableDefs(modulelist, module);
}

export function updateSingleModuleTableDefs(name: string) {
  const modulelist = calculateWebhareModuleMap();
  if (whconstant_builtinmodules.includes(name))
    name = "webhare";

  updateModuleTableDefs(modulelist, name);
}
