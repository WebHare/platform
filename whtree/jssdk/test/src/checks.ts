import * as testsupport from "./testsupport";
import * as diff from 'diff';
import { Money, isError, isPromise, sleep, stdTypeOf } from "@webhare/std";
import { getCompiledJSONSchema, type JSONSchemaObject, type AjvValidateFunction } from "./ajv-wrapper";
import { flagWait } from "./monitor";

export type { LoadTSTypeOptions } from "./testsupport";
export type { JSONSchemaObject } from "./ajv-wrapper";

/** An Annotation must either be a simple string or a callback returning one */
export type Annotation = string | (() => string) | undefined;

type LoggingCallback = (...args: unknown[]) => void;

type PrimitiveType = Money | Date | RegExp;

/** Custom callback to test a value */
type TestFunction<T> = (value: T) => boolean;

/** Recursively apply `Partial<>` on records in a type but also allow Regexps and Functions to match strings. Also allow the string values for string enums.
 * @typeParam T - Type to convert
*/
type RecursivePartialTestable<T> =
  (T extends Array<infer U> ? ReadonlyArray<RecursivePartialTestable<U>> :
    T extends string ? T | `${T}` | RegExp :
    T extends PrimitiveType ? T :
    T extends object ? { readonly [K in keyof T]?: RecursivePartialTestable<T[K]> } :
    T) | TestFunction<T>;

/** Recursively allow Regexps to match strings. Also allow the string values for string enums.
 * @typeParam T - Type to convert
*/
type RecursiveTestable<T> =
  (T extends Array<infer U> ? ReadonlyArray<RecursiveTestable<U>> :
    T extends string ? T | `${T}` | RegExp :
    T extends PrimitiveType ? T :
    T extends object ? { readonly [K in keyof T]: RecursiveTestable<T[K]> } :
    T) | TestFunction<T>;

let onLog: LoggingCallback = console.log.bind(console) as LoggingCallback;

//We want to make clear ('assert') that wait will not return falsy values
export type WaitRetVal<T> = Promise<Exclude<T, undefined | false | null>>;
export type WaitOptions<T> = Annotation | {
  timeout?: number;
  /**  An optional test that should return true for the wait to end. By default wait() waits for a truthy value */
  test?: (value: T) => boolean;
  annotation?: Annotation;
};
export type TestOptions = {
  /** Custom comparison function. This function will be fed all values before standard comparisons run
   * @param expect - The expected value
   * @param actual - The actual value
   * @param path - Path to the value being compared
   * @returns True if the values match, false if they don't - undefined if onCompare has no opinion
   */
  onCompare?: (expect: unknown, actual: unknown, path: string) => boolean | undefined;
  annotation?: Annotation;
};

class TestError extends Error {
  readonly annotation: string;

  constructor(message: string, options?: TestOptions & { cause?: Error }) {
    super(message, options);

    //Log test failure info during construction so it's not lost if there's not a testrunner to catch and display this
    console.error("TestError:", message);
    this.annotation = (typeof options?.annotation === "function" ? options?.annotation() : options?.annotation) || "";
    if (this.annotation)
      console.error("Annotation:", this.annotation);
  }
}

function myTypeOf(item: unknown): ReturnType<typeof stdTypeOf> | "Error" | "element" | "textnode" | "whitespace" {
  const type = stdTypeOf(item);
  if (type === "object") {
    if (isError(item))
      return "Error";
    if ((item as Node).nodeName) {
      if ((item as Node).nodeType === 1) return 'element';
      if ((item as Node).nodeType === 3) return (/\S/).test((item as Node).nodeValue || '') ? 'textnode' : 'whitespace';
    }
  }
  return type;
}

function presentDomNode(node: Node) {
  let nodedescr = node.nodeName.toLowerCase();
  if ((node as HTMLElement).id)
    nodedescr += "#" + (node as HTMLElement).id;
  if ((node as HTMLElement).classList?.length)
    nodedescr += '.' + Array.from((node as HTMLElement).classList).join(".");
  return nodedescr;
}

function wrapColor(change: diff.Change) {
  if (change.added)
    return `\u001b[${37}m\u001b[${41}m${change.value}\u001b[${39}m\u001b[${49}m`;
  else if (change.removed)
    return `\u001b[${37}m\u001b[${42}m${change.value}\u001b[${39}m\u001b[${49}m`;
  return change.value;
}

