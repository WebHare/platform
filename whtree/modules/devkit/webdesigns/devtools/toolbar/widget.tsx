import * as dompack from '@webhare/dompack';
import { onDomReady } from "@webhare/dompack";
import { getToolsOrigin } from '../support/dtsupport';
import type { BundleStatus, DevToolsSettings, FileStatus } from '../devtools';
import { devState } from '../support';

export class ToolbarWidget {
  //TODO Make these all private
  private toolbar = document.createElement("wh-outputtools");
  private toolbarshadow = this.toolbar.attachShadow({ mode: 'open' });

  private toolbar_resreloadcheck: HTMLInputElement;
  private toolbar_toolscheck: HTMLInputElement;
  private toolbar_showwarningscheck: HTMLInputElement;
  private toolbar_assetstatus: HTMLElement;
  private toolbar_pagereload: HTMLElement;
  private toolbar_filestatus: HTMLElement;
  private toolbar_resstatus: HTMLElement;
  private toolbar_pagerepublishreload;
  private toolbar_cssreloadcheck: HTMLInputElement;
  private toolbar_fullreloadcheck: HTMLInputElement;

  constructor(settings: DevToolsSettings,
    private callbacks: {
      onPageReloadClick: (evt: MouseEvent) => Promise<void> | void;
      onPageRepublishReloadClick: (evt: MouseEvent) => Promise<void> | void;
      onSettingsUpdate: (settings: Partial<DevToolsSettings>) => Promise<void> | void;
    }) {
    this.toolbarshadow.append(
      <>
        <link href={getToolsOrigin() + "/.wh/mod/devkit/public/wh-outputtools.css"} rel="stylesheet" />
        {this.toolbar_assetstatus = <wh-outputtool class="wh-outputtool wh-outputtool__assetstatus"></wh-outputtool>}
        {this.toolbar_pagereload = <wh-outputtool class="wh-outputtool wh-outputtool__pagereload" title="Reload after current recompile" onClick={callbacks.onPageReloadClick}>↻</wh-outputtool>}
        {this.toolbar_filestatus = <wh-outputtool class="wh-outputtool wh-outputtool__filestatus"></wh-outputtool>}
        {this.toolbar_resstatus = <wh-outputtool class="wh-outputtool wh-outputtool__resstatus"></wh-outputtool>}
        {this.toolbar_pagerepublishreload = <wh-outputtool class="wh-outputtool wh-outputtool__pagerepublishreload" title="Reload after current recompile" onClick={callbacks.onPageRepublishReloadClick}>↻</wh-outputtool>}
        <wh-outputtool class="wh-outputtool wh-outputtool__cssreload">
          {this.toolbar_cssreloadcheck = <input id="__wh-outputtool__cssreload" type="checkbox" tabindex="-1" />}
          <label for="__wh-outputtool__cssreload">auto-reload CSS</label>
        </wh-outputtool>

        <wh-outputtool class="wh-outputtool wh-outputtool__fullreload">
          {this.toolbar_fullreloadcheck = <input id="__wh-outputtool__fullreload" type="checkbox" tabindex="-1" />}
          <label for="__wh-outputtool__fullreload">auto-reload page</label>
        </wh-outputtool>

        <wh-outputtool class="wh-outputtool wh-outputtool__resreload">
          {this.toolbar_resreloadcheck = <input id="__wh-outputtool__resreload" type="checkbox" tabindex="-1" />}
          <label for="__wh-outputtool__resreload">auto-reload resources</label>
        </wh-outputtool>

        <wh-outputtool class="wh-outputtool wh-outputtool__showwarnings">
          {this.toolbar_showwarningscheck = <input id="__wh-outputtool__showwarnings" type="checkbox" tabindex="-1" />}
          <label for="__wh-outputtool__showwarnings">show warninngs</label>
        </wh-outputtool>

        <wh-outputtool class="wh-outputtool wh-outputtool__tools">
          {this.toolbar_toolscheck = <input id="__wh-outputtool__tools" type="checkbox" tabindex="-1" />}
          <label for="__wh-outputtool__tools">tools</label>
        </wh-outputtool>

        <wh-outputtool class="wh-outputtool wh-outputtool__hidetools" onClick={this.onHideToolsClick}><span>hide</span></wh-outputtool>
      </>);

    this.toolbar_cssreloadcheck.addEventListener("change", () => void this.callbacks.onSettingsUpdate({ cssReload: this.toolbar_cssreloadcheck.checked }));
    this.toolbar_fullreloadcheck.addEventListener("change", () => void this.callbacks.onSettingsUpdate({ fullReload: this.toolbar_fullreloadcheck.checked }));
    this.toolbar_resreloadcheck.addEventListener("change", () => void this.callbacks.onSettingsUpdate({ resourceReload: this.toolbar_resreloadcheck.checked }));
    this.toolbar_toolscheck.addEventListener("change", () => void this.callbacks.onSettingsUpdate({ tools: this.toolbar_toolscheck.checked }));
    this.toolbar_showwarningscheck.addEventListener("change", () => void this.callbacks.onSettingsUpdate({ showWarnings: this.toolbar_showwarningscheck.checked }));

    this.toolbar_cssreloadcheck.checked = settings.cssReload;
    this.toolbar_fullreloadcheck.checked = settings.fullReload;
    this.toolbar_resreloadcheck.checked = settings.resourceReload;
    this.toolbar_toolscheck.checked = settings.tools;
    this.toolbar_showwarningscheck.checked = settings.showWarnings;

    if (!document.documentElement.classList.contains("wh-widgetpreview")) //don't autoshow, it ruins widget previews (and their tests)
      onDomReady(() => this.showToolbar());
  }

