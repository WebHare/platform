import type { PagePluginFunction, PagePluginRequest } from "@webhare/router";
import type { PagePluginInit } from "@webhare/router/src/siterequest";
import { parseYamlPluginConfig } from "@webhare/whfs/src/applytester";

interface DevPluginData {
  adddebugscript: boolean;
}

export function devSupportHook(init: PagePluginInit, composer: PagePluginRequest) {
  const config = parseYamlPluginConfig<DevPluginData>(init.settings);
  if (config.adddebugscript)
    composer.insertAt("dependencies-bottom", `<script src="/.wh/mod/devkit/public/debug.mjs" type="module"></script>`);
  // IF(IsRequest()) FIXME for DYNAMIC requets only,.
  //   webdesign->InsertWithCallback(PTR this->PrintUsedResources(webdesign), "body-devbottom");
}

devSupportHook satisfies PagePluginFunction;
