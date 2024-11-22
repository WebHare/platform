/** Use this to wrap a handler function that runs async in a context where a void return is required.
 * The resulting function will log any errors that occur during the async function. It is written so the function
 * signature can be inferred from the expected return type.
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function floatAsyncHandler<U extends any[]>(func: (...args: U) => Promise<any>): (...args: U) => void {
  return (...args: U) => {
    func(...args).catch(e => {
      // FIXME: report test error in frontend and backend
      console.error(e);
    });
  };
}
