/** A promise that sleeps for the specified number of milliseconds
 *  @param milliseconds - Number of milliseconds to sleep. Must be 0 or more
*/
export async function sleep(milliseconds: number): Promise<void> {
  if (milliseconds < 0)
    throw new Error(`Wait duration must be positive, got '${milliseconds}'`);
  await new Promise(resolve => setTimeout(resolve, milliseconds));
  return;
}
