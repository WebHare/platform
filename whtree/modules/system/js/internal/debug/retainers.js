/** Experimental library that helps tracing the source of unallocated resources */

// eslint-disable-next-line @typescript-eslint/no-var-requires -- low-level module, no TS/module support here
const async_hooks = require("node:async_hooks");

const hook = async_hooks.createHook({
  init(asyncId, type, triggerAsyncId, resource) {
    // Getting a stack trace string is very expensive (source map lookups etc), so just get an
    // error and let the debugger get the stack trace when needed
    resource.traceInfo = new Error;
  }
});

hook.enable();
