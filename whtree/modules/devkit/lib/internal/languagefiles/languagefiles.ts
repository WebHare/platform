import { simpleGit } from "simple-git";

export async function analyzeGITModuleDir(dir: string) {
  try {
    const info = await (simpleGit({ baseDir: dir })).revparse(["HEAD"]);
    return { revision: info };
  } catch (e) {
    return null;
  }
}
