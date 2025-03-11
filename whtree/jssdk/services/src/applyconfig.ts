import { isWorkOpen, onFinishWork, type FinishHandler } from "@webhare/whdb";
import { openBackendService } from "./backendservice";
import type { ApplyConfigurationOptions, ConfigurableSubsystemPart } from "@mod-platform/js/configure/applyconfig";
import "@mod-platform/js/services/platformservices"; //to ensure openBackendService can see our service

const finishHandlerSymbol = Symbol("ApplyConfig FinishHandler");

type RemoteApplyConfigOptions = ApplyConfigurationOptions & Required<Pick<ApplyConfigurationOptions, "source">>;

/** Apply configuration changes */
export async function applyConfiguration(toApply: RemoteApplyConfigOptions) {
  if (!toApply.source)
    throw new Error("applyConfiguration requires a source");

  using service = await openBackendService("platform:configuration");
  return await service.applyConfiguration(toApply);
}

//TODO Support module targeted updates, for now we only record the subsystems
class ApplyFinishHandler implements FinishHandler {
  private subsystems = new Set<ConfigurableSubsystemPart>;
  private sources = new Set<string>();
  private defer = Promise.withResolvers<void>();
  private applying = false;

  constructor() {
    this.defer.promise.catch(() => { }); //prevent unhandled rejection if the promise is never requested
  }

  add(subsystem: ConfigurableSubsystemPart, source: string): void {
    this.sources.add(source);
    this.subsystems.add(subsystem);
  }

  onCommit(): void { //we shouldn't be async as that will cause whdb finish handlers to wait on us!
    const applyPromise = this.subsystems.size > 0 ?
      applyConfiguration({
        subsystems: Array.from(this.subsystems),
        source: Array.from(this.sources).join(", ")
      }) : Promise.resolve();

    this.defer.resolve(applyPromise);

    this.applying = true;
  }

  onRollback(): void {
    this.applying = true;
    this.defer.reject(new Error("Configuration changes have been rolled back"));
  }

  getPromise(): Promise<void> {
    if (!this.applying)
      throw new Error("Configuration changes are not being applied yet - wait for the work to commit");
    return Promise.resolve(this.defer.promise); //allows unhandled rejection handling once the promise is requested
  }
}


/** Create a function that will return a promise when the specific changes are actually applied
 *
*/
export function createAppliedPromise(toApply: RemoteApplyConfigOptions): () => Promise<void> {
  if (!isWorkOpen())
    throw new Error(`Work must be open to use createAppliedPromise`);

  const handler = onFinishWork(() => new ApplyFinishHandler, { uniqueTag: finishHandlerSymbol });
  for (const subsystem of toApply.subsystems)
    handler.add(subsystem, toApply.source);

  return () => handler.getPromise();
}
