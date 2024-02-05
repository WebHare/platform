import { AsyncWorker } from "../worker";

export class RestAPIWorkerPool {
  workers = new Array<{
    id: string;
    worker: AsyncWorker;
    activeCalls: number;
    totalCalls: number;
  }>;
  counter = 0;
  maxWorkers: number;
  constructor(maxWorkers: number) {
    this.maxWorkers = maxWorkers;
  }

  async runInWorker<T>(fn: (worker: AsyncWorker) => Promise<T>): Promise<T> {
    type WorkerEntry = typeof this.workers[number];
    let bestEntry: WorkerEntry | null = null;
    // Find the worker with the least active calls
    for (const entry of this.workers)
      if (entry.totalCalls < 100 && (!bestEntry || entry.activeCalls < bestEntry.activeCalls))
        bestEntry = entry;
    // Allocate a new worker if all current workers are busy and we have less than 5 active workers
    if (bestEntry?.activeCalls && this.workers.length < this.maxWorkers)
      bestEntry = null;
    if (bestEntry) {
      ++bestEntry.activeCalls;
      ++bestEntry.totalCalls;
    } else {
      const id = `worker-${++this.counter}`;
      this.workers.push(bestEntry = {
        worker: new AsyncWorker(),
        activeCalls: 1,
        totalCalls: 1,
        id
      });
    }
    try {
      return await fn(bestEntry.worker);
    } finally {
      --bestEntry.activeCalls;
      // Remove workers that have handled 100 calls
      if (!bestEntry.activeCalls && bestEntry.totalCalls >= 100) {
        bestEntry.worker.close();
        const pos = this.workers.indexOf(bestEntry);
        if (pos >= 0) {
          this.workers.splice(pos, 1);
        }
      }
    }
  }
}
