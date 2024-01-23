import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";
import { backendConfig, resolveResource } from "@webhare/services";
import { WRDBaseAttributeType, WRDAttributeType, WRDGender } from "@mod-wrd/js/internal/types";
import { GenerateContext, FileToUpdate, generatorBanner } from "./shared";
import { WRDAttributeConfigurationBase, tagToJS } from "@webhare/wrd/src/wrdsupport";
import { loadlib } from "@webhare/harescript";
import { emplace } from "@webhare/std";
import { elements } from "./xmlhelpers";
import { getGeneratedFilePath } from "./generator";

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

interface WRDAttributeConfigurationWithChildren extends WRDAttributeConfigurationBase {
  childAttributes?: Record<string, WRDAttributeConfigurationWithChildren>;
}

interface DeclaredAttribute extends WRDAttributeConfigurationWithChildren {
  childAttributes?: Record<string, DeclaredAttribute>;
  isGenerated: boolean;
  defstr?: string | null; //'null' if in WRDTypeBaseSettings
  typeDeclaration?: string;
}

///SchemaDef as received from HareScript
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

interface ModuleWRDSchemaDef {
  module: string;
  wrdschema: string;
  definitionfile: string;
}

export async function getModuleWRDSchemas(context: GenerateContext, modulename: string) {
  const schemas = new Array<ModuleWRDSchemaDef>();
  const mods = modulename === "platform" ? whconstant_builtinmodules : [modulename];
  for (const mod of mods) {
    const doc = context.moduledefs.find(m => m.name === mod)?.modXml;
    if (!doc)
      continue;

    for (const wrdschemas of elements(doc.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "wrdschemas"))) {
      for (const wrdschema of elements(wrdschemas.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "schema"))) {
        const tag = wrdschema.getAttribute("tag") || "";
        const fulltag = mod + ":" + tag;
        const definitionfile = wrdschema.getAttribute("definitionfile") || "";
        if (!definitionfile)
          continue;

        const resolved_definitionfile = resolveResource(`mod::${mod}/moduledefinition.xml`, definitionfile);
        if (!resolved_definitionfile)
          throw new Error(`Huh? ${mod} ${definitionfile}`);

        schemas.push({ module: modulename, wrdschema: fulltag, definitionfile: resolved_definitionfile });
      }
    }
  }

  return {
    schemas,
    library: getGeneratedFilePath(modulename, "wrd", `wrd/${modulename === "platform" ? "webhare" : modulename}.ts`)
  };
}

///A limited view to prevent devbridge from relying on generator-only propertires
export interface PublicParsedWRDSchemaDef {
  schemaTypeName: string;
  schemaObject: string;
  types: Record<string, {
    typeName: string;
    attrdefs: Record<string, WRDAttributeConfigurationWithChildren>;
  }>;
}

interface ParsedWRDSchemaDef extends PublicParsedWRDSchemaDef {
  types: Record<string, {
    typeName: string;
    attrdefs: Record<string, DeclaredAttribute>;
  }>;
}

function buildAttrsFromArray(attrs: SchemaDef["types"][0]["allattrs"]): Record<string, DeclaredAttribute> {
  const attrdefs: Record<string, DeclaredAttribute> = {};
  for (const attr of attrs) {
    if (!attr.attributetype) //this is an <obsolete ...
      continue;

    const ltag = tagToJS(attr.tag);
    attrdefs[ltag] = {
      attributeType: attr.attributetype as WRDAttributeType,
      allowedValues: attr.allowedvalues,
      isRequired: attr.isrequired,
      isGenerated: false,
      childAttributes: attr.attrs?.length ? buildAttrsFromArray(attr.attrs) : undefined,
      typeDeclaration: attr.typedeclaration
    };
  }
  return attrdefs;
}

