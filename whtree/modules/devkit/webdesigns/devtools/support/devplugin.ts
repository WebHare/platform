import { devkitDebugPath } from "@mod-platform/js/concepts/frontend";
import { dtapStage, getAssetBase } from "@webhare/env";
import { litty } from "@webhare/litty";
import type { PagePluginFunction, PagePluginRequest, PagePluginInit } from "@webhare/router";
import { parseYamlPluginConfig } from "@webhare/whfs";

interface DevPluginData {
  adddebugscript: boolean;
}

export function devSupportHook(init: PagePluginInit, composer: PagePluginRequest) {
  const config = parseYamlPluginConfig<DevPluginData>(init.settings);
  if (config.adddebugscript && dtapStage === "development") {
    const scriptUrl = (getAssetBase() || '/') + devkitDebugPath.substring(1);
    composer.insertAt("dependencies-bottom", litty`<script src="${scriptUrl}" type="module" crossorigin="anonymous"></script>`);
    // IF(IsRequest()) FIXME for DYNAMIC requests only,.
    //   webdesign->InsertWithCallback(PTR this->PrintUsedResources(webdesign), "body-devbottom");
  }
}

devSupportHook satisfies PagePluginFunction;
