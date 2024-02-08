export { triggerGarbageCollection } from './testsupport';
export { run } from './testrunner';

export {
  assert,
  eq,
  eqPartial,
  eqMatch,
  eqProps,
  throws,
  setupLogging,
  wait,
  loadTSType,
  loadJSONSchema, typeAssert
} from './checks';
export type {
  Equals,
  RevEquals,
  Assignable,
  Extends,
  RecursiveOrRegExp,
  RecursivePartialOrRegExp
} from './checks';

export type TestList = Array<string | (() => void | Promise<void>)>;

// Want more than the default 10 stack frames in errors
Error.stackTraceLimit = 25;

export const startTime = new Date;

// the 'sleep' alias doesn't add much and might only confuse users if test.sleep is 'special'. let's mark it as obsolete
import { sleep as stdSleep } from "@webhare/std";
/** @deprecated Use std.sleep */
export const sleep = stdSleep;
