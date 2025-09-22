import { runTests } from './testrunner';

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/test" {
}

export { triggerGarbageCollection } from './testsupport';
export { runTests } from './testrunner';

export {
  assert,
  eq,
  eqMatch,
  eqPartial,
  eqProps,
  loadJSONSchema,
  loadTSType,
  setupLogging,
  throws,
  typeAssert,
  wait,
  waitToggled,
  waitForEvent
} from './checks';

export type {
  Assignable,
  Equals,
  Extends,
  RevEquals,
  JSONSchemaObject,
  RecursiveTestable,
  RecursivePartialTestable,
} from './checks';

export { sleep } from '@webhare/std';

export type TestList = Array<string | (() => void | Promise<void>)>;

// Want more than the default 10 stack frames in errors
Error.stackTraceLimit = 25;

export const startTime = new Date;

// TODO @deprecated We're renaming run to runTests to avoid a conflict with \@webhare/cli's run() - once everyone is WH5.7+
export const run = runTests;
