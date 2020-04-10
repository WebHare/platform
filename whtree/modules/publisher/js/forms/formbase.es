import * as dompack from 'dompack';
import * as domfocus from 'dompack/browserfix/focus';
import * as webharefields from './internal/webharefields';
import * as merge from './internal/merge';
import { executeSubmitInstruction } from '@mod-system/js/wh/integration';
import './internal/requiredstyles.css';
import { getTid } from "@mod-tollium/js/gettid";
import "./internal/form.lang.json";
import { reportValidity, setFieldError, setupValidator } from './internal/customvalidation.es';
import { URL } from 'dompack/browserfix/url';
import * as compatupload from '@mod-system/js/compat/upload';
import * as pxl from '@mod-consilio/js/pxl.es';

const anyinputselector = 'input,select,textarea,*[data-wh-form-name],*[data-wh-form-is-validator]';
const submitselector = 'input[type=submit],input[type=image],button[type=submit],button:not([type])';

function isNodeCollection(node)
{
  // IE11 returns an HTMLCollection for checkbox/radio groups, so check for that instead of RadioNodeList (which is undefined in IE11)
  return (node instanceof HTMLCollection || (typeof RadioNodeList != "undefined" && node instanceof RadioNodeList));
}
function getErrorFields(validationresult)
{
  return validationresult.failed.map(field => field.name || field.dataset.whFormName || field.dataset.whFormGroupFor || "?").sort().join(" ");
}
function hasEverFailed(field)
{
  return field.classList.contains('wh-form__field--everfailed');
}
function doValidation(field, isafter)
{
  //If we're not an 'after failure' event, stay silent if the field hasn't erred yet
  if(isafter && !hasEverFailed(field))
    return;

  let form = dompack.closest(field,'form');
  if(!form || !form.propWhFormhandler)
    return;

  let owner = dompack.closest(field,'*[data-wh-form-is-validator]');
  let formhandler = form.propWhFormhandler;
  formhandler.validate([owner || field], {focusfailed:false});
}

function handleValidateEvent(event)
{
  doValidation(event.target,false);
}
function handleValidateAfterEvent(event)
{
  doValidation(event.target,true);
}

export default class FormBase
{
  constructor(formnode)
  {
    this.node = formnode;
    if(this.node.nodeName != 'FORM')
      throw new Error("Specified node is not a <form>"); //we want our clients to be able to assume 'this.node.elements' works

    this.elements = formnode.elements;
    if(this.node.propWhFormhandler)
      throw new Error("Specified node already has an attached form handler");
    this.node.propWhFormhandler = this;

    //Implement webhare fields extensions, eg 'now' for date fields or 'enablecomponents'
    webharefields.setup(this.node);
    //Implement page navigation
    this.node.addEventListener("click", evt => this._checkClick(evt));
    this.node.addEventListener("dompack:takefocus", evt=> this._onTakeFocus(evt), true);
    this.node.addEventListener("input", evt => this._onInputChange(evt), true);
    this.node.addEventListener("change", evt => this._onInputChange(evt), true);
    this.node.addEventListener('submit', evt => this._submit(evt, null));
    this.node.addEventListener('wh:form-dosubmit', evt => this._doSubmit(evt, null));
    this.node.addEventListener("wh:form-setfielderror", evt => this._doSetFieldError(evt));

    this._rewriteEnableOn();
    this._updateConditions(true); //Update required etc handlers
    this._applyPrefills();

    //Update page navigation
    let pagestate = this._getPageState();
    this._updatePageVisibility(pagestate.pages, 0);
    this._updatePageNavigation();
  }

  sendFormEvent(eventtype, vars)
  {
    if(!this._formhandling || !this._formhandling.pxl)
      return;

    let now = Date.now();
    if(!this._formsessionid)
    {
      this._formsessionid = pxl.generateId();
      this._firstinteraction = now;
    }

    let pagestate = this._getPageState();
    let formid = this.node.dataset.whFormId;
    pxl.sendPxlEvent(eventtype, { ds_formmeta_id: formid && formid != '-' ? formid : ''
                                , ds_formmeta_session: this._formsessionid
                                , dn_formmeta_time: now - this._firstinteraction
                                , dn_formmeta_pagenum: pagestate.curpage + 1
                                , ds_formmeta_pagetitle: this._getPageTitle(pagestate.curpage)
                                , ...vars
                                }, { node: this.node });
  }

  _rewriteEnableOn() //ADDME move this to webhare server
  {
    // This is the initialization, check the enable components for all elements within the form
    for (let control of dompack.qSA(this.node, "*[data-wh-form-enable]"))
      for (let element of control.dataset.whFormEnable.split(" "))
      {
        let target = this.node.elements[element];
        if (target)
        {
          let name = (control.nodeName == "OPTION" ? dompack.closest(control,"select") : control).name;
          if(!name) //duplicated node?
            continue;

          let ourcondition = { field: name, matchtype: "IN", value: control.value };
          if(target.dataset.whFormEnabledIf) //append to existing criterium
            ourcondition = { conditions: [ JSON.parse(target.dataset.whFormEnabledIf).c, ourcondition ], matchtype: "AND" };
          target.dataset.whFormEnabledIf = JSON.stringify({c:ourcondition});
        }
      }
  }

  _applyPrefills()
  {
    //Apply prefills. Set in field order, so controls-enabling-controls things will generally work
    let searchparams = new URL(location.href).searchParams;
    for(let field of this._queryAllFields())
    {
      let allvalues = searchparams.getAll(field.name);
      if(!allvalues.length)
        continue;

      if(field.multi && field.nodes[0].type=='checkbox')
      {
        for(let node of field.nodes)
        {
          let shouldbechecked = allvalues.includes(node.value);
          if(shouldbechecked != field.checked)
            this.setFieldValue(node, shouldbechecked);
        }
      }
      else if(field.multi && field.nodes[0].type=='radio')
      {
        let tocheck = field.nodes.filter(_ => _.value == allvalues[allvalues.length-1])[0];
        if(tocheck && !tocheck.checked)
          this.setFieldValue(tocheck, true);
        if(!tocheck)
          field.nodes.filter(_ => _.checked).forEach(_ => this.setFieldValue(_, false));
      }
      else
      {
        if(!this._isNowSettable(field.node))
          continue;
        this.setFieldValue(field.node, allvalues[allvalues.length-1]); //last value wins
      }
    }
  }

