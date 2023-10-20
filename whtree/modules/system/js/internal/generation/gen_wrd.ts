import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";
import { backendConfig, resolveResource } from "@webhare/services";
import { WRDBaseAttributeType, WRDAttributeType } from "@mod-wrd/js/internal/types";
import { GenerateContext, FileToUpdate } from "./shared";
import { tagToJS } from "@webhare/wrd/src/wrdsupport";
import { loadlib } from "@webhare/harescript";
import { emplace } from "@webhare/std";
import { elements } from "./xmlhelpers";

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
      attributetype: WRDBaseAttributeType | WRDAttributeType;
      allowedvalues: string[];
      isrequired: boolean;
      typedeclaration: string;
      attrs: SchemaDef["types"][number]["allattrs"];  // recursive def
    }>;
  }>;
};

export async function generateWRDDefs(context: GenerateContext, modulename: string, modules: string[]): Promise<string> {
  let fullfile = "";
  let used_isrequired = false;
  let used_wrdattr = false;

  const typeDeclNames = new Set<string>;
  const typeDeclImports = new Map<string, Map<string, string>>;

  // eslint-disable-next-line no-inner-declarations
  function addTypeDeclImport(decl: string) {
    if (!decl)
      return "object";
    const parts = decl.split("#");
    if (parts.length !== 2 || !parts[0] || !parts[1])
      return "object";
    const library = parts[0].replace(/^mod::/, "@mod-");
    const imports = emplace(typeDeclImports, library, { insert: () => new Map<string, string> });
    let usename = imports.get(parts[1]);
    if (!usename) {
      usename = parts[1];
      for (let i = 1; typeDeclNames.has(usename); ++i)
        usename = `${parts[1]}_${i}`;
      imports.set(parts[1], usename);
    }
    return usename;
  }

  for (const mod of Object.entries(backendConfig.module)) {
    if (!modules.includes(mod[0]))
      continue;

    const doc = context.moduledefs.find(m => m.name === mod[0])?.modXml;
    if (!doc)
      continue;

    for (const wrdschemas of elements(doc.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "wrdschemas"))) {
      for (const wrdschema of elements(wrdschemas.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "schema"))) {
        const tag = wrdschema.getAttribute("tag") || "";
        const fulltag = mod[0] + ":" + tag;
        if (context.verbose)
          console.time("generateWRDDefs " + fulltag);

        const definitionfile = wrdschema.getAttribute("definitionfile") || "";
        if (!definitionfile)
          continue;

        const resolved_definitionfile = resolveResource(`mod::${mod[0]}/moduledefinition.xml`, definitionfile);
        if (!resolved_definitionfile)
          throw new Error(`Huh? ${mod[0]} ${definitionfile}`);

        const modprefix = modules.length > 1 ? `${generateTypeName(mod[0])}_` : ``;

        let def = "\n";
        try {
          const schemadef = await loadlib("mod::wrd/lib/internal/metadata/schemaparser.whlib").OpenWRDSchemaDefFile(resolved_definitionfile) as SchemaDef;
          let fulldef = `export type ${modprefix}${generateTypeName(tag)}SchemaType = {\n`;

          for (const type of schemadef.types) {
            const typename = `${modprefix}${generateTypeName(tag)}_${generateTypeName(type.tag)}`;
            const attrdefs: Record<string, { generated: boolean; required: boolean; defstr: string }> = {};

            if (type.type !== "OBJECT") {
              if (type.type === "DOMAIN") {
                attrdefs.wrdLeftEntity = { generated: false, required: false, defstr: `WRDBaseAttributeType.Base_Domain` };
              } else {
                attrdefs.wrdLeftEntity = { generated: false, required: true, defstr: `WRDBaseAttributeType.Base_Domain` };
                used_isrequired = true;
              }
            }
            if (type.type === "LINK") {
              attrdefs.wrdRightEntity = { generated: false, required: true, defstr: `WRDBaseAttributeType.Base_Domain` };
              used_isrequired = true;
            }

            const parentpath = [];
            for (let ptype: typeof type | undefined = type; ptype; ptype = schemadef.types.find(t => t.tag === ptype?.parenttype_tag))
              parentpath.push(ptype.tag);

            if (parentpath.includes("WRD_PERSON")) {
              attrdefs.wrdGender = { generated: false, required: false, defstr: `WRDBaseAttributeType.Base_Gender` };
              attrdefs.wrdSaluteFormal = { generated: true, required: false, defstr: `IsGenerated<WRDBaseAttributeType.Base_GeneratedString>` };
              attrdefs.wrdAddressFormal = { generated: true, required: false, defstr: `IsGenerated<WRDBaseAttributeType.Base_GeneratedString>` };
              attrdefs.wrdFullName = { generated: true, required: false, defstr: `IsGenerated<WRDBaseAttributeType.Base_GeneratedString>` };
              attrdefs.wrdTitles = { generated: false, required: false, defstr: `WRDBaseAttributeType.Base_NameString` };
              attrdefs.wrdInitials = { generated: false, required: false, defstr: `WRDBaseAttributeType.Base_NameString` };
              attrdefs.wrdFirstName = { generated: false, required: false, defstr: `WRDBaseAttributeType.Base_NameString` };
              attrdefs.wrdFirstNames = { generated: false, required: false, defstr: `WRDBaseAttributeType.Base_NameString` };
              attrdefs.wrdInfix = { generated: false, required: false, defstr: `WRDBaseAttributeType.Base_NameString` };
              attrdefs.wrdLastName = { generated: false, required: false, defstr: `WRDBaseAttributeType.Base_NameString` };
              attrdefs.wrdTitlesSuffix = { generated: false, required: false, defstr: `WRDBaseAttributeType.Base_NameString` };
              attrdefs.wrdDateOfBirth = { generated: false, required: false, defstr: `WRDBaseAttributeType.Base_Date` };
              attrdefs.wrdDateOfDeath = { generated: false, required: false, defstr: `WRDBaseAttributeType.Base_Date` };
            }
            if (parentpath.includes("WRD_PERSON") || parentpath.includes("WRD_RELATION") || parentpath.includes("WRD_ORGANIZATION"))
              attrdefs.wrdTitle = { generated: true, required: false, defstr: `IsGenerated<WRDBaseAttributeType.Base_GeneratedString>` };
            if (parentpath.includes("WRD_PERSON") || parentpath.includes("WRD_RELATION") || parentpath.includes("WRD_ORGANIZATION"))
              attrdefs.wrdOrgName = { generated: false, required: false, defstr: `WRDAttributeType.Free` };

            let normalattrdefs = ``;
            for (const attr of type.allattrs) {
              const ltag = tagToJS(attr.tag);
              if (attrdefs[ltag]) {
                // base attribute: make required if the update is required
                if (attr.isrequired && !attrdefs[ltag].required) {
                  attrdefs[ltag].required = true;
                }
              } else {
                // custom attribute: generate type definition
                // eslint-disable-next-line @typescript-eslint/no-loop-func
                const typedef = createTypeDef(attr, "  ", () => { used_isrequired = true; }, () => { used_wrdattr = true; }, addTypeDeclImport);
                if (typedef)
                  normalattrdefs += `  ${tagToJS(attr.tag)}: ${typedef};\n`;
              }
            }

            def += `export type ${typename} = WRDTypeBaseSettings`;
            if (Object.entries(attrdefs).length || normalattrdefs) {
              def += ` & {\n`;
              for (const [name, attrdef] of Object.entries(attrdefs)) {
                if (attrdef.required) {
                  used_isrequired = true;
                  attrdef.defstr = `IsRequired<${attrdef.defstr}>`;
                }
                def += `  ${name}: ${attrdef.defstr};\n`;
              }
              def += normalattrdefs + "}";
            }
            def += `;\n\n`;
            fulldef += `  ${tagToJS(type.tag)}: ${typename};\n`;
          }
          fulldef += `};\n\n`;
          const schemaprop = (modules.length > 1 ? `${mod[0]}_` : ``) + tag + "_schema";

          fulldef += `export const ${generatePropertyName(schemaprop)} = new WRDSchema<${modprefix}${generateTypeName(tag)}SchemaType>(${JSON.stringify(fulltag)});\n`;

          fullfile += def + fulldef;
        } catch (e) {
          console.log(fulltag + ": " + (e as Error).message); //TODO log it, back to console.error, but we need to understand applicability first as we now fail for newsletter module
        }

        if (context.verbose)
          console.timeEnd("generateWRDDefs " + fulltag);
      }
    }
  }

  if (fullfile) {
    const needtypes = ['WRDTypeBaseSettings', 'WRDBaseAttributeType', 'WRDAttributeType', 'IsGenerated'];
    if (used_isrequired)
      needtypes.push('IsRequired');
    if (used_wrdattr)
      needtypes.push('WRDAttr');

    const typedecls = Array.from(typeDeclImports.entries()).map(([library, imports]) => {
      const names = Array.from(imports).map(([name, usename]) => (name !== usename ? `${name} as ${usename}` : name)).join(", ");
      library = library.replace(/(\.d)?\.tsx?$/, ""); // remove .d.ts,  .ts, .tsx extensions
      return `import type { ${names} } from ${JSON.stringify(library)};\n`;
    }
    ).join("");

    fullfile = `import { ${needtypes.join(", ")} } from "@mod-wrd/js/internal/types";
import { WRDSchema } from "@mod-wrd/js/internal/schema";
${typedecls}
` + fullfile;
  }
  return fullfile;
}

