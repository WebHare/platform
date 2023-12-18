export interface AssetPackControlClient {
  register(data: { id: number }): Promise<void>;
  getBundle(requestedbundle: unknown, options?: { nowait?: boolean }): Promise<{ id: number; outputtag: string; lastcompile: Date }>;
  waitForCompile(outputtag: string, acceptstale: boolean): Promise<unknown>;
  getAdhocBundle(bundle: unknown): Promise<unknown>;
  getStatus(): Promise<unknown>;
  lookupBundle(uuid: string): Promise<number>;
  getBundleStatus(uuid: string): Promise<unknown>;
  clearCaches(): Promise<void>;
  recompleBundle(outputtag: string, rebuild: boolean): Promise<void>;
  setWatched(outputtag: string, watched: boolean): Promise<void>;
  setFullSourceMap(outputtag: string, fullsourcemap: boolean): Promise<void>;
  reload(): Promise<number>;
}
