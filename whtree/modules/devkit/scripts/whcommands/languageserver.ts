/* Language server stub so the WebHare VScode module can safely transition */

import { backendConfig } from "@webhare/services";
import { isatty } from "tty";

if (!backendConfig.module["dev"]) {
  console.error("You need to install the 'dev' machine for the language server to work (https://www.webhare.dev/manuals/developers/dev-module/)");
  process.exit(1);
}

if (isatty(0)) {
  //TODO offer cli option to override
  console.error("The language server is not meant to be run interactively but is used by eg. a VSCode extension");
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- FIXME we don't have await import yet..
require("@mod-dev/js/lsp/server").runWebHareLSP();