export async function parseWRDDefinitionFile(schemaptr: ModuleWRDSchemaDef): Promise<ParsedWRDSchemaDef> {
  const [modulename, schematag] = schemaptr.wrdschema.split(":");
  const modprefix = schemaptr.module === "platform" ? `${generateTypeName(modulename)}_` : ``;
  const parsedschemadef: ParsedWRDSchemaDef = {
    schemaTypeName: `${modprefix}${generateTypeName(schematag)}SchemaType`,
    schemaObject: generatePropertyName((schemaptr.module === "platform" ? `${modulename}_` : ``) + schematag + "_schema"),
    types: {}
  };

  try {
    const schemadef = await loadlib("mod::wrd/lib/internal/metadata/schemaparser.whlib").OpenWRDSchemaDefFile(schemaptr.definitionfile) as SchemaDef;

    for (const type of schemadef.types) {
      const typeinfo: ParsedWRDSchemaDef["types"][string] = {
        typeName: `${modprefix}${generateTypeName(schematag)}_${generateTypeName(type.tag)}`,
        attrdefs: {
          wrdId: { attributeType: WRDAttributeType.Integer, isGenerated: false, isRequired: false, defstr: null },
          wrdGuid: { attributeType: WRDAttributeType.Free, isGenerated: false, isRequired: false, defstr: null },
          wrdType: { attributeType: WRDAttributeType.Integer, isGenerated: false, isRequired: false, defstr: null },
          wrdTag: { attributeType: WRDAttributeType.Free, isGenerated: false, isRequired: false, defstr: null },
          wrdCreationDate: { attributeType: WRDAttributeType.DateTime, isGenerated: false, isRequired: false, defstr: null },
          wrdLimitDate: { attributeType: WRDAttributeType.DateTime, isGenerated: false, isRequired: false, defstr: null },
          wrdModificationDate: { attributeType: WRDAttributeType.DateTime, isGenerated: false, isRequired: false, defstr: null }
        }
      };

      if (type.type !== "OBJECT")
        typeinfo.attrdefs.wrdLeftEntity = { attributeType: WRDAttributeType.Domain, isGenerated: false, isRequired: type.type !== "DOMAIN", defstr: `WRDBaseAttributeType.Base_Domain` };

      if (type.type === "LINK")
        typeinfo.attrdefs.wrdRightEntity = { attributeType: WRDAttributeType.Domain, isGenerated: false, isRequired: true, defstr: `WRDBaseAttributeType.Base_Domain` };

      const parentpath = [];
      for (let ptype: typeof type | undefined = type; ptype; ptype = schemadef.types.find(t => t.tag === ptype?.parenttype_tag))
        parentpath.push(ptype.tag);

      if (parentpath.includes("WRD_PERSON")) {
        typeinfo.attrdefs.wrdGender = { attributeType: WRDAttributeType.Enum, isGenerated: false, isRequired: false, defstr: `WRDBaseAttributeType.Base_Gender`, allowedValues: Object.values(WRDGender) };
        typeinfo.attrdefs.wrdSaluteFormal = { attributeType: WRDAttributeType.Free, isGenerated: true, isRequired: false, defstr: `IsGenerated<WRDBaseAttributeType.Base_GeneratedString>` };
        typeinfo.attrdefs.wrdAddressFormal = { attributeType: WRDAttributeType.Free, isGenerated: true, isRequired: false, defstr: `IsGenerated<WRDBaseAttributeType.Base_GeneratedString>` };
        typeinfo.attrdefs.wrdFullName = { attributeType: WRDAttributeType.Free, isGenerated: true, isRequired: false, defstr: `IsGenerated<WRDBaseAttributeType.Base_GeneratedString>` };
        typeinfo.attrdefs.wrdTitles = { attributeType: WRDAttributeType.Free, isGenerated: false, isRequired: false, defstr: `WRDBaseAttributeType.Base_NameString` };
        typeinfo.attrdefs.wrdInitials = { attributeType: WRDAttributeType.Free, isGenerated: false, isRequired: false, defstr: `WRDBaseAttributeType.Base_NameString` };
        typeinfo.attrdefs.wrdFirstName = { attributeType: WRDAttributeType.Free, isGenerated: false, isRequired: false, defstr: `WRDBaseAttributeType.Base_NameString` };
        typeinfo.attrdefs.wrdFirstNames = { attributeType: WRDAttributeType.Free, isGenerated: false, isRequired: false, defstr: `WRDBaseAttributeType.Base_NameString` };
        typeinfo.attrdefs.wrdInfix = { attributeType: WRDAttributeType.Free, isGenerated: false, isRequired: false, defstr: `WRDBaseAttributeType.Base_NameString` };
        typeinfo.attrdefs.wrdLastName = { attributeType: WRDAttributeType.Free, isGenerated: false, isRequired: false, defstr: `WRDBaseAttributeType.Base_NameString` };
        typeinfo.attrdefs.wrdTitlesSuffix = { attributeType: WRDAttributeType.Free, isGenerated: false, isRequired: false, defstr: `WRDBaseAttributeType.Base_NameString` };
        typeinfo.attrdefs.wrdDateOfBirth = { attributeType: WRDAttributeType.DateTime, isGenerated: false, isRequired: false, defstr: `WRDBaseAttributeType.Base_Date` };
        typeinfo.attrdefs.wrdDateOfDeath = { attributeType: WRDAttributeType.DateTime, isGenerated: false, isRequired: false, defstr: `WRDBaseAttributeType.Base_Date` };
      }
      if (parentpath.includes("WRD_ORGANIZATION"))
        typeinfo.attrdefs.wrdOrgName = { attributeType: WRDAttributeType.Free, isGenerated: false, isRequired: false, defstr: `WRDAttributeType.Free` };
      if (parentpath.includes("WRD_PERSON") || parentpath.includes("WRD_RELATION") || parentpath.includes("WRD_ORGANIZATION"))
        typeinfo.attrdefs.wrdTitle = { attributeType: WRDAttributeType.Free, isGenerated: true, isRequired: false, defstr: `IsGenerated<WRDBaseAttributeType.Base_GeneratedString>` };

      for (const [tag, attr] of Object.entries(buildAttrsFromArray(type.allattrs))) {
        if (!typeinfo.attrdefs[tag]) {
          typeinfo.attrdefs[tag] = attr;
        } else { //updating a builtin attribute
          if (attr.isRequired && !typeinfo.attrdefs[tag].isRequired) {
            typeinfo.attrdefs[tag].isRequired = true;
          }
        }
      }
      parsedschemadef.types[tagToJS(type.tag)] = typeinfo;
    }
  } catch (e) {
    console.log(schemaptr.wrdschema + ": " + (e as Error).message); //TODO log it, back to console.error, but we need to understand applicability first as we now fail for newsletter module
  }

  return parsedschemadef;
}

