import test from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';

/* More advanced visible conditions */

test.registerTests(
  [ async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?visibleconditions=1');

      // second is only available if first is set
      test.false(test.canClick('input[name="second"][value="a_a"]'), "second.a_a not clickable");
      test.false(test.canClick('input[name="second"][value="a_b"]'), "second.a_b not clickable");
      test.false(test.canClick('input[name="second"][value="b_a"]'), "second.b_a not clickable");
      test.false(test.canClick('input[name="second"][value="b_b"]'), "second.b_b not clickable");
      // third is only available if second is set
      test.false(test.canClick('input[name="third"][value="a"]'), "third.a not clickable");
      test.false(test.canClick('input[name="third"][value="b"]'), "third.b not clickable");

      // Choosing 'b' for first should enable second's 'b_a' and 'b_b'
      test.click('input[name="first"][value="b"]');
      test.false(test.canClick('input[name="second"][value="a_a"]'), "second.a_a still not clickable");
      test.false(test.canClick('input[name="second"][value="a_b"]'), "second.a_b still not clickable");
      test.true(test.canClick('input[name="second"][value="b_a"]'), "second.b_a now clickable");
      test.true(test.canClick('input[name="second"][value="b_b"]'), "second.b_b now clickable");
      test.false(test.canClick('input[name="third"][value="a"]'), "third.a still not clickable");
      test.false(test.canClick('input[name="third"][value="b"]'), "third.b still not clickable");

      // Choosing 'b_a' for second should enable third's 'a'
      test.click('input[name="second"][value="b_a"]');
      test.false(test.canClick('input[name="second"][value="a_a"]'), "second.a_a still not clickable");
      test.false(test.canClick('input[name="second"][value="a_b"]'), "second.a_b still not clickable");
      test.true(test.canClick('input[name="second"][value="b_a"]'), "second.b_a still clickable");
      test.true(test.canClick('input[name="second"][value="b_b"]'), "second.b_b still clickable");
      test.true(test.canClick('input[name="third"][value="a"]'), "third.a now clickable");
      test.false(test.canClick('input[name="third"][value="b"]'), "third.b still not clickable");

      // Switching first to 'a' should enabled second's 'a_a' and 'a_b', but third should no longer be available as none of
      // the available second options are chosen, i.e. second is no longer set
      test.click('input[name="first"][value="a"]');
      test.true(test.canClick('input[name="second"][value="a_a"]'), "second.a_a is now clickable");
      test.true(test.canClick('input[name="second"][value="a_b"]'), "second.a_b is now clickable");
      test.false(test.canClick('input[name="second"][value="b_a"]'), "second.b_a no longer clickable");
      test.false(test.canClick('input[name="second"][value="b_b"]'), "second.b_b no longer clickable");
      test.false(test.canClick('input[name="third"][value="a"]'), "third.a no longer clickable");
      test.false(test.canClick('input[name="third"][value="b"]'), "third.b still not clickable");
    }
  ]);