function printColoredTextDiff(expected: string, actual: string) {
  const enc_expected = JSON.stringify(expected).slice(1, -1).replaceAll("\\n", "\\n\n");
  const enc_actual = JSON.stringify(actual).slice(1, -1).replaceAll("\\n", "\\n\n");

  let str = "diff: ";
  const colors = [];
  const isnode = Boolean(globalThis.process);
  for (const change of diff.diffChars(enc_actual, enc_expected)) {
    if (isnode)
      str += wrapColor(change);
    else {
      str += `%c${change.value}`;
      colors.push(change.added ? "background-color:red; color: white" : change.removed ? "background-color:green; color: white" : "");
    }
  }
  console.log(str, ...colors);
}

function testMoney(expect: Money, actual: unknown, path: string, options?: TestOptions) {
  if (!Money.isMoney(actual)) {
    onLog("Money fails type: expected", expect);
    onLog("Money fails type: actual  ", actual);
    throw new TestError("Expected type: Money actual type: " + typeof actual + (path !== "" ? " at " + path : ""), options);
  }

  if (Money.cmp(expect, actual) !== 0) {
    onLog("Money fails: expected", expect);
    onLog("Money fails: actual  ", actual);
    throw new TestError("Expected match: " + String(expect) + " actual: " + actual + (path !== "" ? " at " + path : ""), options);
  }
}

function testTestFunction(expect: TestFunction<unknown>, actual: unknown, path: string, options?: TestOptions) {
  const result = expect(actual);
  if (typeof result !== "boolean") {
    onLog("test function fails type: want boolean but got ", typeof result);
    onLog("test function fails type: actual  ", actual);
    throw new TestError("test function did not return a boolean: " + typeof actual + (path !== "" ? " at " + path : ""), options);
  }

  if (!result) {
    onLog("test function evaluated to false");
    onLog("test function actual value: ", actual);
    throw new TestError("test function failed" + (path !== "" ? " at " + path : ""), options);
  }
}

function testRegExp(expect: RegExp, actual: unknown, path: string, options?: TestOptions) {
  if (typeof actual !== "string") {
    onLog("regExp fails type: expected", expect);
    onLog("regExp fails type: actual  ", actual);
    throw new TestError("Expected type: string actual type: " + typeof actual + (path !== "" ? " at " + path : ""), options);
  }

  if (!expect.test(actual)) {
    onLog("regExp fails: expected", expect);
    onLog("regExp fails: actual  ", actual);
    throw new TestError("Expected match: " + String(expect) + " actual: " + actual + (path !== "" ? " at " + path : ""), options);
  }
}

function testSet(expect: Set<unknown>, actual: unknown, path: string, options?: TestOptions) {
  if (!(actual instanceof Set))
    throw new TestError(`Expected a Set, got ${actual?.constructor.name} at ${path}`, options);

  const missing = expect.difference(actual);
  const unexpected = actual.difference(expect);

  if (missing.size || unexpected.size) {
    if (missing.size)
      onLog(`Missing ${missing.size} elements, eg:`, [...missing].slice(0, 3).join(", "));
    if (unexpected.size)
      onLog(`Unexpected ${unexpected.size} elements, eg:`, [...unexpected].slice(0, 3).join(", "));

    const baseError = (missing.size && unexpected.size) ? `Missing ${missing.size} elements and ${unexpected.size} unexpected elements` :
      missing.size ? `Missing ${missing.size} elements` : `Unexpected ${unexpected.size} elements`;
    throw new TestError(`${baseError} in Set at ${path}`, options);
  }
}

function handleCustomCompare(expected: unknown, actual: unknown, path: string, options?: TestOptions): boolean {
  if (!options?.onCompare)
    return false; //handle it yourself

  const result = options.onCompare(expected, actual, path);
  if (result === true)
    return true;
  if (result === false)
    throw new TestError(`Custom comparison failed for expected: ${expected} actual: ${actual}${path !== "" ? " at " + path : ""}`, options);
  return false; //handle it yourself
}

