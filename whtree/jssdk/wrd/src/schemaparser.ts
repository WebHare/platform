import { resolveResource, toFSPath } from "@webhare/services";
import { readFile, stat } from "node:fs/promises";
import type { Node, Element } from "@xmldom/xmldom";
import { elements, getAttr, parseDocAsXML } from "@mod-system/js/internal/generation/xmlhelpers";
import { Money, throwError } from "@webhare/std";
import { maxDateTime } from "@webhare/hscompat";
import { isNodeApplicableToThisWebHare } from "@mod-system/js/internal/generation/shared";

export const wrd_baseschemaresource = "mod::wrd/data/wrdschemas/base.wrdschema.xml";
const ns_schemadef = "http://www.webhare.net/xmlns/wrd/schemadefinition";
const current_schema_version = 2; //v1 doesn't explicitly mention mod::wrd/data/wrdschemas/base.wrdschema.xml as a dependency, causing 5.03 WH upgrades to not apply WRD_SETTINGS

async function readResource(resource: string) {
  const diskpath = toFSPath(resource);
  const contents = await readFile(diskpath, 'utf-8');
  const moddate = (await stat(diskpath)).mtime;
  return { contents, moddate };
}

export interface ParsedAttr {
  attributetype: number;
  attributetypename: string;
  tag: string;
  title: string;
  description: string;
  isrequired: boolean;
  isunique: boolean;
  isunsafetocopy: boolean;
  multiline: boolean;
  allowedvalues: string[];
  domaintag: string;
  typedeclaration: string;
  checklinks: boolean;
  attrs: ParsedAttr[];
}

type ParsedMetaType = "OBJECT" | "ATTACHMENT" | "LINK" | "DOMAIN";

interface ParsedType {
  tag: string;
  type: ParsedMetaType;
  title: string;
  parenttype_tag: string;
  description: string;
  deleteclosedafter: number;
  keephistorydays: number;
  haspersonaldata: boolean;
  attrs: ParsedAttr[];
  allattrs: ParsedAttr[];
  hasvalues: boolean;
  vals: ParsedValue[];
  valslinenum: number;
  linkfrom_tag: string;
  linkto_tag: string;
  domvalsyncattr: string;
  domvalsoverwritefields: string[];
}

type ParsedValue = Record<string, unknown> & { __subvalues?: ParsedValue[] };

type AccountStatusOption = "active" | "inactive" | "blocked" | "required";

interface ParsedSchemaMetadata {
  accounttype?: string;
  accountloginfield?: string;
  accountemailfield?: string;
  accountpasswordfield?: string;
  accountstatus?: AccountStatusOption[];
}

interface ParsedFinalSchemaDef {
  types: ParsedType[];
  metadata: ParsedSchemaMetadata | null;
  migrations: Array<{
    tag: string;
    updatefunction: string;
    stage: string;
    revision: number;
    at: "create" | "update" | "";
  }>;
  schemaresources: {
    resources: Array<{
      resourcename: string;
      modified: Date;
    }>;
    version: number;
    schemaresource?: string;
  };
}

function finalize(schema: ParsedFinalSchemaDef): ParsedFinalSchemaDef {
  if (schema.metadata?.accountstatus?.length) {
    //If accountstatus has been enabled, add the ENUM to the accounttype
    if (!schema.metadata?.accounttype)
      throw new Error("Account status is enabled, but no accounttype is defined");

    const accounttype = schema.types.find(t => t.tag.toUpperCase() === schema.metadata?.accounttype?.toUpperCase());
    if (!accounttype)
      throw new Error(`Account status is enabled, but accounttype '${schema.metadata.accounttype}' is not defined`);

    if (accounttype.attrs.find(a => a.tag === "WRDAUTH_ACCOUNT_STATUS"))
      throw new Error(`Account status is enabled but attribute 'WRDAUTH_ACCOUNT_STATUS' already exists in type '${schema.metadata.accounttype}'`);

    const addattr: ParsedAttr = {
      attributetype: getAttributeTypeIdByTypeName("JSON"),
      attributetypename: "JSON",
      tag: "WRDAUTH_ACCOUNT_STATUS",
      title: "",
      description: "",
      isrequired: schema.metadata.accountstatus.includes("required"),
      isunique: false,
      isunsafetocopy: false,
      multiline: false,
      typedeclaration: `@webhare/auth.ts#WRDAuthAccountStatus`, //FIXME  & { status: "active" } but we need to test with a real generator
      allowedvalues: [],
      domaintag: "",
      checklinks: false,
      attrs: [],
    };

    accounttype.attrs.push(addattr);
    accounttype.allattrs.push(addattr);
  }

  return schema;
}

