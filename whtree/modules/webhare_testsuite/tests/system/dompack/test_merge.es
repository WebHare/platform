import * as test from "@mod-system/js/wh/testframework";
import * as dompack from "dompack";

import * as merge from "dompack/extra/merge.es";

test.registerTests(
[ "Pulldown test"
, async function()
  {
    await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=merge');
    merge.registerFormatter("makeupper", value => value.toUpperCase());
    merge.registerFormatter("selectsubtext", value => value.subtext);
    merge.registerUpdater("upd", (node, value) => { if (value.updtext) node.textContent = value.updtext; });

    test.eq("Come on not-set, just one more page!", test.qS("#mergetest1").textContent);
    test.eq("Test my formula not-set", test.qS("#mergetest2").textContent);
    await merge.run(test.qS("#mergetest1"), { a: { b: "Homer" } });
    test.eq("Homer", test.qS("#mergetest1 span").textContent);
    test.eq("Come on Homer, just one more page!", test.qS("#mergetest1").textContent);

    await merge.run(test.qS("#mergetest2"), { a: { b: "Homer" } });
    test.eq("Test my formula HOMER", test.qS("#mergetest2").textContent);

    await merge.run(test.qS("#mergetest1"), { a: { b: "Marge" } });
    test.eq("Marge", test.qS("#mergetest1 span").textContent);
    test.eq("Come on Marge, just one more page!", test.qS("#mergetest1").textContent);

    // applying to all nodes, without filter
    await merge.run(test.getDoc(), { a: { b: "Maggie", l: "http://example.com/" } });
    test.eq("Maggie", test.qS("#mergetest1 span").textContent);
    test.eq("MAGGIE", test.qS("#mergetest2 span").textContent);
    test.eq("http://example.com/", test.qS("#mergetest3 a").href);
    test.eq("MAGGIE", test.qS("#mergetest3 a").textContent);

    // test filter (a.l not needed because '#mergetest3 a' will not be visited)
    await merge.run(test.getDoc(), { a: { b: "Bart" } }, { filter: node => dompack.closest(node, "#mergetest2") });
    test.eq("Maggie", test.qS("#mergetest1 span").textContent);
    test.eq("BART", test.qS("#mergetest2 span").textContent);
    test.eq("http://example.com/", test.qS("#mergetest3 a").href);

    //these tests don't seem to have ever done anything? merge.run is not async.
    //await test.throws(merge.run(test.qS("#mergetest1"), { a: { c: "Marge" } }));
    //await test.throws(merge.run(test.qS("#mergetest1"), { b: { b: "Marge" } }));

    await merge.run(test.getDoc(), { updtext: "updaterfunc" });
    test.eq("updaterfunc", test.qS("#mergetest4 span").textContent);

    await merge.run(test.getDoc(), { subdata: { updtext: "updaterfunc2" } });
    test.eq("updaterfunc2", test.qS("#mergetest5 span").textContent);

    await merge.run(test.qS("#mergetest6"), { subtext: "merge-selectsubtext" });
    test.eq("merge-selectsubtext", test.qS("#mergetest6 span").textContent);
  }
]);
