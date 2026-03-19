import { run } from "@webhare/cli";
import * as path from "node:path";
import * as ts from "typescript";

run({
  main() {
    console.log(`Listing recursive imports for webhare:\n`);

    const tsconfigdir = process.env["WEBHARE_DIR"] || "";

    const { config } = ts.readConfigFile(path.join(tsconfigdir, "tsconfig.json"), ts.sys.readFile);
    const { options: tsOptions, errors, fileNames } = ts.parseJsonConfigFileContent(config, ts.sys, tsconfigdir);
    tsOptions.configFilePath = tsconfigdir + "/tsconfig.json"; //needed to make @types/... lookups independent of cwd



    // Parse file with the definition
    const program = ts.createProgram({
      options: tsOptions,
      rootNames: fileNames,
      configFileParsingDiagnostics: errors
    });

    // COmpiler host, needed to resolve files
    const compiler = ts.createCompilerHost(tsOptions);

    /// References of a file
    type Ref = { name: string; from: Set<Ref>; to: Set<Ref> };

    /// List of all files
    const refs = new Map<string, Ref>;

    /// Get/create a ref for a file name
    function getRef(name: string): Ref {
      let ref = refs.get(name);
      if (!ref) {
        ref = { name: name, from: new Set, to: new Set };
        refs.set(name, ref);
      }
      return ref;
    }

    for (const sourcefile of program.getSourceFiles()) {
      // Ignore all node_modules files
      if (sourcefile.fileName.indexOf("node_modules") !== -1)
        continue;

      const fromref = getRef(sourcefile.fileName);

      // Walk over all 'important' nodes (skips over stuff like naked semicolons)
      ts.forEachChild(sourcefile, node => {
        // ignore type-only imports/exports
        if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)
          return;
        if (ts.isExportDeclaration(node) && node.isTypeOnly)
          return;

        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const resolved = ts.resolveModuleName(node.moduleSpecifier.text, sourcefile.fileName, tsOptions, compiler);

            if (resolved.resolvedModule) {
              // ignore loads of node_modules
              if (resolved.resolvedModule.resolvedFileName.indexOf("node_modules") !== -1)
                return;
              const toref = getRef(resolved.resolvedModule.resolvedFileName);
              fromref.to.add(toref);
              toref.from.add(fromref);
            }
          }
        }
      });
    }

    // Remove all files that aren't references or don't have references themselves
    function removeLeaves() {
      for (; ;) {
        let anychanged = false;
        for (const v of refs.values()) {
          if (!v.to.size) {
            anychanged = true;
            refs.delete(v.name);
            for (const f of v.from.values())
              f.to.delete(v);
          }
          if (!v.from.size) {
            anychanged = true;
            refs.delete(v.name);
            for (const f of v.to.values())
              f.from.delete(v);
          }
        }
        if (!anychanged)
          break;
      }
    }

    // Removes a single reference
    function removeEdge(from: Ref, to: Ref) {
      if (!from.to.has(to))
        throw new Error(`edge does not exist`);
      to.from.delete(from);
      from.to.delete(to);
    }

    // Finds the shortest reference involving a file
    function findShortestCycle(root: Ref) {
      // breadth-first search, keeping how we got to a file
      const directions = new Map<Ref, Ref>;
      const todo = [root];
      for (const elt of todo) {
        for (const c of elt.to) {
          //console.log(elt.name, "->", c.name);
          if (c === root) {
            const result: Ref[] = [];
            for (let iter: Ref | undefined = elt; iter; iter = directions.get(iter))
              result.unshift(iter);
            return result;

            // shortest cycle
          } else if (!directions.get(c)) {
            directions.set(c, elt);
            todo.push(c);
          }
        }
      }
      return [];
    }

    removeLeaves();

    let count = 0;
    while (refs.size) {
      for (const todo of refs.values()) {
        const cycle = findShortestCycle(todo);
        if (!cycle.length)
          continue;

        ++count;
        console.log(cycle.map(r => r.name).join(" => "));

        removeEdge(cycle[0], cycle[1] ?? cycle[0]);
        removeLeaves();
        break;
      }

    }
    console.log(`Found ${count} cycles`);
    return count > 0 ? 1 : 0;
  }
});