  /** Setup how the form will handle validation and events. This is invoked
      after the form is setup and handled separately from any options passed
      to the constructor.. because there may be a race between form construction
      and forms.setup being invoked */
  _setupFormHandler(formhandling)
  {
    if(this._formhandling)
      throw new Error("Form handling can only be setup once");

    this._formhandling = { ...formhandling };
    this._dovalidation = formhandling.validate;
    if(this._dovalidation)
    {
      this._curtriggerevents = [...formhandling.triggerevents];
      this._curafterevents = [...formhandling.triggerafterfailure];
      this._curtriggerevents.forEach(eventname => this.node.addEventListener(eventname, handleValidateEvent, true));
      this._curafterevents.forEach(eventname => this.node.addEventListener(eventname, handleValidateAfterEvent, true));
      this.node.noValidate = true;
    }
  }

  _updateFieldGroupMessageState(field, type, getError)
  {
    let mygroup = dompack.closest(field,".wh-form__fieldgroup");
    if(!mygroup)
      return null;

    //look for failing class, eg .wh-form__field--error - might actually apply to this group itself!
    let failedfield = mygroup.classList.contains("wh-form__field--" + type) ? mygroup : mygroup.querySelector(".wh-form__field--" + type);
    dompack.toggleClass(mygroup, "wh-form__fieldgroup--" + type, !!failedfield); //eg. wh-form__fieldgroup--error

    let error = (failedfield ? getError(failedfield) : null) || null;
    if(error) //mark the field has having failed at one point. we will now switch to faster updating error state
      field.classList.add('wh-form__field--everfailed');

    if(error && !(error instanceof Node))
      error = dompack.create('span', { textContent: error });

    if(!dompack.dispatchCustomEvent(mygroup, 'wh:form-displaymessage', //this is where parsley hooks in and cancels to handle the rendering of faults itself
          { bubbles: true
          , cancelable: true
          , detail: { message: error
                    , field: failedfield
                    , type: type
                    } }))
    {
      return null;
    }

    let messagenode = mygroup.querySelector(".wh-form__" + type); //either wh-form__error or wh-form__suggestion
    if(!messagenode)
    {
      if(!failedfield)
        return; //nothing to do

      let suggestionholder = dompack.closest(field,'.wh-form__fields') || mygroup.querySelector('.wh-form__fields') || mygroup;
      messagenode = dompack.create("div", { className: "wh-form__" + type });
      dompack.append(suggestionholder, messagenode);
    }

    dompack.empty(messagenode);
    if(error)
      messagenode.appendChild(error);
  }

  _updateFieldGroupErrorState(field)
  {
    this._updateFieldGroupMessageState(field, 'error', failedfield => failedfield.propWhSetFieldError || failedfield.propWhValidationError);
  }

  _updateFieldGroupSuggestionState(field)
  {
    this._updateFieldGroupMessageState(field, 'suggestion', failedfield => failedfield.propWhValidationSuggestion);
  }

  _doSetFieldError(evt)
  {
    //FIXME properly handle multiple fields in this group reporting errors
    if(!this._dovalidation)
      return;

    dompack.stop(evt);

    //if we're already in error mode, always update reporting
    if(!evt.detail.reportimmediately && !evt.target.classList.contains("wh-form__field--error"))
      return;

    this._reportFieldValidity(evt.target);
  }

  _reportFieldValidity(node)
  {
    let iserror = (node.propWhSetFieldError || node.propWhValidationError || node.propWhFormNativeError);
    dompack.toggleClass(node, "wh-form__field--error", !!iserror);

    let issuggestion = !iserror && node.propWhValidationSuggestion;
    dompack.toggleClass(node, "wh-form__field--suggestion", !!issuggestion);

    this._updateFieldGroupErrorState(node);
    this._updateFieldGroupSuggestionState(node);
    return !iserror;
  }

  //validate and submit. normal submissions should use this function, directly calling submit() skips validation and busy locking
  async validateAndSubmit(extradata)
  {
    await this._submit(null, extradata);
  }

  async _submit(evt, extradata)
  {
    if(this.node.classList.contains('wh-form--submitting')) //already submitting
      return;

    //A form element's default button is the first submit button in tree order whose form owner is that form element.
    let submitter = this._submitter || this.node.querySelector(submitselector);
    this._submitter = null;

    if(dompack.debugflags.fhv)
      console.log('[fhv] received submit event, submitter:', submitter);

    let tempbutton = null;
    if(submitter)
    { //temporarily add a hidden field representing the selected button
      tempbutton = document.createElement('input');
      tempbutton.name = submitter.name;
      tempbutton.value = submitter.value;
      tempbutton.type = "hidden";
      this.node.appendChild(tempbutton);
    }

    try
    {
      if(!dompack.dispatchCustomEvent(this.node, 'wh:form-beforesubmit',{ bubbles:true, cancelable:true })) //allow parsley to hook into us
        return; //we expect parsley to invoke _doSubmit through wh:form-dosubmit

      await this._doSubmit(evt, extradata);
    }
    finally
    {
      dompack.remove(tempbutton);
    }
  }

  //reset any serverside generated errors (generally done when preparing a new submission)
  resetServerSideErrors()
  {
    for(let field of Array.from(this.node.querySelectorAll(anyinputselector)))
    {
      if(field.propWhSetFieldError && field.propWhErrorServerSide)
        field.propWhCleanupFunction();
    }

  }

