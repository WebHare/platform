import type { PagePluginFunction, PagePluginRequest, PagePluginInit } from "@webhare/router";
import { parseYamlPluginConfig } from "@webhare/whfs";

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
