/**
 * WebHare MCP Server
 *
 * Tells AI clients where WebHare is installed and how to invoke 'wh', and offers the webhare.dev AI skills.
 * It deliberately has no tools to run commands: clients that can run commands should invoke 'wh' themselves.
 */
import { backendConfig } from "@webhare/services";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { SkillProvider, skillToolName } from "./skills";


// WebHare installation and data directories of the WebHare running this MCP server (without trailing slash)
const WEBHARE_DIR = backendConfig.installationRoot.replace(/\/$/, "");
const WEBHARE_DATAROOT = backendConfig.dataRoot.replace(/\/$/, "");

/** Get the command line to invoke 'wh' for this WebHare. A bare bin/wh only works if the environment (eg WEBHARE_DATAROOT)
    is set up, so if we were started through runkit, use runkit targeting the same server */
function getWhCommand(): string[] {
  const runkit = process.env.WHRUNKIT_ORIGCOMMAND;
  const target = process.env.WHRUNKIT_TARGETSERVER;
  if (runkit && target)
    return [runkit, `@${target}`, "wh"];
  return [`${WEBHARE_DIR}/bin/wh`];
}

/** Server instructions describing the WebHare installation this server is connected to */
function getInstallationInstructions(): string {
  const whCommand = getWhCommand();
  const usesRunkit = whCommand.length > 1;
  return [
    `This server is connected to WebHare ${backendConfig.whVersion} (server name '${backendConfig.serverName}', backend ${backendConfig.backendURL}).`,
    `- WebHare installation (source tree): ${WEBHARE_DIR}/`,
    `- Data root (database, storage, installed modules, logs): ${WEBHARE_DATAROOT}/`,
    `- WebHare CLI: run \`${whCommand.join(" ")} <command>\` to invoke 'wh' for this WebHare. `
    + (usesRunkit
      ? `This goes through WebHare runkit, which sets up the environment for this server. Don't invoke ${WEBHARE_DIR}/bin/wh directly as it requires that environment (eg WEBHARE_DATAROOT).`
      : `It requires WEBHARE_DATAROOT=${WEBHARE_DATAROOT}/ to be set in the environment.`),
  ].join("\n");
}


/** Create the MCP server */
function createServer(skills: SkillProvider) {
  /**
   * Create the MCP server
   */
  const server = new Server(
    {
      name: "webhare-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true, subscribe: true },
        prompts: { listChanged: true },
      },
      instructions: getInstallationInstructions() + "\n\n" + skills.getInstructions()
    }
  );

  /**
   * Skills (from the webhare_dev module) are offered as resources and as prompts
   */
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: await skills.listResources() }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = await skills.readResource(request.params.uri);
    if (!resource)
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${request.params.uri}`);
    return { contents: [resource] };
  });

  const subscribedResources = new Set<string>();

  server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    subscribedResources.add(request.params.uri);
    return {};
  });

  server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    subscribedResources.delete(request.params.uri);
    return {};
  });

  /** Inform clients about added, removed or modified skills */
  async function onSkillsChanged(changedUris: string[]) {
    try {
      await server.sendToolListChanged();
      await server.sendResourceListChanged();
      await server.sendPromptListChanged();
      for (const uri of changedUris)
        if (subscribedResources.has(uri))
          await server.sendResourceUpdated({ uri });
    } catch (e) {
      console.error("Failed to send skill change notifications:", e);
    }
  }

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: await skills.listPrompts() }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = await skills.getPrompt(request.params.name);
    if (!prompt)
      throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${request.params.name}`);
    return prompt;
  });

  /**
   * Handler for listing available tools
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const skillTool = await skills.getTool();
    return { tools: skillTool ? [skillTool] : [] };
  });

  /**
   * Handler for tool execution
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      switch (request.params.name) {
        case skillToolName: {
          const name = String(request.params.arguments?.name);
          const file = request.params.arguments?.file ? String(request.params.arguments.file) : undefined;
          const text = await skills.runTool(name, file);
          if (text === null)
            throw new Error(file ? `Skill '${name}' has no file '${file}'` : `Unknown skill '${name}'`);
          return { content: [{ type: "text", text }] };
        }


        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${(error as Error).message}`
          }
        ],
        isError: true
      };
    }
  });

  skills.watch(uris => void onSkillsChanged(uris));
  return server;
}

export async function runMCPServer() {
  /**
   * Start the server using stdio transport
   */
  const skills = await SkillProvider.open();
  const server = createServer(skills);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("WebHare MCP server running on stdio");

  // Log WebHare installation directory
  console.error(`Using WebHare installation at: ${WEBHARE_DIR}`);
  console.error(`Using WebHare data root at: ${WEBHARE_DATAROOT}`);
  console.error(`Using wh command: ${getWhCommand().join(" ")}`);
  console.error(`Skills: ${skills.source.location}`);
}
