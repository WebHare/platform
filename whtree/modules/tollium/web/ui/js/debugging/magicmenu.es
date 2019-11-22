import * as dompack from 'dompack';
import { qS } from 'dompack';
import * as menu from '@mod-tollium/web/ui/components/basecontrols/menu';
import * as whintegration from '@mod-system/js/wh/integration';
import * as whconnect from '@mod-system/js/wh/connect';

let magicmenuactive = !whintegration.config.islive;
let clicks = [];

function onTopbarClick(event)
{
  if(magicmenuactive)
    return;

  clicks = clicks.slice(-2).concat(Date.now()); //note last three clicks
  if(clicks.length==3 && (clicks[2]-clicks[0])<1000)
  {
    magicmenuactive = true;
    qS('#topbar').classList.add('topbar--play');
    window.setTimeout(() => qS('#topbar').classList.remove('topbar--play'), 1);
  }
}

function editElement(component)
{
  let screennode = component.closest('.t-screen');

  if(!screennode)
    return alert ("Sorry, no screen found there");

  let componentpath=[];
  while(component)
  {
    componentpath.push(component.dataset.name);
    component = component.parentNode.closest('*[data-name]');
  }

  whconnect.openInEditor(screennode.dataset.tolliumscreen, { componentpath });
}

function onMagicMenu(event)
{
  if(!event.shiftKey || !event.altKey || !magicmenuactive)
    return;

  event.preventDefault();
  event.stopPropagation();

  let component = event.target.closest( '*[data-name]');
  let submenu = dompack.create("ul");

  if(component)
  {
    submenu.append(dompack.create("li", { className: "divider" })
                  , dompack.create("li", { textContent: "Edit element '" + component.dataset.name + "'"
                                         , on: { click: () => editElement(component) }
                                         }));
  }
  dompack.dispatchCustomEvent(event.target, 'tollium:magicmenu', { bubbles: true, cancelable: true, detail: { submenu: submenu }});
  menu.openAt(submenu, event);
}

window.addEventListener("contextmenu", onMagicMenu, true);
dompack.register('#topbar', node => node.addEventListener("click", onTopbarClick));
