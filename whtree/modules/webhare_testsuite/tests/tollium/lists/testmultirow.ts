import * as test from '@mod-tollium/js/testframework';


test.runTests(
  [
    {
      loadpage: test.getTestScreen('tests/lists.multirow'),
      waits: ['ui']
    },
    {
      name: 'setsort',
      test: function () {
        const baselist = test.compByName("layout");
        const senderheader = test.qSA(baselist, '.listheader span').filter(span => span.textContent?.includes("Sender"))[0];
        test.click(senderheader);
        test.assert(senderheader.classList.contains("sortascending"), 'looks like sender column didnt get selected for sort');
      }
    },
    {
      name: 'footer',
      test: function () {
        const normalrow = test.getCurrentScreen().getListRow('normal', /^SU45 .*/);
        const footerrow = test.getCurrentScreen().getListRow('normal', 'footer-subject');
        for (let i = 0; i < 4; ++i)
          test.eq(normalrow.childNodes[i].getBoundingClientRect().width,
            footerrow.childNodes[i].getBoundingClientRect().width, 'width of plain and footer cells should match in col #' + i);
      }
    }
  ]);
