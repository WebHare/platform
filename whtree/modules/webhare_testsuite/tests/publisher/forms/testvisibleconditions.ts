import * as test from '@webhare/test-frontend';

/* More advanced visible conditions */

test.runTests(
  [
    "Test with radio",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?visibleconditions=1');

      const form = test.qR("form");
      test.assert(form.classList.contains("wh-form"));
      test.assert(form.classList.contains("wh-styledinput"));
      test.assert(form.classList.contains("mycustomformclass"));

      // second is only available if first is set
      test.assert(!test.canClick('input[name="second"][value="a_a"]'), "second.a_a not clickable");
      test.assert(!test.canClick('input[name="second"][value="a_b"]'), "second.a_b not clickable");
      test.assert(!test.canClick('input[name="second"][value="b_a"]'), "second.b_a not clickable");
      test.assert(!test.canClick('input[name="second"][value="b_b"]'), "second.b_b not clickable");
      // third is only available if second is set
      test.assert(!test.canClick('input[name="third"][value="a"]'), "third.a not clickable");
      test.assert(!test.canClick('input[name="third"][value="b"]'), "third.b not clickable");

      // Choosing 'b' for first should enable second's 'b_a' and 'b_b'
      test.click('input[name="first"][value="b"]');
      test.assert(!test.canClick('input[name="second"][value="a_a"]'), "second.a_a still not clickable");
      test.assert(!test.canClick('input[name="second"][value="a_b"]'), "second.a_b still not clickable");
      test.assert(test.canClick('input[name="second"][value="b_a"]'), "second.b_a now clickable");
      test.assert(test.canClick('input[name="second"][value="b_b"]'), "second.b_b now clickable");
      test.assert(!test.canClick('input[name="third"][value="a"]'), "third.a still not clickable");
      test.assert(!test.canClick('input[name="third"][value="b"]'), "third.b still not clickable");

      // Choosing 'b_a' for second should enable third's 'a'
      test.click('input[name="second"][value="b_a"]');
      test.assert(!test.canClick('input[name="second"][value="a_a"]'), "second.a_a still not clickable");
      test.assert(!test.canClick('input[name="second"][value="a_b"]'), "second.a_b still not clickable");
      test.assert(test.canClick('input[name="second"][value="b_a"]'), "second.b_a still clickable");
      test.assert(test.canClick('input[name="second"][value="b_b"]'), "second.b_b still clickable");
      test.assert(test.canClick('input[name="third"][value="a"]'), "third.a now clickable");
      test.assert(!test.canClick('input[name="third"][value="b"]'), "third.b still not clickable");

      // Switching first to 'a' should enabled second's 'a_a' and 'a_b', but third should no longer be available as none of
      // the available second options are chosen, i.e. second is no longer set
      test.click('input[name="first"][value="a"]');
      test.assert(test.canClick('input[name="second"][value="a_a"]'), "second.a_a is now clickable");
      test.assert(test.canClick('input[name="second"][value="a_b"]'), "second.a_b is now clickable");
      test.assert(!test.canClick('input[name="second"][value="b_a"]'), "second.b_a no longer clickable");
      test.assert(!test.canClick('input[name="second"][value="b_b"]'), "second.b_b no longer clickable");
      test.assert(!test.canClick('input[name="third"][value="a"]'), "third.a no longer clickable");
      test.assert(!test.canClick('input[name="third"][value="b"]'), "third.b still not clickable");
    },

    "Test with pulldown",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?visibleconditions=1&type=pulldown');

      const form = test.qR("form");
      test.assert(form.classList.contains("wh-form"));
      test.assert(form.classList.contains("wh-styledinput"));
      test.assert(form.classList.contains("mycustomformclass"));

      // second is only available if first is set
      test.assert(test.qR('select[name="second"] option[value="a_a"]').hidden, "second.a_a hidden");
      test.assert(test.qR('select[name="second"] option[value="a_b"]').hidden, "second.a_b hidden");
      test.assert(test.qR('select[name="second"] option[value="b_a"]').hidden, "second.b_a hidden");
      test.assert(test.qR('select[name="second"] option[value="b_b"]').hidden, "second.b_b hidden");
      // third is only available if second is set
      test.assert(!test.canClick('select[name="third"] option[value="a"]'), "third.a not clickable");
      test.assert(!test.canClick('select[name="third"] option[value="b"]'), "third.b not clickable");

      // Choosing 'b' for first should enable second's 'b_a' and 'b_b'
      test.fill('select[name="first"]', 'b');
      test.assert(test.qR('select[name="second"] option[value="a_a"]').hidden, "second.a_a still not clickable");
      test.assert(test.qR('select[name="second"] option[value="a_b"]').hidden, "second.a_b still not clickable");
      test.assert(!test.qR('select[name="second"] option[value="b_a"]').hidden, "second.b_a now clickable");
      test.assert(!test.qR('select[name="second"] option[value="b_b"]').hidden, "second.b_b now clickable");
      test.assert(test.qR('select[name="third"] option[value="a"]').hidden, "third.a still not clickable");
      test.assert(test.qR('select[name="third"] option[value="b"]').hidden, "third.b still not clickable");

      // Choosing 'b_a' for second should enable third's 'a'
      test.fill('select[name="second"]', 'b_a');
      test.assert(test.qR('select[name="second"] option[value="a_a"]').hidden, "second.a_a still not clickable");
      test.assert(test.qR('select[name="second"] option[value="a_b"]').hidden, "second.a_b still not clickable");
      test.assert(!test.qR('select[name="second"] option[value="b_a"]').hidden, "second.b_a still clickable");
      test.assert(!test.qR('select[name="second"] option[value="b_b"]').hidden, "second.b_b still clickable");
      test.assert(!test.qR('select[name="third"] option[value="a"]').hidden, "third.a now clickable");
      test.assert(test.qR('select[name="third"] option[value="b"]').hidden, "third.b still not clickable");

      // Switching first to 'a' should enabled second's 'a_a' and 'a_b', but third should no longer be available as none of
      // the available second options are chosen, i.e. second is no longer set
      test.fill('select[name="first"]', 'a');
      test.assert(!test.qR('select[name="second"] option[value="a_a"]').hidden, "second.a_a is now clickable");
      test.assert(!test.qR('select[name="second"] option[value="a_b"]').hidden, "second.a_b is now clickable");
      test.assert(test.qR('select[name="second"] option[value="b_a"]').hidden, "second.b_a no longer clickable");
      test.assert(test.qR('select[name="second"] option[value="b_b"]').hidden, "second.b_b no longer clickable");
      test.assert(test.qR('select[name="third"] option[value="a"]').hidden, "third.a no longer clickable");
      test.assert(test.qR('select[name="third"] option[value="b"]').hidden, "third.b still not clickable");
    }
  ]);
