import * as test from '@mod-tollium/js/testframework';
import * as dompack from 'dompack';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/basecomponents.menutest')
    , waits: [ 'ui' ]
    }

  , { name: 'enableburger'
    , test:function(doc,win)
      {
        test.true(test.getCurrentScreen().qS("ul.wh-menubar"));
        test.true(test.qS('li[data-menuitem$="x0b1"]'));
        test.false(test.qS('li[data-menuitem$="x0b2"]'));
        test.eq(1, test.qSA('t-toolbar').length);

        //XB01 should be there, XB02 shouldn't
        test.click(test.compByName('b14_toggleforcemenubar'));
      }
    , waits: [ 'ui' ]
    }
  , { test:function(doc,win)
      {
        test.eq(1, test.qSA('t-toolbar').length);
        test.click(test.getCurrentScreen().qS("t-button.ismenubutton"));
        test.true(test.isElementClickable(test.qSA('li[data-menuitem$=":x01menu"]')[0]), "X01 Menu is already gone!");

        test.click(test.compByName('b04_submenubutton'));
        test.click(test.compByName('b04_submenubutton'));
        test.click(test.getCurrentScreen().qS("t-button.ismenubutton"));
        test.true(test.isElementClickable(test.qSA('li[data-menuitem$=":x01menu"]')[0]), "X01 Menu disappeared from the hamburger button after opening it from B04");
      }
    }

  , { name: 'openburger'
    , test:function(doc,win)
      {
        var burgerbutton = test.getCurrentScreen().qS('t-toolbar .t-toolbar-buttongroup__right t-button:last-child');
        test.click(burgerbutton);
        test.true(burgerbutton.classList.contains("button--active"),"button should remain highlighted with open menu");
        test.true(burgerbutton.classList.contains("ismenubutton"));

        var topmenu = test.getOpenMenu();
        test.true(topmenu);
        test.false(topmenu.querySelector('li[data-menuitem$=":x0b1"]'));
        test.true(topmenu.querySelector('li[data-menuitem$=":x0b2"]'));

        test.sendMouseGesture([{el: test.qSA(topmenu, "li").filter(li=>li.textContent.includes("X01"))[0] }]);
        let x13item = test.qS('li[data-menuitem$=x13]');
        test.true(x13item);
        test.true(x13item.hasAttribute("data-menushortcut"));
        test.true(dompack.closest(x13item,'ul').classList.contains('showshortcuts'), 'shortcuts class missing in hamburger, needed to make data-shortcuts appear');

        test.sendMouseGesture([{el: test.qSA(topmenu, "li").filter(li=>li.textContent.includes("X03"))[0] }]);

        test.true(burgerbutton.classList.contains("button--active"));
        test.true(test.getOpenMenu());

        var burgerbuttonrect = burgerbutton.getBoundingClientRect();
        var burgermenurect = topmenu.getBoundingClientRect();
        test.eq(Math.ceil(burgerbuttonrect.right), Math.ceil(burgermenurect.right), "burgermenu should right align with button");

        test.click(test.getCurrentScreen().getNode(), {x:0,y:0});
        test.false(burgerbutton.classList.contains("active"));
        test.false(test.getOpenMenu());

      }
    }

  , { loadpage: test.getTestScreen('tests/basecomponents.menutest')
    , waits: [ 'ui' ]
    }

  , { name: 'initialburger'
    , test:function(doc,win)
      {
        test.click(test.getMenu(['X01','X17']));
      }
    , waits:['ui']
    }

  , { name: 'test burger'
    , test:function(doc,win)
      {
        console.error(test.getCurrentScreen());
        var burgerbutton = test.getCurrentScreen().qS('t-toolbar .t-toolbar-buttongroup__right t-button:last-child');
        test.true(burgerbutton);
        test.true(burgerbutton.classList.contains("ismenubutton"));
        test.false(test.getMenu(['X01']));

        test.click(burgerbutton);
        test.true(test.getOpenMenu());

        test.click(test.compByName('b14_toggleforcemenubar'));
      }
    , waits: [ 'ui' ]
    }
  , { name: 'test menu back'
    , test:function(doc,win)
      {
        test.false(test.getOpenMenu());
        var lastbutton = test.getCurrentScreen().qS('t-toolbar .t-toolbar-buttongroup__right t-button:last-child');
        test.eq(null, lastbutton);

        test.true(test.getMenu(['X01']), 'menubar did not come back');
      }
    }
  , { name: 'reenable burger'
    , test:function(doc,win)
      {
        test.click(test.compByName('b14_toggleforcemenubar'));
      }
    , waits: [ 'ui' ]
    }
  , { name: 'add menuitems'
    , test:function(doc,win)
      {
        //check if the ismenubutton is back
        var lastbutton = test.getCurrentScreen().qS('t-toolbar .t-toolbar-buttongroup__right t-button:last-child');
        test.true(lastbutton.classList.contains("ismenubutton"));
        test.click(lastbutton);
        test.click(test.getOpenMenu().querySelector('li[data-menuitem$=":x01menu"]'));
        test.click(test.getOpenMenu().querySelector('li[data-menuitem$=":x18"]'));
      }
    , waits: [ 'ui' ]
    }
  , { name: 'check added menuitems'
    , test:function(doc,win)
      {
        var lastbutton = test.getCurrentScreen().qS('t-toolbar .t-toolbar-buttongroup__right t-button:last-child');
        test.click(lastbutton);

        let menu = test.getOpenMenu();
        test.true(menu);
        test.true(test.qS('li[data-menuitem$=":x07"]'));
      }
    }

  , { loadpage: test.getTestScreen('tests/basecomponents.menutest')
    , waits: [ 'ui' ]
    }

  , { name: 'initialburger-withpopup'
    , test:function(doc,win)
      {
        test.click(test.getMenu(['X01','X19']));
      }
    , waits:['ui']
    }

  , { name: "Check if menubar isn't visible in parent"
    , test:function(doc,win)
      {
        let parentscreen = test.getCurrentScreen().getParent();
        var lastbutton = parentscreen.qS('t-toolbar .t-toolbar-buttongroup__right t-button:last-child');
        test.true(lastbutton.classList.contains("ismenubutton"));
        test.false(parentscreen.qS("ul.wh-menubar"));
      }
    }
  ]);
