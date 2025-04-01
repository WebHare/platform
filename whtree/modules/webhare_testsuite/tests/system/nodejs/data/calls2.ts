export async function testAsync52() {
  return 52;
}

export function testSync53() {
  return 53;
}

export default function () {
  return 58;
}

export class TestClass {
  arg?: number;
  constructor(arg?: number) {
    this.arg = arg;
  }
  get44() {
    return 44;
  }
  getArg() {
    return this.arg;
  }
}

export const testInstance = new TestClass(59);
