import { logDebug } from "@webhare/services/src/logging";
import * as child_process from "child_process";
import { simpleGit } from 'simple-git';

//TODO is this useful?  https://isomorphic-git.org/docs/en/snippets#use-native-git-credential-manager

export async function executeGitCommand(parameters: string[], { workingdir = "" } = {}) {
  // Launch a git subprocess with the specified parameters, capturing its output
  let output = '', errors = '';
  const proc = child_process.spawn("git", parameters, {
    cwd: workingdir,
    stdio: ["ignore", "pipe", "pipe"]
  });
  proc.stdout.on("data", data => output += data);
  proc.stderr.on("data", data => errors += data);

  const exitinfo = await new Promise<number | string>(resolve =>
    proc.on("exit", (code: number, signal: string) => resolve(signal || code)));

  logDebug("devkit:executegitcommand", { exitinfo, output, errors });
  return { exitcode: exitinfo, output: output + '\n' + errors };
}

export async function executeGitCommandForeground(parameters: string[], { workingdir = "" } = {}) {
  const proc = child_process.spawn("git", parameters, {
    cwd: workingdir,
    stdio: ["inherit", "inherit", "inherit"]
  });

  const exitinfo = await new Promise<number | string>(resolve =>
    proc.on("exit", (code: number, signal: string) => resolve(signal || code)));

  return exitinfo;
}


function tryOrFallback<T>(func: () => Promise<T>, fallback: T): Promise<T> {
  return func().catch(() => fallback);
}

export async function getRepoInfo(dir: string) {
  const gitty = simpleGit({ baseDir: dir });

  let branch = 'HEAD';
  try {
    branch = (await gitty.revparse(['--abbrev-ref', 'HEAD'])).trim() || 'HEAD';
  } catch (e) {
    branch = 'HEAD';
  }

  const head_oid = await tryOrFallback(() => gitty.revparse(['HEAD']), '');
  const origin_oid = await tryOrFallback(() => gitty.revparse([`origin/${branch}`]), '');

  const remotes = await gitty.getRemotes(true);
  const remote_url = remotes.find(r => r.name === 'origin')?.refs?.fetch ?? "";

  const rawLog = await gitty.log(['-n', '100']);
  const logentries = rawLog.all;

  const status = await gitty.status();
  // if (!status.isClean()) console.error(status);
  const paths = status.files.map(f => ({ path: f.path }));

  const result = {
    branch,
    head_oid,
    msg: "", //??
    origin_oid,
    remote_url,
    status: "ok",
    paths,
    commits: logentries.map(logentry =>
    ({
      date: new Date(logentry.date),
      id: logentry.hash,
      message: logentry.message,
      author: { name: logentry.author_name, email: logentry.author_email },
      parents: logentry.refs
    }))
  };
  return result;
}

export async function describeGitRepo(dir: string, obsolete: boolean) {
  try {
    return await getRepoInfo(dir);
  } catch (e) {
    console.log("ERR", dir, e);
    return { status: "error" };
  }
}
