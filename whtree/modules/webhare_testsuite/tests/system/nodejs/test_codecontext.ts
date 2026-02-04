import { getCodeContext, CodeContext, isRootCodeContext, ensureScopedResource } from "@webhare/services/src/codecontexts";
import * as test from "@webhare/test";
import * as contexttests from "./data/context-tests";
import { loadlib } from "@webhare/harescript";
import { debugFlags } from "@webhare/env";
import { registerDebugConfigChangedCallback, updateDebugConfig, type DebugFlags } from "@webhare/env/src/envbackend";
import noAuthJSService from '@mod-webhare_testsuite/js/jsonrpc/client';
import { spawnSync } from "child_process";

const nonExistingDebugFlag = `nonexisting-flag-${crypto.randomUUID()}`;
const nonExistingGlobalFlag = `nonexisting-global-${crypto.randomUUID()}`;

async function testContextSetup() {
  const callbacks = new Array<DebugFlags>;
  registerDebugConfigChangedCallback(() => callbacks.push({ ...debugFlags }));

  test.eq('root', getCodeContext().title);
  test.eq(true, isRootCodeContext());

  test.eq(undefined, debugFlags[nonExistingDebugFlag]);
  debugFlags[nonExistingDebugFlag] = true;

  test.eq(true, Object.keys(debugFlags).includes(nonExistingDebugFlag));

  updateDebugConfig({ tags: [`${nonExistingDebugFlag}-flag1`], outputsession: "testsession", context: "testcontext" });
  test.eq(true, debugFlags[`${nonExistingDebugFlag}-flag1`]);
  test.eq(true, Object.keys(debugFlags).includes(`${nonExistingDebugFlag}-flag1`));

  updateDebugConfig({ tags: [`${nonExistingDebugFlag}-flag2`], outputsession: "testsession", context: "testcontext" });
  test.eq(undefined, debugFlags[`${nonExistingDebugFlag}-flag1`]);
  test.eq(true, debugFlags[`${nonExistingDebugFlag}-flag2`]);
  test.eq(false, Object.keys(debugFlags).includes(`${nonExistingDebugFlag}-flag1`));
  test.eq(true, Object.keys(debugFlags).includes(`${nonExistingDebugFlag}-flag2`));

  test.eq(true, debugFlags[nonExistingDebugFlag]);
  delete debugFlags[nonExistingDebugFlag];
  //@ts-ignore TS 5.5 incorrectly infers debugFlags[nonExistingDebugFlag] to be true. 5.4 shows it as undefined | boolean
  test.eq(undefined, debugFlags[nonExistingDebugFlag]);
  test.eq(false, Object.keys(debugFlags).includes(nonExistingDebugFlag));

  callbacks.splice(0, callbacks.length); //clear callbacks
  debugFlags[nonExistingDebugFlag] = true;
  test.eq(true, Object.keys(debugFlags).includes(nonExistingDebugFlag));
  test.eqPartial([{ [nonExistingDebugFlag]: true }], callbacks);

  const context1 = new CodeContext("test_codecontext:context setup", { context: 1 });
  const context2 = new CodeContext("test_codecontext:context setup", { context: 2 });
  test.eq(/^whcontext-.*/, context1.id);
  test.eq(/^whcontext-.*/, context2.id);
  test.assert(context1.id !== context2.id, "Assert we have two different contexts");

  test.eq(false, context1.run(() => isRootCodeContext()));
  test.eq(context1.id, context1.run(contexttests.returnContextId));
  test.eq(context2.id, context2.run(contexttests.returnContextId));
  test.eq(context1.id, await context1.run(contexttests.returnContextIdAsync));
  test.eq(context2.id, await context2.run(contexttests.returnContextIdAsync));

  // new contexts should inherit flags live from the root context
  test.eq(true, context1.run(() => debugFlags[nonExistingDebugFlag]));
  delete debugFlags[nonExistingDebugFlag];
  test.eq(undefined, context1.run(() => debugFlags[nonExistingDebugFlag]));

  // settings flags in context1 should not affect the root context or context2
  context1.run(() => debugFlags[nonExistingDebugFlag] = true);
  test.eq(true, context1.run(() => debugFlags[nonExistingDebugFlag]));
  //@ts-ignore TS 5.5 incorrectly infers debugFlags[nonExistingDebugFlag] to be true. 5.4 shows it as undefined | boolean
  test.eq(undefined, debugFlags[nonExistingDebugFlag]);
  test.eq(undefined, context2.run(() => debugFlags[nonExistingDebugFlag]));

  const contextgetter = context1.run(contexttests.getWrappedReturnContextId);
  test.eq(context1.id, contextgetter());

  const asynccontextgetter = context2.run(contexttests.getWrappedReturnContextIdAsync);
  test.eq(context2.id, await asynccontextgetter());

  const contextidgenerator = context1.runGenerator(contexttests.generateContextId);
  test.eq(["1:" + context1.id, "2:" + context1.id], [...contextidgenerator]);

  const contextidgenerator2 = context2.runGenerator(contexttests.generateContextId);
  test.eq({ value: "1:" + context2.id, done: false }, contextidgenerator2.next());
  test.eq({ value: "2:" + context2.id, done: false }, contextidgenerator2.next());
  test.eq({ value: undefined, done: true }, contextidgenerator2.next());

  const contextidgeneratorasync = context2.runGenerator(contexttests.generateContextIdAsync);
  test.eq({ value: "1:" + context2.id, done: false }, await contextidgeneratorasync.next());
  test.eq({ value: "2:" + context2.id, done: false }, await contextidgeneratorasync.next());
  test.eq({ value: undefined, done: true }, await contextidgeneratorasync.next());

  //test global flag updates
  test.eq(false, (await noAuthJSService.describeMyRequest()).debugFlags.includes(nonExistingGlobalFlag));
  spawnSync("wh", ["debug", "enable", "--force", nonExistingGlobalFlag], { shell: true, stdio: "inherit", env: { ...process.env, WEBHARE_DEBUG: "" } });
  await test.wait(async () => (await noAuthJSService.describeMyRequest()).debugFlags.includes(nonExistingGlobalFlag));
  spawnSync("wh", ["debug", "disable", "--force", nonExistingGlobalFlag], { shell: true, stdio: "inherit", env: { ...process.env, WEBHARE_DEBUG: "" } });
  await test.wait(async () => !(await noAuthJSService.describeMyRequest()).debugFlags.includes(nonExistingGlobalFlag));
}

