import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";
import { backendConfig, resolveResource } from "@webhare/services";
import { WRDAttributeTypeId, WRDGender, type WRDAttributeType, WRDAttributeTypes } from "@webhare/wrd/src/types";
import { type GenerateContext, type FileToUpdate, generatorBanner, isNodeApplicableToThisWebHare } from "./shared";
import { type WRDAttributeConfigurationBase, tagToJS } from "@webhare/wrd/src/wrdsupport";
import type { Document } from "@xmldom/xmldom";
import { emplace } from "@webhare/std";
import { elements, getAttr } from "./xmlhelpers";
import { parseSchema, wrd_baseschemaresource, type ParsedAttr } from "@webhare/wrd/src/schemaparser";
import type { WRDSchemas } from "@mod-platform/generated/schema/moduledefinition";

/** Convert snake_case to CamelCase, with the first character uppercase. Special cases the words 'WRD', 'WH' and 'WebHare' */
export function generateTypeName(str: string) {
  str = str.toLowerCase();
  if (str.startsWith("wrd"))
    str = "WRD_" + str.substring(3);
  else if (str.startsWith("wh"))
    str = "WH_" + str.substring(2);
  else if (str.startsWith("webhare"))
    str = "WebHare_" + str.substring(7);

  str = str.split(/-|_/).filter(e => e).map(e => e[0].toUpperCase() + e.substring(1)).join("");
  str = str.replaceAll("*", "Wildcard");
  return str;
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

  str = str.split(/-|_/).filter(e => e).map((e, idx) => idx ? e[0].toUpperCase() + e.substring(1) : e).join("");
  str = str.replaceAll("*", "Wildcard");
  return str;
}

/** Format of schema definition data return by HareScript */

interface WRDAttributeConfigurationWithChildren extends WRDAttributeConfigurationBase {
  childAttributes?: Record<string, WRDAttributeConfigurationWithChildren>;
}

interface DeclaredAttribute extends WRDAttributeConfigurationWithChildren {
  childAttributes?: Record<string, DeclaredAttribute>;
  isGenerated: boolean;
  isBase: boolean; //if in one of the WRDTypeBaseSettings types
  typeDeclaration?: string;
}

interface ModuleWRDSchemaBaseDef {
  /** @deprecated 'module' should already be in our parent object */
  module: string;
  /** Full module:tag schema name. May contain wildcards */
  wrdSchema: string;
  /** It's an exact match */
  isExactMatch: boolean;
  /** Resource path containing schema definition */
  schemaDefinitionResource: string;
  /** Schema title */
  title: string;
  /** Abstract schema? (shouldn't exist) */
  abstract: boolean;
  /** Should this schema be autocreated? */
  autoCreate: boolean;
}

interface ModuleWRDSchemaDef extends ModuleWRDSchemaBaseDef {
  /** Type base name for the schema */
  schemaTypeBase: string;
  /** Type name for the schema */
  schemaTypeName: string;
  /** Modern type name for the schema */
  schemaTypeNameModern: string;
  /** Object name for the schema (deprecated, used by the wh:wrd/... typescript files) */
  schemaObject: string;
}

interface PaymentProviderDef {
  /** module:tag */
  tag: string;
  /** Title */
  title: string;
  /** Path to driver */
  driver: string;
  paymentInfoScreen: string;
  configExtensions: string;
}

export interface WRDSchemasExtract {
  schemas: ModuleWRDSchemaDef[];
  psp: PaymentProviderDef[];
}