class ParsedSchemaDef {
  resources = new Array<{
    resourcename: string;
    modified: Date;
  }>;

  types = new Array<ParsedType>;
  metadata: ParsedSchemaMetadata = {};
  migrations: ParsedFinalSchemaDef["migrations"] = [];

  constructor() {

  }

  async importFile(resource: string) {
    if (this.resources.find(r => r.resourcename === resource))
      return;

    const { contents, moddate } = await readResource(resource);
    await this.readSchemaDef(resource, contents, moddate);
  }

  async readSchemaDef(resource: string, contents: string, moddate: Date) {
    //HS version validated but we won't ... that's up to checkmodule and its much easier for JS to be robust against missing values anyway
    const doc = parseDocAsXML(contents, 'text/xml');
    if (!doc.documentElement)
      throw new Error("Failed to parse XML schema definition");

    this.resources.push({ resourcename: resource, modified: moddate });

    for (const node of elements(doc.documentElement.childNodes)) {
      if (node.localName === "import") {
        const filetoimport = node.getAttribute("definitionfile");
        if (!filetoimport)
          throw new Error(`Missing definitionfile attribute in import node`);

        const fullpath = resolveResource(resource, filetoimport);
        await this.importFile(fullpath);
      } else if (node.localName === "migration") {
        if (!isNodeApplicableToThisWebHare(node, ''))
          continue;

        this.migrations.push({
          tag: getAttr(node, 'tag', ''),
          updatefunction: resolveResource(resource, getAttr(node, 'updatefunction', '')),
          stage: node.getAttribute("stage") || "beforeTypes",
          revision: getAttr(node, 'revision', 0),
          at: (node.getAttribute("at") || "") as "create" | "update" | ""
        });
      } else if (node.localName === "keyvalues") {
        //Pre WH5.7 servers still send these on WRD sync, ignore
        continue;
      } else {
        this.addType(node, resource);
      }
    }

    this.readMetadata(doc.documentElement);
  }

  readMetadata(rootnode: Element) {
    if (rootnode.hasAttribute("accounttype"))
      this.metadata.accounttype = rootnode.getAttribute("accounttype")!;
    if (rootnode.hasAttribute("accountloginfield"))
      this.metadata.accountloginfield = rootnode.getAttribute("accountloginfield")!;
    if (rootnode.hasAttribute("accountemailfield"))
      this.metadata.accountemailfield = rootnode.getAttribute("accountemailfield")!;
    if (rootnode.hasAttribute("accountpasswordfield"))
      this.metadata.accountpasswordfield = rootnode.getAttribute("accountpasswordfield")!;
    if (rootnode.hasAttribute("accountstatus"))
      this.metadata.accountstatus = getAttr(rootnode, "accountstatus", []) as AccountStatusOption[];
  }

  getResult(schemaResource: string): ParsedFinalSchemaDef {
    return finalize({
      types: this.types,
      metadata: this.metadata,
      migrations: this.migrations,
      schemaresources: {
        resources: this.resources.toSorted((lhs, rhs) => lhs.resourcename.localeCompare(rhs.resourcename)),
        version: current_schema_version,
        ...(schemaResource ? { schemaresource: schemaResource } : {}),
      }
    });
  }

