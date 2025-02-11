/* This configuration is used by 'wh checkmodule'/RunESLint

   checkmodule normally prefilters by extension (.ts/.tsx) and passes the
   individual files to eslint, but running 'eslint' in whtree/ will also
   validate all JS files
*/
import { strictConfig } from "./jssdk/eslint-config/eslint.config.mjs";

export default [
  ...strictConfig, {
    name: "WebHare whtree ignore list",
    ignores: [
      "jssdk/*/dist/",
      "currentinstall",
      "modules/platform/generated/",
    ]
  },
];