function testDeepEq(expected: unknown, actual: unknown, path: string, options?: TestOptions) {
  if (handleCustomCompare(expected, actual, path, options))
    return true;

  if (expected === actual)
    return;

  if (expected === null)
    if (actual === null)
      return; //ok!
    else
      throw new TestError("Expected null, got " + (path !== "" ? " at " + path : ""), options);

  if (actual === null)
    throw new TestError("Got a null, but expected " + expected + (path !== "" ? " at " + path : ""), options);
  if (actual === undefined)
    throw new TestError("Got undefined, but expected " + expected + (path !== "" ? " at " + path : ""), options);

  if (expected instanceof RegExp)
    return testRegExp(expected, actual, path, options);
  if (typeof expected === "function")
    return testTestFunction(expected as TestFunction<unknown>, actual, path, options);
  if (Money.isMoney(expected))
    return testMoney(expected, actual, path, options);

  if (isPromise(expected))
    throw new TestError(`Passing a Promise to test.eq's expected value - did you mean to await it?`, options);
  if (isPromise(actual))
    throw new TestError(`Passing a Promise to test.eq's actual value - did you mean to await it?`, options);

  const type_expected = myTypeOf(expected);
  const type_actual = myTypeOf(actual);
  if (type_expected !== type_actual)
    throw new TestError("Expected type: " + type_expected + " actual type: " + type_actual + (path !== "" ? " at " + path : ""), options);

  if (["number", "string", "Date", "Instant", "PlainDate", "PlainDateTime"].includes(type_expected)) {
    const str_expected = type_expected === "Date" ? (expected as Date).toISOString() : (expected as object).toString();
    const str_actual = type_actual === "Date" ? (actual as Date).toISOString() : (actual as object).toString();
    if (str_expected === str_actual)
      return;

    printColoredTextDiff(str_expected, str_actual);
    throw new TestError(`Expected ${type_expected}: ${str_expected}, actual: ${str_actual}${path !== "" ? " at " + path : ""}`, options);
  }

  if (expected instanceof Set)
    return testSet(expected, actual, path, options);

  if (typeof expected !== "object") //simple value mismatch
    throw new TestError("Expected: " + expected + " actual: " + actual + (path !== "" ? " at " + path : ""), options);

  if (['element', 'textnode', 'whitespace'].includes(type_expected) && expected !== actual) {
    onLog("Expected node: ", expected);
    onLog("Actual node:", actual);
    throw new TestError("Expected DOM node: " + presentDomNode(expected as Node) + " actual: " + presentDomNode(actual as Node) + (path !== "" ? " at " + path : ""), options);
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length)
      throw new TestError("Expected: " + expected.length + " elements, actual: " + actual.length + " elements" + (path !== "" ? " at " + path : ""), options);

    for (let i = 0; i < expected.length; ++i)
      testDeepEq(expected[i], actual[i], path + "[" + i + "]", options);
  } else {
    //not the same object. same contents?
    const expectedkeys = Object.keys(expected);
    const actualkeys = Object.keys(actual);

    for (const key of expectedkeys) {
      if (!actualkeys.includes(key)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (handleCustomCompare((expected as any)[key], (actual as any)[key], path + "." + key, options))
          return true;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((expected as any)[key] === undefined) // allow undefined to function as missing-property indicator too
          continue;

        throw new TestError("Expected key: " + key + ", didn't actually exist" + (path !== "" ? " at " + path : ""), options);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      testDeepEq((expected as any)[key], (actual as any)[key] as any, path + "." + key, options);
    }
    for (const key of actualkeys) {
      if (!expectedkeys.includes(key)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (handleCustomCompare((expected as any)[key], (actual as any)[key], path + "." + key, options))
          return true;

        throw new TestError("Key unexpectedly exists: " + key + (path !== "" ? " at " + path : ""), options);
      }
    }
  }
}

