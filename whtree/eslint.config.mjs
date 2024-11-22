/* This configuration file is needed because eslint can also be ran on deployed
   WebHares that don't have the root eslint.config.mjs file.
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
