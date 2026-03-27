export class PGBoundParam {
  value: unknown;
  type: string | number;

  constructor(value: unknown, type: string | number) {
    this.value = value;
    this.type = type;
  }
}