export async function generateWRDDefs(context: GenerateContext, modulename: string): Promise<string> {
  let fullfile = "";
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

  // Sort on schema name
  const schemasptrs = (await getModuleWRDSchemas(context, modulename)).schemas.sort((a, b) => a.wrdschema < b.wrdschema ? -1 : 1);

  const schemaconsts = [];
  for (const schemaptr of schemasptrs) {
    if (context.verbose)
      console.time("generateWRDDefs " + schemaptr.wrdschema);

    const wrddef = await parseWRDDefinitionFile(schemaptr);
    let def = '';
    let fulldef = `export type ${wrddef.schemaTypeName} = {\n`;

    // Process the types sorted on tag
    for (const [tag, type] of Object.entries(wrddef.types).sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      def += `export type ${type.typeName} = WRDTypeBaseSettings`;

      const attrlines = [];
      for (const [name, attrdef] of Object.entries(type.attrdefs)) {
        if (attrdef.defstr === null)
          continue; //the ones with null are in WRDTypeBaseSettings

        attrlines.push(`  ${name}: ${createTypeDef(attrdef, "  ", addTypeDeclImport)}`);
      }

      if (attrlines.length)
        def += ` & {\n${attrlines.join(";\n")};\n}`;

      def += ';\n\n';
      fulldef += `  ${tag}: ${type.typeName};\n`;
    }
    fulldef += `};\n\n`;

    schemaconsts.push(`export const ${(wrddef.schemaObject)} = new WRDSchema<${wrddef.schemaTypeName}>(${JSON.stringify(schemaptr.wrdschema)});`);

    fullfile += def + fulldef;

    if (context.verbose)
      console.timeEnd("generateWRDDefs " + schemaptr.wrdschema);
  }

  if (fullfile) {
    const typedecls = Array.from(typeDeclImports.entries()).map(([library, imports]) => {
      const names = Array.from(imports).map(([name, usename]) => (name !== usename ? `${name} as ${usename} ` : name)).join(", ");
      library = library.replace(/(\.d)?\.tsx?$/, ""); // remove .d.ts,  .ts, .tsx extensions
      return `import type { ${names}
  } from ${JSON.stringify(library)}; \n`;
    }
    ).join("");

    fullfile = `${generatorBanner}
import type { WRDTypeBaseSettings, WRDBaseAttributeType, WRDAttributeType, IsGenerated, IsRequired, WRDAttr } from "@mod-wrd/js/internal/types";
import { WRDSchema } from "@mod-wrd/js/internal/schema";

${typedecls}
${fullfile}

///Schema variables
${schemaconsts.join("\n")}
`; //NOTE: we want the file to end on a newline
  }

  return fullfile;
}


