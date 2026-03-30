type SetDataPathEntry = string | number;

export class SetDataError extends Error {
  private path: SetDataPathEntry[] = [];

  constructor(message: string, options?: { path?: SetDataPathEntry[] }) {
    super(message);
    if (options?.path)
      this.path = options.path;
  }

  prependToPath(...entries: SetDataPathEntry[]) {
    this.path.unshift(...entries);
  }

  getPathErrorSuffix() {
    let path = '';
    for (const entry of this.path) {
      if (typeof entry === 'number') {
        path += `[${entry}]`;
      } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(entry)) {
        path += (path ? "." : "") + entry;
      } else {
        path += `[${JSON.stringify(entry)}]`;
      }
    }
    return path ? ` at ${path}` : '';
  }
}