  updateState(changes: {
    pageReloadScheduled?: boolean;
    pageRepublishReloadScheduled?: boolean;
    fileStatus?: FileStatus;
    bundleStatus?: BundleStatus;
  }) {
    if (changes.pageReloadScheduled !== undefined)
      this.toolbar_pagereload.classList.toggle("wh-outputtool__pagereload-scheduled", changes.pageReloadScheduled);
    if (changes.pageRepublishReloadScheduled !== undefined)
      this.toolbar_pagerepublishreload.classList.toggle("wh-outputtool__pagerepublishreload-scheduled", changes.pageRepublishReloadScheduled);

    if (changes.bundleStatus) {
      const assetsstatus = changes.bundleStatus.isUnknown ? { title: "unknown", description: "Connection to assetpack control failed" }
        : changes.bundleStatus.isCompiling ? { title: "compiling", description: "At least one assetpack is recompiling" }
          : changes.bundleStatus.anyErrors ? { title: "ERRORS", description: "Error in assetpacks prevent them from being uopdated" }
            : changes.bundleStatus.isStale ? { title: "STALE", description: "The page initialized with a stale assetpack. Refresh should fix unless caching is interfering" }
              : changes.bundleStatus.anyWarnings ? { title: "Warnings", description: "Assetpacks triggered warnings (but they were updated)" }
                : devState.hadrecompile ? { title: "outdated", description: "Assetpacks just recompiled, reload the page" }
                  : { title: "OK", description: "All assetpacks are up-to-date" };

      this.toolbar_assetstatus.textContent = assetsstatus.title;
      this.toolbar_assetstatus.title = assetsstatus.description;

      const className = "wh-outputtool__assetstatus-" + assetsstatus.title.toLowerCase();
      let classNames = this.toolbar_assetstatus.className.split(" ");
      if (classNames.indexOf(className) < 0) {
        classNames = classNames.filter(function (cls) {
          return cls.indexOf("wh-outputtool__assetstatus-") !== 0;
        });
        classNames.push(className);
        this.toolbar_assetstatus.className = classNames.join(" ");
      }

    }
    if (changes.fileStatus) {
      const showfilestatus = changes.fileStatus
        ? changes.fileStatus.hasfile
          ? changes.fileStatus.isdeleted
            ? "deleted"
            : changes.fileStatus.ispublishing
              ? "publishing"
              : changes.fileStatus.isok
                ? (devState.hadrepublish
                  ? "outdated"
                  : changes.fileStatus.haswarnings
                    ? "warnings"
                    : "OK")
                : "ERRORS"
          : "na"
        : "unknown";
      this.toolbar_filestatus.textContent = showfilestatus;
      //TODO we don't seem to be copying 'ispreview' out of the fileStatus so this didn't exist?
      this.toolbar_filestatus.style.display =/* changes.fileStatus && !changes.fileStatus.ispreview ? '' :*/ 'none';
      this.toolbar_pagerepublishreload.style.display = /*changes.fileStatus && !changes.fileStatus.ispreview ? '' :*/ 'none';

      const className = "wh-outputtool__filestatus-" + showfilestatus.toLowerCase();
      let classNames = this.toolbar_filestatus.className.split(" ");
      if (classNames.indexOf(className) < 0) {
        classNames = classNames.filter(cls => {
          return cls.indexOf("wh-outputtool__filestatus-") !== 0;
        });
        classNames.push(className);
        this.toolbar_filestatus.className = classNames.join(" ");
      }

      const showresstatus = devState.hadresourcechange ? "modified" : "OK";
      this.toolbar_resstatus.textContent = showresstatus;
      // FIXME? merge into filestatus/bundletatus too this.toolbar_resstatus.style.display = whoutputtoolsdata && whoutputtoolsdata.resources ? '' : 'none';
      this.toolbar_resstatus.className = "wh-outputtool wh-outputtool__resstatus wh-outputtool__resstatus-" + (devState.hadresourcechange ? "modified" : "ok");
    }
  }

  showToolbar() {
    document.documentElement.classList.add("wh-outputtool--active");
    document.documentElement.classList.add("wh-outputtool--visible");
    document.body.append(this.toolbar);
  }

  onHideToolsClick = () => {
    document.documentElement.classList.remove("wh-outputtool--visible");
    this.toolbar.remove();
  };

}
