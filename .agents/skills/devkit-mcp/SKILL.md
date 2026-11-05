---
name: devkit-mcp
description: "Use when working on or debugging the devkit MCP server (`wh devkit:mcp-server`, whtree/modules/devkit/js/mcp-server/), how it offers webhare.dev AI skills to clients (wh_get_skill tool, skill:// resources, prompts), or the devkit:integrations.* registry keys that control where those skills come from."
---

# devkit MCP server

The devkit module ships an MCP server that AI clients (Claude Code, VS Code, ...) connect to over stdio:

```
runkit wh devkit:mcp-server
```

WebHare's VS Code extension registers it automatically. Code:

- `whtree/modules/devkit/scripts/whcommands/mcp-server.ts` - CLI entrypoint
- `whtree/modules/devkit/js/mcp-server/server.ts` - MCP server setup and request handlers. The server deliberately offers no tools to run commands: clients run `wh` themselves using the command line from the server instructions (eg `wh getmodulelist`, `wh isrunning`)
- `whtree/modules/devkit/js/mcp-server/skills.ts` - skill sources (local/remote) and how skills are exposed

The server instructions tell the client which WebHare it is connected to: version, server name, backend URL, installation root, data root and the exact command line to invoke `wh`. When started through runkit, that's `<runkit> @<target> wh` (from `WHRUNKIT_ORIGCOMMAND`/`WHRUNKIT_TARGETSERVER`), as a bare `bin/wh` needs runkit's environment; otherwise it's `<installationRoot>bin/wh`.

The server logs to stderr (stdout is the MCP protocol). On startup it logs `Skills: <location>` showing which skill source is used.

## Skills

The server offers the AI skills maintained in the webhare_dev module (`content/ai/skills/<skill>/SKILL.md`, with `name` and `description` YAML frontmatter plus optional supporting files). MCP has no native skills concept, so they are exposed in several ways:

- **`wh_get_skill` tool** - its description lists all skills with their descriptions, so the model knows when to load one. Takes `name` and an optional `file` (default `SKILL.md`) for supporting files.
- **Resources** - every skill file as `skill://<name>/<file>`. Clients can subscribe to get `notifications/resources/updated`.
- **Prompts** - every skill as a prompt (in Claude Code: `/mcp__<server>__<skill>`).
- **Server instructions** - only point to `wh_get_skill`. They don't contain the skill list or where the skills come from, because instructions are only sent once, at `initialize`.

When skills change, the server sends `tools/list_changed`, `resources/list_changed` and `prompts/list_changed`. Putting the skill list in the tool description so it can be refreshed is **speculative**: it has not been verified that clients actually refresh the tool definitions in the model's context mid-session. See the comment in `skills.ts` before reworking this.

Only files listed for a skill are served, which prevents path traversal (eg `skill://wrd/../modules/SKILL.md` is refused).

## Registry keys

Both live in `devkit:integrations` (declared in `whtree/modules/devkit/moduledefinition.xml`). The server subscribes to registry changes for these keys (`getRegistryKeyEventMasks` + `subscribe`) and switches skill source on the fly, sending the list_changed notifications. Where the skills come from is therefore described in the `wh_get_skill` tool description (which clients can refresh), not in the server instructions (which are only sent once).

| Key | Default | Effect |
|---|---|---|
| `devkit:integrations.use_checkedout_site` | `true` | Use the skills from the locally installed webhare_dev module (`backendConfig.module["webhare_dev"].root` + `content/ai/skills/`). If the module or folder isn't there, the server falls back to the remote site and says why in the `wh_get_skill` description. |
| `devkit:integrations.webhare_dev_site` | `https://www.webhare.dev/` | Site to fetch skills from when not using the local checkout. The server reads `<site>ai/index.json` and fetches files from `<site>ai/<skill path>/<file>`. |

```bash
wh registry get devkit:integrations.use_checkedout_site
wh registry set devkit:integrations.use_checkedout_site false
```

If the keys don't exist yet after changing the module definition, run `wh apply registry --modules devkit`.

### Local mode

- Skills are read from disk on every request, so edits are visible immediately.
- The folder is watched with a recursive `fs.watch` (changes are batched for 250ms). Changes trigger the list_changed notifications and `resources/updated` for subscribed files. A skills folder that appears after startup is not picked up until a restart.
- The `wh_get_skill` description tells the model the exact skills directory, so it can create or edit skills there when the user asks.

### Remote mode

- `ai/index.json` is fetched at startup and every 15 minutes. If it changed, list_changed notifications are sent (no `resources/updated`, as the index doesn't say which files changed). If a fetch fails, the last good index is kept.
- Skill files are fetched on demand. The `wh_get_skill` description says these are read-only published copies.

## ai/index.json

Generated by webhare_dev's `scripts/tasks/import-repo.ts` (task `webhare_dev:import_repo`), which `scripts/tasks/update-from-github.ts` schedules when it pulls a new commit. The import mirrors the checkout's `content/` folder to `storage::webhare_dev/site/` with all folder and file names lowercased (the webserver folds requested URLs to lowercase) and writes `storage::webhare_dev/site/ai/index.json`, which the site serves as `/ai/index.json`. The index keeps the original case of paths and file names, eg `SKILL.md`:

```json
{
  "version": 1,
  "commit": "<git commit of the checkout>",
  "skills": [
    { "name": "wrd", "description": "...", "path": "skills/wrd", "files": ["SKILL.md"] }
  ]
}
```

`path` is relative to `content/ai/` (and to `<site>ai/`), `files` relative to the skill directory. Bump `version` on incompatible changes; the MCP server rejects versions it doesn't know.

## Testing

Pipe JSON-RPC messages into the server and keep stdin open long enough for responses:

```bash
( printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"wh_get_skill","arguments":{"name":"wrd"}}}'
  sleep 5 ) | wh devkit:mcp-server
```

To test change notifications in local mode, touch or add a file in the skills folder while the server runs.
