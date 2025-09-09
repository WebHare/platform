import { promises as fs } from "node:fs";
import { normalize } from "node:path";

let registeredModules: Map<string, (argv: string[], options: { cwd: string }) => Promise<string[]>> | undefined;
let loading: string | undefined;

export function enableAutoCompleteMode(options?: { registerAsDynamicLoader: (module: NodeJS.Module) => void }) {
  registeredModules ??= new Map();

  // We want to register as dynamic loader for HMR, but can't load HMR here as that would prevent the use of this module in non-HMR environments
  // So we'll let the caller pass the function to register this module as a dynamic loader
  options?.registerAsDynamicLoader(module);
}

/// Called by run() to see in which mode it is running
export function registerRun(autoComplete: (argv: string[], options: { cwd: string }) => Promise<string[]>): { mode: "normal" | "autocomplete" } {
  if (!registeredModules)
    return { mode: "normal" };

  if (!loading)
    throw new Error("registerRun() called outside of autocompletion loader");
  registeredModules.set(loading, autoComplete);
  return { mode: "autocomplete" };
}

/// Parse a command line into words, following bash quoting rules
export function parseCommandLine(line: string) {
  const words: string[] = [];
  const lineUntilCursor = line + "z";

  // Split the line into words, taking bash quoting into account
  let currentWord = "";
  let inQuote: '"' | "'" | undefined;
  let inEscape = false;
  for (let i = 0; i < lineUntilCursor.length; i++) {
    const c = lineUntilCursor[i];
    if (inEscape) {
      currentWord += c;
      inEscape = false;
    } else if (c === "\\") {
      if (!inQuote)
        inEscape = true;
      else if (inQuote === '"' && `"'\`$`.includes(lineUntilCursor[i + 1]))
        inEscape = true;
      if (!inEscape)
        currentWord += c;
    } else if (c === '"' || c === "'") {
      if (!inQuote)
        inQuote = c;
      else if (inQuote === c)
        inQuote = undefined;
      else
        currentWord += c;
    } else if (c === " " && !inQuote) {
      if (currentWord)
        words.push(currentWord);
      currentWord = "";
    } else {
      currentWord += c;
    }
  }
  if (currentWord)
    words.push(currentWord.slice(0, -1));

  return words;
}

export async function autoCompleteCLIRunScript(cwd: string, path: string, args: string[], options?: { debug?: boolean }): Promise<string[]> {
  if (!registeredModules)
    throw new Error(`enableAutoCompleteMode() was not called`);
  path = normalize(path);
  if (options?.debug)
    console.error(`Autocompleting ${path} with args ${JSON.stringify(args)}, cwd: ${cwd}`);
  const fileData = await fs.readFile(path, "utf8");
  if (!fileData.match(/^\/\/ @webhare\/cli: /m)) { //We require a line starting exactly with "// @webhare/cli: "
    if (options?.debug)
      console.error(`No "// @webhare/cli: " comment found`);
    return [];
  }

  try {
    loading = path;

    /* Require the module. If not loaded yet, it will be loaded and the run()
       invocation will register the autocomplete handler for that module.
       If already loaded, the old handler is reused.
       Hot reloading will cause the module to reload and re-register
       the definitions.
    */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(path);

    const autoCompleteData = registeredModules?.get(path);
    if (!autoCompleteData) {
      if (options?.debug)
        console.error(`No autocomplete data found for ${path}, was run() called?`);
      return [];
    }

    if (options?.debug)
      console.error(`Running autocomplete with @webhare/cli config data`);

    const completions = autoCompleteData(args, { cwd });

    if (options?.debug)
      console.error(`Autocomplete result:`, completions);

    return completions;
  } catch (e) {
    console.error(`Error running autocompletion for ${path}:`, e);
    return [];
  } finally {
    loading = undefined;
  }
}
