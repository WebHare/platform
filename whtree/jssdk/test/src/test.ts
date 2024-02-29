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

export { sleep } from '@webhare/std';

export type TestList = Array<string | (() => void | Promise<void>)>;

// Want more than the default 10 stack frames in errors
Error.stackTraceLimit = 25;

export const startTime = new Date;