  addType(typenode: Element, currentfile: string) {
    let which = typenode.localName;
    if (which === "classification")
      which = "attachment";

    if (!which || !["object", "attachment", "link", "domain", "extend"].includes(which))
      throw new Error(`Unrecognized object type '${which}'`);

    const typetag = typenode.getAttribute("tag")?.toUpperCase();
    if (!typetag)
      throw new Error(`Type has no tag`);

    const existingtypepos = this.types.findIndex(type => type.tag === typetag);
    let type;
    if (existingtypepos === -1) {  //ADDING
      if (type === 'extend')
        throw new Error(`Type '${typetag}' is not defined yet, cannot extend it`);

      type = {
        tag: typetag,
        type: which.toUpperCase() as ParsedMetaType,
        title: getAttr(typenode, "title", ""),
        parenttype_tag: getAttr(typenode, "parent", "").toUpperCase(),
        description: getAttr(typenode, "description", ""),
        deleteclosedafter: getAttr(typenode, "deleteclosedafter", 0),
        keephistorydays: getAttr(typenode, "keephistorydays", 0),
        haspersonaldata: getAttr(typenode, "haspersonaldata", false),
        linkfrom_tag: which === "attachment" || which === "link" ? getAttr(typenode, "linkfrom", "").toUpperCase() : "",
        linkto_tag: which === "link" ? getAttr(typenode, "linkto", "").toUpperCase() : "",
        attrs: [],
        allattrs: [],
        hasvalues: false,
        vals: [],
        valslinenum: -1,
        domvalsyncattr: "",
        domvalsoverwritefields: [],
      } satisfies ParsedType;
      if (type.tag === "WRD_PERSON" && !typenode.hasAttribute("haspersonaldata"))
        type.haspersonaldata = true;
    } else {
      type = this.types[existingtypepos];

      if (which !== "extend" && type.type !== which.toUpperCase())
        throw new Error(`Metatype '${type.type}' cannot be changed to '${which}' at the second declaration of type '${typetag}'`);

      if (typenode.hasAttribute("parent"))
        type.parenttype_tag = getAttr(typenode, "parent", "");

      if (typenode.hasAttribute("title"))
        type.title = getAttr(typenode, "title", "");

      if (typenode.hasAttribute("description"))
        type.description = getAttr(typenode, "description", "");

      if (typenode.hasAttribute("haspersonaldata"))
        type.haspersonaldata = getAttr(typenode, "haspersonaldata", false);

      if (typenode.hasAttribute("deleteclosedafter"))
        type.deleteclosedafter = getAttr(typenode, "deleteclosedafter", 0);

      if (typenode.hasAttribute("keephistorydays"))
        type.keephistorydays = getAttr(typenode, "keephistorydays", 0);
    }

    const attributes = typenode.getElementsByTagNameNS(ns_schemadef, "attributes")[0];
    if (attributes)
      type.attrs.push(...getXMLAttributes(attributes, currentfile));

    type.allattrs = structuredClone(type.attrs);
    //FIXME scan for dupes
    if (type.parenttype_tag) {
      const parentpos = this.types.findIndex(t => t.tag === type.parenttype_tag);
      if (parentpos !== -1) //FIXME this seems correct if a type is extended, we would re-encounter it and re-add our attributes to the parent
        type.allattrs.push(...this.types[parentpos].allattrs);
      /* ignore referring to nonexisting parents for backwards compatibility with schemaparser.whlib
          externally synched WRD Schemas may come in this way (with parent not (yet?) defined?)
          good reason to remove schema syncing in the future WRDSync and only trust local metadata
      else if (type.parenttype_tag !== "WRD_RELATION") {//you're allowed to refer to WRD_RELATION without defining it
        throw new Error(`Parent type '${type.parenttype_tag}' not found for type '${typetag}'`);
        */
    }

    const valuesnode = typenode.getElementsByTagNameNS(ns_schemadef, "values")[0];
    if (valuesnode) {
      if (type.hasvalues)
        throw new Error(`<values> can currently only be defined once for a type (reading a second <values> for '${typetag}'`);
      type.hasvalues = true;
      type.valslinenum = valuesnode.lineNumber || -1;
      type.domvalsyncattr = valuesnode.getAttribute("matchattribute")?.toUpperCase() || "";
      type.domvalsoverwritefields = getAttr(valuesnode, "overwriteattributes", []);

      // Overwrite WRD_TAG if it is the match attribute - fixes case sensitivity differences
      if (type.domvalsyncattr === "WRD_TAG" && !type.domvalsoverwritefields.includes("WRD_TAG"))
        type.domvalsoverwritefields.push("WRD_TAG");
      if (which === 'domain' && !type.domvalsoverwritefields.includes("WRD_LEFTENTITY"))
        type.domvalsoverwritefields.push("WRD_LEFTENTITY");

      const vals: ParsedValue[] = [];
      for (const [idx, valnode] of elements(valuesnode.childNodes).entries()) {
        if (valnode.localName !== "value")
          throw new Error(`Expected <value> in <values> node`);

        const val = this.parseEntityValue(valnode, String(idx), type, type.allattrs);
        vals.push(val);
        continue;
      }
      type.vals = vals;
    }

    if (existingtypepos === -1)
      this.types.push(type);
    else
      this.types[existingtypepos] = type;
  }

