import { getCodeContext, CodeContext } from "@webhare/services";
import * as test from "@webhare/test";
import * as contexttests from "./data/context-tests";
import { ensureScopedResource } from "@webhare/services/src/codecontexts";

async function testContextSetup() {
  test.throws(/Not running inside a CodeContext/, getCodeContext);

  const context1 = new CodeContext("test_codecontext:context setup", { context: 1 });
  const context2 = new CodeContext("test_codecontext:context setup", { context: 2 });
  test.eq(/^whcontext-.*/, context1.id);
  test.eq(/^whcontext-.*/, context2.id);
  test.assert(context1.id !== context2.id, "Assert we have two different contexts");

  test.eq(context1.id, context1.run(contexttests.returnContextId));
  test.eq(context2.id, context2.run(contexttests.returnContextId));
  test.eq(context1.id, await context1.run(contexttests.returnContextIdAsync));
  test.eq(context2.id, await context2.run(contexttests.returnContextIdAsync));

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

test.run([
  testContextSetup,
  testContextStorage
]);
