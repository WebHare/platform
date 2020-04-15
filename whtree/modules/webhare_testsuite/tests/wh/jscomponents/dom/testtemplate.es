import * as dompack from 'dompack';
import * as test from '@mod-tollium/js/testframework';
var domtemplate = require('@mod-system/js/dom/template');

test.registerTests(
  [ { loadpage: '/.webhare_testsuite/tests/pages/template'
    }

  , { name:'manipulation'
    , test:function(doc,win)
      {
        var imported = domtemplate.importTemplate(doc, test.qS('#testif'));
        test.eq(11, imported.nodeType);
        test.eq('SPAN', imported.firstChild.nodeName);
        test.eq('SPAN', imported.firstElementChild.nodeName);
        test.eq('B', imported.lastElementChild.nodeName);
        test.eq(3, imported.childElementCount);
      }
    }

  , { name:'basics'
    , test:function(doc,win)
      {
        //remove the templates so we can test IE more easily
        dompack.remove(doc.querySelector('#testif2'));
        dompack.remove(doc.querySelector('#testif'));
        dompack.remove(doc.querySelector('#testifnot'));

        var receivednodes = test.qSA('#receiver .contents');
        test.eq(2, receivednodes.length);
        test.eq(2, test.qSA('#receiver .contents template').length);
        test.eq(1, test.qSA('template#basetocopy').length);

        test.eq(3, test.qSA('#expansion .expandednode').length);
        test.eq(0, test.qSA('#expansion .expandednode *[data-template-set]').length);

        test.eq("17 sep 2014", test.qSA('#expansion .expandednode .date')[0].textContent);
        test.eq("rgb(0, 153, 0)", window.getComputedStyle(test.qSA('#expansion .expandednode .date')[0]).color);

        test.eq("18 sep 2014", test.qSA('#expansion .expandednode .date')[1].textContent);
        test.eq("rgb(0, 0, 0)", window.getComputedStyle(test.qSA('#expansion .expandednode .date')[1]).color);

        test.eq("none", test.qSA('#expansion .expandednode .date')[2].textContent);
        test.eq("rgb(0, 255, 0)", window.getComputedStyle(test.qSA('#expansion .expandednode .date')[2]).color);

        test.eq("<b>bold</b>", test.qS('#simpletemplateuse').innerHTML);

        test.eq("my text", test.qSA('#testifholder b')[0].textContent);
        test.eq("Notyo is setmy text", test.qS('#testifholder').textContent);

        test.eq("not my text", test.qSA('#testifnotholder b')[0].textContent);
        test.eq("Yo is not setnot my text", test.qS('#testifnotholder').textContent);

        test.eq("Yo is setmy second textGo!Go!Go!", test.qS('#testif2holder').innerHTML);

  //FIXME test replaceable components (but being left alone in <template>)
  //FIXME test $wh.expandTemplateContent not recursing through <template>

      }
    }

  , { name:'iteration'
    , test:function(doc,win)
      {
        test.eq(1, test.qSA('#listexpansion > div').length);
        test.eq(2, test.qSA('#listexpansion > div > span').length);
        test.eq('99', test.qSA('#listexpansion > div')[0].getAttribute('data-yy'));
        test.false(test.qSA('#listexpansion > div')[0].hasAttribute('data-template-iterate'));
        test.eq('noot', test.qSA('#listexpansion > div > span')[1].firstChild.nodeValue);
        test.eq('BR', test.qSA('#listexpansion > div > span')[1].firstChild.nextSibling.nodeName);
        test.eq('mies', test.qSA('#listexpansion > div > span')[1].lastChild.nodeValue);

        test.eq(2, test.qSA('#listexpansion > div > b').length);

        test.eq(2, test.qSA('#listexpansion2 > div').length);
        test.eq(2, test.qSA('#listexpansion2 > div > span').length);
        test.false(test.qSA('#listexpansion2 > div')[0].hasAttribute('data-template-repeat'));
        test.eq('noot', test.qSA('#listexpansion2 > div > span')[1].firstChild.nodeValue);
        test.eq('BR', test.qSA('#listexpansion2 > div > span')[1].firstChild.nextSibling.nodeName);
        test.eq('mies', test.qSA('#listexpansion2 > div > span')[1].lastChild.nodeValue);
        test.eq('42', test.qSA('#listexpansion2 > div')[0].getAttribute('data-yy'));
        test.eq('11', test.qSA('#listexpansion2 > div')[1].getAttribute('data-yy'));

        test.eq(2, test.qSA('#listexpansion2 > div > b').length);
      }
    }

  ]);