  async _doSubmit(evt, extradata)
  {
    if(evt)
      evt.preventDefault();

    let lock = dompack.flagUIBusy({ ismodal: true, component: this.node });
    this._submitstart = Date.now();
    if(this._formhandling && this._formhandling.warnslow)
      this._submittimeout = setTimeout(() => this._submitHasTimedOut(), this._formhandling.warnslow);

    this.node.classList.add('wh-form--submitting');

    try
    {
      this.resetServerSideErrors();

      let validationresult = await this.validate();
      if(validationresult.valid)
      {
        let result = await this.submit(extradata);
        if (result.result && result.result.submittype && result.result.submittype != this._getVariableValueForConditions("formsubmittype"))
        {
          this.node.setAttribute("data-wh-form-var-formsubmittype", result.result.submittype);
          this._updateConditions(false);
        }
      }
      else
      {
        this.sendFormEvent('publisher:formfailed', { ds_formmeta_errorfields: getErrorFields(validationresult)
                                                   , ds_formmeta_errorsource: 'client'
                                                   , dn_formmeta_waittime: Date.now() - this._submitstart
                                                 });
      }
    }
    finally
    {
      lock.release();
      this.node.classList.remove('wh-form--submitting');
      if(this._submittimeout)
      {
        clearTimeout(this._submittimeout);
        this._submittimeout = 0;
      }
    }
  }

  _submitHasTimedOut() //TODO extend this to (background) RPCs too, and make waitfor more specific. also check whether we're stuck on client or server side
  {
    this.sendFormEvent('publisher:formslow', { dn_formmeta_waittime: Date.now() - this._submitstart
                                             , ds_formmeta_waitfor: "submit"
                                             });
    this._submittimeout = 0;
  }

  //default submission function. eg. RPC will override this
  async submit()
  {
    this.node.submit();
  }

  _onTakeFocus(evt)
  {
    let containingpage = dompack.closest(evt.target,'.wh-form__page');
    if(containingpage && containingpage.classList.contains('wh-form__page--hidden'))
    {
      //make sure the page containing the errored component is visible
      let pagenum = dompack.qSA(this.node, '.wh-form__page').findIndex(page => page == containingpage);
      if(pagenum >= 0)
        this.gotoPage(pagenum);
    }
  }

  _checkClick(evt)
  {
    let actionnode = dompack.closest(evt.target, "*[data-wh-form-action]");
    if(!actionnode)
    {
      let submitter = dompack.closest(evt.target, submitselector);
      if(submitter)
      {
        this._submitter = submitter; //store as submitter in case a submit event actually occurs
        setTimeout(() => this._submitter = null); //but clear it as soon as event processing ends
      }
      return;
    }

    dompack.stop(evt);
    this.executeFormAction(actionnode.dataset.whFormAction);
  }

  _getPageState()
  {
    let pages = dompack.qSA(this.node, '.wh-form__page');
    let curpage = pages.findIndex(page => !page.classList.contains('wh-form__page--hidden'));
    return { pages, curpage };
  }

  _updatePageVisibility(pagelist, currentpage)
  {
    pagelist.forEach( (page,idx) =>
    {
      dompack.toggleClass(page, 'wh-form__page--hidden', idx != currentpage);
      dompack.toggleClass(page, 'wh-form__page--visible', idx == currentpage);
    });
  }

  ///Get the currently opened page (page node)
  getCurrentPage()
  {
    let state = this._getPageState();
    return state.curpage >= 0 ? state.pages[state.curpage] : null;
  }

  scrollToFormTop()
  {
    let firstgroup = this.node.querySelector('.wh-form__page--visible .wh-form__fieldgroup:not(.wh-form__fieldgroup--hidden)');
    this._scrollIntoView(firstgroup || this.node);
  }

  async gotoPage(pageidx)
  {
    let state = this._getPageState();
    if(state.curpage == pageidx)
      return;
    if (pageidx < 0 || pageidx >= state.pages.length)
      throw new Error(`Cannot navigate to nonexisting page #${pageidx}`);

    let goingforward = pageidx > state.curpage;
    this.sendFormEvent(goingforward ? 'publisher:formnextpage' : 'publisher:formpreviouspage'
                      , { dn_formmeta_targetpagenum: pageidx + 1
                        , ds_formmeta_targetpagetitle: this._getPageTitle(pageidx)
                        });

    this._updatePageVisibility(state.pages, pageidx);
    if(goingforward) //only makes sense to update if we're making progress
      merge.run(state.pages[pageidx], { form: await this.getFormValue() });

    this._updatePageNavigation();

    //scroll back up
    this.scrollToFormTop();

    /* tell the page it's now visible - note that we specifically don't fire this on init, as it's very likely
       users would 'miss' the event anyway - registerHandler usually executes faster than your wh:form-pagechange
       registrations, if you wrapped those in a dompack.register */
    dompack.dispatchCustomEvent(state.pages[pageidx], "wh:form-pagechange", { bubbles: true, cancelable: false });
  }

  _getDestinationPage(pagestate, direction)
  {
    let pagenum = pagestate.curpage + direction;
    while (pagenum >= 0 && pagenum < pagestate.pages.length && pagestate.pages[pagenum].propWhFormCurrentVisible === false)
      pagenum = pagenum + direction;
    if (pagenum < 0 || pagenum >= pagestate.pages.length)
      return -1;
    return pagenum;
  }

  _getPageTitle(pagenum)
  {
    let pagenode = this._getPageState().pages[pagenum];
    if(!pagenode)
      return "";
    return pagenode.dataset.whFormPagetitle || ("#" + (pagenum+1));
  }

