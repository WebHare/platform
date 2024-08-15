export type ManualCheckMessagesCondition = {
  type: "webhareVersion";
  semver_range: string;
} | {
  /// Date ranges. Supported for now: ">= iso8601-date"
  type: "dateRange";
  date_range: string;
} | {
  type: "moduleVersion";
  module: string;
  semver_range: string;
};

export type ManualCheckMessagesConditions = {
  conditions: ManualCheckMessagesCondition[];
};
