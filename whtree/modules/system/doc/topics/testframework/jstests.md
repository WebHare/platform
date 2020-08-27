# JS Tests

## Canonical approaches

Template for tests:

```javascript
import test from "@mod-system/js/wh/testframework";

test.registerTests(
  [ "My test name"
  , async function()
    {
      await test.load(test.getTestSiteRoot());
      //test.eq stuff...
    }
  ]);
```

Common test actions:
```javascript
  // Lookup an element
  let searchbutton = test.qS('button.p-helpersearch__search--vehicle');
  let allbuttons = test.qSA('buttons');

  // Click an element, by selector or element
  test.click('.js-select-car[data-car-type="motorcycle"]');
  test.click(inputradionode);

  // Fill a field, by selector or element
  test.fill('#inputfield', 'value');
  test.fill(inputradionode, true);

  // Test a value (with optional annotation)
  test.true(searchbutton, 'Expecting the search button to exist');
  test.eq('ExpectedButtonText', searchbutton.textContent);

  // Keyboard: Press 's' key ('ArrowUp' for up, 'Tab' for tab ...)
  await test.pressKey('s');

  // Special tests
  test.true(test.canClick(node)); //can we click on the node? (it's visible, not covered)

  // Navigate to a page relative to the current siteroot, and wait for it to load
  await test.load(test.getTestSiteRoot() + 'mysubfolder/mysubfile');

  // Wait for a page to load (eg after form submission or location.href update)
  await test.wait('pageload');

  // Wait for a UI-blocking action to finish (busy.es locks)
  await test.wait('ui');

  // Wait for emails sent to an email address
  const emails = await test.waitForEmails('test@example.org', { timeout: 60000 });
```

## Tollium tests
Common actions for Tollium in-browser testing (as opposed to [headless testing](tollium-headless.md)).

You can import the Tollium testframework library instead of `@mod-system/js/wh/testframework` as everything from the latter
will also be exported by Tollium's version:

Common test actions:
```javascript
import * as test from "@mod-tollium/js/testframework";

  //Lookup an element in a component's dom
  let thetextarea = test.compByName("html").querySelector("textarea");

  //Click a button by label
  test.clickTolliumButton("OK");
```

## Server side code
Tests can directly invoke prepared HareScript functions on the server. You can use this to eg update configuration
or verify that data was properly stored.

Use `test.invoke` to run a function, specifying library and function name. The HareScript function must be PUBLIC and
its name must be prefixed with `TestInvoke_`. You don't need to specify this prefix when calling this function. For example:

```javascript
  let result = await test.invoke('mod::mymodule/lib/internal/tests.whlib','UpdatePrice', "product:Fuchsia", "5.00");
```

and in your `tests.whlib`:
```harescript
PUBLIC RECORD FUNCTION TestInvoke_UpdatePrice(STRING product, STRING newprice)
{
  ...
}
```

As an extra security measure, the RPCs used by `test.invoke` are automatically blocked if the current server's DTAP stage
is not set to `development`.

## Old/deprecated approacehes
Don't do this anymore, but replace with....

```javascript
 { loadpage: "xxx" }      => await test.load("xxx");
 { waits: ["x", "y"] }    => await test.wait("x", "y");
 await test.waitUIFree()  => await test.wait("ui");
 $qS                      => test.qS
 $qSA                     => test.qSA
 { email: "x@x", emailhandler: emails => {} } => const emails = await test.waitForEmails("x@x");
```