  async executeFormAction(action)
  {
    switch(action)
    {
      case 'previous':
      {
        if(this.node.classList.contains('wh-form--allowprevious'))
        {
          this.gotoPage(this._getDestinationPage(this._getPageState(), -1));
        }
        return;
      }
      case 'next':
      {
        let pagestate = this._getPageState();
        if(this.node.classList.contains('wh-form--allownext'))
        {
          this.resetServerSideErrors();

          let validationstatus = await this.validate(pagestate.pages[pagestate.curpage]);
          if(validationstatus.valid)
          {
            this.gotoPage(this._getDestinationPage(pagestate, +1));
          }
          else
          {
            this.sendFormEvent('publisher:formfailed', { ds_formmeta_errorfields: getErrorFields(validationstatus)
                                                       , ds_formmeta_errorsource: 'nextpage'
                                                       });
          }
        }
        return;
      }
      default:
      {
        console.error(`Unknown form action '${action}'`);
      }
    }
  }

  async refreshConditions()
  {
    await this._updateConditions(false);
  }

  _onInputChange(evt)
  {
    if(!this._firstinteraction)
      this.sendFormEvent("publisher:formstarted");

    this._updateConditions(false);
  }

  async _updateConditions(isinit)
  {
    // Check pages visibility
    let hiddenPages = [];
    let mergeNodes = [];
    let anychanges = false;

    for (let formpage of dompack.qSA(this.node, ".wh-form__page"))
    {
      let visible = true;
      if (formpage.dataset.whFormVisibleIf)
      {
        visible = this._matchesCondition(formpage.dataset.whFormVisibleIf);
        if (!visible)
          hiddenPages.push(formpage); // We don't have to check fields on this page any further

        if (visible != formpage.propWhFormCurrentVisible)
        {
          anychanges = true;
          formpage.propWhFormCurrentVisible = visible;
          mergeNodes.push(formpage);
        }
      }
    }
    if (anychanges)
      this._updatePageNavigation();

    let tovalidate = [];
    let hiddengroups = [], enabledgroups = [], requiredgroups = [];
    for (let formgroup of dompack.qSA(this.node, ".wh-form__fieldgroup"))
    {
      let visible = !hiddenPages.includes(dompack.closest(formgroup, ".wh-form__page"))
          && this._matchesCondition(formgroup.dataset.whFormVisibleIf);

      if(!visible)
        hiddengroups.push(formgroup);

      let enabled = visible
          && this._matchesCondition(formgroup.dataset.whFormEnabledIf);

      if(enabled)
        enabledgroups.push(formgroup);

      //load initial status?
      if(formgroup.propWhFormInitialRequired === undefined)
        formgroup.propWhFormInitialRequired = formgroup.classList.contains("wh-form__fieldgroup--required");

      let required = enabled
                     && (formgroup.dataset.whFormRequiredIf ? this._matchesCondition(formgroup.dataset.whFormRequiredIf) : formgroup.propWhFormInitialRequired);

      if(required)
        requiredgroups.push(formgroup);

      if (visible !== formgroup.propWhFormCurrentVisible // These are initially undefined, so this code will always run first time
          || enabled !== formgroup.propWhFormCurrentEnabled
          || required !== formgroup.propWhFormCurrentRequired)
      {
        formgroup.propWhFormCurrentVisible = visible;
        formgroup.propWhFormCurrentEnabled = enabled;
        formgroup.propWhFormCurrentRequired = required;

        dompack.toggleClass(formgroup, "wh-form__fieldgroup--hidden", !visible);
        dompack.toggleClass(formgroup, "wh-form__fieldgroup--disabled", !enabled);
        dompack.toggleClass(formgroup, "wh-form__fieldgroup--required", required);

        mergeNodes.push(formgroup);
      }
    }

    for(let formline of dompack.qSA(this.node, ".wh-form__fieldline"))
    {
      let formgroup = dompack.closest(formline, ".wh-form__fieldgroup");
      let visible = !hiddengroups.includes(formgroup) && this._matchesCondition(formline.dataset.whFormVisibleIf);
      let enabled = visible && enabledgroups.includes(formgroup) && this._matchesCondition(formline.dataset.whFormEnabledIf);
      let required = enabled && requiredgroups.includes(formgroup);

      if (visible !== formline.propWhFormlineCurrentVisible) // These are initially undefined, so this code will always run first time
      {
        formline.propWhFormlineCurrentVisible = visible;
        dompack.toggleClass(formline, "wh-form__fieldline--hidden", !visible);
      }

      // Look for nodes that are explicit enable state (enablee/require) listeners, or that need to do so because they're real input controls
      let inputtargets = dompack.qSA(formline, "[data-wh-form-state-listener='true'],input,select,textarea");

      for (let node of inputtargets)
      {
        //Record initial states
        if (node.propWhFormSavedEnabled === undefined)
          node.propWhFormSavedEnabled = !node.disabled && !("whFormDisabled" in node.dataset);

        if (node.propWhFormSavedRequired === undefined)
          node.propWhFormSavedRequired = !!node.required;

        // The field is enabled if all of these are matched:
        // - we're setting it to enabled now
        // - it hasn't been disabled explicitly (set initially on the node)
        // - it hasn't been disabled through enablecomponents
        let node_enabled = enabled && node.propWhFormSavedEnabled && this._matchesCondition(node.dataset.whFormEnabledIf);

        if(node_enabled !== node.propWhNodeCurrentEnabled)
        {
          node.propWhNodeCurrentEnabled = node_enabled;

          // Give the formgroup a chance to handle it
          if (dompack.dispatchCustomEvent(node, "wh:form-enable", { bubbles: true, cancelable: true, detail: { enabled: node_enabled }}))
          {
            // Not cancelled, so run our default handler
            if(node.matches("input,select,textarea")) //For true html5 inputs we'll use the native attributes. formstatelisteners: we use data attributes
              node.disabled = !node_enabled;
            else if(node_enabled)
              node.removeAttribute("data-wh-form-disabled");
            else
              node.setAttribute("data-wh-form-disabled","");
          }

          if (!isinit && !node_enabled && !tovalidate.includes(node))
            tovalidate.push(node); // to clear errors for this disabled field
        }

        let node_required = (node.propWhFormSavedRequired || required) && node_enabled && visible;
        if(node.propWhNodeCurrentRequired !== node_required)
        {
          node.propWhNodeCurrentRequired = node_required;

          // Give the formgroup a chance to handle it
          if (dompack.dispatchCustomEvent(node, "wh:form-require", { bubbles: true, cancelable: true, detail: { required: node_required }}))
          {
            // Not cancelled, so run our default handler
            if(node.matches("input,select,textarea")) //For true html5 inputs we'll use the native attributes. formstatelisteners: we use data attributes
            {
              if(node.type != 'checkbox') //don't set required on checkboxes, that doesn't do what you want
                node.required = node_required;
            }
            else if(node_required)
              node.setAttribute("data-wh-form-required","");
            else
              node.removeAttribute("data-wh-form-required");
          }

          if (!isinit && !node_required && formgroup.classList.contains("wh-form__fieldgroup--error") && !tovalidate.includes(node))
            tovalidate.push(node); // to clear errors for this now optional field
        }
      }
    }

    for(let option of dompack.qSA(this.node, ".wh-form__fieldgroup select > option"))
    {
      let formgroup = dompack.closest(option, ".wh-form__fieldgroup");
      let visible = !hiddengroups.includes(formgroup) && this._matchesCondition(option.dataset.whFormVisibleIf);
      let enabled = visible && enabledgroups.includes(formgroup);

      //Record initial states
      if (option.propWhFormSavedEnabled === undefined)
        option.propWhFormSavedEnabled = !option.disabled;

      let option_enabled = enabled && option.propWhFormSavedEnabled;

      if(option_enabled !== option.propWhNodeCurrentEnabled)
      {
        option.propWhNodeCurrentEnabled = option_enabled;
        option.disabled = !option_enabled;
        // If this option was the selected option, but is now disabled, reset the select's value
        // FIXME option.parentNode will fail with optgroups, but so will this for() loop... formsapi supports <optgroup> but fortunately the formwebtool doesn't expose it yet
        if (option.disabled && option.selected)
          option.parentNode.selectedIndex = -1;

        if (!isinit && !tovalidate.includes(option.parentNode))
          tovalidate.push(option.parentNode); // to clear errors for this option's select field
      }
    }

    if (tovalidate.length)
      await this.validate(tovalidate, { focusfailed: false, iffailedbefore: true });

    this.fixupMergeFields(mergeNodes);
  }

