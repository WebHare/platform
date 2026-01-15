import * as inspector from 'node:inspector';
import Module from "node:module";

type HeapSnapshotMetainfo = {
  location_fields: string[];
  node_fields: string[];
  node_types: string[][];
  edge_fields: string[];
  edge_types: string[][];
  trace_function_info_fields: string[];
  trace_node_fields: string[];
  sample_fields: string[];
  type_strings: {
    [key: string]: string;
  };
};
type HeapSnapshotHeader = {
  title: string;
  meta: HeapSnapshotMetainfo;
  node_count: number;
  edge_count: number;
  trace_function_count: number;
  root_index: number;
};

type Profile = {
  root_index: number;
  nodes: number[];
  edges: number[];
  snapshot: HeapSnapshotHeader;
  samples: number[];
  strings: string[];
  locations: number[];
  trace_function_infos: number[];
  trace_tree: never[];
};

function takeHeapSnapshot(session: inspector.Session) {
  const parts: string[] = [];

  session.on('HeapProfiler.addHeapSnapshotChunk', (m) => {
    parts.push(m.params.chunk);
  });

  return new Promise<Profile>((resolve, reject) => {
    session.post('HeapProfiler.takeHeapSnapshot', {}, (err) => {
      if (err) reject(err);
      else resolve(JSON.parse(parts.join("")));
    });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleSessionPostResult<T>(executor: [resolve: (value: T) => void, reject: (reason: any) => void]) {
  return (err: Error | null, result: T) => {
    if (err)
      executor[1](err);
    else
      executor[0](result);
  };
}

export async function getActiveGenerators(): Promise<{ name: string; location: string; suspendedAt: string }[]> {
  const session = new inspector.Session();
  session.connect();

  const scripts: inspector.Debugger.ScriptParsedEventDataType[] = [];
  session.on("Debugger.scriptParsed", msg => scripts.push(msg.params));
  await new Promise<inspector.Debugger.EnableReturnType>((...executor) => session.post('Debugger.enable', handleSessionPostResult(executor)));
  const scriptIdMap = new Map(scripts.map(s => [s.scriptId, s]));


  function lookupLocation(location: inspector.Debugger.Location | undefined): { url: string; lineNumber: number; columnNumber: number; urlWithLocation: string } | null {
    if (!location)
      return null;
    const script = scriptIdMap.get(location.scriptId);
    if (!script)
      return null;

    if (script.sourceMapURL) {
      const mod = Module.findSourceMap(script?.url);
      const entry = mod?.findEntry(location.lineNumber, location.columnNumber || 1);
      if (entry && "originalSource" in entry)
        return {
          url: entry.originalSource || script.url,
          lineNumber: (entry.originalLine ?? 0) + 1,
          columnNumber: (entry.originalColumn ?? 0) + 1,
          urlWithLocation: `${entry.originalSource || script.url}(${(entry.originalLine ?? 0) + 1},${(entry.originalColumn ?? 0) + 1})`
        };
    }
    return {
      url: script.url,
      lineNumber: location.lineNumber,
      columnNumber: location.columnNumber || 1,
      urlWithLocation: `${script.url}(${location.lineNumber},${location.columnNumber || 1})`
    };
  }

  const profile = await takeHeapSnapshot(session);

  // V8 heap snapshot format: nodes are in snapshot.nodes, with types in snapshot.snapshot.meta
  const nodes = profile.nodes;
  const meta = profile.snapshot.meta;
  const nodeFields = meta.node_fields;
  const nodeTypes = meta.node_types[0]; // e.g. 'object', 'string', etc.
  const locations = profile.locations;
  const locationFields = meta.location_fields;

  const idIdx = nodeFields.indexOf('id');
  const nameIdx = nodeFields.indexOf('name');
  const typeIdx = nodeFields.indexOf('type');
  const nodeFieldCount = nodeFields.length;
  const locationFieldCount = locationFields.length;

  const locObjIdx = locationFields.indexOf('object_index');
  const locScriptIdIdx = locationFields.indexOf('script_id');
  const locLineNumberIdx = locationFields.indexOf('line');
  const locColumnNumberIdx = locationFields.indexOf('column');

  const locationMap = new Map<number, inspector.Debugger.Location>;

  for (let i = 0; i < locations.length; i += locationFieldCount) {
    const locId = locations[i + locObjIdx];
    locationMap.set(locId, {
      scriptId: locations[i + locScriptIdIdx].toString(),
      lineNumber: locations[i + locLineNumberIdx],
      columnNumber: locations[i + locColumnNumberIdx],
    });
  }

  const generators = [];
  for (let index = 0; index < nodes.length; index += nodeFieldCount) {
    const type = nodeTypes[nodes[index + typeIdx]];
    const id = nodes[index + idIdx];
    const name = profile.strings[nodes[index + nameIdx]];
    if (type === 'object' && name === 'Generator') {
      const objectData = await new Promise<inspector.HeapProfiler.GetObjectByHeapObjectIdReturnType>((resolve, reject) => session.post('HeapProfiler.getObjectByHeapObjectId', { objectId: id.toString() }, (err, result) => err ? reject(err) : resolve(result)));
      // subType needs to be 'generator'
      if (objectData.result.subtype !== "generator")
        continue;
      // Get the runtime properties of the generator
      const generatorProps = await new Promise<inspector.Runtime.GetPropertiesReturnType>((resolve, reject) => session.post('Runtime.getProperties', {
        objectId: objectData.result.objectId!,
        ownProperties: true,
        accessorPropertiesOnly: false,
        nonIndexedPropertiesOnly: false,
        generatePreview: true
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }, (err, result) => err ? reject(err) : resolve(result as any)));

      const state = generatorProps.internalProperties?.find(p => p.name === '[[GeneratorState]]')?.value?.value;
      if (state === "running") {
        // this function!
        continue;
      }
      const location: { scriptId: string; lineNumber: number; columnNumber: number } | undefined = generatorProps.internalProperties?.find(prop => prop.name === '[[GeneratorLocation]]')?.value?.value;

      const func = generatorProps.internalProperties?.find(p => p.name === '[[GeneratorFunction]]')?.value;
      const funcProps = await new Promise<inspector.Runtime.GetPropertiesReturnType>((resolve, reject) => session.post('Runtime.getProperties', {
        objectId: func!.objectId!,
        ownProperties: true,
        accessorPropertiesOnly: false,
        nonIndexedPropertiesOnly: false,
        generatePreview: true
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }, (err, result) => err ? reject(err) : resolve(result as any)));

      const funcName = funcProps.result.find(prop => prop.name === 'name')?.value?.value;

      generators.push({ name: funcName ?? "anonymous", location: lookupLocation(locationMap.get(index))?.urlWithLocation ?? "--", suspendedAt: lookupLocation(location)?.urlWithLocation ?? "--" });
    }
  }

  session.disconnect();
  return generators;
}
