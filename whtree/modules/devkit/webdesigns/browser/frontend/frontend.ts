import "./frontend.scss";

import * as dompack from "@webhare/dompack";
import "@webhare/dompack/reset.css";
import { initBrowseModuleWHDB } from "./whdb/whdb";
import { initBrowseModuleWRD } from "./wrd/wrd";

if (document.documentElement.classList.contains("dev-browsemodule-whdb"))
  dompack.onDomReady(initBrowseModuleWHDB);
else if (document.documentElement.classList.contains("dev-browsemodule-wrd"))
  dompack.onDomReady(initBrowseModuleWRD);
