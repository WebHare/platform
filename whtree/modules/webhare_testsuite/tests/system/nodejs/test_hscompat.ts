/* HS Compatibility APIs mimick original HareScript APIs as much as possible. New code should probably not use it (or if they
   find it useful, consider contributing that API to the stdlib.

   Other @webhare/ libs should avoid depending on HSCompat
*/

import * as test from "@webhare/test";
import * as strings from "@webhare/hscompat/strings";

function testStrings() {
  //based on test_operators.whscr LikeTest
  test.eq(true, strings.isLike("testje", "test*"));
  test.eq(true, strings.isLike("testje", "test??"));
  test.eq(false, strings.isLike("testje", "tess*"));
  test.eq(true, strings.isLike("testje", "*je"));
  test.eq(true, strings.isLike("testje", "****"));
  test.eq(true, strings.isLike("testje", "t?stj?"));
  test.eq(true, strings.isLike("a", "?*"));
  test.eq(false, strings.isLike("", "?*"));

  test.eq(false, strings.isNotLike("testje", "test*"));
  test.eq(false, strings.isNotLike("testje", "test??"));
  test.eq(true, strings.isNotLike("testje", "tess*"));
  test.eq(false, strings.isNotLike("testje", "*je"));
  test.eq(false, strings.isNotLike("testje", "****"));
  test.eq(false, strings.isNotLike("testje", "t?stj?"));
  test.eq(false, strings.isNotLike("a", "?*"));
  test.eq(true, strings.isNotLike("", "?*"));
}

test.run([testStrings]);
