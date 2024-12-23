/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-system/js/wh//testframework";

function getVoteCounts(counts) {
  return test.qSA('.wh-poll__option__votes').map(_ => parseInt(_.dataset.votes));
}

let pollurl = '';
let testdata;

test.runTests(
  [
    async function () {
      //remove all webtool vote blockers locally
      for (const key of Object.keys(localStorage))
        if (key.startsWith("wh-webtools-votetime:"))
          localStorage.removeItem(key);

      testdata = await test.invoke('mod::webhare_testsuite/tests/publisher/webtools/poll/poll.whlib#resetTestPoll');
      pollurl = testdata.pollurl;
    },

    async function () {
      await test.load(pollurl);
      console.log(test.qS('.wh-poll__showresultsbutton').getBoundingClientRect());
      console.log(test.qS('.wh-poll').getBoundingClientRect());
      test.click('.wh-poll__showresultsbutton');
      test.eq([0, 0], getVoteCounts());
    },

    async function () {
      //there's no way to navigate back, so... reload!
      await test.load(pollurl);
      const voteoptions = test.qSA('.wh-poll__option input');
      await test.wait(() => !voteoptions[0].disabled, "Wait until we're allowed to click");
      test.eq(2, voteoptions.length);
      test.click(voteoptions[1]);
      test.click(test.qS('.wh-poll__votebutton'));

      await test.wait('ui');

      test.eq([0, 1], getVoteCounts());
    },

    async function () {
      await test.load(testdata.pollholder);
      await test.wait('ui');

      test.eq([0, 1, 0, 0], getVoteCounts());
      //we still can't vote on poll 1
    }

  ]);
