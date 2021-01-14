import * as test from "@mod-system/js/wh//testframework";
//
function testVoteCounts(counts)
{
  let votecounts = test.qSA('.wh-poll__option__votes');
  test.eq(counts.length, votecounts.length);
  counts.forEach( (count,idx) => test.eq(count, parseInt(votecounts[idx].dataset.votes)));
}

let pollurl = '';

test.registerTests(
  [ async function()
    {
      //remove all webtool vote blockers locally
      for(let key of Object.keys(localStorage))
        if(key.startsWith("wh-webtools-votetime:"))
          localStorage.removeItem(key);

      let result = await test.invoke('mod::webhare_testsuite/tests/publisher/webtools/poll/poll.whlib', 'resetTestPoll');
      pollurl = result.pollurl;
    }

  , { loadpage: function() { return pollurl; }
    }

  , async function()
    {
      console.log(test.qS('.wh-poll__showresultsbutton').getBoundingClientRect());
      console.log(test.qS('.wh-poll').getBoundingClientRect());
      test.click('.wh-poll__showresultsbutton');
      testVoteCounts([0,0]);
    }

    //there's no way to navigate back, so... reload!
  , { loadpage: function() { return pollurl; }
    }

  , async function()
    {
      let voteoptions = test.qSA('.wh-poll__option input');
      test.eq(2,voteoptions.length);
      test.click(voteoptions[1]);
      test.click(test.qS('.wh-poll__votebutton'));

      await test.wait('ui');

      testVoteCounts([0,1]);
    }

  ]);
