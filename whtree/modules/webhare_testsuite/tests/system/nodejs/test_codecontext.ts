import { getCodeContext, CodeContext } from "@webhare/services";
import * as test from "@webhare/test";
import * as contexttests from "./data/context-tests";

async function testContextSetup() {
  test.throws(/Not running inside a CodeContext/, getCodeContext);

  const context1 = new CodeContext;
  const context2 = new CodeContext;
  test.eqMatch(/^whcontext-.*/, context1.id);
  test.eqMatch(/^whcontext-.*/, context2.id);
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

test.run([testContextSetup]);
