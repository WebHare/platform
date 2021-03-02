import { log } from './index.es';

var typeOf = function(item){
        if (item == null) return 'null';

        if (item.nodeName){
               if (item.nodeType == 1) return 'element';
               if (item.nodeType == 3) return (/\S/).test(item.nodeValue) ? 'textnode' : 'whitespace';
        } else if (typeof item.length == 'number'){
               if ('callee' in item) return 'arguments';
               if ('item' in item) return 'collection';
        }

        return typeof item;
};

function presentDomNode(node)
{
  let nodedescr = node.nodeName.toLowerCase();
  if(node.id)
    nodedescr += "#" + node.id;
  if(node.classList.length)
    nodedescr += '.' + Array.from(node.classList).join(".");
  return nodedescr;
}

export function testDeepEq(expected, actual, path) //exported for webhare's testfw, will be made public once we're fully merged
{
  if(expected === actual)
    return;
  if(actual === null && expected !== null)
    throw new Error("Got a null, but expected " + expected + (path!="" ? " at " + path : ""));
  if(expected === null && actual !== null)
    throw new Error("Expected null, got " + (path!="" ? " at " + path : ""));

  var t_expected = typeof expected;
  var t_actual = typeof actual;
  if(t_expected != t_actual)
    throw new Error("Expected type: " + t_expected + " actual type: " + t_actual + (path!="" ? " at " + path : ""));

  if(t_expected != "object") //simple value mismatch
    throw new Error("Expected: " + expected + " actual: " + actual + (path!="" ? " at " + path : ""));

  // Deeper type comparison
  t_expected = typeOf(expected);
  t_actual = typeOf(actual);

  if(t_expected != t_actual)
    throw new Error("Expected type: " + t_expected + " actual type: " + t_actual + (path!="" ? " at " + path : ""));

  if([ 'element', 'textnode', 'whitespace' ].includes(t_expected) && expected != actual)
  {
    console.log("Expected node: ",expected);
    console.log("Actual node:", actual);
    throw new Error("Expected DOM node: " + presentDomNode(expected) + " actual: " + presentDomNode(actual) + (path!="" ? " at " + path : ""));
  }

  if([ 'window', 'collection', 'document' ].includes(t_expected) && expected != actual)
  {
    throw new Error("Expected: " + expected + " actual: " + actual + (path!="" ? " at " + path : ""));
  }

  if(typeof expected.sort != 'undefined' && typeof actual.sort != 'undefined')
  {
    if (expected.length != actual.length)
      throw new Error("Expected: " + expected.length + " elements, actual: " + actual.length + " elements" + (path!="" ? " at " + path : ""));

    for (var i=0; i < expected.length; ++i)
      testDeepEq(expected[i], actual[i], path + "[" + i + "]");
  }
  else
  {
    //not the same object. same contents?
    var expectedkeys = Object.keys(expected);
    var actualkeys = Object.keys(actual);

    expectedkeys.forEach(key =>
    {
      if(!actualkeys.includes(key))
        throw new Error("Expected key: " + key + ", didn't actually exist" + (path!="" ? " at " + path : ""));
      testDeepEq(expected[key], actual[key], path + "." + key);
    });
    actualkeys.forEach(key =>
    {
      if(!expectedkeys.includes(key))
        throw new Error("Key unexpectedly exists: " + key + (path!="" ? " at " + path : ""));
    });
  }
}

function isequal(a, b)
{
  try
  {
    testDeepEq(a,b,'');
    return true;
  }
  catch(e)
  {
    return false;
  }
}

function logExplanation(explanation)
{
  if(typeof explanation=="function")
    explanation=explanation();

  console.error(explanation);
  log("* " + explanation + "\n");
}

export function testEq(expected, actual, explanation)
{
  if (arguments.length < 2)
    throw new Error("Missing argument to test.eq");

  if(isequal(expected,actual))
    return;

  let expected_str = expected;
  let actual_str = actual;

  try { expected_str = typeof expected == "string" ? unescape(escape(expected).split('%u').join('/u')) : JSON.stringify(expected); } catch(e){}
  try { actual_str = typeof actual == "string" ? unescape(escape(actual).split('%u').join('/u')) : JSON.stringify(actual); } catch(e){}

  if(explanation)
    logExplanation(explanation);

  console.log("testEq fails: expected", expected_str);
  log("testEq fails: expected " + (typeof expected_str == "string" ? "'" + expected_str + "'" : expected_str));

  console.log("testEq fails: actual  ", actual_str);
  log("testEq fails: actual " + (typeof actual_str == "string" ? "'" + actual_str + "'" : actual_str));

  if(typeof expected == "string" && typeof actual == "string")
  {
    log("E: " + encodeURIComponent(expected));
    log("A: " + encodeURIComponent(actual));
  }

  testDeepEq(expected, actual, '');
}

export function testTrue(actual, explanation)
{
  testEq(true, !!actual, explanation);
}

export function testFalse(actual, explanation)
{
  testEq(false, !!actual, explanation);
}


async function testThrowsAsync(promise, explanation)
{
  try
  {
    await promise;
  }
  catch (e)
  {
    return;
  }

  if(explanation)
    logExplanation(explanation);

  console.log("testThrows fails: expected async function to throw");
  log("testThrows fails: expected async function to throw");
}

export function testThrows(func, explanation)
{
  try
  {
    let res = func();
    if (res && res.then) // thenable?
      return testThrowsAsync(res, explanation);

    if(explanation)
      logExplanation(explanation);

    console.log("testThrows fails: expected function to throw");
    log("testThrows fails: expected function to throw");
  }
  catch (e)
  {
  }
}
