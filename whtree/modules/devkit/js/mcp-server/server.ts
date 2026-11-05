/**
 * WebHare MCP Server
 *
 * This MCP server provides a simple interface to the WebHare CLI.
 */
import { backendConfig, logDebug } from "@webhare/services";

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
import { exec, spawnSync, type ExecException } from "child_process";
import { promisify } from "util";
import { openSkillSource, SkillProvider, skillToolName } from "./skills";


// Promisify exec for async/await usage
const execAsync = promisify(exec);

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

/**
 * Execute a shell command and return the result
 */
async function executeCommand(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, { encoding: "utf8" });

    if (stderr) {
      console.error(`Command stderr: ${stderr}`);
    }

    return stdout.trim();
  } catch (error) {
    const stdout = (error as ExecException).stdout;
    if (stdout) {
      return (typeof stdout === "string" ? stdout : stdout.toString("utf8")).trim();
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Command execution failed: ${(error as Error).message}`
    );
  }
}

/**
 * Execute a WebHare CLI command
 */
async function executeWebHareCommand(command: string, args: string[] = []): Promise<string> {
  try {
    console.error("MUST EXECUTE", command, args);
    logDebug("mcptest:whcommand", { command, args });

    const [cmd, ...cmdargs] = getWhCommand();
    const result = spawnSync(cmd, [...cmdargs, command, ...args], { encoding: "utf8" });
    logDebug("mcptest:whcommandoutput", { stdout: result.stdout });
    if (result.error) {
      console.error("executeWebHareCommand", result);
      throw new Error(`Failed to execute WebHare command: ${result.error.message}`);
    }
    return result.stdout.trim();
  } catch (error) {
    throw new McpError(ErrorCode.InternalError, `WebHare command execution failed: ${(error as Error).message}`
    );
  }
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
    return {
      tools: [
        ...(skillTool ? [skillTool] : []),
        {
          name: "wh_command",
          description: "Execute a command in the WebHare directory",
          inputSchema: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "Command to execute"
              }
            },
            required: ["command"]
          }
        },
        {
          name: "wh_cli",
          description: "Execute a WebHare CLI command",
          inputSchema: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "WebHare command to execute"
              },
              args: {
                type: "array",
                items: {
                  type: "string"
                },
                description: "Command arguments"
              }
            },
            required: ["command"]
          }
        }
      ]
    };
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

        case "wh_command": {
          const command = String(request.params.arguments?.command);

          // Execute the command
          const output = await executeCommand(`cd ${WEBHARE_DIR} && ${command}`);

          return {
            content: [
              {
                type: "text",
                text: output || "Command executed successfully with no output"
              }
            ]
          };
        }

        case "wh_cli": {
          const command = String(request.params.arguments?.command);
          const args = request.params.arguments?.args as string[] || [];

          // Execute the WebHare CLI command
          const output = await executeWebHareCommand(command, args);

          return {
            content: [
              {
                type: "text",
                text: output || "Command executed successfully with no output"
              }
            ]
          };
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
  const skills = new SkillProvider(await openSkillSource());
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
