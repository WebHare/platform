/* This configuration is used by 'wh checkmodule'/RunESLint

   checkmodule normally prefilters by extension (.ts/.tsx) and passes the
   individual files to eslint, but running 'eslint' in whtree/ will also
   validate all JS files

   Running eslint --inspect-config in whtree/ givs a live view of the
   configuration and can help to debug file ignore/inclusion issues
*/
import { strictConfig } from "./jssdk/eslint-config/eslint.config.mjs";

export default [
  ...strictConfig, {
    name: "WebHare whtree ignore list",
    ignores: [
      "jssdk/*/dist/",
      "currentinstall",
      "modules/platform/generated/",
      "lib/*", // generated WASM files
      "libexec/*", //puppeteer
    ]
  },
];