function testStringify(val: unknown): string {
  switch (typeof val) {
    case "bigint":
      return val.toString() + "n";
    case "function":
      return "<function>";
    case "symbol":
      return val.toString();
    case "undefined":
      return "undefined";
    case "object":
      if (val === null)
        return "null";
      if (val instanceof RegExp)
        return val.toString();
      if (val instanceof Money)
        return `Money(${val.toString()}`;
      if (val instanceof Date)
        return `Date("${val.toISOString()}")`;
      if (Array.isArray(val))
        return `[${val.map(testStringify).join(", ")}]`;
      return `{ ${Object.entries(val).toSorted(([lhsKey], [rhsKey]) => lhsKey.localeCompare(rhsKey)).map(([k, v]) => `${k}: ${testStringify(v)}`).join(", ")}} `;
    default:
      return JSON.stringify(val);
  }
}

/** Verify deep equality of two values (to compare object identity, you need to use {@link assert} with ===)
 * @typeParam T - The type of the values (both values are expected to be of the same type). This type is only inferred
 * from the 'actual' parameter.
 * @param expected - The expected value
 * @param actual - The actual value
 * @throws If the values are not equal
 */
export function eq<T>(expected: NoInfer<RecursiveTestable<T>>, actual: T, options?: Annotation | TestOptions): void {
  if (arguments.length < 2)
    throw new Error("Missing argument to test.eq");

  if (typeof options === "string" || typeof options === "function")
    options = { annotation: options };

  try {
    testDeepEq(expected, actual, '', options);
  } catch (e) {
    const expected_str = testStringify(expected);
    const actual_str = testStringify(actual);

    onLog("testEq fails: expected", expected_str);
    onLog("testEq fails: actual  ", actual_str);
    if (typeof actual === "object" && actual && "then" in actual)
      onLog("actual looks like a promise, did you await it?");

    if (typeof expected === "string" && typeof actual === "string") {
      onLog("E: " + encodeURIComponent(expected));
      onLog("A: " + encodeURIComponent(actual));

      printColoredTextDiff(expected, actual);
    }
    throw e;
  }
}

/* TypeScript requires assertions to return void, so we can't just "asserts actual" here if we return the original value.
   assert's returnvalue isn't that useful so it seems worth giving up the return value for cleaner testcode
*/
export function assert<T>(actual: [T] extends [void] ? T & false : Exclude<T, Promise<unknown>>, options?: Annotation | TestOptions): asserts actual {
  if (typeof options === "string" || typeof options === "function")
    options = { annotation: options };

  if (isPromise(actual))
    throw new TestError(`You cannot assert on a promise.Did you forget to await it ?`, options);

  if (actual)
    return; //test passed is actual was 'true'

  const stack = (new Error).stack;
  if (stack) {
    testsupport.reportAssertError(stack);
  }
  throw new TestError("test.assert failed", options);
}

async function throwsAsync(expect: RegExp, promise: Promise<unknown>, options?: TestOptions): Promise<Error> {
  let retval;
  try {
    retval = await promise;
    //fallthrough OUT OF the catch to do the actual throw, or we'll just recatch it below
  } catch (e) {
    return verifyThrowsException(expect, e, options);
  }

  failThrows(expect, retval, options);
}

//handle the failure of throws(Async)
function failThrows(expect: RegExp, retval: unknown, options?: TestOptions): never {
  //If we get here, no exception occurred
  const error = new TestError(`test.throws failed - expected function to throw ${expect.toString()}`, options);

  onLog("Expected exception: ", expect.toString());
  if (retval === undefined)
    onLog("Did not get an exception or return value");
  else
    onLog("Instead we got: ", retval);

  throw error;
}

function verifyThrowsException(expect: RegExp, exception: unknown, options?: TestOptions): Error {
  if (!isError(exception)) {
    console.error("Expected a proper Error but got:", exception);
    throw new TestError("test.throws failed - didn't get an Error object", options);
  }

  const exceptiontext = exception.message;
  if (!exceptiontext.match(expect)) {
    onLog("Expected exception: ", expect.toString());
    onLog("Got exception: ", exceptiontext);
    if (exception.stack)
      onLog("Stack: ", exception.stack);
    throw new TestError("test.throws failed - exception mismatch", { ...options, cause: exception });
  }

  return exception; //we got what we wanted - a throw! return the Error
}

/** Expect a call or promise to throw
 * @param expect - A regular expression to match the exception message against
 * @param func_or_promise - A function to call, or a promise to await
 *  @param options - Test compare options or annotation
 * @returns The Error object thrown */
