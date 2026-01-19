///x @ts-nocheck -- Bulk rename to enable TypeScript validation

//TODO Only after all components pass TS validation, we can allow TS validation here

import action from './action/action';
import button from './button/button';
import buttongroup from './buttongroup/buttongroup';
import { ObjCheckbox } from './checkbox/checkbox';
import codeedit from './codeedit/codeedit';
import customhtml from './customhtml/customhtml';
import datetime from './datetime/datetime';
import dirtylistener from './frame/dirtylistener';
import forward from './action/forward';
import { ObjFrame } from './frame/frame';
import hr from './hr/hr';
import iframe from './iframe/iframe';
import image from './image/image';
import inlineblock from './inlineblock/inlineblock';
import list from './list/list';
import menuitem from './menuitem/menuitem';
import { ObjPanel } from './panel/panel';
import progress from './progress/progress';
import proxy from './frame/proxy';
import pulldown from './pulldown/pulldown';
import radiobutton from './radiobutton/radiobutton';
import rte from './rte/rte';
import section from './section/section';
import slider from './slider/slider';
import spacer from './spacer/spacer';
import split from './split/split';
import table from './table/table';
import { ObjTabs } from './tabs/tabs';
import tagedit from './tagedit/tagedit';
import { ObjText } from './text/text';
import textarea from './textarea/textarea';
import { ObjTextEdit } from './textedit/textedit';
import toolbar from './toolbar/toolbar';

import type { ToddCompBase } from '@mod-tollium/web/ui/js/componentbase';

export type { ObjCheckbox, ObjFrame, ObjPanel, ObjTabs, ObjText, ObjTextEdit };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- quickest fix but getComponents() may be too cumbersome to keep in a TS-safe setup
export function getComponents(): Record<string, { new(parentcomp: ToddCompBase, data: any): unknown }> {
  return {
    action,
    button,
    buttongroup,
    checkbox: ObjCheckbox,
    codeedit,
    customhtml,
    datetime,
    dirtylistener,
    //@ts-expect-error -- it's not a 'real' component
    frame: ObjFrame,
    forward,
    hr,
    iframe,
    image,
    inlineblock,
    list,
    menuitem,
    panel: ObjPanel,
    progress,
    proxy,
    pulldown,
    radiobutton,
    rte,
    section,
    slider,
    spacer,
    split,
    table,
    tabs: ObjTabs,
    tagedit,
    text: ObjText,
    textarea,
    textedit: ObjTextEdit,
    toolbar
  };
}
