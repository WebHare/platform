import * as dompack from "@webhare/dompack";
import { getTid } from "@mod-tollium/js/gettid";
import FormBase from "../formbase";
import { flags } from "@webhare/env";
import { AddressValue } from "@webhare/forms/src/address";

function orThrow(error: string): never {
  throw new Error(error);
}

class SubField {
  node;
  fieldgroup: HTMLElement;
  pos: number;

  constructor(node: dompack.FillableFormElement, pos: number) {
    this.node = node;
    this.pos = pos;
    this.fieldgroup = node.closest(".wh-form__fieldgroup") ?? orThrow("Could not find fieldgroup for field");
  }
}

interface OrderingData {
  countries: string[];
  fieldorder: string[];
}

interface LookupResult {
  /* Lookup Status

  "ok" (the address is valid or addresses for this country cannot be checked)
  - "not_enough_data" (NL: not enough data to do an address lookup)
  - "invalid_city" city is not correct (eg a number)
  - "invalid_zip" (NL: the supplied zip is invalid)
  - "invalid_nr_detail" (NL: the nr_detail is invalid)
  - "different_citystreet" (NL: given city and street are different from the city and street that are found for the given zip and nr_detail)
  - "incomplete" (NL: the input data was incomplete - the looked_up field contains the missing fields)
  - "zip_not_found" (NL: there is no address with the given zip and nr_detail)
  - "address_not_found" (NL: there is no address with the given street nr_detail and city),
  - "lookup_failed" (there was an error looking up data - maybe the service is not configured correctly or was unavailable)
  - "not_supported" (the operation is not supported for this service)
  */
  status: "ok" | "not_enough_data" | "invalid_city" | "invalid_zip" | "invalid_nr_detail" | "different_citystreet" | "incomplete" | "zip_not_found" | "address_not_found" | "lookup_failed" | "not_supported";
  ///The (normalized) input data
  data: [key: string];
  ///The result of the address lookup, contains the complete address if the status is "incomplete"
  looked_up: AddressValue;
}

const lookupcache = new Map<string, Promise<LookupResult>>();

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

    if (event.target == this.countryNode && this.currentcountry != this.countryNode.value) {
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
          const item = this.allFields.get(ordering.fieldorder[idx])!;
          item.pos = idx + 1;
          const fieldgroup = item.fieldgroup;
          if (idx !== 0) {
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
        if (country.toUpperCase() == 'NL')
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
    const value: Record<string, string> = {};
    const visiblefields: HTMLElement[] = [];
    let anyset = false, allrequiredset = true;
    this.allFields.forEach((field, key) => {
      if (!field.fieldgroup.classList.contains("wh-form__fieldgroup--hidden")) {
        visiblefields.push(field.node.closest(".wh-form__fieldgroup")!);
        value[key] = field.node.value;

        if (!anyset && key != 'country' && field.node.value)
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

    let result: LookupResult;
    try {
      curstate.visiblefields.forEach(el => el.classList.add("wh-form__fieldgroup--addresslookup"));

      ++this.numvaliditycalls;
      if (!lookupcache.get(curstate.lookupkey))
        ///@ts-ignore the assumption that a form is a RPCormBase already exists without validation, so keeping this call for now
        lookupcache.set(curstate.lookupkey, form.invokeBackgroundRPC(this.fieldName + ".ValidateValue", curstate.value));

      result = await lookupcache.get(curstate.lookupkey)!; //has to existed, created above
    } catch (e) {
      console.error(`Error while validating value: ${e}`);
      return;
    } finally {
      if (--this.numvaliditycalls == 0) //we're the last call
        curstate.visiblefields.forEach(el => el.classList.remove("wh-form__fieldgroup--addresslookup"));
    }
    if (this._getCurState().lookupkey != curstate.lookupkey)
      return; //abandon this _checkValidity call, the field has already changed.

    if (flags.fhv)
      console.log(`[fhv] Validation result for address '${this.fieldName}': ${result.status}`);

    if (flags.fdv) {
      if (["different_citystreet", "incomplete"].includes(result.status))
        console.warn(`[fdv] Address validation was performed, processing incomplete address (status: '${result.status}')`);
      else {
        console.warn(`[fdv] Ignoring return status '${result.status}' of address validation`);
        result.status = "ok";
      }
    }

    this._clearErrors();
    switch (result.status) {
      case "not_supported": // Address lookup not supported, treat as "ok"
      case "ok":
        {
          break;
        }
      case "not_enough_data":
        {
          // Nothing to check yet
          break;
        }
      case "invalid_city":
        {
          // We'll target the right field but we don't want to supply N translations for 'invalid city'
          form.setFieldError(this.allFields.get("city")!.node, getTid("publisher:site.forms.addressfield.address_not_found"), { reportimmediately: true });
          break;
        }
      case "invalid_zip":
        {
          form.setFieldError(this.allFields.get("zip")!.node, getTid("publisher:site.forms.addressfield.invalid_zip"), { reportimmediately: true });
          break;
        }
      case "invalid_nr_detail":
        {
          form.setFieldError(this.allFields.get("nr_detail")!.node, getTid("publisher:site.forms.addressfield.invalid_nr_detail"), { reportimmediately: true });
          break;
        }
      case "zip_not_found":
        {
          form.setFieldError(this.allFields.get("zip")!.node, getTid("publisher:site.forms.addressfield.zip_not_found"), { reportimmediately: true });
          break;
        }
      case "address_not_found":
        {
          form.setFieldError(this._getFirstCountrySpecificField().node, getTid("publisher:site.forms.addressfield.address_not_found"), { reportimmediately: true });
          break;
        }
      case "different_citystreet": // This can happen when fields have been set for another country, we'll update those fields with correct values
      case "incomplete":
        {
          let anychanges = false;
          this._updatingFields = true;
          this.allFields.forEach((field, key) => {
            if (key in result.looked_up) {
              dompack.changeValue(field.node, (result.looked_up as Record<string, string>)[key]);
              anychanges = true;
            }
          });
          this._updatingFields = false;
          if (anychanges)
            form.refreshConditions();
          break;
        }
      case "lookup_failed":
        {
          console.error("Lookup failed, is the service configured correctly?");
          break;
        }
      default:
        {
          console.error(`Unknown status code '${result.status}' returned`);
          break;
        }
    }
  }
}
