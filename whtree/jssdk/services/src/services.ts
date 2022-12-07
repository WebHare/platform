import WHBridge from "@mod-system/js/internal/bridge";

/** Asynchronously invoke a HareScript fuction

    @param func - Reference to the function (in the form 'resourcename#functionname'). HareScipt and JavaScript functions are both supported.
    @param args - Arguments
    @return Return value of the function
*/
export async function callHareScript(func: string, args: unknown[]) {
  //TODO or should we be exposing callAsync here and always go through that abstraction (and remove AsyncCallFunctionFromJob from bridge.whsock Invoke?)
  return WHBridge.invoke(func,args);
}