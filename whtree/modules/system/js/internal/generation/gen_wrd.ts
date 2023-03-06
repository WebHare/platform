import fs from "node:fs";
import { DOMParser } from '@xmldom/xmldom';
import { calculateWebHareConfiguration, WebHareConfiguration } from "@mod-system/js/internal/configuration";
import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";
import { resolveResource } from "@webhare/services";
import { openHSVM } from "@webhare/services/src/hsvm";
import { WRDAttributeType } from "@mod-wrd/js/internal/types";
import { updateDir } from "./shared";


function elements<T extends Element>(collection: HTMLCollectionOf<T>): T[] {
  const items: T[] = [];
  for (let i = 0; i < collection.length; ++i)
    items.push(collection[i]);
  return items;
}

/** Convert snake_case to CamelCase, with the first character uppercase. Special cases the words 'WRD', 'WH' and 'WebHare' */
export function generateTypeName(str: string) {
  str = str.toLowerCase();
  if (str.startsWith("wrd"))
    str = "WRD_" + str.substring(3);
  else if (str.startsWith("wh"))
    str = "WH_" + str.substring(2);
  else if (str.startsWith("webhare"))
    str = "WebHare_" + str.substring(7);
  str = str.split("_").filter(e => e).map(e => e[0].toUpperCase() + e.substring(1)).join("");
  return str.split("-").filter(e => e).map(e => e[0].toUpperCase() + e.substring(1)).join("");
}

/** Convert snake_case to camelCase, with the first character lowercase. Special cases the words 'WRD', 'WH' and 'WebHare' */
export function generatePropertyName(str: string) {
  str = str.toLowerCase();
  if (str.startsWith("wrd"))
    str = "wrd" + generateTypeName(str.substring(3));
  else if (str.startsWith("wh"))
    str = "wh" + generateTypeName(str.substring(2));
  else if (str.startsWith("webhare"))
    str = "webhare" + generateTypeName(str.substring(7));
  str = str.split("_").filter(e => e).map((e, idx) => idx ? e[0].toUpperCase() + e.substring(1) : e).join("");
  return str.split("-").filter(e => e).map((e, idx) => idx ? e[0].toUpperCase() + e.substring(1) : e).join("");
}

/** Format of schema definition data return by HareScript */
type SchemaDef = {
  types: Array<{
    tag: string;
    type: "OBJECT" | "DOMAIN" | "ATTACHMENT" | "LINK";
    parenttype_tag: string;
    allattrs: Array<{
      tag: string;
      attributetype: WRDAttributeType;
      allowedvalues: string[];
      isrequired: boolean;
      attrs: SchemaDef["types"][number]["allattrs"];  // recursive def
    }>;
  }>;
};

