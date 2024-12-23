import * as test from "@webhare/test";
import { resolveGid, resolveTid } from "@webhare/gettid/src/clients";

function testClientParesers() {
  test.eq("webhare_testsuite:", resolveGid("webhare_testsuite:", ""));
  test.eq("webhare_testsuite:xyz", resolveGid("webhare_testsuite:", "xyz"));
  test.eq("webhare_testsuite:xyz.abc", resolveGid("webhare_testsuite:xyz", ".abc"));
  test.eq("webhare_testsuite:abc", resolveGid("webhare_testsuite:xyz", "abc"));
  test.eq("webhare_testsuite:xyz.abc.def.ghi", resolveGid("webhare_testsuite:xyz", ".abc.def.ghi"));
  test.eq("other:xyz", resolveGid("webhare_testsuite:xyz", "other:xyz"));

  // for WH compatiblity, setting a tid always wins over title:
  test.eq("webhare_testsuite:xyz.abc", resolveTid("webhare_testsuite:xyz", { name: "def", title: null, tid: ".abc" }));
  test.eq("webhare_testsuite:xyz.abc", resolveTid("webhare_testsuite:xyz", { name: "def", title: "", tid: ".abc" }));
  test.eq("webhare_testsuite:xyz.abc", resolveTid("webhare_testsuite:xyz", { name: "def", title: "Hi everybody!", tid: ".abc" }));

  // tid resolving
  test.eq("webhare_testsuite:xyz.def", resolveTid("webhare_testsuite:xyz", { name: "def", title: "Hi everybody!", tid: "xyz.def" }));
  test.eq("mymod:xyz.def", resolveTid("webhare_testsuite:xyz", { name: "def", title: "Hi everybody!", tid: "mymod:xyz.def" }));

  // title wins over implicit names
  test.eq(":hi everybody", resolveTid("webhare_testsuite:xyz", { title: "hi everybody", name: "def" }));
  test.eq(":hi everybody", resolveTid("webhare_testsuite:xyz", { title: "hi everybody", name: "def", tid: null }));
  test.eq(":hi everybody", resolveTid("webhare_testsuite:xyz", { title: "hi everybody", name: "def", tid: "" }));
  test.eq(":hi everybody", resolveTid("webhare_testsuite:", { title: "hi everybody", name: "def", tid: "" }));
  test.eq("", resolveTid("webhare_testsuite:xyz", { title: "", name: "def", tid: "" }));

  // no explicit title, work using name
  test.eq("webhare_testsuite:xyz.def", resolveTid("webhare_testsuite:xyz", { name: "def", tid: "" }));
  test.eq("webhare_testsuite:xyz.def", resolveTid("webhare_testsuite:xyz", { title: null, name: "def", tid: "" }));

  // nothing to work with
  test.eq("", resolveTid("webhare_testsuite:xyz", { title: null, name: "", tid: "" }));
  test.eq("", resolveTid("webhare_testsuite:xyz", { title: null, name: null, tid: "" }));
  test.eq("", resolveTid("webhare_testsuite:xyz", {}));

  //if no gid was selected yet, no resolving of names
  test.eq("", resolveTid("webhare_testsuite:", { title: null, name: "def", tid: "" }));
}

test.runTests([testClientParesers]);
