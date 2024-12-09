// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/test" {
}

export { triggerGarbageCollection } from './testsupport';
export { run } from './testrunner';

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
  RecursiveOrRegExp,
  RecursivePartialOrRegExp,
  RevEquals,
} from './checks';

export { sleep } from '@webhare/std';

export type TestList = Array<string | (() => void | Promise<void>)>;

// Want more than the default 10 stack frames in errors
Error.stackTraceLimit = 25;

export const startTime = new Date;