function createTypeDef(attr: SchemaDef["types"][number]["allattrs"][number], indent: string, gotrequired: () => void, gotwrdattr: () => void, gottypedecl: (decl: string) => string): string {
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
      const subdef = createTypeDef(subattr, indent + "    ", gotrequired, gotwrdattr, gottypedecl);
      if (subdef)
        typedef += `${indent}    ${tagToJS(subattr.tag)}: ${subdef};\n`;
    }
    typedef += `${indent}  };\n${indent}}>`;
  } else if (attr.attributetype == WRDAttributeType.JSON) {
    const typedeclname = attr.typedeclaration ? gottypedecl(attr.typedeclaration) : "object";
    typedef = `WRDAttr<WRDAttributeType.${WRDAttributeType[attr.attributetype]}, { type: ${typedeclname} }>`;
    gotwrdattr();
  } else {
    typedef = `WRDAttributeType.${WRDAttributeType[attr.attributetype]}`;
  }
  if (attr.isrequired) {
    typedef = `IsRequired<${typedef}>`;
    gotrequired();
  }
  return typedef;
}

function generateFile(options: GenerateContext, { defname, modules }: { defname: string; modules: string[] }) {
  // Only process existing modules
  modules = modules.filter(module => backendConfig.module[module]);
  if (!modules.length) {
    return "";
  }

  return generateWRDDefs(options, defname, modules);
}

export async function listAllModuleWRDDefs(): Promise<FileToUpdate[]> {
  const noncoremodules = Object.keys(backendConfig.module).filter(m => !whconstant_builtinmodules.includes(m));

  return [
    {
      path: "wrd/webhare.ts",
      module: "platform",
      type: "wrd",
      generator: (options: GenerateContext) => generateFile(options, { defname: "webhare", modules: whconstant_builtinmodules })
    }, ...noncoremodules.map(m => ({
      path: `wrd/${m}.ts`,
      module: m,
      type: "wrd",
      generator: (options: GenerateContext) => generateFile(options, { defname: m, modules: [m] })
    }))
  ];
}
