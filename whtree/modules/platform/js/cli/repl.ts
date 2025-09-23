/* eslint-disable @typescript-eslint/no-require-imports */
// short: A JS REPL for WebHare

import * as repl from "node:repl"; //https://nodejs.org/api/repl.html

import { listDirectory } from "@webhare/system-tools";
import { backendConfig, toFSPath } from "@webhare/services";
import { nameToCamelCase } from "@webhare/std";

console.log("Starting WebHare REPL. Use .help for help");

const whrepl = repl.start({
  prompt: "wh => ",
  breakEvalOnSigint: true,
  replMode: repl.REPL_MODE_STRICT //no octals etc
});

whrepl.setupHistory(toFSPath("storage::system/whrepl_history"), () => { });

//expose all @webhare libraries on demand.
async function setupWhRepl() {
  for (const dir of await listDirectory(backendConfig.installationRoot + "jssdk")) {
    //map all @webhare/ dirs to a symbol, but translate eg jsonrpc-client to jsonrpcClient
    Object.defineProperty(whrepl.context, nameToCamelCase(dir.name.replaceAll('-', '_')), {
      get: () => {
        return require(`@webhare/${dir.name}`);
      },
      configurable: false,
      enumerable: true
    });
  }

  //Convenience wrappers
  Object.defineProperty(whrepl.context, "loadlib", {
    get: () => {
      return require("@webhare/harescript").loadlib;
    },
    configurable: false,
    enumerable: true
  });
}

void setupWhRepl();
