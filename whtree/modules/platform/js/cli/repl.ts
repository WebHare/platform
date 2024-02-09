// short: A JS REPL for WebHare

import * as repl from "node:repl"; //https://nodejs.org/api/repl.html

//Globals to create:
import * as env from "@webhare/env";
import * as harescript from "@webhare/harescript";
import * as jsonrpcClient from "@webhare/jsonrpc-client";
import * as services from "@webhare/services";
import * as std from "@webhare/std";
import * as systemTools from "@webhare/system-tools";
// import * as test from "@webhare/test"; //test is not that useful and slows done wh reply by up to 200ms
import * as whdb from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import * as witty from "@webhare/witty";

console.log("Starting WebHare REPL. Use .help for help");
const whrepl = repl.start({
  prompt: "wh => ",
  breakEvalOnSigint: true,
  replMode: repl.REPL_MODE_STRICT //no octals etc
});

whrepl.setupHistory(services.toFSPath("storage::system/whrepl_history"), () => { });
Object.assign(whrepl.context,
  {
    //Globals for the flat API:
    env,
    harescript,
    jsonrpcClient,
    services,
    std,
    systemTools,
    // test,
    whdb,
    whfs,
    witty,

    //Convenience wrappers
    loadlib: harescript.loadlib
  });
