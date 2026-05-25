import { Session, type Profiler, type Runtime } from 'node:inspector/promises';

// types declared manually instead of importing them to add parent link to ProfileNode
type Profile = {
  nodes: ProfileNode[];
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
};

type ProfileNode = {
  id: number;
  callFrame: Runtime.CallFrame;
  hitCount?: number;
  children?: number[];
  deoptReason?: string;
  positionTicks?: Profiler.PositionTickInfo[];
  parent?: number; // added manually for easier traversal
};

function dumpProfile(profile: Profile, options?: { start?: number; finish?: number }) {
  const idToNode = new Map(profile.nodes.map(n => [n.id, n]));
  // set the parents
  for (const node of profile.nodes)
    for (const child of node.children ?? [])
      idToNode.get(child)!.parent = node.id;

  let curStart = 0;
  const samples: {
    relStart: number;
    trace: { node: ProfileNode; usedUntil: number | null; time: number }[];
  }[] = (profile.samples ?? []).entries().map(([index, sampleId]) => {
    const time = profile.timeDeltas?.[index] ?? 0;
    let node = idToNode.get(sampleId)!;
    const trace = [{ node, usedUntil: null, time }];
    while (node.parent !== undefined) {
      node = idToNode.get(node.parent)!;
      trace.unshift({ node, usedUntil: null, time });
    }
    const relStart = curStart;
    curStart += profile.timeDeltas?.[index] ?? 0;
    return {
      relStart,
      trace,
    };
  }).toArray();

  for (let i = samples.length - 1; i >= 0; i--) {
    const sample = samples[i];
    let a = i - 1;
    traceLoop:
    for (let t = sample.trace.length - 1; t >= 0; t--) {
      for (; a >= -1; a--) {
        if (samples[a]?.trace[t]?.node.id !== sample.trace[t].node.id) {
          if (samples[a + 1].trace[t].usedUntil === null)
            samples[a + 1].trace[t].usedUntil = i;
          if (a + 1 !== i)
            break traceLoop;
          break;
        }
      }
    }
  }

  for (let i = samples.length - 1; i > 0; i--) {
    const sample = samples[i];
    for (let t = sample.trace.length - 1; t >= 0; t--) {
      if (samples[i - 1].trace[t]?.node.id === sample.trace[t].node.id) {
        samples[i - 1].trace[t].time += sample.trace[t].time;
      }
    }
  }

  const traceUntil: (number | null)[] = [];
  for (const [sidx, sample] of samples.entries()) {
    const stime = profile.timeDeltas?.[sidx] ?? 0;
    let lastRepeat = traceUntil.findLastIndex(u => u !== null) ?? -1;
    if (lastRepeat >= sample.trace.length - 1)
      lastRepeat = sample.trace.length - 2;
    let lines = '';

    for (const [idx, { node, usedUntil, time }] of sample.trace.entries()) {
      traceUntil[idx] = usedUntil ?? traceUntil[idx];
      const isLeaf = idx === sample.trace.length - 1;
      const isStart = sample.trace[idx].usedUntil !== null;
      const show = isLeaf || isStart;

      if (show) {
        console.log(`${(isLeaf ? (sample.relStart / 1000).toFixed(3) : "").padStart(10)} ${(isLeaf ? (stime / 1000).toFixed(3) : "").padStart(7)} ${lines}+ ${node.callFrame.url ?? `VM${node.callFrame.scriptId}`}:${node.callFrame.lineNumber}:${node.callFrame.columnNumber} ${node.callFrame.functionName} ${isStart ? `${(time / 1000).toFixed(3)}ms` : ""}`);
      }

      if ((traceUntil[idx] || 0) > sidx)
        lines += "|";
      else
        lines += " ";
    }
  }
}

let session: Session | null = null;

/** Starts a CPU profile and prints the results */
export async function profileCPU(opts?: { intervalUs?: number }) {
  if (!session) {
    session = session = new Session();
    session.connect();
  }
  const localSession = session;

  const retval = {
    start: 0,
    stopped: false,
    async stop() {
      if (!this.stopped) {
        const finish = Date.now();
        const { profile } = await localSession.post('Profiler.stop');
        dumpProfile(profile, { start: this.start, finish });
        this.stopped = true;
      }
    },
    async [Symbol.asyncDispose](): Promise<void> {
      return this.stop();
    }
  };

  await session.post('Profiler.enable');
  if (opts?.intervalUs && opts.intervalUs !== 100)
    await session.post('Profiler.setSamplingInterval', { interval: opts.intervalUs });
  await session.post('Profiler.start');
  retval.start = Date.now();
  return retval;
}
