import * as dompack from "dompack";
import { getTid } from "@mod-tollium/js/gettid";

let lookupcache = {};

export default class AddressField
{
  constructor(node, options)
  {
    this.node = node;
    this.form = dompack.closest(this.node,"form").propWhFormhandler;

    // AddressField is initialized for the address's country field, so first find the other fields
    this.countryNode = dompack.qS(this.node, "select.wh-form__pulldown");
    if (!this.countryNode)
      throw new Error("Could not find country select node");

    this.currentcountry = this.countryNode.value;
    this.fieldName = this.countryNode.name.substr(0, this.countryNode.name.lastIndexOf("."));
    this.orderingData = this.countryNode.dataset.orderingdata && JSON.parse(this.countryNode.dataset.orderingdata);
    let prefixLength = this.fieldName.length + 1; // fieldName + "."
    this.allFields = new Map();
    let fieldpos = 0;
    this.allFields.set(this.countryNode.name.substr(prefixLength),
        { node: this.countryNode
        , fieldgroup: dompack.closest(this.countryNode, ".wh-form__fieldgroup")
        , pos: ++fieldpos
        });
    for (let field of dompack.qSA(dompack.closest(this.node, "form"), `[name^='${this.fieldName}.']`))
    {
      this.allFields.set(field.name.substr(prefixLength),
          { node: field
          , fieldgroup: dompack.closest(field, ".wh-form__fieldgroup")
          , pos: ++fieldpos
          });
      field.addEventListener("change", event => this._gotFieldChange(event));
    }

    if (this.orderingData)
    {
      this.countryNode.addEventListener("change", () => this._reconfigureFieldOrdering());
      this._reconfigureFieldOrdering();
    }
  }

  _gotFieldChange(event)
  {
    if (this._updatingFields)
      return; // We're updating our own fields
    console.log(this.countryNode, event.target, this.currentcountry);
    if(event.target == this.countryNode && this.currentcountry != this.countryNode.value)
    {
      //country changed. clear errors on all fields before revalidating.. otherwise the errors will just seem to 'linger' for a while after switching
      this._clearErrors();
      this.currentcountry = this.countryNode.value;
    }

    if (this._getFieldValue("country") === "NL")
    {
      if (!this._getFieldValue("zip") || !this._getFieldValue("nr_detail"))
        return;
    }
    this._checkValidity(event);
  }

  _getFieldValue(fieldname)
  {
    const data = this.allFields.get(fieldname);
    if (data)
      return data.node.value;
    return "";
  }

  _getFirstCountrySpecificField()
  {
    let firstfield = null;
    this.allFields.forEach((field, key) =>
    {
      if (key !== "country" && !field.fieldgroup.classList.contains("wh-form__fieldgroup--hidden") && (!firstfield || firstfield.pos > field.pos))
        firstfield = field;
    });
    return firstfield;
  }

  _reconfigureFieldOrdering()
  {
    const country = this.countryNode.value;
    if (country)
    {
      const ordering = this.orderingData.find(e => e.countries.length === 0 || e.countries.includes(country));
      if (ordering)
      {
        let prevgroup;
        for (let idx = 0; idx < ordering.fieldorder.length; ++idx)
        {
          const item = this.allFields.get(ordering.fieldorder[idx]);
          item.pos = idx + 1;
          const fieldgroup = item.fieldgroup;
          if (idx !== 0)
          {
            const compareres = prevgroup.compareDocumentPosition(fieldgroup);
            if (compareres & Node.DOCUMENT_POSITION_PRECEDING)
              prevgroup.parentNode.insertBefore(fieldgroup, prevgroup.nextSibling);
          }
          prevgroup = fieldgroup;
        }
      }
    }

    //street + city should skip client side validation for NL, we will be looking it up server side (FIXME we should consider overwriting our validation to delay validation until address lookups are complete)
    for(let fieldname of ['street','city'])
    {
       let field = this.allFields.get(fieldname);
       if(field)
         if(country.toUpperCase() == 'NL')
           field.node.setAttribute("data-wh-form-skipnativevalidation","");
         else
           field.node.removeAttribute("data-wh-form-skipnativevalidation");
    }
  }

  _clearErrors()
  {
    this.allFields.forEach(field => this.form.setFieldError(field.node, "", { reportimmediately: true }));
  }

  async _checkValidity(event)
  {
    /* we used to clear fields that are no longer visible after a country change, add visible fields to the value we're checking
       but not sure why. ignoring those fields should be okay? and this is a very eager trigger, so if we really do this, do
       this on base of the country actually changing, not an external checkbox controlling visiblity of the whole country field
       and a stray update event
       */
    let value = {}, visiblefields = [], anyset = false;
    this.allFields.forEach((field, key) =>
    {
      if (!field.fieldgroup.classList.contains("wh-form__fieldgroup--hidden"))
      {
        visiblefields.push(field.node.closest(".wh-form__fieldgroup"));
        value[key] = field.node.value;

        if(!anyset && key != 'country' && field.node.value)
          anyset = true;
      }
    });

    if(!anyset) //fields are empty..
    {
      this._clearErrors();
      return; //then don't validate
    }

    let result;
    try
    {
      visiblefields.forEach(el => el.classList.add("wh-form__fieldgroup--addresslookup"));

      let lookupkey = JSON.stringify(value);
      if(!lookupcache[lookupkey])
        lookupcache[lookupkey] = this.form.invokeBackgroundRPC(this.fieldName + ".ValidateValue", value);

      result = await lookupcache[lookupkey];
    }
    catch (e)
    {
      console.error(`Error while validating value: ${e}`);
      return;
    }
    finally
    {
      visiblefields.forEach(el => el.classList.remove("wh-form__fieldgroup--addresslookup"));
    }

    if(dompack.debugflags.fhv)
      console.log(`[fhv] Validation result for address '${this.fieldName}': ${result.status}`);

    if(dompack.debugflags.fdv)
    {
      if ([ "different_citystreet", "incomplete" ].includes(result.status))
        console.warn(`[fdv] Address validation was performed, processing incomplete address (status: '${result.status}')`);
      else
      {
        console.warn(`[fdv] Ignoring return status '${result.status}' of address validation`);
        result.status = "ok";
      }
    }

    this._clearErrors();
    switch (result.status)
    {
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
      case "invalid_zip":
      {
        this.form.setFieldError(this.allFields.get("zip").node, getTid("publisher:site.forms.addressfield.invalid_zip"), { reportimmediately: true });
        break;
      }
      case "invalid_nr_detail":
      {
        this.form.setFieldError(this.allFields.get("nr_detail").node, getTid("publisher:site.forms.addressfield.invalid_nr_detail"), { reportimmediately: true });
        break;
      }
      case "zip_not_found":
      {
        this.form.setFieldError(this.allFields.get("zip").node, getTid("publisher:site.forms.addressfield.zip_not_found"), { reportimmediately: true });
        break;
      }
      case "address_not_found":
      {
        this.form.setFieldError(this._getFirstCountrySpecificField().node, getTid("publisher:site.forms.addressfield.address_not_found"), { reportimmediately: true });
        break;
      }
      case "different_citystreet": // This can happen when fields have been set for another country, we'll update those fields with correct values
      case "incomplete":
      {
        let anychanges = false;
        this._updatingFields = true;
        this.allFields.forEach((field, key) =>
        {
          if (key in result.looked_up)
          {
            dompack.changeValue(field.node, result.looked_up[key]);
            anychanges = true;
          }
        });
        this._updatingFields = false;
        if (anychanges)
          this.form.refreshConditions();
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
