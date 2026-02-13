// @webhare/cli: short tool description

import { run } from "@webhare/cli";

run({
  flags: {
    "j,json": { description: "Output in JSON format" },
    "v,verbose": { description: "Show verbose output" },
    "f,force": { description: "Force this action" },
  },
  options: {
    // Options have associated values. Also, the names are camelcased, this one is stored as "withData".
    "with-data": { description: "string option" },
  },
  arguments: [
    { name: "<file>", description: "File to load" }
  ],
  main: async ({ opts, args }) => {
    return 0;
  }
});
