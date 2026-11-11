import type { MCPToolHandler } from "@webhare/mcp";
import { getAuthSettings } from "@webhare/auth/src/support";
import { wrd } from "@webhare/wrd";

/** Report who the MCP client is signed in as. Reads the user from the MCP server's WRD schema using its account settings,
    so it works for any schema and verifies that tools get the right schema */
export const whoami = (async (input, context) => {
  const schema = wrd<"*">(context.wrdSchema);
  const authSettings = await getAuthSettings(schema);
  if (!authSettings)
    return { content: [{ type: "text", text: `WRD schema '${context.wrdSchema}' has no account type` }], isError: true };

  const fields = [authSettings.loginAttribute, authSettings.emailAttribute].filter(attr => attr !== null);
  const account = await schema.getFields(authSettings.accountType, context.user, fields) as Record<string, unknown>;

  const info = {
    wrdSchema: context.wrdSchema,
    accountType: authSettings.accountType,
    entityId: context.user,
    login: authSettings.loginAttribute ? account[authSettings.loginAttribute] : null,
    email: authSettings.emailAttribute ? account[authSettings.emailAttribute] : null,
    scopes: context.scopes
  };
  return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }], structuredContent: info };
}) satisfies MCPToolHandler;

/** Throw an exception, to verify its details don't reach the MCP client */
export const failTool: MCPToolHandler = async () => {
  throw new Error("Internal detail that must not reach the client: /secret/path");
};
