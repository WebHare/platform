//Data as imported from moduledefs

export interface ManagedService {
  ///Script to run
  script?: string;
}

export interface ModuleDefinitionYML {
  ///Name of the module
  module: string;
  ///Base resource path for relative references
  baseResourcePath: string;
  ///Managed services
  managedServices?: Record<string, ManagedService>;
}
