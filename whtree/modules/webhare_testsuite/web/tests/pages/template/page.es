import * as dompack from 'dompack';
var domtemplate = require('@mod-system/js/dom/template');

/*! LOAD: wh.util.template
    USE: page.css
!*/

function init()
{
  //Test the polyfills
  var clone = document.importNode(document.querySelector('#basetocopy').content, true);
  document.querySelector('#receiver').appendChild(clone);

  clone = domtemplate.importTemplate(document, document.querySelector('#basetocopy'));
  if(clone.ownerDocument != document)
    throw new Error("I want to own the clone! Mootools Slick get confused if we don't");

  document.querySelector('#receiver').appendChild(clone);

  domtemplate.expandTemplate(document.querySelector('#expansion template'), { date: "17 sep 2014", coleure: '#009900' });
  domtemplate.expandTemplate(document.querySelector('#expansion template'), [ { date: "18 sep 2014" }, { coleure: '#00ff00' } ]);

  domtemplate.expandTemplateContent(document.querySelector('#simpletemplateuse'), { xxx:'<b>bold</b>' });

  domtemplate.expandTemplate(document.querySelector('#listexpansiontemplate'), { yy:99, items: [{ title: 'aap', yy: 42, yo:true},{title:'noot\nmies', yy:11}]}, { injectinto: document.querySelector('#listexpansion')});
  domtemplate.expandTemplate(document.querySelector('#listexpansiontemplate2'), { yy:99, items: [{ title: 'aap', yy: 42, yo:true},{title:'noot\nmies', yy:11}]}, { injectinto: document.querySelector('#listexpansion2')});
  domtemplate.expandTemplate(document.querySelector('#testif'), { text:'my text', yo:false, notyo:true });
  domtemplate.expandTemplate(document.querySelector('#testifnot'), { text:'not my text', yo:false, notyo:true });
  domtemplate.expandTemplate(document.querySelector('#testif2'), { text:'my second text', yo:1, go:[null,null,null] });
}
dompack.onDomReady(init);
