import { Money } from "@webhare/std";

/** Get data that should survive std.stringify typed:true */
export function getTypedStringifyableData() {
  return {
    date: new Date("2024-01-01T12:13:14Z"),
    instant: Temporal.Instant.from("2024-01-01T12:13:14Z"),
    zoned: Temporal.ZonedDateTime.from("2024-01-01T12:13:14[Europe/Amsterdam]"),
    plainDate: Temporal.PlainDate.from("2024-01-01"),
    plainDateTime: Temporal.PlainDateTime.from("2024-01-01T12:13:14"),
    money: new Money("1.23"),
    object: {},
    array: [],
  };
}
