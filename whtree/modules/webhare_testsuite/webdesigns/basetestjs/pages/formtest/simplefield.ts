import { JSFormElement } from '@webhare/forms';

export type MySimpleFieldValue = { answer: number };

export class MySimpleField extends JSFormElement<MySimpleFieldValue> {
  didsetup = false;

  connectedCallback() {
    if (!this.didsetup) //attach event listeners only on first connect
      this.querySelector("button")?.addEventListener("click", () => this.setAnswer());

    this.didsetup = true;
  }
  get value() {
    return {
      answer: parseInt(this.querySelector(".answer")?.textContent || "") || 0
    };
  }
  set value(val: { answer: number }) {
    this.querySelector(".answer")!.textContent = String(val.answer);
  }
  setAnswer() {
    this.value = { answer: this.value.answer + 14 };
  }
  /** Invoked whenever disabled/required states change */
  protected refreshState() {
    for (const comp of this.querySelectorAll("button"))
      comp.disabled = this.disabled;
  }
}
