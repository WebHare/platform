/* To activate us add a mcp server:
    - type: stdio
    - command: "<YOUR HOME DIR>/projects/webhare-runkit/bin/runkit",
      "args": [ "wh", "devkit:mcp-server" ]
    }

  WebHare's VSCode extension should enable the MCP server automatically
*/

import { runMCPServer } from "@mod-devkit/js/mcp-server/server";
import { run } from "@webhare/cli";

run({
  async main() {
    await runMCPServer();
  }
});