  parseEntityValue(valnode: Element, idx: string, type: ParsedType, attrs: ParsedAttr[]): ParsedValue {
    const val: ParsedValue = {};

    for (const fieldnode of elements(valnode.childNodes)) {
      if (fieldnode.localName === "subvalues") { //filling a domain recursively?
        const subvalues = [];
        for (const subvalnode of elements(fieldnode.childNodes)) {
          if (subvalnode.localName !== "value")
            throw new Error("Expected <value> in <values> node");

          const subval = this.parseEntityValue(subvalnode, `${idx}/${subvalnode.tagName}`, type, attrs);
          subvalues.push(subval);
        }
        val.__subvalues = subvalues;
        continue;
      }

      if (fieldnode.localName !== "arrayfield" && fieldnode.localName !== "field")
        throw new Error(`Expected <field> or <arrayfield> in <value> node, got ${fieldnode.localName}`);

      const cellname = getAttr(fieldnode, 'tag', '').toUpperCase();
      if (cellname in val)
        throw new Error(`Duplicate field '${cellname}' in value #${idx} for type ${type.tag}`);

      const attr = attrs.find(a => a.tag === cellname);

      if (["WRD_TAG", "WRD_TITLE", "WRD_LEFTENTITY", "WRD_GUID"].includes(cellname) || (attr?.attributetypename && ["FREE", "DOMAIN", "EMAIL", "PASSWORD", "TELEPHONE", "ENUM"].includes(attr?.attributetypename))) {
        const setval = fieldnode.textContent || '';
        val[cellname] = setval;
        if (cellname === "WRD_TAG" && setval.includes(" "))
          throw new Error(`Whitespace in WRD_TAG value '${setval}' for type ${type.tag}`); //FIXME we must have better tag validation somewhere...
        if (cellname === "WRD_TAG" && setval !== setval.toUpperCase())
          throw new Error(`Non-uppercase WRD_TAG value '${setval}' for type ${type.tag}`); //FIXME we must have better tag validation somewhere...
      } else if (cellname === "WRD_LIMITDATE") {
        if (fieldnode.textContent === "MAX_DATETIME")
          val[cellname] = maxDateTime;
        else
          throw new Error(`Unsupported MAX_DATETIME value '${fieldnode.textContent}'`);
      } else if (attr?.attributetypename === "INTEGER" || cellname === "WRD_ORDERING") {
        val[cellname] = parseInt(fieldnode.textContent || '', 10) || 0;
      } else if (attr?.attributetypename === "INTEGER64") {
        val[cellname] = BigInt(fieldnode.textContent || '0') || 0n;
      } else if (attr?.attributetypename === "BOOLEAN") {
        val[cellname] = ["TRUE", "1"].includes(fieldnode.textContent?.toUpperCase() || '');
      } else if (attr?.attributetypename === "MONEY") {
        val[cellname] = new Money(fieldnode.textContent || '0');
      } else if (attr?.attributetypename === "DOMAINARRAY" || attr?.attributetypename === "ENUMARRAY") {
        val[cellname] = fieldnode.textContent?.split(" ") || [];
      } else if (attr?.attributetypename === "ARRAY") {
        const vals = [];
        for (const subvalnode of elements(fieldnode.childNodes)) {
          if (subvalnode.localName !== "element")
            throw new Error("Expected <element> in <arrayfield> node");

          const subval = this.parseEntityValue(subvalnode, `${idx}/${subvalnode.tagName}`, type, attr.attrs);
          vals.push(subval);
        }
        val[cellname] = vals;
      } else if (!attr) {
        throw new Error(`Unknown field '${cellname}' in value #${idx} for type ${type.tag}`);
      } else {
        throw new Error(`Unimplemented value type '${attr.attributetypename}' for '${cellname}'`);
      }
    }
    return val;
  }


}

