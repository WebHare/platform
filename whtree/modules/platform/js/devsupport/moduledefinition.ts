/* Validation of moduledefinition.yml beyond what its JSON schema can express. Invoked by `wh validate` and `wh checkmodule`
   (through moduleFileTypes and runJSBasedGlobalValidators), not by `wh apply` */

import { readFile } from "node:fs/promises";
import { toFSPath } from "@webhare/services";
import { addModule } from "@webhare/services/src/naming";
import { getAllModuleYAMLs, type ModDefYML } from "@webhare/services/src/moduledefparser";
import type { ModuleDefinition } from "@mod-platform/generated/schema/moduledefinition";
import { checkInputSchema } from "@mod-platform/js/mcp/inputvalidation";
import { TrackedYAML } from "./yaml";
import type { ValidationState } from "./validation";

/** Content validator for moduledefinition.yml (see moduleFileTypes in the platform's moduledefinition.yml) */
export async function validateModuleDefinition(resourceName: string, content: TrackedYAML<ModuleDefinition>, result: ValidationState): Promise<void> {
  //The router validates tool arguments against inputSchema, so the schema must be a usable JSON Schema for an object
  for (const [name, tool] of Object.entries(content.doc?.mcpTools || {})) {
    if (!tool?.inputSchema || typeof tool.inputSchema !== "object")
      continue; //missing, or not an object, which the JSON schema validation already reported

    const error = checkInputSchema(tool.inputSchema as Record<string, unknown>);
    if (error)
      result.messages.push({
        type: "error",
        resourcename: resourceName,
        line: 0,
        col: 0,
        ...content.getPositionForPointer(`/mcpTools/${name}/inputSchema`),
        message: `MCP tool '${name}': ${error}`,
        source: "validation"
      });
  }
}

export type MCPToolCollision = {
  /** Module declaring the tool */
  module: string;
  /** Tool name (the key in mcpTools) */
  toolName: string;
  /** Fully qualified WRD schema the tool is added to */
  wrdSchema: string;
  /** Other modules adding a tool with the same name to the same schema */
  otherModules: string[];
};

/** Find MCP tools with the same name added to the same WRD schema by different modules. The MCP server only offers one of
    them, so each declaration involved is reported */
export function findMCPToolCollisions(moduleDefs: Array<Pick<ModDefYML, "module" | "mcpTools">>): MCPToolCollision[] {
  const declaredBy = new Map<string, string[]>(); //"<schema> <toolname>" => modules
  for (const mod of moduleDefs)
    for (const [toolName, tool] of Object.entries(mod.mcpTools || {}))
      for (const schema of Array.isArray(tool?.addToSchemas) ? tool.addToSchemas : []) {
        const key = `${addModule(mod.module, schema)} ${toolName}`;
        const modules = declaredBy.get(key) ?? [];
        if (!modules.includes(mod.module))
          modules.push(mod.module);
        declaredBy.set(key, modules);
      }

  const collisions: MCPToolCollision[] = [];
  for (const [key, modules] of declaredBy) {
    if (modules.length < 2)
      continue;
    const [wrdSchema, toolName] = key.split(" ");
    for (const module of modules)
      collisions.push({ module, toolName, wrdSchema, otherModules: modules.filter(m => m !== module) });
  }
  return collisions;
}

/** Report MCP tool name collisions between modules (a global validator, as it needs all module definitions)
    @param modules - Only report messages for these modules */
export async function validateMCPToolNames(result: ValidationState, modules: string[] | "*"): Promise<void> {
  const collisions = findMCPToolCollisions(await getAllModuleYAMLs()).filter(c => modules === "*" || modules.includes(c.module));
  const trackedDefs = new Map<string, TrackedYAML<ModuleDefinition> | null>();

  for (const collision of collisions) {
    const resourceName = `mod::${collision.module}/moduledefinition.yml`;
    if (!trackedDefs.has(collision.module)) //reread the file to find the position of the declaration
      trackedDefs.set(collision.module, await readFile(toFSPath(resourceName), "utf8").then(text => new TrackedYAML<ModuleDefinition>(text), () => null));

    result.messages.push({
      type: "error",
      resourcename: resourceName,
      line: 0,
      col: 0,
      ...trackedDefs.get(collision.module)?.getPositionForPointer(`/mcpTools/${collision.toolName}`),
      message: `MCP tool '${collision.toolName}' is also added to WRD schema '${collision.wrdSchema}' by ${collision.otherModules.map(m => `module '${m}'`).join(", ")}. The MCP server only offers one of them`,
      source: "validation"
    });
  }
}
