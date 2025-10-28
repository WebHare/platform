//@ts-nocheck -- this is only processable by a specifically configured bundler

import h1 from "./h1.txt1";
import h4 from "./h4.txt4";
import loadpath from "./h7.loadme.txt4";

setTimeout(() => console.log(JSON.stringify({ h1, h4, loadpath, assetpacks: globalThis.whAssetPacks })), 1);