const attrtypes = [
  "DOMAIN", /*2*/"FREE", "ADDRESS", "EMAIL", "TELEPHONE", "DATE", "PASSWORD",
  "DOMAINARRAY", /*9*/"IMAGE", "FILE", "TIME", "DATETIME",/*13*/  "ARRAY", "MONEY",
  "INTEGER", "BOOLEAN", "RICHDOCUMENT", "INTEGER64", /*19*/"WHFSINSTANCE", "WHFSINTEXTLINK",
   /*21*/"URL", /*22*/"RECORD", /*23*/"ENUM", /*24*/"ENUMARRAY", /*25*/"PAYMENTPROVIDER", /*26*/"PAYMENT",
   /*27*/"STATUSRECORD", /*28*/"AUTHENTICATIONSETTINGS", /*29*/ "WHFSLINK", /*30*/ "JSON"
] as const;

//possible valid options are: domain, required, isunique, ordered, checklinks, multiline, allowedvalues
const wrdattributes: Record<string, {
  image: string;
  options: string[];
  canchangeto?: string[];
  defaults?: string[];
}> = {
  "domain": {
    image: "domain.gif",
    options: ["domain"],
    canchangeto: ["DOMAINARRAY"]
  },
  "free": {
    image: "free.gif",
    options: ["isunique", "checklinks", "multiline"],
    canchangeto: ["URL", "TELEPHONE"]
  },
  "address": {
    image: "dummy.gif",
    options: ["isunique"] //TODO why can an address be unique? seems pointless, too many spelling
  },
  "email": {
    image: "email.gif",
    options: ["isunique"],
    canchangeto: ["FREE"]
  },
  "telephone": {
    image: "dummy.gif",
    options: ["isunique"],
    canchangeto: ["FREE"]
  },
  "date": {
    image: "date.gif",
    options: ["isunique"],
    canchangeto: ["DATETIME"]
  },
  "password": {
    image: "dummy.gif",
    options: [],
    canchangeto: ["AUTHENTICATIONSETTINGS"]
  },
  "domainarray": {
    image: "checkbox.gif",
    options: ["domain"]
  },
  "image": {
    image: "image.gif",
    options: [],
    canchangeto: ["FILE"]
  },
  "file": {
    image: "file.gif",
    options: [],
    canchangeto: ["IMAGE"]
  },
  "time": {
    image: "dummy.gif",
    options: ["isunique"]
  },
  "datetime": {
    image: "dummy.gif",
    options: ["isunique"],
    canchangeto: ["DATE"]
  },
  "array": {
    image: "dummy.gif",
    options: ["ordered"]
  },
  "money": {
    image: "dummy.gif",
    options: ["isunique"]
  },
  "integer": {
    image: "dummy.gif",
    options: ["isunique"],
    canchangeto: ["INTEGER64"]
  },
  "boolean": {
    image: "boolean.gif",
    options: []
  },
  "richdocument": {
    image: "dummy.gif",
    options: ["checklinks"],
    defaults: ["checklinks"]
  },
  "integer64": {
    image: "dummy.gif",
    options: ["isunique"]
  },
  "whfsinstance": {
    image: "dummy.gif",
    options: []
  },
  "whfsintextlink": {
    image: "dummy.gif",
    options: ["checklinks"],
    defaults: ["checklinks"]
  },
  "url": {
    image: "dummy.gif",
    options: ["checklinks", "isunique"],
    canchangeto: ["FREE"],
    defaults: ["checklinks"]
  },
  "record": {
    image: "dummy.gif",
    options: []
  },
  "enum": {
    image: "dummy.gif",
    options: ["allowedvalues"],
    canchangeto: ["FREE"]
  },
  "enumarray": {
    image: "dummy.gif",
    options: ["allowedvalues"]
  },
  "paymentprovider": {
    image: "dummy.gif",
    options: []
  },
  "payment": {
    image: "dummy.gif",
    options: ["domain"]
  },
  "statusrecord": {
    image: "dummy.gif",
    options: ["allowedvalues"]
  },
  "authenticationsettings": {
    image: "dummy.gif",
    options: [],
    canchangeto: ["PASSWORD"]
  },
  "whfslink": {
    image: "dummy.gif",
    options: []
  },
  "json": {
    image: "dummy.gif",
    options: []
  }
} as const;

