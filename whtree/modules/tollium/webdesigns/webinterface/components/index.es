import action from './action/action.es';
import button from './button/button.es';
import buttongroup from './buttongroup/buttongroup.es';
import checkbox from './checkbox/checkbox.es';
import codeedit from './codeedit/codeedit.es';
import customhtml from './customhtml/customhtml.es';
import datetime from './datetime/datetime.es';
import dirtylistener from './frame/dirtylistener.es';
import forward from './action/forward.es';
import frame from './frame/frame.es';
import hr from './hr/hr.es';
import iframe from './iframe/iframe.es';
import image from './image/image.es';
import inlineblock from './inlineblock/inlineblock.es';
import list from './list/list.es';
import menuitem from './menuitem/menuitem.es';
import panel from './panel/panel.es';
import progress from './progress/progress.es';
import proxy from './frame/proxy.es';
import pulldown from './pulldown/pulldown.es';
import radiobutton from './radiobutton/radiobutton.es';
import rte from './rte/rte.es';
import slider from './slider/slider.es';
import spacer from './spacer/spacer.es';
import split from './split/split.es';
import table from './table/table.es';
import tabs from './tabs/tabs.es';
import tagedit from './tagedit/tagedit.es';
import text from './text/text.es';
import textarea from './textarea/textarea.es';
import textedit from './textedit/textedit.es';
import toolbar from './toolbar/toolbar.es';

export function getComponents()
{
  return { action
         , button
         , buttongroup
         , checkbox
         , codeedit
         , customhtml
         , datetime
         , dirtylistener
         , frame
         , forward
         , hr
         , iframe
         , image
         , inlineblock
         , list
         , menuitem
         , panel
         , progress
         , proxy
         , pulldown
         , radiobutton
         , rte
         , slider
         , spacer
         , split
         , table
         , tabs
         , tagedit
         , text
         , textarea
         , textedit
         , toolbar
         };
}
