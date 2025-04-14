import * as test from "@webhare/test-backend";
import { collapsePathString, searchLastSubArray } from "@webhare/zip/src/utils";

async function testUtils() {
  test.eq(0, searchLastSubArray([1, 2, 3], [1]));
  test.eq(0, searchLastSubArray([1, 2, 3], [1, 2, 3]));
  test.eq(-1, searchLastSubArray([1, 2, 3], [1, 4, 3]));
  test.eq(1, searchLastSubArray([1, 1, 1, 2, 1], [1, 1, 2]));
  test.eq(1, searchLastSubArray([1, 1, 1, 2, 1, 1, 3], [1, 1, 2]));
}

function testCollapsePathString() {

  test.eq("simpl/path", collapsePathString("simpl/path"));
  test.eq("", collapsePathString("."));
  test.eq("", collapsePathString(".."));

  test.eq("/", collapsePathString("/.."));
  test.eq("/", collapsePathString("/../"));
  test.eq("/", collapsePathString("/../", true));
  test.eq("", collapsePathString("../"));
  test.eq("/", collapsePathString("../", true));
  test.eq("a/b", collapsePathString("a//b"));
  test.eq("a/b", collapsePathString("a/./b"));
  test.eq("a/b", collapsePathString("./a/b/"));
  test.eq("a/b/", collapsePathString("./a/b/", true));
  test.eq("/a/b", collapsePathString("/a/b/."));
  test.eq("/a/b", collapsePathString("/a/b/.", true));
  test.eq("a/b", collapsePathString("a/b/."));
  test.eq("/a/c/d", collapsePathString("/a/b/../c//d/"));
  test.eq("f", collapsePathString("b/../c/d/../../e/../../f"));
  test.eq("/f", collapsePathString("/b/../c///d/../../e/../../f/"));
  test.eq("f", collapsePathString("../b/../c/d/..///../e/../../f/"));
  test.eq("/", collapsePathString("/"));
  test.eq("/", collapsePathString("//"));
  test.eq("/", collapsePathString("/."));
  test.eq("", collapsePathString("./"));
  test.eq("/", collapsePathString("/./"));
  test.eq("/a/b", collapsePathString("/a/b/./"));
  test.eq("/a/b/c", collapsePathString("//a/b/c/"));
  test.eq("A:/b/c/d", collapsePathString("A:/b/c/d/"));
  test.eq("A:b/c/d", collapsePathString("A:b/c/d/"));
  test.eq("A:/b/c/d", collapsePathString("A:///b/c/d/"));
  test.eq("b/c/d", collapsePathString("A:/../b/c/d/"));
  test.eq("b/c/d", collapsePathString("A:/../b/c/d/"));
  test.eq("/bunny/b/c", collapsePathString("//bunny/b-lex/../b/c/"));
  test.eq("/bunny/b/c", collapsePathString("//bunny///b-lex/../b/c/"));
  test.eq("/bunny/b/c", collapsePathString("////bunny///b-lex/../b/c/"));
}

test.runTests([testUtils, testCollapsePathString]);