export function throws(expect: RegExp, func_or_promise: () => never, options?: Annotation | TestOptions): Error; // only picks up always-throwing functions
export function throws(expect: RegExp, func_or_promise: Promise<unknown>, options?: Annotation | TestOptions): Promise<Error>;
export function throws(expect: RegExp, func_or_promise: () => Promise<unknown>, options?: Annotation | TestOptions): Promise<Error>;
export function throws(expect: RegExp, func_or_promise: () => unknown, options?: Annotation | TestOptions): Error;

export function throws(expect: RegExp, func_or_promise: Promise<unknown> | (() => unknown), options?: Annotation | TestOptions): Error | Promise<Error> {
  if (typeof options === "string" || typeof options === "function")
    options = { annotation: options };

  let retval;
  try {
    //If we got a function, execute it
    const potentialpromise = typeof func_or_promise === "function" ? func_or_promise() : func_or_promise;
    if (isPromise(potentialpromise))
      return throwsAsync(expect, potentialpromise as Promise<unknown>, options);

    retval = potentialpromise;
    //fallthrough OUT OF the catch to do the actual throw, or we'll just recatch it below
  } catch (e) {
    return verifyThrowsException(expect, e, options);
  }
  failThrows(expect, retval, options);

}

/** Compare specific cells of two values (partial, recursive)
 * @typeParam T - The type of the values (both values are expected to be of the same type). This type is only inferred
 * from the 'actual' parameter.
 *  @param expect - Expected value
 *  @param actual - Actual value
 *  @param options - Test compare options or annotation
 * */
export function eqPartial<T>(expect: NoInfer<RecursivePartialTestable<T>>, actual: T, options?: Annotation | TestOptions) {
  if (typeof options === "string" || typeof options === "function")
    options = { annotation: options };

  eqPropsRecurse(expect, actual, "root", [], options);
  return actual;
}

/** @deprecated use test.eqPartial instead */
export function eqProps<T>(expect: NoInfer<RecursivePartialTestable<T>>, actual: T, ignore: string[] = [], options?: Annotation | TestOptions) {
  if (typeof options === "string" || typeof options === "function")
    options = { annotation: options };

  eqPropsRecurse(expect, actual, "root", ignore, options);
  return actual;
}

function eqPropsRecurse<T>(expect: NoInfer<RecursivePartialTestable<T>>, actual: T, path: string, ignore: string[], options?: TestOptions) {
  switch (stdTypeOf(expect)) {
    case "Date":
    case "Money":
    case "Instant":
      testDeepEq(expect, actual, path, options);
      return;
  }

  switch (typeof expect) {
    case "undefined": {
      if (expect !== actual) {
        onLog({ expect, actual });
        throw new TestError(`Mismatched value at ${path}`, options);
      }
      return;
    }
    case "function":
      return testTestFunction(expect as TestFunction<unknown>, actual, path, options);
    case "object":
      {
        if (expect instanceof RegExp)
          return testRegExp(expect, actual, path, options);

        if (expect === null) {
          if (expect !== actual) {
            onLog({ expect, actual });
            throw new TestError(`Mismatched value at ${path}`, options);
          }
          return;
        }
        const expectarray = Array.isArray(expect);
        if (expectarray !== Array.isArray(actual)) {
          onLog({ expect, actual });
          throw new TestError(`Expected ${expectarray ? "array" : "object"}, got ${!expectarray ? "array" : "object"}, at ${path}`, options);
        }
        if (expectarray) {
          if (!Array.isArray(actual)) {
            onLog({ expect, actual });
            throw new TestError(`Expected array, got object, at ${path}`, options);
          }

          if (expect.length !== actual.length) {
            onLog({ expect, actual });
            throw new TestError(`Expected array of length ${expect.length}, got array of length ${actual.length}, at ${path}`, options);
          }
          for (let i = 0; i < expect.length; ++i)
            eqPropsRecurse(expect[i], actual[i], `${path}[${i}]`, ignore, options);
          return;
        } else {
          if (Array.isArray(actual)) {
            onLog({ expect, actual });
            throw new TestError(`Expected object, got array, at ${path}`, options);
          }

        }

        if (typeof actual !== "object" || !actual) {
          onLog({ expect, actual });
          throw new TestError(`Mismatched value at ${path}`, options);
        }

        const gotkeys = Object.keys(actual);
        for (const [key, value] of Object.entries(expect)) {
          if (ignore.includes(key))
            continue;

          if (!gotkeys.includes(key)) {
            // allow undefined to match a missing property
            if (value === undefined)
              continue;
            onLog({ expect, actual });
            throw new TestError(`Expected property '${key}', didn't find it, at ${path}`, options);
          }
          eqPropsRecurse(value, (actual as { [k: string]: unknown })[key], `${path}.${key}`, ignore);
        }
        return;
      }
    default:
      if (expect !== actual) {
        onLog({ expect, actual });
        throw new TestError(`Mismatched value at ${path}`, options);
      }
  }
}

