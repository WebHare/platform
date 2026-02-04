import { logError } from "@webhare/services";
import { AsyncWorker } from "../worker";

type WorkerList = Array<{
  id: string;
  worker: AsyncWorker;
  activeCalls: number;
  totalCalls: number;
}>;

const cleanAfterCollection = new FinalizationRegistry((workers: WorkerList) => {
  for (const worker of workers)
    worker.worker.close();
  workers.splice(0);
});

export class RestAPIWorkerPool {
  workers: WorkerList = [];
  counter = 0;
  id: string;
  maxWorkers: number;
  maxCallsPerWorker: number;

  constructor(id: string, maxWorkers: number, maxCallsPerWorker: number) {
    this.id = id;
    this.maxWorkers = maxWorkers;
    this.maxCallsPerWorker = maxCallsPerWorker;

    // Ensure that workers are closed when the pool is collected
    cleanAfterCollection.register(this, this.workers);
  }

  async runInWorker<T>(fn: (worker: AsyncWorker) => Promise<T>): Promise<T> {
    type WorkerEntry = typeof this.workers[number];
    let bestEntry: WorkerEntry | null = null;
    // Find the worker with the least active calls. FIXME: this can cause unbounded growth of workers when calls don't finish
    for (const entry of this.workers)
      if (entry.totalCalls < this.maxCallsPerWorker && (!bestEntry || entry.activeCalls < bestEntry.activeCalls))
        bestEntry = entry;
    // Allocate a new worker if all current workers are busy and we have less than 5 active workers
    if (bestEntry?.activeCalls && this.workers.length < this.maxWorkers)
      bestEntry = null;
    if (bestEntry) {
      ++bestEntry.activeCalls;
      ++bestEntry.totalCalls;
    } else {
      const worker = new AsyncWorker();
      const id = `worker-${this.id}-${++this.counter}-${worker.id}`;
      this.workers.push(bestEntry = {
        worker,
        activeCalls: 1,
        totalCalls: 1,
        id
      });
      worker.on("error", (error) => {
        console.error(`Worker ${id} failed: ${error}`);
        logError(new Error(`Worker ${id} failed: ${error}`, { cause: error }));
        const pos = this.workers.findIndex(w => w.worker === worker);
        if (pos >= 0)
          this.workers.splice(pos, 1);
        worker.close();
      });
    }
    try {
      return await fn(bestEntry.worker);
    } finally {
      --bestEntry.activeCalls;
      // Remove workers that have handled maxCallsPerWorker calls
      if (!bestEntry.activeCalls && bestEntry.totalCalls >= this.maxCallsPerWorker) {
        bestEntry.worker.close();
        const pos = this.workers.indexOf(bestEntry);
        if (pos >= 0) {
          this.workers.splice(pos, 1);
        }
      }
    }
  }

  close() {
    for (const worker of this.workers)
      worker.worker.close();
    this.workers.splice(0);
  }
}
