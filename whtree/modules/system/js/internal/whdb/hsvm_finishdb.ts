import type { HareScriptVM } from "@webhare/harescript/src/wasm-hsvm";
import type { HSVMHeapVar } from "@webhare/harescript/src/wasm-hsvmvar";
import { finishHandlerFactory, type FinishHandler } from "@webhare/whdb/src/impl";

class HSVMFinishHandler implements FinishHandler {
  handlerlist = new Array<{
    vm: WeakRef<HareScriptVM>;
    handlers?: HSVMHeapVar;
  }>();

  addVM(vm: HareScriptVM) {
    if (this.handlerlist.find(h => h.vm.deref() === vm))
      return;

    this.handlerlist.push({ vm: new WeakRef(vm) });
  }

  async onBeforeCommit() {
    await this.setup(true);
  }

  async onBeforeRollback() {
    await this.setup(false);
  }

  async onCommit() {
    await this.invoke("onCommit");
  }

  async onRollback() {
    await this.invoke("onRollback");
  }

  private async setup(iscommit: boolean) {
    for (const vmRef of [...this.handlerlist]) {
      const vm = vmRef.vm.deref();
      if (!vm)
        continue;

      /* Finishhandlers for HaresSript are 'global' (primary transaction object) state which
         is why we need to copy the HS commithandler state at commit time (as commithandlers may start new work) */

      const handlers = vm.allocateVariable();
      using commitparam = vm.allocateVariable();
      commitparam.setBoolean(iscommit);

      //This also invokes precommit handlers for that VM
      await vm.callWithHSVMVars("wh::internal/transbase.whlib#__PopPrimaryFinishHandlers", [commitparam], undefined, handlers);
      if (handlers.recordExists())
        vmRef.handlers = handlers;
      else
        handlers[Symbol.dispose]();
    }
  }

  async invoke(stage: "onCommit" | "onRollback") {
    for (const vmRef of this.handlerlist) {
      const vm = vmRef.vm.deref();
      if (!vm || !vmRef.handlers)
        continue;

      if (vm.__isShutdown()) {
        /* This may happen if the lifecycles of VMs aren't managed properly. This is because we simply invoke __CallCommitHandlers on
           all VMs known to the context as its pretty fast and this absolves us of having to coordinate stashed works and commit handlers
           between HSVM and TS. We should normally get away with this as loadlib VMs last as long as the codecontext and thus live longer than
           database transactions */
        throw new Error(`VM associated with finish handler is already shutdown`);
      }

      await vm.loadlib("wh::internal/transbase.whlib").__CallCommitHandlers(vmRef.handlers, stage);
      vmRef.handlers[Symbol.dispose]();
    }
  }
}

export const hsvmFinishHandler = finishHandlerFactory(HSVMFinishHandler);