function describeAttributeType(attrtypename: string) {
  const attrinfo = wrdattributes[attrtypename.toLowerCase()];
  if (!attrinfo)
    throw new Error(`Unknown attribute type '${attrtypename}'`);

  return {
    typename: attrtypename,
    tid: "wrd:types.attributes.types." + attrtypename.toLowerCase(),
    canchangeto: attrinfo.canchangeto || [],
    defaults: attrinfo.defaults || [],
    options: attrinfo.options || [],
  };
}

function getAttributeTypeNameByTypeId(attributetype: number) {
  return attrtypes[attributetype - 1] ?? throwError(`Invalid attribute type #${attributetype}`);
}

//processes (legacy) XML types
function getAttributeTypeIdByTypeName(attributetype: string) {
  attributetype = attributetype.toUpperCase();
  attributetype = attributetype.replace(/_/g, '');
  if (attributetype === "DOMAINSINGLE")
    attributetype = "DOMAIN";
  else if (attributetype === "DOMAINMULTIPLE")
    attributetype = "DOMAINARRAY";

  //TS names:
  else if (attributetype === "DEPRECATEDSTATUSRECORD")
    attributetype = "STATUSRECORD";
  else if (attributetype === "HSON")
    attributetype = "RECORD";
  else if (attributetype === "WHFSREF")
    attributetype = "WHFSLINK";
  else if (attributetype === "STRING")
    attributetype = "FREE";
  else if (attributetype === "PASSWORD")
    attributetype = "AUTHENTICATIONSETTINGS";

  return (attrtypes as readonly string[]).indexOf(attributetype) + 1;
}

export async function parseSchema(resourcePath: string, addBaseSchema: boolean, overrideData: string | null) {
  let contents = '', moddate: Date;
  if (overrideData === null) {
    ({ contents, moddate } = await readResource(resourcePath));
  } else {
    contents = overrideData;
    moddate = new Date();
  }

  const parser = new ParsedSchemaDef;
  if (addBaseSchema && resourcePath !== wrd_baseschemaresource) {
    await parser.importFile(wrd_baseschemaresource);
  }

  await parser.readSchemaDef(resourcePath, contents, moddate);
  return parser.getResult(overrideData === null ? resourcePath : '');
}

function getXMLAttributes(parent: Node, currentFile: string): ParsedAttr[] {
  const attrs = [];
  for (const attrnode of elements(parent.childNodes)) {
    const attr: ParsedAttr = {
      attributetype: 0,
      attributetypename: "",
      tag: getAttr(attrnode, 'tag', '').toUpperCase(),
      title: getAttr(attrnode, 'title', ''),
      description: getAttr(attrnode, 'description', ''),
      isrequired: getAttr(attrnode, 'required', false),
      isunique: getAttr(attrnode, 'unique', false),
      isunsafetocopy: getAttr(attrnode, 'unsafetocopy', false),
      multiline: getAttr(attrnode, "multiline", false),
      allowedvalues: getAttr(attrnode, "allowedvalues", []),
      domaintag: '',
      typedeclaration: '',
      checklinks: false,
      attrs: getXMLAttributes(attrnode, currentFile)
    };

    if (attrnode.localName === "documentation")
      continue;
    if (attr.tag === "")
      throw new Error(`Attribute #${attrnode} of type ${attrnode.localName} has no tag`);

    if (attrnode.localName !== "obsolete") {
      attr.attributetype = getAttributeTypeIdByTypeName(attrnode.localName || '');
      if (attr.attributetype <= 0)
        throw new Error(`Unknown attribute type '${attrnode.localName}' for '${attr.tag}'`);
      attr.attributetypename = getAttributeTypeNameByTypeId(attr.attributetype);

      const descr = describeAttributeType(attr.attributetypename);
      if (descr.options.includes("domain")) {
        attr.domaintag = getAttr(attrnode, "domain", '');
        if (!attr.domaintag)
          throw new Error(`Attribute '${attr.tag}' has no domain`);
      }

      let typedeclaration = getAttr(attrnode, "typedeclaration", '');
      if (typedeclaration.startsWith("./") || typedeclaration.startsWith("../"))
        typedeclaration = resolveResource(currentFile, typedeclaration);
      attr.typedeclaration = typedeclaration;

      attr.checklinks = getAttr(attrnode, "checklinks", descr.defaults.includes("checklinks"));
    }
    attrs.push(attr);
  }
  return attrs;
}
