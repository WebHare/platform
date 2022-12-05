/** An Annotation must either be a simple string or a callback returning one */
export type Annotation = string | (() => string);

function myTypeOf(item: unknown) {
  if (item === undefined) return 'undefined';
  if (item === null) return 'null';

  if ((item as Node).nodeName) {
    if ((item as Node).nodeType === 1) return 'element';
    if ((item as Node).nodeType === 3) return (/\S/).test((item as Node).nodeValue || '') ? 'textnode' : 'whitespace';
  } else if (typeof (item as unknown[]).length == 'number') {
    if ('callee' in item) return 'arguments';
    if ('item' in item) return 'collection';
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
    console.log("Expected node: ", expected);
    console.log("Actual node:", actual);
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
  }
  else {
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
  }
  catch (e) {
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
  }
  catch (ignore) {
    return "";
  }
}

function testEq<T>(expected: T, actual: T, annotation?: Annotation) {
  if (arguments.length < 2)
    throw new Error("Missing argument to test.eq");

  if (isequal(expected, actual))
    return;

  const expected_str = toTestableString(expected);
  const actual_str = toTestableString(actual);

  if (annotation)
    logAnnotation(annotation);

  console.log("testEq fails: expected", expected_str);
  console.log("testEq fails: actual  ", actual_str);

  if (typeof expected == "string" && typeof actual == "string") {
    console.log("E: " + encodeURIComponent(expected));
    console.log("A: " + encodeURIComponent(actual));
  }

  testDeepEq(expected, actual, '');
}

function testAssert(actual: unknown, annotation?: Annotation) //TODO ': asserts actual' declaration.. but still mistified by https://github.com/microsoft/TypeScript/issues/36931
{
  testEq(true, Boolean(actual), annotation);
}

async function testThrows(expect: RegExp, func_or_promise: Promise<unknown> | (() => unknown), annotation?: Annotation): Promise<Error> {
  try {
    //If we got a function, execute it
    const promiselike = typeof func_or_promise == "function" ? func_or_promise() : func_or_promise;
    //To be safe and consistently take up a tick, we'll await the return value. awaiting non-promises is otherwise safe anyway
    await promiselike;

    if (annotation)
      logAnnotation(annotation);

    throw new Error("testThrows fails: expected function to throw");
  }
  catch (e) {
    if (!(e instanceof Error)) {
      if (annotation)
        logAnnotation(annotation);

      console.error("Expected a proper Error but got:", e);
      throw new Error("testThrows fails - didn't get an Error object");
    }

    const exceptiontext = e.toString();
    if (!exceptiontext.toString().match(expect)) {
      if (annotation)
        logAnnotation(annotation);

      console.log("Expected exception: ", expect.toString());
      console.log("Got exception: ", exceptiontext);
      throw new Error("testThrows fails - exception mismatch");
    }

    return e; //we got what we wanted - a throw!
  }
}
async function testSleep(condition: number) : Promise<void> {
  if(condition < 0)
    throw new Error(`Wait duration must be positive, got '${condition}'`);
  await new Promise(resolve => setTimeout(resolve, condition));
  return;
}

export {
  testAssert as assert
  , testEq as eq
  , testSleep as sleep
  , testThrows as throws
};
