import * as testsupport from "./testsupport";
import * as diff from 'diff';
import Ajv, { SchemaObject, ValidateFunction } from "ajv";
export { LoadTSTypeOptions } from "./testsupport";
export { sleep } from "@webhare/std";

/** An Annotation must either be a simple string or a callback returning one */
export type Annotation = string | (() => string);

type LoggingCallback = (...args: unknown[]) => void;

let onLog: LoggingCallback = console.log.bind(console) as LoggingCallback;

function myTypeOf(item: unknown) {
  if (item === undefined) return 'undefined';
  if (item === null) return 'null';

  if ((item as Node).nodeName) {
    if ((item as Node).nodeType === 1) return 'element';
    if ((item as Node).nodeType === 3) return (/\S/).test((item as Node).nodeValue || '') ? 'textnode' : 'whitespace';
  }

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

  const t_expected = typeof expected;
  const t_actual = typeof actual;
  if (t_expected != t_actual)
    throw new Error("Expected type: " + t_expected + " actual type: " + t_actual + (path != "" ? " at " + path : ""));

  if (typeof expected !== "object") //simple value mismatch
    throw new Error("Expected: " + expected + " actual: " + actual + (path != "" ? " at " + path : ""));

  // Deeper type comparison
  const type_expected = myTypeOf(expected);
  const type_actual = myTypeOf(actual);

  if (type_expected != type_actual)
    throw new Error("Expected type: " + type_expected + " actual type: " + type_actual + (path != "" ? " at " + path : ""));

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
      if (!actualkeys.includes(key))
        throw new Error("Expected key: " + key + ", didn't actually exist" + (path != "" ? " at " + path : ""));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      testDeepEq((expected as any)[key], (actual as any)[key] as any, path + "." + key);
    }
    for (const key of actualkeys) {
      if (!expectedkeys.includes(key))
        throw new Error("Key unexpectedly exists: " + key + (path != "" ? " at " + path : ""));
    }
  }
}

function isequal(a: unknown, b: unknown) {
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
    return JSON.stringify(val);
  } catch (ignore) {
    return "";
  }
}

/** Verify deep equality of two values (to compare object identity, you need to use {@link assert} with ===)
 * @typeparam T - The type of the values (both values are expected to be of the same type)
 * @param expected - The expected value
 * @param actual - The actual value
 * @throws If the values are not equal
 */
export function eq<T>(expected: T, actual: T, annotation?: Annotation): void {
  if (arguments.length < 2)
    throw new Error("Missing argument to test.eq");

  if (isequal(expected, actual))
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

    let str = "diff: ";
    const colors = [];
    for (const change of diff.diffChars(actual, expected)) {
      str += `%c${change.value}`;
      colors.push(change.added ? "background-color:red; color: white" : change.removed ? "background-color:green; color: white" : "");
    }
    console.log(str, ...colors);
  }

  testDeepEq(expected, actual, '');
}

/* TypeScript requires assertions to return void, so we can't just "asserts actual" here if we return the original value.
   assert's returnvalue isn't that useful so it seems worth giving up the return value for cleaner testcode
*/
export function assert<T>(actual: T, annotation?: Annotation): asserts actual {
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

/** @returns The Error object thrown */
export async function throws(expect: RegExp, func_or_promise: Promise<unknown> | (() => unknown), annotation?: Annotation): Promise<Error> {
  try {
    //If we got a function, execute it
    const promiselike = typeof func_or_promise == "function" ? func_or_promise() : func_or_promise;
    //To be safe and consistently take up a tick, we'll await the return value. awaiting non-promises is otherwise safe anyway
    const retval = await promiselike;

    //If we get here, no exception occurred
    if (annotation)
      logAnnotation(annotation);

    onLog("Expected exception: ", expect.toString());
    if (retval === undefined)
      onLog("Did not get an exception or return value");
    else
      onLog("Instead we got: ", retval);

    //fallthrough OUT OF the catch to do the actual throw, or we'll just recatch it below
  } catch (e) {
    if (!quacksLikeAnError(e)) {
      if (annotation)
        logAnnotation(annotation);

      console.error("Expected a proper Error but got:", e);
      throw new Error("testThrows fails - didn't get an Error object");
    }

    const exceptiontext = e.message;
    if (!exceptiontext.match(expect)) {
      if (annotation)
        logAnnotation(annotation);

      onLog("Expected exception: ", expect.toString());
      onLog("Got exception: ", exceptiontext);
      if (e.stack)
        onLog("Stack: ", e.stack);
      throw new Error("testThrows fails - exception mismatch");
    }

    return e; //we got what we wanted - a throw! return the Error
  }
  throw new Error(`testThrows fails: Expected function to throw ${expect.toString()}`);
}

/** Compare specific cells of two values (recursive)
    @param expected - Expected value
    @param actual - Actual value
    @param ignore - List of properties to ignore
    @param annotation - Message to display when the test fails */
export function eqProps<T>(expect: T, actual: T, ignore: string[] = [], annotation?: Annotation) {
  eqPropsRecurse(expect, actual, "root", ignore, annotation);
  return actual;
}

function eqPropsRecurse<T>(expect: T, actual: T, path: string, ignore: string[], annotation?: Annotation) {
  switch (typeof expect) {
    case "undefined": return;
    case "object":
      {
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

export async function loadTSType(typeref: string, options: testsupport.LoadTSTypeOptions = {}): Promise<TestTypeValidator> {
  const schema = await testsupport.getJSONSchemaFromTSType(typeref, options);

  if (!ajv)
    ajv = new Ajv();

  return new JSONSchemaValidator(ajv.compile(schema));
}

export async function loadJSONSchema(schema: string | SchemaObject): Promise<TestTypeValidator> {
  let tocompile;
  if (typeof schema === "string") {
    tocompile = await testsupport.getJSONSchemaFromFile(schema);
  } else
    tocompile = schema;

  if (!ajv)
    ajv = new Ajv();

  return new JSONSchemaValidator(ajv.compile(tocompile));
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