/** @deprecated use test.eq in WebHare 5.4+, it also accepts RegExp */
export function eqMatch(regexp: RegExp, actual: string, options?: TestOptions) {
  if (actual.match(regexp))
    return;

  onLog("testEqMatch fails: regex", regexp.toString());
  // testfw.log("testEqMatch fails: regexp " + regexp.toString());

  let actual_str = actual;
  try {
    actual_str = typeof actual === "string" ? unescape(escape(actual).split('%u').join('/u')) : JSON.stringify(actual);
  } catch (ignore) {
    //Ignoring
  }
  onLog("testEqMatch fails: actual  ", actual_str);
  // testfw.log("testEqMatch fails: actual " + (typeof actual_str === "string" ? "'" + actual_str + "'" : actual_str));

  throw new TestError("testEqMatch failed", options);
}

export function setupLogging(settings: { onLog?: LoggingCallback } = {}) {
  if (settings.onLog)
    onLog = settings.onLog;
}

export interface TestTypeValidator {
  validateStructure(data: unknown, options?: TestOptions): void;
}

class JSONSchemaValidator implements TestTypeValidator {
  validate: AjvValidateFunction;
  constructor(validatefunction: AjvValidateFunction) {
    this.validate = validatefunction;
  }
  validateStructure(data: unknown, options?: TestOptions) {
    const valid = this.validate(data);
    if (!valid) {
      let message = "";
      if (this.validate.errors) {
        if (this.validate.errors[0].message)
          message = `${JSON.stringify(this.validate.errors[0].instancePath)} ${this.validate.errors[0].message}`;
        console.log("Got structure validation errors: ", this.validate.errors);
      }

      throw new TestError(`validateStructure failed - data does not conform to the structure${message ? `: ${message}` : ""}`, options);
    }
  }
}

export async function loadTSType(typeref: string, options: testsupport.LoadTSTypeOptions = {}): Promise<TestTypeValidator> {
  const schema = await testsupport.getJSONSchemaFromTSType(typeref, options);
  return new JSONSchemaValidator(await getCompiledJSONSchema(schema));
}

export async function loadJSONSchema(schema: string | JSONSchemaObject): Promise<JSONSchemaValidator> {
  let tocompile;
  if (typeof schema === "string") {
    tocompile = await testsupport.getJSONSchemaFromFile(schema);
  } else
    tocompile = schema;
  return new JSONSchemaValidator(await getCompiledJSONSchema(tocompile));
}

/** Wait for a condition to become truthy
 * @param waitfor - A function/promiose that should resolve to true for the wait to finish
 * @param options - Test compare options or annotation
 * @returns The value that the waitfor function last resolved to
 */
export async function wait<T>(waitfor: (() => T | PromiseLike<T>) | PromiseLike<T>, options?: WaitOptions<T>): WaitRetVal<T> {
  using waitState = flagWait("wait");

  if (typeof options === "string" || typeof options === "function")
    options = { annotation: options };

  const { timeout = 60000 } = options ?? {};

  // TypeScript can't see that the timeout can modify gottimeout, so use a function to read it
  let gottimeout = false;
  function gotTimeout() { return gottimeout; }

  if (typeof waitfor === "function") {
    const timeout_cb = setTimeout(() => gottimeout = true, timeout);
    try {
      while (!gotTimeout()) {
        const result = await waitState.race([waitfor()]);
        const done = options?.test ? options?.test(result) : result;
        if (done) {
          return result as unknown as WaitRetVal<T>;
        }

        await new Promise(resolve => setTimeout(resolve, 1));
      }
    } finally {
      clearTimeout(timeout_cb);
    }
    throw new TestError(`test.wait timed out after ${timeout} ms`, options);
  } else {
    let cb;
    if (options?.test)
      throw new Error("The test option can only be used together with function waits");

    const timeoutpromise = new Promise((_, reject) => {
      cb = setTimeout(() => {
        cb = null;
        reject(new TestError(`test.wait timed out after ${timeout} ms`, options));
      }, timeout);
    });
    try {
      return await waitState.race([waitfor, timeoutpromise]) as WaitRetVal<T>;
    } finally {
      if (cb)
        clearTimeout(cb);
    }
  }
}

