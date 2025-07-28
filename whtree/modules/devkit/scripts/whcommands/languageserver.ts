/* Language server invoked by the VSCode extension through wh devkit:languageserver
   VSCode will pass additional command line arguments, see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#implementationConsiderations
*/

import { runWebHareLSP } from "@mod-devkit/js/language-server/server";

import { run } from "@webhare/cli";

run({
  flags: {
    stdio: "Launch LSP in stdio mode",
  },
  async main({ args, opts }) {
    if (!opts.stdio)
      throw new Error("Invalid mode, expected 'stdio'");

    await runWebHareLSP();
  }
});
