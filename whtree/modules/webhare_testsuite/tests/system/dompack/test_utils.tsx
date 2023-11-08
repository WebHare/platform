import * as test from "@mod-system/js/wh/testframework";

import * as dompack from "dompack";
import * as create from "dompack/src/create";
import * as webhare_dompack from "@webhare/dompack";

let eventcount = 0;

function anyEventHandler(evt: Event) {
  console.log(evt);
  ++eventcount;
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
    }
  ]);
