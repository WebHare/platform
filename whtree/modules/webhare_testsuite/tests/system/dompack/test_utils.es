import * as test from "@mod-system/js/wh/testframework";

import * as dompack from "dompack";
import * as create from "dompack/src/create.es";

var eventcount = 0;

function anyEventHandler(evt)
{
  console.log(evt);
  ++eventcount;
}

test.registerTests(
[ "Internal utility functions"
, async function()
  {
    test.eq("a", create.toDashed("A"));
    test.eq("aa-bb-cc", create.toDashed("AaBbCc"));
    test.eq("a-b-c-d", create.toDashed("ABCD"));

    test.eq("a", create.toCamel("a"));
    test.eq("aaBbCc", create.toCamel("aa-bb-cc"));
    test.eq("aBCD", create.toCamel("a-b-c-d"));
  }

, "jsxcreate"
, async function()
  {
    //please note this tests the lower layers of the JSX, it does not bother with the JSX syntax
    test.eq(0,eventcount);
    let node = dompack.jsxcreate('input', { type:'checkbox', checked:false });
    test.eq(false, node.checked);

    node = dompack.jsxcreate('input', { type:'text', onChange: anyEventHandler });
    dompack.changeValue(node,'newvalue');
    test.eq(1,eventcount,'expected change event');

    node = dompack.jsxcreate('div', { type:'checkbox', attr1:0, attr2:null, attr3:undefined,attr4:"" });
    test.eq("0", node.getAttribute("attr1"));
    test.eq(false, node.hasAttribute("attr2"));
    test.eq(false, node.hasAttribute("attr3"));
    test.eq(true, node.hasAttribute("attr4"));
    test.eq("", node.getAttribute("attr4"));
  }
]);
