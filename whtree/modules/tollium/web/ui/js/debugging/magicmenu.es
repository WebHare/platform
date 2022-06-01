import * as dompack from 'dompack';
import * as menu from '@mod-tollium/web/ui/components/basecontrols/menu';
import * as whintegration from '@mod-system/js/wh/integration';
import $todd from '@mod-tollium/web/ui/js/support';

let magicmenuactive;
let clicks = [];

///Is the magic menu active? (Always on development but we'll still let you play the animation on Dev)
function isActive()
{
  return whintegration.config.dtapstage == 'development' || magicmenuactive;
}

function onTopbarClick(event)
{
  if(magicmenuactive)
    return;

  clicks = clicks.slice(-2).concat(Date.now()); //note last three clicks
  if(clicks.length==3 && (clicks[2]-clicks[0])<1000)
  {
    magicmenuactive = true;
    dompack.qS('.wh-backend__topbar').classList.add('wh-backend__topbar--play');
    window.setTimeout(() => dompack.qS('.wh-backend__topbar').classList.remove('wh-backend__topbar--play'), 1);
  }
}

async function editElement(component)
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

  $todd.getActiveApplication().queueEventNoLock("$devhook", { action: "openineditor", screen: screennode.dataset.tolliumscreen, componentpath });
}

function onMagicMenu(event)
{
  if(!event.shiftKey || !event.altKey || !isActive())
    return;

  dompack.stop(event);

  let component = event.target.closest( '*[data-name]');
  let submenu = dompack.create("ul");

  if(component)
  {
    submenu.append( <li class="divider" />
                  , <li onClick={ () => editElement(component) }>Edit element {component.dataset.name}</li>
                  );
  }
  dompack.dispatchCustomEvent(event.target, 'tollium:magicmenu', { bubbles: true, cancelable: true, detail: { submenu: submenu }});
  menu.openAt(submenu, event);
}

window.addEventListener("contextmenu", onMagicMenu, true);
dompack.register('.wh-backend__topbar', node => node.addEventListener("click", onTopbarClick));
