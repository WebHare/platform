# WebHare Devkit module
The devkit module included with WebHare is the successor to the separate 'dev' module. It is automatically
enabled for source installs or by starting WebHare with the `WEBHARE_ENABLE_DEVKIT=1` environment variable.

You should only enable this module on development servers, never in production!

## WH Extensions
- `wh up` - Update all modules
- `wh umic` - Update all modules and make+install+start WebHare (like `wh mic`)

## Development tools
The development tools are normally inserted by the webdesign. If you want to
manually enable the devtools on a page, insert `<script src="/.wh/mod/devkit/public/debug.mjs" type="module"></script>`.
It will automatically watch any assetpack included through a `<script>` or `<link>`
tag in the `<head>`, even if they're dynamically updated

## Troubleshooting
If a rewrite isn't working properly, try
```bash
wh devkit:rewrite --debug <infile> /tmp/outfile
```
and watch the messages

Note that xsd files are only rewritten if:
- They appear to be contain form components/handlers
- They appear to be contain tollium components
- They explicitly set their format to a rewritable XMLSchema using `xmlns:rewrite="http://www.webhare.net/xmlns/dev/rewrite" rewrite:format="http://www.w3.org/2001/XMLSchema#schema"`

## LSP
The Devkit module includes an [Language Server Protocol](https://microsoft.github.io/language-server-protocol/specifications/specification-current/)
server implementation.

### Features
The following LSP features are supported by the WebHare language server:

* File diagnostics for HareScript and Witty files and supported XML files (e.g. module definitions, WRD schemas, screens,
 site profiles)
* Code actions to automatically add missing LOADLIBs and remove unused LOADLIBs
* Documentation popups on hover
* Jump to definition


### Installation and usage
The WebHare language server is supported in the following applications:

* Visual Studio Code, through the [WebHare language client](https://marketplace.visualstudio.com/items?itemName=WebHare.webhare-language-vscode)
* Nova, through the [`WebHare`](https://extensions.panic.com/extensions/dev.webhare/dev.webhare.WebHare/) extension

See those extensions for specific installation and configuration instructions.

### How it works
* The language clients (eg the VS Code WebHare extension or the Nova package) invoke `wh devkit:languageserver` (usually through runkt).
* The language server is started (the main script `server.ts` is run).
* The server sets up a connection to the editor (in `connection.ts`) which receives the application capabilities and
  configuration and sends the language server capabilities back.
* The language server actions are invoked through events on the connection object (e.g. `connection.onDefinition`), which in
  turn call the appropriate functions in `service.ts` (e.g. `definitionRequest`).
* The functions in `service.ts` call the `sendRequest` (expecting a result) or `sendNotification` (no result expected)
  function of the WebHareConnection.
* The module uses the `HareScriptFile` object as an abstraction for a HareScript file, which has the actual implementation of
  the different file actions.
* Code action requests return commands, which are registered through the server capabilities. When a command is run by the
  editor, the requested command is run by dynamically calling the function that implements the command in `service.whlib`
  (prefixed with `CMD_`). The first argument of a called command is always the text document uri, followed by the arguments
  returned with the code action.
* The language server also defines custom actions, which are prefixed with `webHare/`, for example `webHare/getStackTrace`.
  These are defined in `protocol.ts`. The exported definitions of `protocol.ts` can be used in language clients that are
  written in TypeScript.

## MCP server
The Devkit module includes a [Model Context Protocol](https://modelcontextprotocol.io/) server for AI clients such as
Claude. It tells the client where WebHare is installed and how to invoke `wh`, and offers the
[webhare.dev](https://www.webhare.dev/) AI skills (as a `wh_get_skill` tool, as `skill://` resources and as prompts).

The server runs over stdio and is started with `wh devkit:mcp-server`. AI clients don't load your shell's `wh`
function, so configure them with the full path to runkit and the WebHare server to connect to (eg `@default`). WebHare
must be running when the client starts the MCP server.

### Claude Code
To add the server for all your projects:

```bash
claude mcp add --scope user webhare -- ~/projects/webhare-runkit/bin/runkit @default wh devkit:mcp-server
```

Use `--scope project` instead to add it to the `.mcp.json` of the current project (which can be committed to share it),
or leave out `--scope` to add it just for yourself in the current project. Use `claude mcp list` or `/mcp` inside a
session to check whether it's connected. The skills are also available as slash commands, eg `/mcp__webhare__wrd`.

### Claude Code in VS Code (without the `claude` command)
The Claude Code extension for VS Code uses the same configuration as the command line, so you can also add the server
by creating an `.mcp.json` file in the root of your project:

```json
{
  "mcpServers": {
    "webhare": {
      "command": "/Users/<you>/projects/webhare-runkit/bin/runkit",
      "args": ["@default", "wh", "devkit:mcp-server"]
    }
  }
}
```

Start a new Claude session in VS Code. Claude asks once whether to trust the servers in `.mcp.json`. Use `/mcp` to check
whether the server is connected. The runkit path and server name are specific to your machine, so think twice before
committing this file.

### Claude Desktop
Add the server to `~/Library/Application Support/Claude/claude_desktop_config.json` and restart Claude:

```json
{
  "mcpServers": {
    "webhare": {
      "command": "/Users/<you>/projects/webhare-runkit/bin/runkit",
      "args": ["@default", "wh", "devkit:mcp-server"]
    }
  }
}
```

Claude Desktop doesn't expand `~`, so use the absolute path.

### Skills
By default the skills are read from the locally installed `webhare_dev` module, so changes to skills are picked up
immediately. If `webhare_dev` isn't installed, they're downloaded from webhare.dev. This is controlled by the registry
keys `devkit:integrations.use_checkedout_site` and `devkit:integrations.webhare_dev_site`. Restart the MCP server
(reconnect the client) after changing them.
