import { addModule, type ModuleQualifiedName } from "@webhare/services/src/naming";
import type { GenerateContext } from "./shared";

export type RealmMCPServerDescriptor = {
  /** Human readable title of the MCP server. Empty if not set */
  title: string;
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
        mcpServer: realm.mcpServer ? { title: realm.mcpServer.title || "" } : null
      });
    }

  return JSON.stringify(retval, null, 2) + "\n";
}
