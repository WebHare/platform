import * as testsupport from "./testsupport";
import * as diff from 'diff';
import Ajv from "ajv";
import Ajv2019 from "ajv/dist/2019";
import Ajv2020, { SchemaObject, ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { checkPromiseErrorsHandled } from "@webhare/js-api-tools";
import { Money } from "@webhare/std";

export { LoadTSTypeOptions } from "./testsupport";

/** An Annotation must either be a simple string or a callback returning one */
export type Annotation = string | (() => string);

type LoggingCallback = (...args: unknown[]) => void;

// Disallows type inferences when a parameter type is wrapped with this type. From: https://github.com/Microsoft/TypeScript/issues/14829#issuecomment-504042546
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NoInfer<T> = [T][T extends any ? 0 : never];

type PrimitiveType = Money | Date | RegExp;

/** Recursively apply `Partial<>` on records in a type but also allow Regexps to match strings. Also allow the string values for string enums.
 * @typeParam T - Type to convert
*/
export type RecursivePartialOrRegExp<T> = T extends Array<infer U> ? Array<RecursivePartialOrRegExp<U>> : T extends string ? T | `${T}` | RegExp : T extends PrimitiveType ? T : T extends object ? { [K in keyof T]?: RecursivePartialOrRegExp<T[K]> } : T;

/** Recursively allow Regexps to match strings. Also allow the string values for string enums.
 * @typeParam T - Type to convert
*/
export type RecursiveOrRegExp<T> = T extends Array<infer U> ? Array<RecursiveOrRegExp<U>> : T extends string ? T | `${T}` | RegExp : T extends PrimitiveType ? T : T extends object ? { [K in keyof T]: RecursiveOrRegExp<T[K]> } : T;

let onLog: LoggingCallback = console.log.bind(console) as LoggingCallback;

function isDate(item: unknown) {
  return item && Object.prototype.toString.call(item) === "[object Date]";
}

function myTypeOf(item: unknown) {
  if (item === undefined) return 'undefined';
  if (item === null) return 'null';

  if ((item as Node).nodeName) {
    if ((item as Node).nodeType === 1) return 'element';
    if ((item as Node).nodeType === 3) return (/\S/).test((item as Node).nodeValue || '') ? 'textnode' : 'whitespace';
  }

  if (isDate(item))
    return "date";

  return typeof item;
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

function testMoney(expect: Money, actual: unknown, path: string) {
  if (!Money.isMoney(actual)) {
    onLog("Money fails type: expected", expect);
    onLog("Money fails type: actual  ", actual);
    throw new Error("Expected type: Money actual type: " + typeof actual + (path != "" ? " at " + path : ""));
  }

  if (Money.cmp(expect, actual) !== 0) {
    onLog("Money fails: expected", expect);
    onLog("Money fails: actual  ", actual);
    throw new Error("Expected match: " + String(expect) + " actual: " + actual + (path != "" ? " at " + path : ""));
  }
}

function testRegExp(expect: RegExp, actual: unknown, path: string) {
  if (typeof actual !== "string") {
    onLog("regExp fails type: expected", expect);
    onLog("regExp fails type: actual  ", actual);
    throw new Error("Expected type: string actual type: " + typeof actual + (path != "" ? " at " + path : ""));
  }

  if (!expect.test(actual)) {
    onLog("regExp fails: expected", expect);
    onLog("regExp fails: actual  ", actual);
    throw new Error("Expected match: " + String(expect) + " actual: " + actual + (path != "" ? " at " + path : ""));
  }
}

function testDeepEq(expected: unknown, actual: unknown, path: string) {
  if (expected === actual)
    return;

  if (expected === null)
    if (actual === null)
      return; //ok!
    else
      throw new Error("Expected null, got " + (path != "" ? " at " + path : ""));

  if (actual === null)
    throw new Error("Got a null, but expected " + expected + (path != "" ? " at " + path : ""));
  if (actual === undefined)
    throw new Error("Got undefined, but expected " + expected + (path != "" ? " at " + path : ""));

  if (expected instanceof RegExp)
    return testRegExp(expected, actual, path);
  if (Money.isMoney(expected))
    return testMoney(expected, actual, path);

  const t_expected = typeof expected;
  const t_actual = typeof actual;
  if (t_expected != t_actual)
    throw new Error("Expected type: " + t_expected + " actual type: " + t_actual + (path != "" ? " at " + path : ""));

  if (typeof expected !== "object") {//simple value mismatch
    if (typeof expected == "string" && typeof actual == "string") {
      printColoredTextDiff(expected, actual);
    }

    throw new Error("Expected: " + expected + " actual: " + actual + (path != "" ? " at " + path : ""));
  }
  // Deeper type comparison
  const type_expected = myTypeOf(expected);
  const type_actual = myTypeOf(actual);

  if (type_expected != type_actual)
    throw new Error("Expected type: " + type_expected + " actual type: " + type_actual + (path != "" ? " at " + path : ""));

  if (type_expected === 'date') {
    expected = JSON.stringify(expected);
    actual = JSON.stringify(actual);
    if (expected !== actual)
      throw new Error("Expected date: " + expected + " actual date: " + actual + (path != "" ? " at " + path : ""));
    return;
  }

  if (['element', 'textnode', 'whitespace'].includes(type_expected) && expected != actual) {
    onLog("Expected node: ", expected);
    onLog("Actual node:", actual);
    throw new Error("Expected DOM node: " + presentDomNode(expected as Node) + " actual: " + presentDomNode(actual as Node) + (path != "" ? " at " + path : ""));
  }

  if (['window', 'collection', 'document'].includes(type_expected) && expected != actual) {
    throw new Error("Expected: " + expected + " actual: " + actual + (path != "" ? " at " + path : ""));
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length != actual.length)
      throw new Error("Expected: " + expected.length + " elements, actual: " + actual.length + " elements" + (path != "" ? " at " + path : ""));

    for (let i = 0; i < expected.length; ++i)
      testDeepEq(expected[i], actual[i], path + "[" + i + "]");
  } else {
    //not the same object. same contents?
    const expectedkeys = Object.keys(expected);
    const actualkeys = Object.keys(actual);

    for (const key of expectedkeys) {
      if (!actualkeys.includes(key)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((expected as any)[key] === undefined) // allow undefined to function as missing-property indicator too
          continue;

        throw new Error("Expected key: " + key + ", didn't actually exist" + (path != "" ? " at " + path : ""));
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      testDeepEq((expected as any)[key], (actual as any)[key] as any, path + "." + key);
    }
    for (const key of actualkeys) {
      if (!expectedkeys.includes(key))
        throw new Error("Key unexpectedly exists: " + key + (path != "" ? " at " + path : ""));
    }
  }
}

function isEqual(a: unknown, b: unknown) {
  try {
    testDeepEq(a, b, '');
    return true;
  } catch (e) {
    return false;
  }
}

function logAnnotation(annotation: Annotation) {
  if (typeof annotation == "function")
    annotation = annotation();

  console.error(annotation);
}

function toTestableString(val: unknown): string {
  if (typeof val == "string")
    return unescape(escape(val).split('%u').join('/u'));
  try {
    return JSON.stringify(val, (key, value) => value === undefined ? "undefined" : value);
  } catch (ignore) {
    return "";
  }
}

/** Verify deep equality of two values (to compare object identity, you need to use {@link assert} with ===)
 * @typeparam T - The type of the values (both values are expected to be of the same type). This type is only inferred
 * from the 'actual' parameter.
 * @param expected - The expected value
 * @param actual - The actual value
 * @throws If the values are not equal
 */
export function eq<T>(expected: NoInfer<RecursiveOrRegExp<T>>, actual: T, annotation?: Annotation): void {
  if (arguments.length < 2)
    throw new Error("Missing argument to test.eq");

  if (isEqual(expected, actual))
    return;

  const expected_str = toTestableString(expected);
  const actual_str = toTestableString(actual);

  if (annotation)
    logAnnotation(annotation);

  onLog("testEq fails: expected", expected_str);
  onLog("testEq fails: actual  ", actual_str);
  if (typeof actual === "object" && actual && "then" in actual)
    onLog("actual looks like a promise, did you await it?");

  if (typeof expected == "string" && typeof actual == "string") {
    onLog("E: " + encodeURIComponent(expected));
    onLog("A: " + encodeURIComponent(actual));

    printColoredTextDiff(expected, actual);
  }

  testDeepEq(expected, actual, '');
}

/* TypeScript requires assertions to return void, so we can't just "asserts actual" here if we return the original value.
   assert's returnvalue isn't that useful so it seems worth giving up the return value for cleaner testcode
*/
export function assert<T>(actual: [T] extends [void] ? T & false : Exclude<T, Promise<unknown>>, annotation?: Annotation): asserts actual {
  if ((actual as Promise<unknown>)?.then)
    throw new Error(`You cannot assert on a promise. Did you forget to await it?`);

  if (actual)
    return; //test passed is actual was 'true'

  if (annotation)
    logAnnotation(annotation);

  const stack = (new Error).stack;
  if (stack) {
    testsupport.reportAssertError(stack);
  }
  throw new Error("test.assert failed");
}

/** Check if the object is probably an Error object. Can't use 'instanceof Error' as an Error might come from a different frame */
function quacksLikeAnError(e: unknown): e is Error {
  if (!e)
    return false;
  return (typeof e === "object") && ("stack" in e) && ("message" in e);
}

async function throwsAsync(expect: RegExp, promise: Promise<unknown>, annotation?: Annotation): Promise<Error> {
  let retval;
  try {
    retval = await promise;
    //fallthrough OUT OF the catch to do the actual throw, or we'll just recatch it below
  } catch (e) {
    return verifyThrowsException(expect, e, annotation);
  }

  failThrows(expect, retval, annotation);
}

//handle the failure of throws(Async)
function failThrows(expect: RegExp, retval: unknown, annotation?: Annotation): never {
  //If we get here, no exception occurred
  if (annotation)
    logAnnotation(annotation);

  onLog("Expected exception: ", expect.toString());
  if (retval === undefined)
    onLog("Did not get an exception or return value");
  else
    onLog("Instead we got: ", retval);

  throw new Error(`testThrows fails: Expected function to throw ${expect.toString()}`);
}

function verifyThrowsException(expect: RegExp, exception: unknown, annotation?: Annotation): Error {
  if (!quacksLikeAnError(exception)) {
    if (annotation)
      logAnnotation(annotation);

    console.error("Expected a proper Error but got:", exception);
    throw new Error("testThrows fails - didn't get an Error object");
  }

  const exceptiontext = exception.message;
  if (!exceptiontext.match(expect)) {
    if (annotation)
      logAnnotation(annotation);

    onLog("Expected exception: ", expect.toString());
    onLog("Got exception: ", exceptiontext);
    if (exception.stack)
      onLog("Stack: ", exception.stack);
    throw new Error("testThrows fails - exception mismatch");
  }

  return exception; //we got what we wanted - a throw! return the Error
}

/** Expect a call or promise to throw
 * @param expect - A regular expression to match the exception message against
 * @param func_or_promise - A function to call, or a promise to await
 * @param annotation - Optional annotation to log if the test fails
 * @returns The Error object thrown */
export function throws(expect: RegExp, func_or_promise: Promise<unknown>, annotation?: Annotation): Promise<Error>;
export function throws(expect: RegExp, func_or_promise: () => Promise<unknown>, annotation?: Annotation): Promise<Error>;
export function throws(expect: RegExp, func_or_promise: () => unknown, annotation?: Annotation): Error;

export function throws(expect: RegExp, func_or_promise: Promise<unknown> | (() => unknown), annotation?: Annotation): Error | Promise<Error> {
  let retval;
  try {
    //If we got a function, execute it
    const potentialpromise = typeof func_or_promise == "function" ? func_or_promise() : func_or_promise;
    if ((potentialpromise as Promise<unknown>)?.then)
      return checkPromiseErrorsHandled(throwsAsync(expect, potentialpromise as Promise<unknown>, annotation));

    retval = potentialpromise;
    //fallthrough OUT OF the catch to do the actual throw, or we'll just recatch it below
  } catch (e) {
    return verifyThrowsException(expect, e, annotation);
  }
  failThrows(expect, retval, annotation);

}

/** Compare specific cells of two values (recursive)
 * @typeparam T - The type of the values (both values are expected to be of the same type). This type is only inferred
 * from the 'actual' parameter.
 *  @param expected - Expected value
 *  @param actual - Actual value
 *  @param ignore - List of properties to ignore
 *  @param annotation - Message to display when the test fails */
export function eqProps<T>(expect: NoInfer<RecursivePartialOrRegExp<T>>, actual: T, ignore: string[] = [], annotation?: Annotation) {
  eqPropsRecurse(expect, actual, "root", ignore, annotation);
  return actual;
}

function eqPropsRecurse<T>(expect: NoInfer<RecursivePartialOrRegExp<T>>, actual: T, path: string, ignore: string[], annotation?: Annotation) {
  switch (typeof expect) {
    case "undefined": {
      if (expect !== actual) {
        onLog({ expect, actual });
        throw Error(`Mismatched value at ${path}`);
      }
      return;
    }
    case "object":
      {
        if (isDate(expect) || isDate(actual) || Money.isMoney(expect) || Money.isMoney(actual)) {
          testDeepEq(expect, actual, path);
          return;
        }

        if (expect instanceof RegExp)
          return testRegExp(expect, actual, path);

        if (expect === null) {
          if (expect !== actual) {
            onLog({ expect, actual });
            throw Error(`Mismatched value at ${path}`);
          }
          return;
        }
        const expectarray = Array.isArray(expect);
        if (expectarray != Array.isArray(actual)) {
          onLog({ expect, actual });
          throw Error(`Expected ${expectarray ? "array" : "object"}, got ${!expectarray ? "array" : "object"}, at ${path}`);
        }
        if (expectarray) {
          if (!Array.isArray(actual)) {
            onLog({ expect, actual });
            throw Error(`Expected array, got object, at ${path}`);
          }

          if (expect.length != actual.length) {
            onLog({ expect, actual });
            throw Error(`Expected array of length ${expect.length}, got array of length ${actual.length}, at ${path}`);
          }
          for (let i = 0; i < expect.length; ++i)
            eqPropsRecurse(expect[i], actual[i], `${path}[${i}]`, ignore, annotation);
          return;
        } else {
          if (Array.isArray(actual)) {
            onLog({ expect, actual });
            throw Error(`Expected object, got array, at ${path}`);
          }

        }

        if (typeof actual !== "object" || !actual) {
          onLog({ expect, actual });
          throw Error(`Mismatched value at ${path}`);
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
            throw Error(`Expected property '${key}', didn't find it, at ${path}`);
          }
          eqPropsRecurse(value, (actual as { [k: string]: unknown })[key], `${path}.${key}`, ignore);
        }
        return;
      }
    default:
      if (expect !== actual) {
        onLog({ expect, actual });
        throw Error(`Mismatched value at ${path}`);
      }
  }
}

/** @deprecated use test.eq in WebHare 5.4+, it also accepts RegExp */
export function eqMatch(regexp: RegExp, actual: string, annotation?: Annotation) {
  if (actual.match(regexp))
    return;

  if (annotation)
    logAnnotation(annotation);

  onLog("testEqMatch fails: regex", regexp.toString());
  // testfw.log("testEqMatch fails: regexp " + regexp.toString());

  let actual_str = actual;
  try {
    actual_str = typeof actual == "string" ? unescape(escape(actual).split('%u').join('/u')) : JSON.stringify(actual);
  } catch (ignore) {
    //Ignoring
  }
  onLog("testEqMatch fails: actual  ", actual_str);
  // testfw.log("testEqMatch fails: actual " + (typeof actual_str == "string" ? "'" + actual_str + "'" : actual_str));

  throw new Error("testEqMatch failed");
}

export function setupLogging(settings: { onLog?: LoggingCallback } = {}) {
  if (settings.onLog)
    onLog = settings.onLog;
}

export interface TestTypeValidator {
  validateStructure(data: unknown, annotation?: string): void;
}

class JSONSchemaValidator implements TestTypeValidator {
  validate: ValidateFunction;
  constructor(validatefunction: ValidateFunction) {
    this.validate = validatefunction;
  }
  validateStructure(data: unknown, annotation?: Annotation) {
    const valid = this.validate(data);
    if (!valid) {
      if (annotation)
        logAnnotation(annotation);

      let message = "";
      if (this.validate.errors) {
        if (this.validate.errors[0].message)
          message = `${JSON.stringify(this.validate.errors[0].instancePath)} ${this.validate.errors[0].message}`;
        console.log("Got structure validation errors: ", this.validate.errors);
      }

      throw new Error(`validateStructure failed - data does not conform to the structure${message ? `: ${message}` : ""}`);
    }
  }
}

let ajv: (Ajv | null) = null;
let ajv2019: (Ajv2019 | null) = null;
let ajv2020: (Ajv2020 | null) = null;

function getCompiledJSONSchema(schema: SchemaObject) {
  if ([
    "http://json-schema.org/draft-04/schema#",
    "http://json-schema.org/draft-06/schema#",
    "http://json-schema.org/draft-07/schema#",
  ].includes(schema.$schema ?? "")) {
    if (!ajv) {
      ajv = new Ajv({ allowMatchingProperties: true });
      addFormats(ajv);
    }
    return ajv.compile(schema);
  }

  if (schema.$schema === "https://json-schema.org/draft/2019-09/schema") {
    if (!ajv2019) {
      ajv2019 = new Ajv2019({ allowMatchingProperties: true });
      addFormats(ajv2019);
    }
    return ajv2019.compile(schema);
  }

  if (!ajv2020) {
    ajv2020 = new Ajv2020({ allowMatchingProperties: true });
    addFormats(ajv2020);
  }

  return ajv2020.compile(schema);
}

export async function loadTSType(typeref: string, options: testsupport.LoadTSTypeOptions = {}): Promise<TestTypeValidator> {
  const schema = await testsupport.getJSONSchemaFromTSType(typeref, options);
  return new JSONSchemaValidator(getCompiledJSONSchema(schema));
}

export async function loadJSONSchema(schema: string | SchemaObject): Promise<TestTypeValidator> {
  let tocompile;
  if (typeof schema === "string") {
    tocompile = await testsupport.getJSONSchemaFromFile(schema);
  } else
    tocompile = schema;
  return new JSONSchemaValidator(getCompiledJSONSchema(tocompile));
}

//We want to make clear ('assert') that wait will not return falsy values
type WaitRetVal<T> = Promise<Exclude<T, undefined | false | null>>;

export async function wait<T>(waitfor: (() => T | PromiseLike<T>) | PromiseLike<T>, options?: Annotation | { timeout?: number; annotation?: Annotation }): WaitRetVal<T> {
  if (typeof options == "string" || typeof options == "function")
    options = { annotation: options };

  const { timeout = 60000, annotation } = options ?? {};

  // TypeScript can't see that the timeout can modify gottimeout, so use a function to read it
  let gottimeout = false;
  function gotTimeout() { return gottimeout; }

  if (typeof waitfor == "function") {
    const timeout_cb = setTimeout(() => gottimeout = true, timeout);
    while (!gotTimeout()) {
      const result = await waitfor();
      if (result) {
        if (!gotTimeout())
          clearTimeout(timeout_cb);
        return result as unknown as WaitRetVal<T>;
      }

      await new Promise(resolve => setTimeout(resolve, 1));
    }
    if (annotation)
      logAnnotation(annotation);
    throw new Error(`test.wait timed out after ${timeout} ms`);
  } else {
    let cb;
    const timeoutpromise = new Promise((_, reject) => {
      cb = setTimeout(() => {
        cb = null;
        reject(new Error(`test.wait timed out after ${timeout} ms`));
      }, timeout);
    });
    try {
      return await Promise.race([waitfor, timeoutpromise]) as WaitRetVal<T>;
    } finally {
      if (cb)
        clearTimeout(cb);
    }
  }
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
