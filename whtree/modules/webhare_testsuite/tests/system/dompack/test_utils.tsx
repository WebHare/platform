import * as test from "@mod-system/js/wh/testframework";

import * as dompack from "dompack";
import * as create from "dompack/src/create";
import * as webhare_dompack from "@webhare/dompack";

let eventcount = 0;

function anyEventHandler(evt: Event) {
  console.log(evt);
  ++eventcount;
}

type MyCustomEvent = CustomEvent<{
  test: 42;
}>;

declare global {
  //Test extending events
  interface GlobalEventHandlersEventMap {
    "webhare_testsuite:mycustomevent": MyCustomEvent;
  }
}

test.registerTests(
  [
    "Verify dompack identity",
    async function () {
      //make sure 'both' dompack paths point to the same APIs
      test.assert(dompack.register === webhare_dompack.register);
    },

    "Internal utility functions",
    async function () {
      test.eq("a", create.toDashed("A"));
      test.eq("aa-bb-cc", create.toDashed("AaBbCc"));
      test.eq("a-b-c-d", create.toDashed("ABCD"));

      test.eq("a", create.toCamel("a"));
      test.eq("aaBbCc", create.toCamel("aa-bb-cc"));
      test.eq("aBCD", create.toCamel("a-b-c-d"));
    },

    "jsxcreate",
    async function () {
      //please note this tests the lower layers of the JSX, it does not bother with the JSX syntax
      test.eq(0, eventcount);
      {
        const node = dompack.jsxcreate('input', { type: 'checkbox', checked: false });
        test.eq(false, node.checked);
      }

      {
        const node = dompack.jsxcreate('input', { type: 'text', onChange: anyEventHandler });
        dompack.changeValue(node, 'newvalue');
        test.eq(1, eventcount, 'expected change event');
      }

      {
        const node = dompack.jsxcreate('div', { type: 'checkbox', attr1: 0, attr2: null, attr3: undefined, attr4: "" });
        test.eq("0", node.getAttribute("attr1"));
        test.eq(false, node.hasAttribute("attr2"));
        test.eq(false, node.hasAttribute("attr3"));
        test.eq(true, node.hasAttribute("attr4"));
        test.eq("", node.getAttribute("attr4"));
      }
    },

    "jsx-syntax",
    async function () {
      const node1 = <div id="div1" />;
      node1.append(<><div id="div2" /><div id="div3" /></>);
      test.eq('<div id="div2"></div><div id="div3"></div>', node1.innerHTML);
    },

    "Array/String.prototype.at polyfill",
    async function () {
      test.eq(undefined, [1, 2, 3].at(3));
      test.eq(1, [1, 2, 3].at(0));
      test.eq(3, [1, 2, 3].at(2));
      test.eq(3, [1, 2, 3].at(-1));
      test.eq(1, [1, 2, 3].at(-3));
      test.eq(undefined, [1, 2, 3].at(-4));

      test.eq(undefined, "123".at(3));
      test.eq("1", "123".at(0));
      test.eq("3", "123".at(2));
      test.eq("3", "123".at(-1));
      test.eq("1", "123".at(-3));
      test.eq(undefined, "123".at(-4));
    },

    "Events",
    async function () {
      //Verify event validation (and not getting in the way of unknown events)
      webhare_dompack.dispatchCustomEvent(window, "webhare_testsuite:mycustomevent", { bubbles: true, cancelable: true, detail: { test: 42 } });
      ///@ts-expect-error details have been defined so should be required
      webhare_dompack.dispatchCustomEvent(window, "webhare_testsuite:mycustomevent", { bubbles: true, cancelable: true });
      ///@ts-expect-error nosuch is not a valid detail, should be test:42
      webhare_dompack.dispatchCustomEvent(window, "webhare_testsuite:mycustomevent", { bubbles: true, cancelable: true, detail: { nosuch: 43 } });

      //an unregistered event should not be bothered at all
      webhare_dompack.dispatchCustomEvent(window, "webhare_testsuite:unknownevent", { bubbles: true, cancelable: true });
      webhare_dompack.dispatchCustomEvent(window, "webhare_testsuite:unknownevent", { bubbles: true, cancelable: true, detail: { nosuch: 43 } });

      function clickHandler(evt: webhare_dompack.DocEvent<MouseEvent>) {
        evt.target.click();
      }
      function takeFocusHandler(evt: webhare_dompack.DocEvent<MyCustomEvent>) {
        evt.target.click();
      }
      function unknownHandler(evt: webhare_dompack.DocEvent<Event, HTMLBodyElement>) {
        evt.target.click();
      }

      webhare_dompack.addDocEventListener(document.body, "click", clickHandler);
      webhare_dompack.addDocEventListener(document.body, "webhare_testsuite:mycustomevent", takeFocusHandler);
      //@ts-expect-errora a div is not a body element, and unknownHandler expects a HTMLBodyElement
      webhare_dompack.addDocEventListener(document.createElement("div"), "webhare_testsuite:unknownevent", unknownHandler);
      webhare_dompack.addDocEventListener(document.createElement("body"), "webhare_testsuite:unknownevent", unknownHandler);

      webhare_dompack.addDocEventListener(document.body, "click", evt => { evt.target.click(); });
      webhare_dompack.addDocEventListener(document.body, "webhare_testsuite:mycustomevent", evt => { evt.target.click(); });
      webhare_dompack.addDocEventListener(document.body, "webhare_testsuite:unknownevent", evt => { evt.target.click(); });

      using mylisteners = new webhare_dompack.EventListenerSet;
      webhare_dompack.addDocEventListener(document.body, "click", evt => { evt.target.click(); }, { listenerSet: mylisteners, capture: true });
    }
  ]);