function parseXMLWRDSchemas(mod: string, doc: Document) {
  const schemas = new Array<ModuleWRDSchemaBaseDef>();

  for (const wrdschemas of elements(doc.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "wrdschemas"))) {
    for (const wrdschema of elements(wrdschemas.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "schema"))) {
      if (!isNodeApplicableToThisWebHare(wrdschema, ""))
        continue;

      const tag = wrdschema.getAttribute("tag") || "";
      const fulltag = mod + ":" + tag;
      const isExactMatch = !(tag.includes('*') || tag.includes('?'));

      schemas.push({
        module: mod,
        isExactMatch,
        title: getAttr(wrdschema, "title", ""),
        wrdSchema: fulltag,
        schemaDefinitionResource: resolveResource(`mod::${mod}/moduledefinition.xml`, getAttr(wrdschema, 'definitionfile', '')),
        autoCreate: isExactMatch && getAttr(wrdschema, "autocreate", true),
        abstract: !isExactMatch
      });
    }
  }

  return schemas;
}

function parseYMLWRDSchemas(mod: string, yml: WRDSchemas) {
  const schemas = new Array<ModuleWRDSchemaBaseDef>();

  for (const [tag, def] of Object.entries(yml)) {
    const fulltag = mod + ":" + tag;
    const isExactMatch = !(tag.includes('*') || tag.includes('?'));

    schemas.push({
      wrdSchema: fulltag,
      module: mod,
      isExactMatch,
      abstract: def.abstract ?? false,
      title: def.title || '',
      schemaDefinitionResource: def.schema ? resolveResource(`mod::${mod}/moduledefinition.yml`, def.schema) : '',
      autoCreate: (def.autoCreate ?? true) && isExactMatch && !def.abstract
    });
  }
  return schemas;
}

export class WRDSchemaCache {
  cache = new Map<string, ModuleWRDSchemaDef[]>();

  async getSchemas(context: GenerateContext, modulename: string): Promise<ModuleWRDSchemaDef[]> {
    let schemas = this.cache.get(modulename);
    if (!schemas) {
      schemas = await getModuleWRDSchemas(context, modulename);
      this.cache.set(modulename, schemas);
    }
    return schemas;
  }
}

function addTypeNames(schemaptr: ModuleWRDSchemaBaseDef): ModuleWRDSchemaDef {
  const [modulename, schematag] = schemaptr.wrdSchema.split(":");
  const isPlatformPart = whconstant_builtinmodules.includes(modulename);
  const modprefix = isPlatformPart ? `${generateTypeName(modulename)}_` : ``;
  const schemaTypeBase = `${modprefix}${generateTypeName(schematag)}`;
  return {
    ...schemaptr,
    schemaTypeBase,
    schemaTypeName: `${schemaTypeBase}SchemaType`,
    schemaTypeNameModern: `ModernSchemaType_${generateTypeName(modulename)}__${generateTypeName(schematag)}`,
    schemaObject: generatePropertyName((isPlatformPart ? `${modulename}_` : ``) + schematag + "_schema"),
  };
}

export async function getModuleWRDSchemas(context: GenerateContext, modulename: string): Promise<ModuleWRDSchemaDef[]> {
  const schemas = [];
  const mods = modulename === "platform" ? whconstant_builtinmodules : [modulename];

  for (const mod of context.moduledefs) {
    if (!mods.includes(mod.name))
      continue;

    if (mod.modXml)
      schemas.push(...parseXMLWRDSchemas(mod.name, mod.modXml));
    if (mod.modYml?.wrdSchemas)
      schemas.push(...parseYMLWRDSchemas(mod.name, mod.modYml.wrdSchemas));
  }
  return schemas.map(addTypeNames);
}

export async function getModulePaymentProviders(context: GenerateContext, modulename: string): Promise<PaymentProviderDef[]> {
  const providers = new Array<PaymentProviderDef>();
  const mods = modulename === "platform" ? whconstant_builtinmodules : [modulename];

  for (const mod of context.moduledefs) {
    if (!mods.includes(mod.name))
      continue;
    if (mod.modYml?.paymentProviders) {
      for (const [tag, def] of Object.entries(mod.modYml.paymentProviders)) {
        providers.push({
          tag: `${mod.name}:${tag}`,
          title: def.title ? `:${def.title}` : `:${mod.name}:${tag}`,
          driver: resolveResource(`mod::${mod.name}/moduledefinition.yml`, def.driver),
          configExtensions: resolveResource(`mod::${mod.name}/moduledefinition.yml`, def.configExtensions || ''),
          paymentInfoScreen: resolveResource(`mod::${mod.name}/moduledefinition.yml`, def.paymentInfoScreen || '')
        });
      }
    }
  }
  return providers;
}