  async fixupMergeFields(nodes)
  {
    // Rename the data-wh-merge attribute to data-wh-dont-merge on hidden pages and within hidden formgroups to prevent
    // merging invisible nodes
    // FIXME 'merge' has a filter option now - convert to that!
    let formvalue = await this.getFormValue();
    for (let node of nodes)
    {
      if (node.propWhFormCurrentVisible)
      {
        for(let mergeNode of dompack.qSA(node, '*[data-wh-dont-merge]'))
        {
          mergeNode.dataset.merge = mergeNode.dataset.whDontMerge;
          mergeNode.removeAttribute("data-wh-dont-merge");
        }
        merge.run(node, { form: formvalue });
      }
      else
      {
        for(let mergeNode of dompack.qSA(node, '*[data-merge]'))
        {
          mergeNode.dataset.whDontMerge = mergeNode.dataset.merge;
          mergeNode.removeAttribute("data-merge");
        }
      }
    }
  }

  _matchesCondition(conditiontext)
  {
    if(!conditiontext)
      return true;

    let condition = JSON.parse(conditiontext).c;
    return this._matchesConditionRecursive(condition);
  }

  _getConditionRawValue(fieldname)
  {
    if(this.node.hasAttribute("data-wh-form-var-" + fieldname))
      return this.node.getAttribute("data-wh-form-var-" + fieldname);

    let matchfield = this.elements[fieldname];
    if(!matchfield)
    {
      console.error(`No match for conditional required field '${fieldname}'`);
      return null;
    }

    if (isNodeCollection(matchfield))
    {
      let currentvalue = null;

      for (let field of matchfield)
        if (this._isNowSettable(field) && field.checked)
        {
          if (field.type != "checkbox")
            return field.value;

          if(!currentvalue)
            currentvalue = [];
          currentvalue.push(field.value);
        }
      return currentvalue;
    }
    else
    {
      //Can we set this field?
      if(!this._isNowSettable(matchfield))
        return null;
    }

    if (matchfield.type == "checkbox")
      return matchfield.checked ? [ matchfield.value ] : null;

    if (matchfield.type == "radio")
      return matchfield.checked ? matchfield.value : null;

    return matchfield.value;
  }

  _getVariableValueForConditions(conditionfield)
  {
    let fields = conditionfield.split("$");
    let currentvalue = this._getConditionRawValue(fields[0]);
    if(fields.length === 1 || currentvalue === null) //no subs to process
      return currentvalue;

    // Look for an extrafield match
    let matchfield = this.elements[fields[0]];
    if (!matchfield)
    {
      console.error(`No match for conditional required field '${conditionfield}'`);
      return null;
    }

    if (matchfield.nodeName == "SELECT")
    {
      if (Array.isArray(currentvalue))
      {
        let selectedvalue = currentvalue;
        currentvalue = [];
        for (let val of selectedvalue)
        {
          let selected = dompack.qS(matchfield, `option[value="${val}"]`);
          if(!selected.dataset.__extrafields)
            return null;
          let extrafields = JSON.parse(selected.dataset.__extrafields);
          currentvalue.push(extrafields[fields[1]]);
        }
      }
      else
      {
        let selected = dompack.qS(matchfield, `option[value="${currentvalue}"]`);
        if(!selected.dataset.__extrafields)
          return null;
        let extrafields = JSON.parse(selected.dataset.__extrafields);
        currentvalue = extrafields[fields[1]];
      }
      return currentvalue;
    }
    else
    {
      console.error("Subfield matching not supported for non-select fields");
      return null;
    }
  }


