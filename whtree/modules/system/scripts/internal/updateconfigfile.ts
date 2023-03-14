import { updateWebHareConfigFile } from "../../js/internal/generation/gen_config";

const withdb = !process.argv.includes("--nodb");

updateWebHareConfigFile(withdb);
