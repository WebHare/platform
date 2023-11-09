import { triggerGarbageCollection } from './testsupport';
import { run } from './testrunner';
export { startTime, triggerGarbageCollection, run };

export {
  assert,
  eq,
  eqMatch,
  eqProps,
  throws,
  setupLogging,
  wait,
  loadTSType,
  loadJSONSchema,
  Equals,
  RevEquals,
  Assignable,
  Extends,
  typeAssert,
} from './checks';

export { sleep } from "@webhare/std";

export type TestList = Array<string | (() => void | Promise<void>)>;

// Want more than the default 10 stack frames in errors
Error.stackTraceLimit = 25;

const startTime = new Date;
