/** This file describes data as directly imported from moduledefs (not how we store/present it) */

export interface ManagedService {
  ///Script to run
  script?: string;
  ///When to run it
  run: "always" | "on-demand";
}

export interface ModuleDefinitionYML {
  ///Name of the module
  module: string;
  ///Base resource path for relative references
  baseResourcePath: string;
  ///Managed services
  managedServices?: Record<string, ManagedService>;
}
