export interface SuppressingClient {

}

// We should learns servicemnanager too to keep track of services, even when currently stopped/unconfigured. Preparing a base class
// as in the abstract, nodeservices has the same lifecycle issues
export class ManagedService {
  /// Is this service in the current configuration?
  inConfig: boolean = true;
  /// Should we start this service ? Initially true but affected by 'wh service stop'
  shouldStart: boolean = true;
  /// Which client is currently suppressing this service
  suppressedBy: SuppressingClient | null = null;

  constructor() {
  }
}
