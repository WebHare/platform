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
  /** Fully qualified tags of the WRD schemas whose MCP server offers this tool */
  addToSchemas: string[];
  /** Human readable title. Empty if not set */
  title: string;
  /** Description of what the tool does. Empty if not set */
  description: string;
  annotations: MCPToolAnnotations;
  /** JSON Schema for the tool's arguments. Tools don't accept arguments yet */
  inputSchema: Record<string, unknown>;
  /** Resolved function implementing the tool (eg mod::module/js/mcp.ts#whoami) */
  onCall: string;
};

export type MCPExtract = {
  tools: MCPToolDescriptor[];
};

export async function generateMCP(context: GenerateContext): Promise<string> {
  const retval: MCPExtract = {
    tools: []
  };

  for (const mod of context.moduledefs)
    for (const [name, tool] of Object.entries(mod.modYml?.mcpTools || {})) {
      if (!Array.isArray(tool.addToSchemas))
        continue; //invalid declaration (eg addToRealms from the realms design), the moduledefinition validation reports it

      retval.tools.push({
        name: `${mod.name}:${name}`,
        toolName: name,
        addToSchemas: tool.addToSchemas.map(schema => addModule(mod.name, schema)),
        title: tool.title || "",
        description: tool.description || "",
        annotations: tool.annotations || {},
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        onCall: resolveResource(mod.resourceBase, tool.onCall)
      });
    }

  return JSON.stringify(retval, null, 2) + "\n";
}
