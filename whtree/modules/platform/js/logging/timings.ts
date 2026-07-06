class RunningTimer implements Disposable {
  stopped?: boolean;
  public readonly tag: string;
  private readonly timings: Timings;

  constructor(tag: string, timings: Timings) {
    this.tag = tag;
    this.timings = timings;
  }

  stop() {
    if (this.stopped)
      throw new Error(`Timer with tag '${this.tag}' already stopped`);
    this.timings["stopTimer"](this.tag);
    this.stopped = true;
  }

  [Symbol.dispose]() {
    if (!this.stopped)
      this.stop();
  }
}

/** Gather performance timings - used to build a server-timing overview */
export class Timings {
  timerStack: Array<{ tag: string; start: number }> = [];
  timers: Record<string, number> = {};

  /** Start the specified timer. If a timer is already running it will be paused */
  startTimer(tag: string): RunningTimer {
    if (this.timerStack.find(t => t.tag === tag))
      throw new Error(`Timer with tag '${tag}' already started`);
    if (this.timers[tag])
      throw new Error(`Timer with tag '${tag}' has already run`);

    this.timerStack.push({ tag, start: performance.now() });
    this.timers[tag] = 0; //allocate the timer - this keeps them in start order for asServerTimingHeader

    return new RunningTimer(tag, this);
  }

  /** Stop the specified timer. Timers must be stopped in reverse order they were started */
  private stopTimer(tag: string) {
    if (this.timerStack.at(-1)?.tag !== tag)
      throw new Error(`Timer with tag '${tag}' is not the most recently started timer`);

    const { start } = this.timerStack.pop()!;
    const spentTime = performance.now() - start;
    this.timers[tag] = spentTime;

    for (const entry of this.timerStack) //we don't actually pause timers, we just modify them
      entry.start += spentTime; //if it's a child timer, add our time to all ancestors
  }
  getTimers() {
    return this.timers;
  }
}

export function asServerTimingHeader(timings: Timings) {
  return Object.entries(timings.getTimers()).map(([name, duration]) => `${name};dur=${duration.toFixed(3)}`).join(",");
}
