import type { PagePluginFunction, PagePluginRequest } from "@webhare/router";

interface DevPluginData {
  adddebugscript: boolean;
}

export function devSupportHook(composer: PagePluginRequest, hookdata: DevPluginData) {
  if (hookdata.adddebugscript)
    composer.insertAt("dependencies-bottom", `<script src="/.wh/mod/devkit/public/debug.mjs" type="module"></script>`);
  // IF(IsRequest()) FIXME for DYNAMIC requets only,.
  //   webdesign->InsertWithCallback(PTR this->PrintUsedResources(webdesign), "body-devbottom");
}

devSupportHook satisfies PagePluginFunction<DevPluginData>;