async function testContextStorage() {
  const context1 = new CodeContext("test_codecontext:context storage", { context: 1 });
  const context2 = new CodeContext("test_codecontext:context storage", { context: 2 });

  ensureScopedResource("webhare_testsuite:mykey", () => 77);
  context1.ensureScopedResource("webhare_testsuite:mykey", () => 88);
  context2.run(() => ensureScopedResource("webhare_testsuite:mykey", () => 99));

  test.eq(77, ensureScopedResource("webhare_testsuite:mykey", (): number => { throw new Error("should not happen"); }));
  test.eq(88, context1.ensureScopedResource("webhare_testsuite:mykey", (): number => { throw new Error("should not happen"); }));
  test.eq(99, context2.ensureScopedResource("webhare_testsuite:mykey", (): number => { throw new Error("should not happen"); }));
}

async function testContextHSVM() {
  const context1 = new CodeContext("test_codecontext:context storage", { context: 1 });
  const context2 = new CodeContext("test_codecontext:context storage", { context: 2 });
  const invoketarget = "mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib";

  await loadlib(invoketarget).setGlobal({ x: 42 });
  test.eq({ x: 42 }, await loadlib(invoketarget).getGlobal());

  await context1.run(() => loadlib(invoketarget).setGlobal({ x: 77 }));
  test.eq({ x: 77 }, await context1.run(() => loadlib(invoketarget).getGlobal()));

  await context2.run(() => loadlib(invoketarget).setGlobal({ x: 99 }));
  test.eq({ x: 99 }, await context2.run(() => loadlib(invoketarget).getGlobal()));
  test.eq({ x: 77 }, await context1.run(() => loadlib(invoketarget).getGlobal()));
  test.eq({ x: 42 }, await loadlib(invoketarget).getGlobal());

  //verify that loadlib itself doesn't bind
  const myloadlib = loadlib(invoketarget);
  test.eq({ x: 99 }, await context2.run(() => myloadlib.getGlobal()));
  test.eq({ x: 77 }, await context1.run(() => myloadlib.getGlobal()));
  test.eq({ x: 42 }, await myloadlib.getGlobal());

  await context1.close();
  await context2.close();
}

test.runTests([
  testContextSetup,
  testContextStorage,
  testContextHSVM
]);