/** Wait for a condition from false to true when executing a specific code.
 *
 * This is generally equivalent to `assert(!test); run(); wait(test);` but helps prevent mistakes if the two test conditions weren't identical, or if they became true because of another side effect rather than the run() function.
 *
 * @param wait - Toggle set
 * @param wait.test - A function that should resolve to falsy value before run() is invoked (tested immediatley and after one tick), and to a truthy value once run() has completed
 * @param wait.run - The function to run
 * @param options - Test compare options or annotation
*/
export async function waitToggled<T>({ test, run }: {
  test: () => T | Promise<T>;
  run: () => unknown | Promise<unknown>;
}, options?: Annotation | { timeout?: number; annotation?: Annotation }): WaitRetVal<T> {
  if (typeof options === "string" || typeof options === "function")
    options = { annotation: options };

  //Evaluate immediately
  let result = test();
  if (isPromise(result)) //TODO guard with timeout - share with wait()
    result = await result;

  if (result)
    throw new TestError("waitToggled: the test condition is already initially true", options);

  await sleep(1);

  //Re-evaluate
  result = test();
  if (isPromise(result)) //TODO guard with timeout - share with wait()
    result = await result;

  if (result)
    throw new TestError("waitToggled: the test condition became true before we even got to invoke the action!", options);

  await run();
  return await wait(test, options);
}

/** Return a promise that waits for event 'eventtype' to trigger on the node */
export function waitForEvent<EventType extends Event>(target: EventTarget, eventtype: string, options?:
  {
    filter?: (event: EventType) => boolean;
    stop?: boolean;
    capture?: boolean;
  }): Promise<Event> {
  return new Promise<EventType>(resolve => {
    //we need access to the eventhandler after declaring, so it must be VAR
    const eventhandler = (event: EventType) => {
      if (options && options.filter && !options.filter(event))
        return;

      if (options && options.stop) {
        event.stopPropagation();
        event.preventDefault();
      }

      target.removeEventListener(eventtype, eventhandler as EventListenerOrEventListenerObject, options && options.capture);
      resolve(event);
    };
    target.addEventListener(eventtype, eventhandler as EventListenerOrEventListenerObject, options && options.capture);
  });
}

// from https://github.com/Microsoft/TypeScript/issues/27024
export type EqualsInternal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2) ? true : false;

/** Returns whether types X and Y are equal. If will give good feedback if Y can't be assigned to X. If false is returned, try using RevEquals if that one gives better feedback.
 * @typeParam X - First type
 * @typeParam Y - Second type
 */
export type Equals<X extends Y, Y> = EqualsInternal<X, Y>;

/** Returns whether types X and Y are equal. If will give good feedback if X can't be assigned to Y
 * @typeParam X - First type
 * @typeParam Y - Second type
 */
export type RevEquals<X, Y extends X> = EqualsInternal<X, Y>;

/** Returns whether a value of type Y can be assigned to type X
 * @typeParam X - Type that is assigned to
 * @typeParam Y - Type that is assigned
 */
export type Assignable<X, Y extends X> = Y extends X ? true : true;

/** Returns whether type X extends from type Y
 * @typeParam X - Type that is should extend Y
 * @typeParam Y - Type that X is ectended from
 */
export type Extends<X extends Y, Y> = X extends Y ? true : true;

/** Checks if a type assertion holds. Use Equals or RevEquals to check for equality, Assignable for assignabilty
 * @param X - Type assertion
 */
export function typeAssert<X extends true>(): X extends true ? void : void { return; }

export type { TestError };