async function generateWRDDefs(config: WebHareConfiguration, modulename: string, modules: string[]): Promise<string> {
  let fullfile = "";
  let used_isrequired = false;
  let used_wrdattr = false;
  for (const mod of Object.entries(config.module)) {
    if (!modules.includes(mod[0]))
      continue;

    const moduleroot = mod[1].root;

    const buffer = fs.readFileSync(moduleroot + "moduledefinition.xml");
    if (!buffer)
      continue;

    const doc = new DOMParser().parseFromString(buffer.toString("utf-8"), 'text/xml');


    const hsvm = await openHSVM();


    for (const wrdschemas of elements(doc.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "wrdschemas"))) {
      for (const wrdschema of elements(wrdschemas.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "schema"))) {
        const tag = wrdschema.getAttribute("tag") || "";

        const definitionfile = wrdschema.getAttribute("definitionfile") || "";
        if (!definitionfile)
          continue;

        const resolved_definitionfile = resolveResource(`mod::${mod[0]}/moduledefinition.xml`, definitionfile);
        if (!resolved_definitionfile)
          throw new Error(`Huh? ${mod[0]} ${definitionfile}`);

        const modprefix = modules.length > 1 ? `${generateTypeName(mod[0])}_` : ``;

        let def = "\n";
        try {
          const schemadef = await hsvm.loadlib("mod::wrd/lib/internal/metadata/schemaparser.whlib").OpenWRDSchemaDefFile(resolved_definitionfile) as SchemaDef;

          let fulldef = `export type ${modprefix}${generateTypeName(tag)}Schema = {\n`;

          for (const type of schemadef.types) {
            const typename = `${modprefix}${generateTypeName(tag)}_${generateTypeName(type.tag)}`;
            const attrdefs: Record<string, { generated: boolean; required: boolean; defstr: string }> = {};
            attrdefs.wrd_id = { generated: false, required: false, defstr: `IsNonUpdatable<WRDAttributeType.Base_Integer>` };
            attrdefs.wrd_guid = { generated: false, required: false, defstr: `WRDAttributeType.Base_Guid` };
            attrdefs.wrd_type = { generated: true, required: false, defstr: `IsGenerated<WRDAttributeType.Base_Integer>` };
            attrdefs.wrd_tag = { generated: false, required: false, defstr: `WRDAttributeType.Base_Tag` };
            attrdefs.wrd_creationdate = { generated: false, required: false, defstr: `WRDAttributeType.Base_DateTime` };
            attrdefs.wrd_limitdate = { generated: false, required: false, defstr: `WRDAttributeType.Base_DateTime` };
            attrdefs.wrd_modificationdate = { generated: false, required: false, defstr: `WRDAttributeType.Base_DateTime` };

            if (type.type !== "OBJECT") {
              if (type.type === "DOMAIN") {
                attrdefs.wrd_leftentity = { generated: false, required: false, defstr: `WRDAttributeType.Base_Domain` };
              } else {
                attrdefs.wrd_leftentity = { generated: false, required: true, defstr: `WRDAttributeType.Base_Domain` };
                used_isrequired = true;
              }
            }
            if (type.type === "LINK") {
              attrdefs.wrd_rightentity = { generated: false, required: true, defstr: `WRDAttributeType.Base_Domain` };
              used_isrequired = true;
            }

            const parentpath = [];
            for (let ptype: typeof type | undefined = type; ptype; ptype = schemadef.types.find(t => t.tag === ptype?.parenttype_tag))
              parentpath.push(ptype.tag);

            if (parentpath.includes("WRD_PERSON")) {
              attrdefs.wrd_gender = { generated: false, required: false, defstr: `WRDAttributeType.Base_Gender` };
              attrdefs.wrd_salute_formal = { generated: true, required: false, defstr: `IsGenerated<WRDAttributeType.Base_GeneratedString>` };
              attrdefs.wrd_address_formal = { generated: true, required: false, defstr: `IsGenerated<WRDAttributeType.Base_GeneratedString>` };
              attrdefs.wrd_fullname = { generated: true, required: false, defstr: `IsGenerated<WRDAttributeType.Base_GeneratedString>` };
              attrdefs.wrd_titles = { generated: false, required: false, defstr: `WRDAttributeType.Base_NameString` };
              attrdefs.wrd_initials = { generated: false, required: false, defstr: `WRDAttributeType.Base_NameString` };
              attrdefs.wrd_firstname = { generated: false, required: false, defstr: `WRDAttributeType.Base_NameString` };
              attrdefs.wrd_firstnames = { generated: false, required: false, defstr: `WRDAttributeType.Base_NameString` };
              attrdefs.wrd_infix = { generated: false, required: false, defstr: `WRDAttributeType.Base_NameString` };
              attrdefs.wrd_lastname = { generated: false, required: false, defstr: `WRDAttributeType.Base_NameString` };
              attrdefs.wrd_titles_suffix = { generated: false, required: false, defstr: `WRDAttributeType.Base_NameString` };
              attrdefs.wrd_dateofbirth = { generated: false, required: false, defstr: `WRDAttributeType.Base_Date` };
              attrdefs.wrd_dateofdeath = { generated: false, required: false, defstr: `WRDAttributeType.Base_Date` };
            }
            if (parentpath.includes("WRD_PERSON") || parentpath.includes("WRD_RELATION") || parentpath.includes("WRD_ORGANIZATION"))
              attrdefs.wrd_title = { generated: true, required: false, defstr: `IsGenerated<WRDAttributeType.Base_GeneratedString>` };

            let normalattrdefs = ``;
            for (const attr of type.allattrs) {
              const ltag = attr.tag.toLowerCase();
              if (attrdefs[ltag]) {
                if (attr.isrequired && !attrdefs[ltag].required) {
                  attrdefs[ltag].required = true;
                }
              } else {
                // eslint-disable-next-line @typescript-eslint/no-loop-func
                const typedef = createTypeDef(attr, "  ", () => { used_isrequired = true; }, () => { used_wrdattr = true; });
                if (typedef)
                  normalattrdefs += `  ${attr.tag.toLowerCase()}: ${typedef};\n`;
              }
            }

            def += `export type ${typename} = {\n`;
            for (const [name, attrdef] of Object.entries(attrdefs)) {
              if (attrdef.required) {
                used_isrequired = true;
                attrdef.defstr = `IsRequired<${attrdef.defstr}>`;
              }
              def += `  ${name}: ${attrdef.defstr};\n`;
            }
            def += normalattrdefs;
            def += `};\n\n`;
            fulldef += `  ${type.tag.toLowerCase()}: ${typename};\n`;
          }
          fulldef += `};\n\n`;
          const schemaprop = (modules.length > 1 ? `${mod[0]}_` : ``) + tag + "_schema";

          fulldef += `export const ${generatePropertyName(schemaprop)} = new WRDSchema(${JSON.stringify(`${mod[0]}:${tag}`)});\n`;

          fullfile += def + fulldef;
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  if (fullfile) {
    fullfile = `import type { WRDAttributeType, ${used_isrequired ? `IsRequired, ` : ""}IsGenerated, IsNonUpdatable${used_wrdattr ? `, WRDAttr` : ``} } from "@mod-wrd/js/internal/types";
import { WRDSchema } from "@mod-wrd/js/internal/schema";

` + fullfile;

    //console.log(fullfile);
  }
  return fullfile;
}

function createTypeDef(attr: SchemaDef["types"][number]["allattrs"][number], indent: string, gotrequired: () => void, gotwrdattr: () => void): string {
  if (!attr.attributetype) // obsolete?
    return "";
  let typedef = "";
  if (attr.attributetype == WRDAttributeType.Enum || attr.attributetype == WRDAttributeType.EnumArray) {
    typedef = `WRDAttr<WRDAttributeType.${WRDAttributeType[attr.attributetype]}, { allowedvalues: ${attr.allowedvalues.map(v => JSON.stringify(v)).join(" | ")} }>`;
    gotwrdattr();
  } else if (attr.attributetype == WRDAttributeType.Array) {
    typedef = `WRDAttr<WRDAttributeType.${WRDAttributeType[attr.attributetype]}, {\n${indent}  members: {\n`;
    gotwrdattr();
    for (const subattr of attr.attrs) {
      const subdef = createTypeDef(subattr, indent + "    ", gotrequired, gotwrdattr);
      if (subdef)
        typedef += `${indent}    ${subattr.tag.toLowerCase()}: ${subdef};\n`;
    }
    typedef += `${indent}  };\n${indent}}>`;
  } else {
    typedef = `WRDAttributeType.${WRDAttributeType[attr.attributetype]}`;
  }
  if (attr.isrequired) {
    typedef = `IsRequired<${typedef}>`;
    gotrequired();
  }
  return typedef;
}

export async function updateAllModuleWRDDefs() {
  const config = calculateWebHareConfiguration();
  const storagedir = config.basedatadir + "storage/system/generated/wrd/";
  const localdir = config.installationroot + "modules/system/js/internal/generated/wrd/";

  const generateFile = (file: string, modules: string[]) => generateWRDDefs(config, file, modules);

  const noncoremodules = Object.keys(config.module).filter(m => !whconstant_builtinmodules.includes(m));
  await updateDir(storagedir, Object.fromEntries(noncoremodules.map(m => [m, [m]])), true, generateFile);
  await updateDir(localdir, { webhare: whconstant_builtinmodules }, true, generateFile);
}

export async function updateSingleModuleWRDDefs(name: string) {
  const config = calculateWebHareConfiguration();

  const generateFile = (file: string, modules: string[]) => generateWRDDefs(config, file, modules);

  if (whconstant_builtinmodules.includes(name)) {
    const localdir = config.installationroot + "modules/system/js/internal/generated/wrd/";
    await updateDir(localdir, { webhare: whconstant_builtinmodules }, true, generateFile);
  } else {
    const storagedir = config.basedatadir + "storage/system/generated/wrd/";
    await updateDir(storagedir, { [name]: [name] }, true, generateFile);
  }
}
