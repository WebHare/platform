// TODO we need to add --verbose support (but let's check if we can't fold ourselves back into updategeneratedfiles.ts first ?
import { updateWebHareConfigFile } from "../../js/internal/generation/gen_config";

const withdb = !process.argv.includes("--nodb");

updateWebHareConfigFile(withdb);