  _matchesConditionRecursive(condition)
  {
    if (condition.matchtype == "AND")
    {
      for (let subcondition of condition.conditions)
        if (!this._matchesConditionRecursive(subcondition))
          return false;
      return true;
    }
    else if (condition.matchtype == "OR")
    {
      for (let subcondition of condition.conditions)
        if (this._matchesConditionRecursive(subcondition))
          return true;
      return false;
    }
    else if (condition.matchtype == "NOT")
    {
      return !this._matchesConditionRecursive(condition.condition);
    }

    let currentvalue = this._getVariableValueForConditions(condition.field);

    if(condition.matchtype == "HASVALUE")
      return !!currentvalue == !!condition.value;

    if([ "IN", "HAS", "IS" ].includes(condition.matchtype))
    {
      let matchcase = !condition.options || condition.options.matchcase !== false; // Defaults to true
      let compareagainst = Array.isArray(condition.value) ? condition.value : condition.value ? [ condition.value ] : [];

      if (!Array.isArray(currentvalue))
        currentvalue = currentvalue ? [ currentvalue ] : [];

      // If the match is not case-sensitive, the condition value is already uppercased, so we only have to uppercase the
      // current value(s) when checking
      if (!matchcase)
        currentvalue = currentvalue.map(value => value.toUpperCase());

      // The current value and the condition value should (at least) overlap
      if (!currentvalue.some(value => compareagainst.includes(value)))
        return false;

      // For "HAS" and "IS" conditions, all of the required values should be selected (there shouldn't be required values
      // that are not selected)
      if ((condition.matchtype == "HAS" || condition.matchtype == "IS") && compareagainst.some(value => !currentvalue.includes(value)))
        return false;

      // For an "IS" condition, all of the selected values should be required (there shouldn't be selected values that are
      // not required)
      if (condition.matchtype == "IS" && currentvalue.some(value => !compareagainst.includes(value)))
        return false;

      return true;
    }

    return console.error(`No support for conditional type '${condition.matchtype}'`), false;
  }

  _updatePageNavigation()
  {
    let pagestate = this._getPageState();
    let nextpage = this._getDestinationPage(pagestate, +1);
    let morepages = nextpage != -1;
    let curpagerole = pagestate.pages[pagestate.curpage] ? pagestate.pages[pagestate.curpage].dataset.whFormPagerole : '';
    let nextpagerole = morepages ? pagestate.pages[nextpage].dataset.whFormPagerole : "";

    dompack.toggleClasses(this.node, { "wh-form--allowprevious": pagestate.curpage > 0 && curpagerole != 'thankyou'
                                     , "wh-form--allownext":     morepages && nextpagerole != 'thankyou'
                                     , "wh-form--allowsubmit":   curpagerole != 'thankyou' && (!morepages || nextpagerole == 'thankyou')
                                     });
  }

  _navigateToThankYou(richvalues)
  {
    let state = this._getPageState();
    if(state.curpage >= 0)
    {
      let nextpage = this._getDestinationPage(state, +1);
      if (nextpage != -1 && state.pages[nextpage] && state.pages[nextpage].dataset.whFormPagerole == 'thankyou')
      {
        if (state.pages[nextpage].dataset.whFormPageredirect)
          executeSubmitInstruction({ type: "redirect", url: state.pages[nextpage].dataset.whFormPageredirect });
        else
        {
          if (richvalues)
          {
            for (let {field,value} of richvalues)
            {
              let node = state.pages[nextpage].querySelector(`.wh-form__fieldgroup--richtext[data-wh-form-group-for="${field}"] .wh-form__richtext`);
              if (node)
              {
                node.innerHTML = value;
                dompack.registerMissed(node);
              }
            }
          }
          this.gotoPage(nextpage);
        }
      }
    }
  }

  /* Override this to overwrite the processing of individual fields. Note that
     radio and checkboxes are not passed through getFieldValue, and that
     getFieldValue may return undefined or a promise. */
  async getFieldValue(field)
  {
    if(field.hasAttribute('data-wh-form-name') || field.whUseFormGetValue)
    {
      //create a deferred promise for the field to fulfill
      let deferred = dompack.createDeferred();
      //if cancelled, we'll assume the promise is taken over
      if(!dompack.dispatchCustomEvent(field, 'wh:form-getvalue', { bubbles:true, cancelable:true, detail: { deferred } }))
        return deferred.promise;
    }
    if(field.nodeName == 'INPUT' && field.type == 'file')
    {
      //FIXME multiple support
      if(field.files.length==0)
        return null;

      let dataurl = await compatupload.getFileAsDataURL(field.files[0]);
      return { filename: field.files[0].name.split('\\').join('/').split('/').pop() //ensure we get the last part
             , link: dataurl
             };
      // return Promise.all(Array.from(field.files).map(async function(fileobject)
      //          {
      //            let dataurl = await compatupload.getFileAsDataURL(fileobject);
      //            return { filename: fileobject.name.split('\\').join('/').split('/').pop() //ensure we get the last part
      //                   , dataurl: dataurl
      //                   };
      //          }));
    }
    return field.value;
  }

  /* Override this to overwrite the processing of radios and checkboxes. */
  getMultifieldValue(name, fields)
  {
    return fields.map(node => node.value);
  }

  /* Override this to overwrite the setting of individual fields. In contrast
     to getFieldValue, this function will also be invoked for radio and checkboxes */
  setFieldValue(fieldnode, value)
  {
    if(fieldnode.hasAttribute('data-wh-form-name'))
    {
      if (!dompack.dispatchCustomEvent(fieldnode, 'wh:form-setvalue', { bubbles:true, cancelable:true, detail: { value } }))
        return;
      // Event is not cancelled, set node value directly
    }
    if(dompack.matches(fieldnode, 'input[type=radio], input[type=checkbox]'))
    {
      dompack.changeValue(fieldnode, !!value);
      return;
    }
    dompack.changeValue(fieldnode, value);
  }

