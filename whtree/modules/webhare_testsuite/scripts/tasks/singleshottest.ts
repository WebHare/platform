import * as test from "@webhare/test";

test.eq(["ARG1 SHOT", "arg2"], process.argv.slice(2));
console.log((new Date).toISOString());