function createTypeDef(attr: DeclaredAttribute, indent: string, gottypedecl: (decl: string) => string): string {
  let typedef = "";
  if (attr.attributeType == WRDAttributeType.Enum || attr.attributeType == WRDAttributeType.EnumArray) {
    typedef = `WRDAttr<WRDAttributeType.${WRDAttributeType[attr.attributeType]}, { allowedvalues: ${attr.allowedValues?.map(v => JSON.stringify(v)).join(" | ")} }>`;
  } else if (attr.attributeType == WRDAttributeType.Array) {
    typedef = `WRDAttr<WRDAttributeType.${WRDAttributeType[attr.attributeType]}, {\n${indent}  members: {\n`;
    if (attr.childAttributes) {
      for (const [tag, subattr] of Object.entries(attr.childAttributes)) {
        const subdef = createTypeDef(subattr, indent + "    ", gottypedecl);
        if (subdef)
          typedef += `${indent}    ${tag}: ${subdef};\n`;
      }
    }
    typedef += `${indent}  };\n${indent}}>`;
  } else if (attr.attributeType == WRDAttributeType.JSON) {
    const typedeclname = attr.typeDeclaration ? gottypedecl(attr.typeDeclaration) : "object";
    typedef = `WRDAttr<WRDAttributeType.${WRDAttributeType[attr.attributeType]}, { type: ${typedeclname} }>`;
  } else {
    typedef = `WRDAttributeType.${WRDAttributeType[attr.attributeType]}`;
  }
  if (attr.isRequired) {
    typedef = `IsRequired<${typedef}>`;
  }
  return typedef;
}

export async function listAllModuleWRDDefs(): Promise<FileToUpdate[]> {
  const noncoremodules = Object.keys(backendConfig.module).filter(m => !whconstant_builtinmodules.includes(m));

  return [
    {
      path: "wrd/webhare.ts",
      module: "platform",
      type: "wrd",
      generator: (options: GenerateContext) => generateWRDDefs(options, "platform")
    }, ...noncoremodules.map((module: string): FileToUpdate => ({
      path: `wrd/${module}.ts`,
      module,
      type: "wrd",
      generator: (options: GenerateContext) => generateWRDDefs(options, module)
    }))
  ];
}
