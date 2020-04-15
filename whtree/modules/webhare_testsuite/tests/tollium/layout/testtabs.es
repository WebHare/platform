import * as test from '@mod-tollium/js/testframework';


function getTabs(startnode)
{
  return Array.from(startnode.querySelectorAll("div[data-tab]")).filter(node => node.closest('t-tabs') == startnode);
}
function getActiveTab(startnode)
{
  return getTabs(startnode).filter(node => node.classList.contains('active'))[0];
}
function getTabSheetLabel(tab)
{
  return Array.from(tab.childNodes).filter(node => node.matches('.label'))[0];
}

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/layout.layouttest,tabs')
    , waits: [ 'ui' ]
    }

  , { name: 'launchappholder'
    , test:function(doc,win)
      {
        test.false(test.canClick(test.compByName('tabs')));
        var A01 = test.getMenu(['M01','A01']);
        test.click(A01);
      }
    , waits: [ 'ui' ]
    }

  , { name: 'clicktab'
    , test:function(doc,win)
      {
        test.true(test.isElementClickable(test.compByName('tabs')));

        //verify the tabs properly all got the same szie (the 400x350 max)
        var tab1 = test.compByName('tab1');
        var tab2 = test.compByName('tab2');
        var tab3 = test.compByName('tab3');
        test.eq(tab1.offsetWidth, tab2.offsetWidth);
        test.eq(tab1.offsetHeight, tab2.offsetHeight);
        test.eq(tab1.offsetWidth, tab3.offsetWidth);
        test.eq(tab1.offsetHeight, tab3.offsetHeight);
        test.eq(400, tab1.offsetWidth);
        test.eq(350, tab1.offsetHeight);


        //verify tab2 is the selected tab
        var activetab = getActiveTab(test.compByName('tabs'));
        var tab2label = getTabSheetLabel(activetab);
        test.true(tab2label.offsetWidth>=25); //regression: it didn't size
        test.eq('Tab 2', tab2label.textContent);
        test.eq('tab2', test.compByName('selectedtab').textContent);

        var tabs = getTabs(test.compByName('tabs'));
        test.eq(4, tabs.length);
        test.eq('Tab 1', getTabSheetLabel(tabs[0]).textContent);

        test.click(tabs[0]);

        //verify tab1 is now the selected tab
        activetab = getActiveTab(test.compByName('tabs'));
        test.eq('Tab 1', getTabSheetLabel(activetab).textContent);
      }
    , waits: [ 'ui' ] //we need to wait for the animation at least
    }

  , { name: 'visibleon'
    , test:function(doc,win)
      {
        test.eq('tab1', test.compByName('selectedtab').textContent);

        test.eq('P01', test.compByName('tab1').querySelector("select").value);
        test.true(test.isElementClickable(test.compByName('productsku')));
        test.false(test.isElementClickable(test.compByName('type_imagetext_title')));

        var elt = test.compByName('tab1').querySelector("select");
        elt.propTodd.setValue('P02');
      }
    , waits: [ 'ui' ] //we need to wait for the animation at least
    }

  , { name: 'visibleon2'
    , test:function(doc,win)
      {
        test.false(test.isElementClickable(test.compByName('productsku')));
        test.true(test.isElementClickable(test.compByName('type_imagetext_title')));
      }
    }

  , { name: 'stackedtabs'
    , test: async function(doc,win)
      {
        test.fill(test.compByName('type_imagetext_title').querySelector('input'), 'Test Title');

        var tabs = getTabs(test.compByName('tabs'));
        test.click(tabs[3]); //goto tab 3
      }
    , waits: [ 'ui' ] //we need to wait for the animation at least
    }
  , { test:function(doc,win)
      {
        test.eq('Stacked tab 1', getActiveTab(test.compByName('stackedtabs')).querySelector('.label').textContent);

        var tabs = getTabs(test.compByName('stackedtabs'));
        test.true(tabs[0].classList.contains('active'));
        test.false(tabs[1].classList.contains('active'));
        test.click(tabs[1]); //stackedtabs1

        tabs = getTabs(test.compByName('stackedtabs'));
        test.false(tabs[0].classList.contains('active'));
        test.true(tabs[1].classList.contains('active'));

        test.fill(test.compByName('texteditstack2').querySelector('input'), 'Test Twee');
      }
    }

  , { test:function(doc,win)
      {
        var tabs = getTabs(test.compByName('tabs'));
        test.click(tabs[1]); //goto tab 2
      }
    , waits: [ 'ui' ]
    }

  , { name: 'stackedtabs3'
    , test:function(doc,win)
      {
        test.click(test.compByName('syncbutton'));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'stackedtabs4'
    , test:function(doc,win)
      {
        test.eq('Test Title', test.compByName('tab1_imagetext_title').textContent);
        test.eq('Test Twee', test.compByName('tab3_texteditstack2').textContent);
      }
    }

  //test state saving
  , { name: 'isstatesaved'
    , test:function(doc,win)
      {
        test.getCurrentScreen().clickCloser();
      }
    , waits: [ 'ui' ]
    }
  , { name: 'isstatesaved-reopen'
    , test:function(doc,win)
      {
        var A02 = test.getMenu(['M01','A02']);
        test.click(A02);
      }
    , waits: [ 'ui' ]
    }
  , { name: 'isstatesaved-settab3'
    , test:function(doc,win)
      {
        //note,we should be able to access the app, as appholder should've saved state
        var tabs = getTabs(test.compByName('tabs'));
        test.click(tabs[2]); //goto tab 3
      }
    , waits: [ 'ui' ]
    }
  , { name: 'isstatesaved-checkstacked2'
    , test:function(doc,win)
      {
        var tabs = getTabs(test.compByName('stackedtabs'));
        test.false(tabs[0].classList.contains('active'));
        test.true(tabs[1].classList.contains('active'));
      }
    }

    //test anonymous tab
  , { name: 'testanonymoustab'
    , test:function(doc,win)
      {
        var tablabel = test.qSA('*[data-tab$=":untitledtab"]')[0];
        test.click(tablabel, {x:5,y:5});
        test.true(test.isElementClickable(test.compByName('untitledtabtext')));
      }
    }
  , //the menu shouldn't be here yet...
    { name: 'testmenu'
    , test:function(doc,win)
      {
        var tablabel = test.compByName('tabs').querySelector('.nav-tabs');
        test.false(test.isElementClickable(tablabel));

        test.click(test.getMenu(['M01','A02']));
      }
    , waits: [ 'ui' ]
    }
  , //use the menu to go to a different tab
    { name: 'testmenu'
    , test:function(doc,win)
      {
        var tablabel = test.compByName('tabs').querySelector('.nav-tabs');
        test.true(test.isElementClickable(tablabel), 'nav pulldown should have appeared');
        test.click(tablabel);

        test.true(test.getOpenMenu());
        var openedmenu = test.getOpenMenu();

        test.eq(4, openedmenu.querySelectorAll("li").length); // 4 tabs
        test.eq(openedmenu.querySelector("li").offsetHeight, openedmenu.querySelectorAll("li")[2].offsetHeight); //all the same height, even the anonymous ones
        test.eq(Math.ceil(tablabel.getBoundingClientRect().right), Math.ceil(openedmenu.getBoundingClientRect().right), 'we also expect this menu to be right aligned against the nav-tabs button');

        var tab3 = test.qSA(openedmenu,'li').filter(li=>li.textContent.includes("long name for tab 3"))[0];
        test.true(tab3, "No menu item named '... long name for tab 3'");

        test.click(tab3);
        test.false(test.getOpenMenu(), 'menu should be closed');
        var tabs = getTabs(test.compByName('tabs'));
        test.true(tabs[3].classList.contains("active"));
        test.true(test.isElementClickable(tabs[3]));
      }
    }

  ]);
