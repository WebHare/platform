import * as dompack from "@webhare/dompack";
import FormBase from "../formbase";
import { debugFlags } from "@webhare/env";
import { verifyAddress, AddressValidationResult, AddressValue, AddressChecks } from "@webhare/forms";

function orThrow(error: string): never {
  throw new Error(error);
}

class SubField {
  node;
  fieldgroup: HTMLElement;
  pos: number;

  constructor(node: dompack.FormControlElement, pos: number) {
    this.node = node;
    this.pos = pos;
    this.fieldgroup = node.closest(".wh-form__fieldgroup") ?? orThrow("Could not find fieldgroup for field");
  }
}

interface OrderingData {
  countries: string[];
  fieldorder: string[];
}

export default class AddressField {
  numvaliditycalls = 0;
  node: HTMLElement;
  formnode: HTMLFormElement;
  countryNode: HTMLSelectElement;
  currentcountry: string;
  fieldName: string;
  orderingData: OrderingData[];
  allFields = new Map<string, SubField>;
  _updatingFields = false;

  constructor(node: HTMLElement) {
    this.node = node;
    //We won't FormBase.getForNode yet here so we're not too dependent on registration ordering
    this.formnode = node.closest("form") ?? orThrow("Could not find form for addressfield");

    // AddressField is initialized for the address's country field, so first find the other fields
    this.countryNode = dompack.qR(this.node, "select.wh-form__pulldown"); //TODO why aren't we targetting by ID ? this will work but seems ambiguous
    if (!this.countryNode)
      throw new Error("Could not find country select node");
    if (!this.countryNode.dataset.orderingdata)
      throw new Error("Addressfield not properly configured");

    this.currentcountry = this.countryNode.value;
    this.fieldName = this.countryNode.name.substr(0, this.countryNode.name.lastIndexOf("."));
    this.orderingData = JSON.parse(this.countryNode.dataset.orderingdata) as OrderingData[];
    const prefixLength = this.fieldName.length + 1; // fieldName + "."
    this.allFields = new Map();
    let fieldpos = 0;
    this.allFields.set(this.countryNode.name.substr(prefixLength), new SubField(this.countryNode, ++fieldpos));

    for (const field of dompack.qSA<HTMLInputElement | HTMLTextAreaElement>(this.formnode, `[name^='${this.fieldName}.']`)) {
      this.allFields.set(field.name.substring(prefixLength), new SubField(field, ++fieldpos));

      field.addEventListener("change", event => this._gotFieldChange(event));
    }

    if (this.orderingData) {
      this.countryNode.addEventListener("change", () => this._reconfigureFieldOrdering());
      this._reconfigureFieldOrdering();
    }
  }

  _gotFieldChange(event: Event) {
    if (this._updatingFields)
      return; // We're updating our own fields

    if (event.target === this.countryNode && this.currentcountry !== this.countryNode.value) {
      //country changed. clear errors on all fields before revalidating.. otherwise the errors will just seem to 'linger' for a while after switching
      this._clearErrors();
      this.currentcountry = this.countryNode.value;
    }

    if (this._getFieldValue("country") === "NL") {
      if (!this._getFieldValue("zip") || !this._getFieldValue("nr_detail"))
        return;
    }
    this._checkValidity(event);
  }

  _getFieldValue(fieldname: string) {
    const data = this.allFields.get(fieldname);
    if (data)
      return data.node.value;
    return "";
  }

  _getFirstCountrySpecificField() {
    let firstfield = null;
    for (const [key, field] of this.allFields.entries())
      if (key !== "country" && !field.fieldgroup.classList.contains("wh-form__fieldgroup--hidden") && (!firstfield || firstfield.pos > field.pos))
        firstfield = field;

    return firstfield ?? orThrow("Cannot find field for error");
  }

