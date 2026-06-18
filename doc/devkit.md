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