export async function getAllModuleWRDSchemas(context: GenerateContext): Promise<WRDSchemasExtract> {
  const extract: WRDSchemasExtract = {
    schemas: [],
    psp: []
  };

  for (const mod of context.moduledefs) {
    extract.schemas.push(...await getModuleWRDSchemas(context, mod.name));
    extract.psp.push(...await getModulePaymentProviders(context, mod.name));
  }

  return extract;
}

///A limited view to prevent devbridge from relying on generator-only propertires
export interface PublicParsedWRDSchemaDef {
  schemaTypeName: string;
  schemaTypeNameModern: string;
  schemaObject: string;
  types: Record<string, {
    typeName: string;
    attrdefs: Record<string, WRDAttributeConfigurationWithChildren>;
  }>;
}

interface ParsedWRDSchemaDef extends PublicParsedWRDSchemaDef {
  types: Record<string, {
    typeName: string;
    typeNameModern: string;
    attrdefs: Record<string, DeclaredAttribute>;
  }>;
}

function buildAttrsFromArray(attrs: ParsedAttr[]): Record<string, DeclaredAttribute> {
  const attrdefs: Record<string, DeclaredAttribute> = {};
  for (const attr of attrs) {
    if (!attr.attributetype) //this is an <obsolete ...
      continue;

    const ltag = tagToJS(attr.tag);
    attrdefs[ltag] = {
      attributeType: WRDAttributeTypes[attr.attributetype - 1],
      allowedValues: attr.allowedvalues,
      isRequired: attr.isrequired,
      isGenerated: false,
      isBase: false,
      childAttributes: attr.attrs?.length ? buildAttrsFromArray(attr.attrs) : undefined,
      typeDeclaration: attr.typedeclaration
    };
  }
  return attrdefs;
}