  _isPartOfForm(el)
  {
    if(!el.hasAttribute("form"))
      return true;
    if(this.node.id && el.getAttribute("form").toUpperCase() == this.node.id.toUpperCase())
      return true;
    return false;
  }

  _queryAllFields(options)
  {
    let foundfields = [];
    let startnode = options && options.startnode ? options.startnode : this.node;
    let skiparraymembers = options && options.skiparraymembers;

    for(let field of Array.from(startnode.querySelectorAll(anyinputselector)))
    {
      if(options && field == options.skipfield) //arrayfield.es needs it
        continue;
      if(!this._isPartOfForm(field))
        continue;
      if (options && options.onlysettable && !this._isNowSettable(field))
        continue;
      if(skiparraymembers && field.closest(".wh-form__arrayrow"))
        continue;

      let name = field.dataset.whFormName || field.name;
      if(!name)
        continue;

      let addto = foundfields.find(_ => _.name == field.name);
      if(field.type == 'radio' || field.type == 'checkbox') //expect multiple inputs with this name?
      {
        if(!addto)
        {
          addto = { name: name, multi: true, nodes: [] };
          foundfields.push(addto);
        }
        addto.nodes.push(field);
      }
      else
      {
        if(addto)
        {
          console.error(`[fhv] Encountered duplicate field '${name}'`, field);
          continue;
        }

        foundfields.push({ name: name, multi: false, node: field });
      }
    }

    return foundfields;
  }

  /** Return the names of all form elements */
  getFormElementNames()
  {
    return this._queryAllFields().map(_ => _.name);
  }

  /** getValue from a field as returned by _queryAllFields (supporting both multilevel and plain fields)
      @return promise */
  _getQueryiedFieldValue(field)
  {
    if(!field.multi)
      return this.getFieldValue(field.node);

    let fields = field.nodes.filter(node => node.checked);
    return this.getMultifieldValue(field.name, fields);
  }

  /** Return a promise resolving to the submittable form value */
  getFormValue(options)
  {
    return new Promise( (resolve,reject) =>
    {
      let outdata = {};
      let fieldpromises = [];

      for(let field of this._queryAllFields({ onlysettable:true, skiparraymembers: true }))
        this._processFieldValue(outdata, fieldpromises, field.name, this._getQueryiedFieldValue(field));

      Promise.all(fieldpromises).then( () => resolve(outdata)).catch( e => reject(e));
    });
  }

  _isNowSettable(node)
  {
    // If the node is disabled, it's not settable
    if (node.disabled)
      return false;

    // If the node's field group is disabled or hidden, it's not settable
    let formgroup = dompack.closest(node, ".wh-form__fieldgroup");
    if (formgroup)
    {
      if (formgroup.classList.contains("wh-form__fieldgroup--disabled"))
        return false;
      if (formgroup.classList.contains("wh-form__fieldgroup--hidden"))
        return false;
    }

    // If the node's form page is hidden dynamically, it's not settable
    let formpage = dompack.closest(node, ".wh-form__page");
    if (formpage)
    {
      if (formpage.propWhFormCurrentVisible === false)
        return false;
    }
    // The node is settable
    return true;
  }

  _processFieldValue(outdata, fieldpromises, fieldname, receivedvalue)
  {
    if(receivedvalue === undefined)
      return;
    if(receivedvalue.then)
    {
      fieldpromises.push(new Promise( (resolve,reject) =>
      {
        receivedvalue.then( result =>
        {
          if(result !== undefined)
            outdata[fieldname] = result;

          resolve();
        }).catch(e => reject(e));
      }));
    }
    else
    {
      outdata[fieldname] = receivedvalue;
    }
  }

  //get the option lines associated with a specific radio/checkbox group
  getOptions(name)
  {
    let nodes = this.node.elements[name];
    if(!nodes)
      return [];
    if(nodes.length === undefined)
      nodes = [nodes];

    return Array.from(nodes).map(node => ({ inputnode: node
                                          , fieldline: dompack.closest(node, '.wh-form__fieldline')
                                          , value: node.value
                                          }));
  }

  /** gets the selected option associated with a radio/checkbox group as an array
      */
  getSelectedOptions(name)
  {
    let opts = this.getOptions(name);
    opts = opts.filter(node => node.inputnode.checked);
    return opts;
  }

  /** get the selected option associated with a radio/checkbox group. returns an object that's either null or the first selected option
      */
  getSelectedOption(name)
  {
    let opts = this.getSelectedOptions(name);
    return opts.length ? opts[0] : null;
  }

  /** get the fieldgroup for an element */
  getFieldGroup(name)
  {
    let node = this.node.elements[name];
    if(!node)
      return null;

    if(node.length !== undefined)
      node = node[0];

    return dompack.closest(node, '.wh-form__fieldgroup');
  }

  /** get the values of the currently selected radio/checkbox group */
  getValues(name)
  {
    return this.getSelectedOptions(name).map(node=>node.value);
  }
  /** get the value of the first currently selected radio/checkbox group */
  getValue(name)
  {
    let vals = this.getValues(name);
    return vals.length ? vals[0] : null;
  }

  setFieldError(field, error, options)
  {
    FormBase.setFieldError(field,error,options);
  }

