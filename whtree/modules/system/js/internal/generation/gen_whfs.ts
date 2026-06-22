import { backendConfig, parseResourcePath } from "@webhare/services";
import { generatorBanner, isNodeApplicableToThisWebHare, type FileToUpdate, type GenerateContext } from "./shared";
import { whconstant_builtinmodules } from "../webhareconstants";
import { CSPMemberType, type CSPContentType, type CSPMember } from "@webhare/whfs/src/siteprofiles";
import { nameToCamelCase, throwError } from "@webhare/std";
import { membertypenames } from "@webhare/whfs/src/describe";
import { codecs, type MemberType, type TypeCodec } from "@webhare/whfs/src/codecs";
import { getOfflineSiteProfiles } from "@mod-publisher/lib/internal/siteprofiles/parser";
import type { StoredWHFSRegisterSlot } from "@webhare/whfs/src/register";
import { elements, parseXMLTidPtr } from "./xmlhelpers";

export type WHFSExtract = {
  slots: StoredWHFSRegisterSlot[];
};

class WHFSCompileContext {
  private contenttypes?: Promise<CSPContentType[]>;
  private registerSlots?: Promise<StoredWHFSRegisterSlot[]>;

  private async loadContentTypes() {
    //FIXME prepare to write this to an extract, but our extract might cache database ids currently? we might need two extracts, one for the Declared situation (based on modules) and one for the Actual situation (based on database). or just cache in process
    const csp = await getOfflineSiteProfiles(false, []);
    // console.log(csp);
    return csp.allcontenttypes;
  }

  async getContentTypes() {
    this.contenttypes ||= this.loadContentTypes();
    return await this.contenttypes;
  }

  private async loadRegisterSlots(context: GenerateContext) {
    const slots: StoredWHFSRegisterSlot[] = [];
    for (const mod of context.moduledefs) {
      if (mod.modXml) {
        const publisher = mod.modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "publisher")[0];
        if (!publisher)
          continue;
        for (const slot of elements(publisher.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "registerslot"))) {
          if (!isNodeApplicableToThisWebHare(slot, ""))
            continue;
          slots.push({
            name: `${mod.name}:${slot.getAttribute("name")}`.toLowerCase(),
            title: parseXMLTidPtr(mod.resourceBase, "", slot, "title"),
            description: parseXMLTidPtr(mod.resourceBase, "", slot, "description"),
            initialValue: slot.getAttribute("initialvalue") || undefined,
            fallback: slot.getAttribute("fallback") || undefined,
            type: slot.getAttribute("type") as "site" | "file" | "folder" || undefined
          });
        }
      }
    }
    return slots;
  }

  async getRegisterSlots(context: GenerateContext) {
    this.registerSlots ||= this.loadRegisterSlots(context);
    return await this.registerSlots;
  }
}

// TODO Integrate siteprofile compilation step with us as we need that one's data to generate the definitions here
//      or we'll always be a step behind
//

function exportMember(member: CSPMember, indent: number, structure: "getType" | "setType" | "exportType"): string {
  const mapsto: MemberType | null = membertypenames[member.type] || null;
  let type = 'never';

  if (member.children.length) {
    //construct all members between { .. }
    type = `{\n${member.children.map(child => exportMember(child, indent + 2, structure)).join("")}${" ".repeat(indent)}}`;
    //and wrap as needed
    if (structure === "setType")
      type = `Partial<${type}>`;
    if (member.type === CSPMemberType.Array)
      type = `Array<${type}>`;
    else
      type = `${type} | null`;
  } else if (mapsto) {
    const codec: TypeCodec = codecs[mapsto];
    type = codec?.[structure] ?? codecs[mapsto]?.["getType"] ?? throwError(`Codec for member type '${mapsto}' is not providing ${structure} information`);
  }

  // The 'get' format always fills in missing values with the default values, for setting and exporting they can be omitted (no required values yet)
  const optional = structure !== "getType";
  return " ".repeat(indent) + JSON.stringify(member.jsname || nameToCamelCase(member.name)) + (optional ? "?" : "") + ": " + type + ";\n";
}

function getStructure(ctype: CSPContentType, type: "getType" | "setType" | "exportType"): string {
  if (!ctype.members?.length)//empty
    return 'Record<never,unknown>;';

  let members = '';
  for (const member of ctype.members)
    members += exportMember(member, 8, type);

  return `{\n${members}      };`;
}

export async function generateWHFSDefs(context: GenerateContext, mods: string[], whfscc: WHFSCompileContext): Promise<string> {
  //TODO cache it between the runs? no need to stat it per module
  // const csp = getExtractedHSConfig("siteprofiles").contentypes;
  const contenttypes = await whfscc.getContentTypes();

  let interfaces = '';

  for (const sp of contenttypes) {
    const module = parseResourcePath(sp.siteprofile)?.module;
    if (!module || !mods.includes(module))
      continue;


    interfaces += `
    // ${sp.siteprofile}${sp.line ? ` line ${sp.line}` : ''}
    ${JSON.stringify(sp.scopedtype || sp.namespace)}: {
      GetFormat: ${getStructure(sp, "getType")}
      SetFormat: ${getStructure(sp, "setType")}
      ExportFormat: ${getStructure(sp, "exportType")}
    };
`;
    // console.log(sp);
  }

  const fullfile = `${generatorBanner}
import type { } from "@webhare/whfs";
import type { Money } from "@webhare/std";
import type { IntExtLink, ResourceDescriptor, RichTextDocument } from "@webhare/services";
import type { ExportedResource } from "@webhare/services/src/descriptor";
import type { RTDSource, Instance, RTDExport } from "@webhare/services/src/richdocument";
import type { ExportedInstance, InstanceSource } from "@webhare/whfs/src/contenttypes";
import type { ExportedCompoundDocument, CompoundDocument } from "@webhare/services/src/compound-document";
import type { ExportedIntExtLink } from "@webhare/services/src/intextlink";
import type { TypedStringifyable } from "@webhare/whfs/src/codecs";

declare module "@webhare/whfs/src/contenttypes" {
  interface WHFSTypes {
${interfaces}
  }
} \n`;

  return fullfile;
}

async function generateWHFSExtract(context: GenerateContext, whfscc: WHFSCompileContext): Promise<string> {
  const extract: WHFSExtract = {
    slots: await whfscc.getRegisterSlots(context)
  };
  return JSON.stringify(extract, null, 2) + "\n";
}

export async function listAllModuleWHFSTypeDefs(): Promise<FileToUpdate[]> {
  const noncoremodules = Object.keys(backendConfig.module).filter(m => !whconstant_builtinmodules.includes(m));
  const whfsCompileContext = new WHFSCompileContext;
  return [
    {
      path: "ts/whfstypes.ts",
      module: "platform",
      type: "whfs",
      generator: (options: GenerateContext) => generateWHFSDefs(options, whconstant_builtinmodules, whfsCompileContext)
    }, {
      path: `ts/whfstypes.ts`,
      module: "dummy-installed",
      type: "whfs",
      generator: (options: GenerateContext) => generateWHFSDefs(options, noncoremodules, whfsCompileContext)
    }, {
      path: `extracts/whfs.json`,
      module: "platform",
      type: "extracts",
      generator: (options: GenerateContext) => generateWHFSExtract(options, whfsCompileContext)
    }
  ];
}