export async function parseWRDDefinitionFile(schemaptr: ModuleWRDSchemaDef): Promise<ParsedWRDSchemaDef> {
  const parsedschemadef: ParsedWRDSchemaDef = {
    schemaTypeName: schemaptr.schemaTypeName,
    schemaTypeNameModern: schemaptr.schemaTypeNameModern,
    schemaObject: schemaptr.schemaObject,
    types: {}
  };

  const schemadef = await parseSchema(schemaptr.schemaDefinitionResource || wrd_baseschemaresource, true, null);

  for (const type of schemadef.types) {
    const typeinfo: ParsedWRDSchemaDef["types"][string] = {
      typeName: `${schemaptr.schemaTypeBase}_${generateTypeName(type.tag)}`,
      typeNameModern: `${schemaptr.schemaTypeBase}_${generateTypeName(type.tag)}Modern`,
      attrdefs: {
        wrdId: { attributeType: "integer", isGenerated: false, isRequired: false, isBase: true },
        wrdGuid: { attributeType: "string", isGenerated: false, isRequired: false, isBase: true },
        wrdType: { attributeType: "integer", isGenerated: false, isRequired: false, isBase: true },
        wrdTag: { attributeType: "string", isGenerated: false, isRequired: false, isBase: true },
        wrdCreationDate: { attributeType: "instant", isGenerated: false, isRequired: false, isBase: true },
        wrdLimitDate: { attributeType: "instant", isGenerated: false, isRequired: false, isBase: true },
        wrdModificationDate: { attributeType: "instant", isGenerated: false, isRequired: false, isBase: true }
      }
    };

    if (type.type !== "OBJECT")
      typeinfo.attrdefs.wrdLeftEntity = { attributeType: "domain", isGenerated: false, isRequired: type.type !== "DOMAIN", isBase: false };

    if (type.type === "LINK")
      typeinfo.attrdefs.wrdRightEntity = { attributeType: "domain", isGenerated: false, isRequired: true, isBase: false };

    if (type.type === "DOMAIN")
      typeinfo.attrdefs.wrdTitle = { attributeType: "string", isGenerated: false, isRequired: false, isBase: false };

    const parentpath = [];
    for (let ptype: typeof type | undefined = type; ptype; ptype = schemadef.types.find(t => t.tag === ptype?.parenttype_tag))
      parentpath.push(ptype.tag);

    if (parentpath.includes("WRD_PERSON")) {
      typeinfo.attrdefs.wrdGender = { attributeType: "enum", isGenerated: false, isRequired: false, isBase: false, allowedValues: Object.values(WRDGender) };
      typeinfo.attrdefs.wrdFullName = { attributeType: "string", isGenerated: true, isRequired: false, isBase: false };
      typeinfo.attrdefs.wrdTitles = { attributeType: "string", isGenerated: false, isRequired: false, isBase: false };
      typeinfo.attrdefs.wrdInitials = { attributeType: "string", isGenerated: false, isRequired: false, isBase: false };
      typeinfo.attrdefs.wrdFirstName = { attributeType: "string", isGenerated: false, isRequired: false, isBase: false };
      typeinfo.attrdefs.wrdFirstNames = { attributeType: "string", isGenerated: false, isRequired: false, isBase: false };
      typeinfo.attrdefs.wrdInfix = { attributeType: "string", isGenerated: false, isRequired: false, isBase: false };
      typeinfo.attrdefs.wrdLastName = { attributeType: "string", isGenerated: false, isRequired: false, isBase: false };
      typeinfo.attrdefs.wrdTitlesSuffix = { attributeType: "string", isGenerated: false, isRequired: false, isBase: false };
      typeinfo.attrdefs.wrdDateOfBirth = { attributeType: "plainDate", isGenerated: false, isRequired: false, isBase: false };
      typeinfo.attrdefs.wrdDateOfDeath = { attributeType: "plainDate", isGenerated: false, isRequired: false, isBase: false };
    }
    if (parentpath.includes("WRD_ORGANIZATION"))
      typeinfo.attrdefs.wrdOrgName = { attributeType: "string", isGenerated: false, isRequired: false, isBase: false };
    if (parentpath.includes("WRD_PERSON") || parentpath.includes("WRD_RELATION") || parentpath.includes("WRD_ORGANIZATION"))
      typeinfo.attrdefs.wrdTitle = { attributeType: "string", isGenerated: true, isRequired: false, isBase: false };

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


  return parsedschemadef;
}

export async function generateWRDDefs(context: GenerateContext, cache: WRDSchemaCache, modulename: string): Promise<string> {
  let fullfile = "";
  const typeDeclNames = new Set<string>;
  const typeDeclImports = new Map<string, Map<string, string>>;

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
  const schemasptrs = (await cache.getSchemas(context, modulename)).sort((a, b) => a.wrdSchema < b.wrdSchema ? -1 : 1);

  const schemaconsts = [];
  for (const schemaptr of schemasptrs) {
    if (context.verbose)
      console.time("generateWRDDefs " + schemaptr.wrdSchema);

    const wrddef = await parseWRDDefinitionFile(schemaptr);
    let def = '';
    let fulldef = `export type ${wrddef.schemaTypeName} = { //To modernize: replace with WRDSchemaDefinitions[${JSON.stringify(schemaptr.wrdSchema)}]\n`;

    // Process the types sorted on tag
    for (const [tag, type] of Object.entries(wrddef.types).sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      def += `export type ${type.typeName} = WRDTypeBaseSettings`;

      const attrlines = [];
      for (const [name, attrdef] of Object.entries(type.attrdefs)) {
        if (attrdef.isBase)
          continue; //the ones with null are in WRDTypeBaseSettings

        attrlines.push(`  ${name}: ${createTypeDef(attrdef, "  ", addTypeDeclImport, false)}`);
      }

      if (attrlines.length)
        def += ` & {\n${attrlines.join(";\n")};\n}`;

      def += ';\n\n';
      fulldef += `  ${tag}: ${type.typeName};\n`;
    }
    fulldef += `};\n\n`;

    let fulldefModern = `export type ${wrddef.schemaTypeNameModern} = { //Refer to this schema type using WRDSchemaDefinitions[${JSON.stringify(schemaptr.wrdSchema)}]\n`;

    // Process the types sorted on tag
    for (const [tag, type] of Object.entries(wrddef.types).sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      def += `type ${type.typeNameModern} = WRDTypeBaseSettingsModern`;

      const attrlines = [];
      for (const [name, attrdef] of Object.entries(type.attrdefs)) {
        if (attrdef.isBase)
          continue; //the ones with null are in WRDTypeBaseSettings

        attrlines.push(`  ${name}: ${createTypeDef(attrdef, "  ", addTypeDeclImport, true)}`);
      }

      if (attrlines.length)
        def += ` & {\n${attrlines.join(";\n")};\n}`;

      def += ';\n\n';
      fulldefModern += `  ${tag}: ${type.typeNameModern};\n`;
    }
    fulldefModern += `};\n\n`;


    if (!schemaptr.abstract)
      schemaconsts.push(`export const ${(wrddef.schemaObject)} = new WRDLegacySchema<${wrddef.schemaTypeName}>(${JSON.stringify(schemaptr.wrdSchema)}); //Replace with wrd(${JSON.stringify(schemaptr.wrdSchema)})`);

    fullfile += def + fulldef + fulldefModern;

    if (context.verbose)
      console.timeEnd("generateWRDDefs " + schemaptr.wrdSchema);
  }

  if (fullfile) {
    const typedecls = Array.from(typeDeclImports.entries()).map(([library, imports]) => {
      const names = Array.from(imports).map(([name, usename]) => (name !== usename ? `${name} as ${usename} ` : name)).join(", ");
      library = library.replace(/(\.d)?\.tsx?$/, ""); // remove .d.ts,  .ts, .tsx extensions
      return `import type { ${names} } from ${JSON.stringify(library)}; \n`;
    }
    ).join("");

    fullfile = `${generatorBanner}
import type { WRDTypeBaseSettings, WRDTypeBaseSettingsModern, WRDBaseAttributeTypeId, WRDAttributeTypeId, IsGenerated, IsRequired, WRDAttr } from "@webhare/wrd/src/types";
import { WRDLegacySchema } from "@webhare/wrd/src/schema";

${typedecls}
${fullfile}

///Schema variables
${schemaconsts.join("\n")}
`; //NOTE: we want the file to end on a newline
  }

  return fullfile;
}

function getEnumName(type: WRDAttributeType, modern: boolean): string {
  if (modern) {
    switch (type) {
      case "plainDate": return "WRDBaseAttributeTypeId.Modern_Date";
      case "instant": return "WRDBaseAttributeTypeId.Modern_DateTime";
      case "plainTime": return "WRDBaseAttributeTypeId.Modern_Time";
    }
  }

  const toId = WRDAttributeTypes.indexOf(type);
  return `WRDAttributeTypeId.${WRDAttributeTypeId[toId + 1]}`;
}

function hasWildcard(val: string) {
  return val.includes("*") || val.includes("?");
}

function createTypeDef(attr: DeclaredAttribute, indent: string, gottypedecl: (decl: string) => string, modern: boolean): string {
  let typedef = "";
  if (attr.attributeType === "enum" || attr.attributeType === "enumArray") {
    let allowedValues = attr.allowedValues?.filter(v => !hasWildcard(v)).map(v => JSON.stringify(v)).join(" | ");
    if (attr.allowedValues?.some(hasWildcard)) //any wildcard?
      allowedValues = allowedValues ? allowedValues + " | string" : "string";

    typedef = `WRDAttr<${getEnumName(attr.attributeType, modern)}, { allowedValues: ${allowedValues || "never"} }>`;
  } else if (attr.attributeType === "array") {
    typedef = `WRDAttr<${getEnumName(attr.attributeType, modern)}, {\n${indent}  members: {\n`;
    if (attr.childAttributes) {
      for (const [tag, subattr] of Object.entries(attr.childAttributes)) {
        const subdef = createTypeDef(subattr, indent + "    ", gottypedecl, modern);
        if (subdef)
          typedef += `${indent}    ${tag}: ${subdef};\n`;
      }
    }
    typedef += `${indent}  };\n${indent}}>`;
  } else if (attr.attributeType === "json") {
    const typedeclname = attr.typeDeclaration ? gottypedecl(attr.typeDeclaration) : "object";
    typedef = `WRDAttr<${getEnumName(attr.attributeType, modern)}, { type: ${typedeclname} }>`;
  } else if (attr.attributeType === "deprecatedStatusRecord") {
    const typedeclname = attr.typeDeclaration ? gottypedecl(attr.typeDeclaration) : "object";
    typedef = `WRDAttr<${getEnumName(attr.attributeType, modern)}, { allowedValues: ${attr.allowedValues?.map(v => JSON.stringify(v)).join(" | ")}; type: ${typedeclname} }>`;
  } else {
    typedef = `${getEnumName(attr.attributeType, modern)}`;
  }
  if (attr.isRequired) {
    typedef = `IsRequired<${typedef}>`;
  }
  return typedef;
}

export async function generateWRDPointers(context: GenerateContext, cache: WRDSchemaCache, platform: boolean, mods: string[]): Promise<string> {
  const schemas = [];
  for (const mod of mods) {
    for (const schema of await cache.getSchemas(context, mod)) {
      schemas.push({
        wrdSchema: schema.wrdSchema,
        type: schema.schemaTypeNameModern,
        import: platform ? `@mod-platform/generated/wrd/webhare.ts` : `wh:wrd/${schema.module}.ts`,
      });
    }
  }

  return `${generatorBanner}

declare module ${JSON.stringify(platform ? "@mod-platform/generated/ts/wrd.ts" : "wh:ts/wrd.ts")} {
}

${schemas.map(s => `import type { ${s.type} } from ${JSON.stringify(s.import)};`).join("\n")}

declare module "@mod-platform/generated/ts/wrd.ts" {
  export interface WRDSchemaDefinitions {
    ${schemas.map(s => `${JSON.stringify(s.wrdSchema)}: ${s.type};`).join("\n    ")}
  }
}
`;
}

export async function listAllModuleWRDDefs(): Promise<FileToUpdate[]> {
  const noncoremodules = Object.keys(backendConfig.module).filter(m => !whconstant_builtinmodules.includes(m));
  const cache = new WRDSchemaCache;

  return [
    {
      path: "wrd/webhare.ts",
      module: "platform",
      type: "wrd",
      generator: (options: GenerateContext) => generateWRDDefs(options, cache, "platform")
    }, ...noncoremodules.map((module: string): FileToUpdate => ({
      path: `wrd/${module}.ts`,
      module,
      type: "wrd",
      generator: (options: GenerateContext) => generateWRDDefs(options, cache, module)
    })),
    {
      path: `ts/wrd.ts`,
      module: "platform",
      type: "wrd",
      generator: (context: GenerateContext) => generateWRDPointers(context, cache, true, ["platform"])
    }, {

      path: `ts/wrd.ts`,
      module: "dummy-installed",
      type: "wrd",
      generator: (context: GenerateContext) => generateWRDPointers(context, cache, false, noncoremodules)
    }
  ];
}
