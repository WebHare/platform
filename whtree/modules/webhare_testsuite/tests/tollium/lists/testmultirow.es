import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/lists.multirow')
    , waits: [ 'ui' ]
    }
  , { name: 'setsort'
    , test: function(doc,win)
      {
        var baselist = test.compByName("layout");
        let senderheader = test.qSA(baselist, '.listheader span').filter(span=>span.textContent.includes("Sender"))[0]
        test.click(senderheader);
        test.true(senderheader.classList.contains("sortascending"), 'looks like sender column didnt get selected for sort');
      }
    }
  , { name: 'footer'
    , test: function()
      {
        let normalrow = test.getCurrentScreen().getListRow('normal', /^SU45 .*/);
        let footerrow = test.getCurrentScreen().getListRow('normal', 'footer-subject');
        for(let i=0; i<4; ++i)
          test.eq(normalrow.childNodes[i].getBoundingClientRect().width
                 ,footerrow.childNodes[i].getBoundingClientRect().width, 'width of plain and footer cells should match in col #'+i);
      }
    }
  ]);
