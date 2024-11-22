/// @ts-nocheck -- Bulk rename to enable TypeScript validation

//TODO Only after all components pass TS validation, we can allow TS validation here

import action from './action/action';
import button from './button/button';
import buttongroup from './buttongroup/buttongroup';
import checkbox from './checkbox/checkbox';
import codeedit from './codeedit/codeedit';
import customhtml from './customhtml/customhtml';
import datetime from './datetime/datetime';
import dirtylistener from './frame/dirtylistener';
import forward from './action/forward';
import frame from './frame/frame';
import hr from './hr/hr';
import iframe from './iframe/iframe';
import image from './image/image';
import inlineblock from './inlineblock/inlineblock';
import list from './list/list';
import menuitem from './menuitem/menuitem';
import panel from './panel/panel';
import progress from './progress/progress';
import proxy from './frame/proxy';
import pulldown from './pulldown/pulldown';
import radiobutton from './radiobutton/radiobutton';
import rte from './rte/rte';
import slider from './slider/slider';
import spacer from './spacer/spacer';
import split from './split/split';
import table from './table/table';
import tabs from './tabs/tabs';
import tagedit from './tagedit/tagedit';
import text from './text/text';
import textarea from './textarea/textarea';
import textedit from './textedit/textedit';
import toolbar from './toolbar/toolbar';

import { ToddCompBase, ToddCompClass } from '@mod-tollium/web/ui/js/componentbase';

export function getComponents(): Record<string, ToddCompClass<ToddCompBase>> {
  return {
    action,
    button,
    buttongroup,
    checkbox,
    codeedit,
    customhtml,
    datetime,
    dirtylistener,
    frame,
    forward,
    hr,
    iframe,
    image,
    inlineblock,
    list,
    menuitem,
    panel,
    progress,
    proxy,
    pulldown,
    radiobutton,
    rte,
    slider,
    spacer,
    split,
    table,
    tabs,
    tagedit,
    text,
    textarea,
    textedit,
    toolbar
  };
}