  _getErrorForValidity(field,validity)
  {
    if(validity.customError && field.validationMessage)
      return field.validationMessage;

    if(validity.valueMissing)
      return getTid("publisher:site.forms.commonerrors.required");
    if(validity.rangeOverflow)
      return getTid("publisher:site.forms.commonerrors.max", field.max);
    if(validity.rangeUnderflow)
      return getTid("publisher:site.forms.commonerrors.min", field.min);
    if(validity.badInput)
      return getTid("publisher:site.forms.commonerrors.default");
    if(validity.tooShort)
      return getTid("publisher:site.forms.commonerrors.minlength", field.minLength);
    if(validity.tooLong)
      return getTid("publisher:site.forms.commonerrors.maxlength", field.maxLength);
    if(validity.typeMismatch)
      if(["email", "url", "number"].includes(field.type))
        return getTid("publisher:site.forms.commonerrors." + field.type);

    for(let key of ["badInput", "customError", "patternMismatch", "rangeOverflow", "rangeUnderflow", "stepMismatch", "typeMismatch", "valueMissing"])
      if(validity[key])
        return key;

    return '?';
  }

  async validateSingleFormField(field)
  {
    return true;
  }

  async _validateSingleFieldOurselves(field)
  {
    let alreadyfailed = false;

    //browser checks go first, any additional checks are always additive (just disable browserchecks you don't want to apply)
    field.propWhFormNativeError = false;
    if(!alreadyfailed && field.checkValidity && !field.hasAttribute("data-wh-form-skipnativevalidation"))
    {
      let validitystatus = field.checkValidity();
      if(this._dovalidation)  //we're handling validation UI ourselves
      {
        //we need a separate prop for our errors, as we shouldn't clear explicit errors
        field.propWhValidationError = validitystatus ? '' : this._getErrorForValidity(field, field.validity);
      }
      if(!validitystatus)
      {
        field.propWhFormNativeError = true;
        alreadyfailed = true;
      }
    }

    if(!alreadyfailed && field.whFormsBuiltinChecker)
    {
      if(!(await field.whFormsBuiltinChecker(field)))
        alreadyfailed = true;
    }

    if(!alreadyfailed && !(await this.validateSingleFormField(field)))
      alreadyfailed = true;

    if(!alreadyfailed && field.whFormsApiChecker && this._dovalidation)
      field.whFormsApiChecker();

    return this._reportFieldValidity(field);
  }

  /** validate the form
      @param limitset A single element, nodelist or array of elements to validate (or their children)
      @param options.focusfailed Focus the first invalid element (defaults to true)
      @return a promise that will fulfill when the form is validated
      @cell return.valid true if the fields successfuly validated  */
  async validate(limitset, options)
  {
    if(dompack.debugflags.fdv)
    {
      console.warn(`[fdv] Validation of form was skipped`);
      return { valid: true, failed: [], firstfailed: null };
    }

    let tovalidate; //fields to validate
    if(!limitset) //no limit specified
    {
      tovalidate = Array.from(this.node.querySelectorAll(anyinputselector)).filter(node => this._isPartOfForm(node));
    }
    else
    {
      tovalidate = [];
      let checklist = Array.isArray(limitset) ? limitset : [limitset];
      checklist.forEach(node =>
      {
        if(dompack.matches(node, anyinputselector))
          tovalidate.push(node);
        tovalidate = tovalidate.concat(Array.from(node.querySelectorAll(anyinputselector)));
      });

      //If we need to validate a radio, validate all radios in their group so we can properly clear their error classes
      tovalidate.filter(node => node.name && node.type == "radio").forEach(node =>
      {
        let siblings = dompack.qSA(this.node, `input[name="${node.name}"]`);
        tovalidate = tovalidate.concat(siblings.filter(sibling => !tovalidate.includes(sibling)));
      });
    }

    if(options && options.iffailedbefore)
      tovalidate = tovalidate.filter(node => hasEverFailed(node));

    let lock = dompack.flagUIBusy();
    try
    {
      if(!tovalidate.length)
        return { valid: true, failed: [], firstfailed: null };

      let deferred = dompack.createDeferred();
      let result;
      let validationcancelled;

      if(dompack.dispatchCustomEvent(this.node, 'wh:form-validate', { bubbles:true, cancelable:true, detail: { tovalidate: tovalidate, deferred: deferred } }))
      {
        //not cancelled, carry out the validation ourselves.
        let validationresults = await Promise.all(tovalidate.map(fld => this._validateSingleFieldOurselves(fld)));
        //remove the elements from validate for which the promise failed
        let failed = tovalidate.filter( (fld,idx) => !validationresults[idx]);
        result = { valid: failed.length == 0
                 , failed: failed
                 };
      }
      else
      {
        validationcancelled = true;
        result = await deferred.promise; //then we expect the validator to sort it all out
      }

      result.firstfailed = result.failed.length ? result.failed[0] : null;
      if(result.firstfailed && (!options || options.focusfailed))
      {
        //FIXME shouldn't getFocusableComponents also return startnode if focusable?
        let tofocus = domfocus.canFocusTo(result.firstfailed) ? result.firstfailed : domfocus.getFocusableComponents(result.firstfailed)[0];
        if(tofocus)
          dompack.focus(tofocus, { preventScroll:true });

        if(!this._dovalidation && !validationcancelled)
          reportValidity(tofocus);

        this._scrollIntoView(result.firstfailed);
      }

      if(dompack.debugflags.fhv)
        console.log(`[fhv] Validation of ${tovalidate.length} fields done, ${result.failed.length} failed`, result);

      return result;
    }
    finally
    {
      lock.release();
    }
  }

  _scrollIntoView(scrollto)
  {
    let group = scrollto.closest('.wh-form__fieldgroup');
    if(group)
    {
      let groupanchor = group.querySelector('.wh-anchor');
      if(groupanchor)
        scrollto = groupanchor;
    }
    dompack.scrollIntoView(scrollto);
  }

  reset()
  {
    this.node.reset();
  }

}

FormBase.getForNode = function(node)
{
  return node.propWhFormhandler || null;
};

FormBase.setFieldError = setFieldError;
FormBase.setupValidator = setupValidator;