  _reconfigureFieldOrdering() {
    const country = this.countryNode.value;
    if (country) {
      const ordering = this.orderingData.find(e => e.countries.length === 0 || e.countries.includes(country));
      if (ordering) {
        let prevgroup;
        for (let idx = 0; idx < ordering.fieldorder.length; ++idx) {
          const item = this.allFields.get(ordering.fieldorder[idx]);
          if (!item)
            continue; //ordering may appear to fields that have not been rendered, eg 'state'

          item.pos = idx + 1;
          const fieldgroup = item.fieldgroup;
          if (prevgroup) {
            const compareres = prevgroup!.compareDocumentPosition(fieldgroup);
            if (compareres & Node.DOCUMENT_POSITION_PRECEDING)
              prevgroup!.parentNode!.insertBefore(fieldgroup, prevgroup!.nextSibling);
          }
          prevgroup = fieldgroup;
        }
      }
    }

    //street + city should skip client side validation for NL, we will be looking it up server side (FIXME we should consider overwriting our validation to delay validation until address lookups are complete)
    for (const fieldname of ['street', 'city']) {
      const field = this.allFields.get(fieldname);
      if (field)
        if (country.toUpperCase() === 'NL')
          field.node.setAttribute("data-wh-form-skipnativevalidation", "");
        else
          field.node.removeAttribute("data-wh-form-skipnativevalidation");
    }
  }

  _clearErrors() {
    const form = FormBase.getForNode(this.formnode) ?? orThrow("Parent form for address field not yet initialized");
    this.allFields.forEach(field => form.setFieldError(field.node, "", { reportimmediately: true }));
  }

  _getCurState() {
    const value: AddressValue = { country: "" };
    const visiblefields: HTMLElement[] = [];
    let anyset = false, allrequiredset = true;
    this.allFields.forEach((field, key) => {
      if (!field.fieldgroup.classList.contains("wh-form__fieldgroup--hidden")) {
        visiblefields.push(field.node.closest(".wh-form__fieldgroup")!);
        value[key as keyof AddressValue] = field.node.value;

        if (!anyset && key !== 'country' && field.node.value)
          anyset = true;
        if (field.node.required && !field.node.value && !field.node.hasAttribute("data-wh-form-skipnativevalidation"))
          allrequiredset = false;
      }
    });

    return { value, visiblefields, anyset, allrequiredset, lookupkey: JSON.stringify(value) };
  }

  async _checkValidity(event: Event) {
    const form = FormBase.getForNode(this.formnode) ?? orThrow("Parent form for address field not yet initialized");
    /* we used to clear fields that are no longer visible after a country change, add visible fields to the value we're checking
       but not sure why. ignoring those fields should be okay? and this is a very eager trigger, so if we really do this, do
       this on base of the country actually changing, not an external checkbox controlling visibility of the whole country field
       and a stray update event
       */
    const curstate = this._getCurState();
    if (!curstate.anyset) { //fields are empty..
      this._clearErrors();
      return; //then don't validate
    }
    if (!curstate.allrequiredset)
      return; //no need to validate if we don't even have the required fields in place

    let result: AddressValidationResult;
    const lock = dompack.flagUIBusy();
    try {
      curstate.visiblefields.forEach(el => el.classList.add("wh-form__fieldgroup--addresslookup"));
      ++this.numvaliditycalls;
      result = await verifyAddress(curstate.value as AddressValue, {
        lang: form.getLangCode(),
        checks: (this.node.dataset.checks?.split(' ') ?? []) as AddressChecks[]
      });
    } catch (e) {
      console.error(`Error while validating value: ${e}`);
      return;
    } finally {
      if (--this.numvaliditycalls === 0) //we're the last call
        curstate.visiblefields.forEach(el => el.classList.remove("wh-form__fieldgroup--addresslookup"));

      lock.release();
    }
    if (this._getCurState().lookupkey !== curstate.lookupkey)
      return; //abandon this _checkValidity call, the field has already changed.

    if (debugFlags.fhv)
      console.log(`[fhv] Validation result for address '${this.fieldName}': ${result.status}`);

    if (debugFlags.fdv) {
      if (["different_citystreet", "incomplete"].includes(result.status))
        console.warn(`[fdv] Address validation was performed, processing incomplete address (status: '${result.status}')`);
      else {
        console.warn(`[fdv] Ignoring return status '${result.status}' of address validation`);
        result.status = "ok";
      }
    }

    this._clearErrors();

    for (const err of result.errors) {
      const field = this.allFields.get(err.fields[0]) ?? this._getFirstCountrySpecificField();
      if (field)
        form.setFieldError(field.node, err.message, { reportimmediately: true });
    }

    if (result.corrections) {
      let anychanges = false;
      this._updatingFields = true;

      for (const [key, newvalue] of Object.entries(result.corrections)) {
        const field = this.allFields.get(key);
        if (field && field.node.value !== newvalue) {
          dompack.changeValue(field.node, newvalue);
          anychanges = true;
        }
      }

      this._updatingFields = false;
      if (anychanges)
        form.refreshConditions();
    }
  }
}
