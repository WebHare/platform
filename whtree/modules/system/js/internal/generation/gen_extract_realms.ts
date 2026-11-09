import { resolveResource } from "@webhare/services";
import { addModule, type ModuleQualifiedName } from "@webhare/services/src/naming";
import type { GenerateContext } from "./shared";

/** Behavior hints for MCP clients, as defined by the MCP ToolAnnotations */
export type MCPToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type MCPToolDescriptor = {
  /** Fully qualified name of the declaration, eg webhare_testsuite:whoami */
  name: ModuleQualifiedName;
  /** Name of the tool as seen by MCP clients, eg whoami */
  toolName: string;
  /** Human readable title. Empty if not set */
  title: string;
  /** Description of what the tool does. Empty if not set */
  description: string;
  annotations: MCPToolAnnotations;
  /** JSON Schema for the tool's arguments */
  inputSchema: Record<string, unknown>;
  /** Resolved function implementing the tool (eg mod::module/js/mcp.ts#whoami) */
  onCall: string;
};

export type RealmMCPServerDescriptor = {
  /** Human readable title of the MCP server. Empty if not set */
  title: string;
  /** Tools offered by this MCP server, contributed by any module through mcpTools.addToRealms */
  tools: MCPToolDescriptor[];
};

export type RealmDescriptor = {
  /** Fully qualified name, eg webhare_testsuite:testrealm */
  name: ModuleQualifiedName;
  /** Fully qualified WRD schema tag providing the realm's users. Empty to use the primary user management schema */
  wrdSchema: string;
  /** MCP server offered at /.wh/mcp/<module>/<realm>, null if the realm offers no MCP server */
  mcpServer: RealmMCPServerDescriptor | null;
};

export type RealmsExtract = {
  realms: RealmDescriptor[];
};

export async function generateRealms(context: GenerateContext): Promise<string> {
  const retval: RealmsExtract = {
    realms: []
  };

  for (const mod of context.moduledefs)
    for (const [name, realm] of Object.entries(mod.modYml?.realms || {})) {
      retval.realms.push({
        name: `${mod.name}:${name}`,
        wrdSchema: addModule(mod.name, realm.wrdSchema || ""),
        mcpServer: realm.mcpServer ? { title: realm.mcpServer.title || "", tools: [] } : null
      });
    }

  /* Add the tools to the realms they're contributed to. Tools contributed to realms that don't exist (eg. because their
     module isn't installed) or don't offer an MCP server are ignored, as is a tool whose name is already taken in that
     realm. TODO report these once we validate realm configuration */
  for (const mod of context.moduledefs)
    for (const [name, tool] of Object.entries(mod.modYml?.mcpTools || {})) {
      const descriptor: MCPToolDescriptor = {
        name: `${mod.name}:${name}`,
        toolName: name,
        title: tool.title || "",
        description: tool.description || "",
        annotations: tool.annotations || {},
        inputSchema: tool.inputSchema || { type: "object", properties: {}, additionalProperties: false },
        onCall: resolveResource(mod.resourceBase, tool.onCall)
      };

      for (const realmName of tool.addToRealms) {
        const mcpServer = retval.realms.find(r => r.name === addModule(mod.name, realmName))?.mcpServer;
        if (mcpServer && !mcpServer.tools.some(t => t.toolName === descriptor.toolName))
          mcpServer.tools.push(descriptor);
      }
    }

  return JSON.stringify(retval, null, 2) + "\n";
}
