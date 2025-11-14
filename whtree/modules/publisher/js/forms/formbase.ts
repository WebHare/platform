/* eslint-disable @typescript-eslint/no-floating-promises -- FIXME: needs API rework */

import * as dompack from '@webhare/dompack';
import { type DocEvent, type FormControlElement, type TakeFocusEvent, addDocEventListener, isFormControl } from '@webhare/dompack';
import * as domfocus from 'dompack/browserfix/focus';
import * as webharefields from './internal/webharefields';
import * as merge from './internal/merge';
import './internal/requiredstyles.css';
import { type SetFieldErrorData, getValidationState, setFieldError, setupValidator, updateFieldError } from './internal/customvalidation';
import { generateRandomId, isPromise, wrapSerialized } from '@webhare/std';
import { debugFlags, isLive, navigateTo, type NavigateInstruction } from '@webhare/env';
import { getFieldDisplayName, isFieldNativeErrored, isRadioOrCheckbox, isRadioNodeList, type ConstrainedRadioNodeList, parseCondition, getFormElementCandidates, isFormFieldLike, queryFormFieldLike, getFieldName } from '@webhare/forms/src/domsupport';
import { rfSymbol } from '@webhare/forms/src/registeredfield';
import type { FormAnalyticsEventData, FormAnalyticsSubEvents, FormCondition, FormFileValue, RPCFormMessage } from '@webhare/forms/src/types';
import { FieldMapDataProxy, FormFieldMap } from '@webhare/forms/src/fieldmap';
import { submitselector, type SubmitSelectorType } from '@webhare/dompack/src/browser';
import type { FormSubmitDetails } from './rpc';

//Suggestion or error messages
export type FormFrontendMessage = HTMLElement | string;

declare global {
  interface HTMLElement {
    //TODO Clean this up, these are internal. Move to a weakobject ?
    propWhFormSavedRequired?: boolean;
    propWhFormSavedEnabled?: boolean;
    propWhFormSavedHidden?: boolean;
    //TODO And how does this differ from propWhFormSavedRequired?
    propWhFormInitialRequired?: boolean;
    propWhFormCurrentEnabled?: boolean;
    propWhFormCurrentRequired?: boolean;
    propWhFormCurrentVisible?: boolean;
    //TODO It's suspicious that both propWhFormCurrent... and propWhNodeCurrent... exist
    propWhNodeCurrentEnabled?: boolean;
    propWhNodeCurrentRequired?: boolean;
    propWhNodeCurrentHidden?: boolean;
    propWhFormlineCurrentVisible?: boolean;
    propWhValidationSuggestion?: FormFrontendMessage | null;
    propWhCleanupFunction?: () => void;
    /** @deprecated Use `getFormHandler` or `getFormData` from `@webhare/forms` to access the form's API */
    propWhFormhandler?: FormBase<object>;
    whFormsApiChecker?: () => Promise<void> | void;
    whUseFormGetValue?: boolean;
    whValidationPolyfilled?: boolean;
    __didPlaceholderWarning?: boolean;
  }

  interface GlobalEventHandlersEventMap {
    "wh:form-enable": CustomEvent<{ enabled: boolean }>;
    "wh:form-require": CustomEvent<{ required: boolean }>;
    "wh:form-getvalue": CustomEvent<{ deferred: PromiseWithResolvers<unknown> }>;
    "wh:form-setfielderror": CustomEvent<SetFieldErrorData>; //TODO can we phase this out? it's a too deep integration
    "wh:form-pagechange": CustomEvent<{
      formHandler: FormBase<object>;
      /** TODO Add numPages and currentPage, but we'd need to figure out how to properly account for Captcha pages (you don't want either numPages or currentPage to count that one)
      numPages: number;
      currentPage: number;
      */
    }>;
    "wh:form-preparesubmit": CustomEvent<{ extrasubmit: Record<string, unknown> }>;
    "wh:form-response": CustomEvent<FormSubmitResult>;
    "wh:form-submitted": CustomEvent<FormSubmitDetails>;
  }
}

type ExtraData = unknown;

type FormControlDescription = {
  name: string;
  multi: false;
  node: HTMLElement;
} | {
  name: string;
  multi: true;
  nodes: HTMLInputElement[];
};

export type FormResultValue = Record<string, unknown>;

/** The result returned to onSubmitSuccess */
export type FormSubmitEmbeddedResult<UserResult = { [key: string]: unknown }> = UserResult & {
  //webtool submit additions. TODO a future API shouldn't mix these at the same level but allow them in the FormSubmitResult
  submittype?: string;
  richvalues?: RichValues;
  resultsguid?: string;
  submitinstruction?: NavigateInstruction;
};

export interface FormSubmitMessage {
  name: string;
  message: string;
  metadata: unknown;
}

export interface FormSubmitResult {
  success: boolean;
  //TODO a next form iteration should not mix all these additional props into the form user's 'result'
  result: FormSubmitEmbeddedResult;
  errors: FormSubmitMessage[];
  warnings: FormSubmitMessage[];
  messages: RPCFormMessage[];
}

type RichValues = Array<{ field: string; value: string }>;

export interface FieldErrorOptions {
  serverside: boolean;
  reportimmediately: boolean;
  metadata?: unknown;
}

type LimitSet = undefined | HTMLElement | HTMLElement[];

interface ValidationOptions {
  // focusfailed Focus the first invalid element (defaults to true)
  focusfailed?: boolean;
  iffailedbefore?: boolean;
}

interface ValidationResult {
  /// True if the fields successfuly validated
  valid: boolean;
  failed: HTMLElement[];
  firstfailed: HTMLElement | null;
}

interface ValidationQueueElement {
  limitset?: LimitSet;
  options?: ValidationOptions;
  defer: PromiseWithResolvers<ValidationResult>;
}

interface PageState {
  pages: HTMLElement[];
  curpage: number;
}

let delayvalidation = false, validationpendingfor: EventTarget | null = null;
let didGlobalHandlers: true | undefined;

/** Convert linefeeds to BR tags */
function lineFeedsToBreaks(text: string): DocumentFragment {
  const frag = new DocumentFragment;
  for (const part of text.split(/\r?\n/)) {
    if (frag.childNodes.length)
      frag.appendChild(document.createElement("br"));
    frag.append(part);
  }
  return frag;
}

function getPageIdx(state: PageState, page: number | HTMLElement) {
  if (typeof page === 'number') {
    if (page < 0 || page >= state.pages.length)
      throw new Error(`Cannot navigate to nonexisting page #${page}`);
    return page;
  }

  const idx = state.pages.indexOf(page);
  if (idx === -1) {
    console.error(`Cannot find page by element`, page);
    throw new Error(`Cannot find page`);
  }

  return idx;
}

function getErrorFields(validationresult: ValidationResult) {
  return validationresult.failed.map(field => getFieldName(field) || field.dataset.whFormGroupFor || "?")
    .sort()
    .filter((value, index, self) => self.indexOf(value) === index) //unique filter
    .join(" ");
}
function hasEverFailed(field: HTMLElement) {
  if (field.matches("input[type=radio],input[type=checkbox]")) //these are handled by their group, so do the failed check there
    return field.closest(".wh-form__fieldgroup")?.classList.contains('wh-form__field--everfailed');

  return field.classList.contains('wh-form__field--everfailed');
}
function doValidation(field: EventTarget | null, iffailedbefore: boolean) {
  if (iffailedbefore || validationpendingfor)
    releasePendingValidations(); //release any earlier validation. this also cancels 'delayvalidation' but better safe than sorry if we double-run here

  if (delayvalidation) { //Can't be "iffailedbefore" as that would have been cleared above
    if (debugFlags.fhv)
      console.log("[fhv] doValidation: validations are delayed. now pending: ", field);
    validationpendingfor = field;
    return;
  }

  const form = (field as HTMLElement).closest?.('form');
  if (!form || !form.propWhFormhandler)
    return;

  const formhandler = form.propWhFormhandler;
  formhandler.validate([field as HTMLElement], { focusfailed: false, iffailedbefore: iffailedbefore });
}


function doDelayValidation() {
  if (delayvalidation)
    releasePendingValidations();

  delayvalidation = true;
}

function releasePendingValidations() {
  if (!delayvalidation)
    return;

  delayvalidation = false;

  if (validationpendingfor) {
    const tovalidate = validationpendingfor;
    if (debugFlags.fhv)
      console.log("[fhv] releasePendingValidations: ", tovalidate);
    validationpendingfor = null;
    doValidation(tovalidate, false);
  }
}

/* Browser extensions such as 1Password interfere with the event model and may
   cause focusout to not fire for email and password fields. They don't seem
   to break focusin so we'll watch focusin to detect missed focusout events */
let lastfocusout: EventTarget | null = null;
function handleFocusOutEvent(event: FocusEvent) {
  lastfocusout = event.target;
  doValidation(event.target, false);
}
function handleFocusInEvent(event: FocusEvent) {
  if (event.relatedTarget && lastfocusout !== event.relatedTarget)
    doValidation(event.relatedTarget, false);
}

function handleValidateAfterEvent(event: Event) {
  doValidation(event.target, true);
}

export default class FormBase<DataShape extends object = Record<string, unknown>> extends FormFieldMap<DataShape> {
  /** @deprecated Use node.elements if you want a true HTMLFormControlsCollection, use getElementByName since WH5.4+ for properly typed elements */
  readonly elements: HTMLFormControlsCollection;
  private _formsessionid = generateRandomId();
  private _firstinteraction: number | undefined;
  protected _submitstart: number | undefined;
  private validationqueue = new Array<ValidationQueueElement>;
  private _submitter: SubmitSelectorType | null = null;
  private _submittimeout: NodeJS.Timeout | undefined;
  /** Is the form currently interactive? Used to ignore changes done by code/setFieldValue */
  private isInteractive = true;
  /** Did we warn about old style form controls? */
  private didLegacyWarning = false;
  /** Are we currently in the _submit handler? (prevent duplicate submit attemps while eg. inside onBeforeSubmit) */
  private inSubmit = false;
  /** Where should the exitButton navigate to? */
  private exitButtonNavigateTo?: NavigateInstruction;

  readonly data = new Proxy<DataShape>({} as DataShape, new FieldMapDataProxy(this));

  constructor(public readonly node: HTMLFormElement) {
    if (node.nodeName !== 'FORM')
      throw new Error("Specified node is not a <form>"); //we want our clients to be able to assume 'this.node.elements' works

    super("", getFormElementCandidates(node, ''));

    this.elements = node.elements;
    if (this.node.propWhFormhandler)
      throw new Error("Specified node already has an attached form handler");
    this.node.propWhFormhandler = this;

    //TODO Can we scope these handlers to the form ? Or register only once needed?
    if (!didGlobalHandlers) {
      didGlobalHandlers = true;
      window.addEventListener("mouseup", releasePendingValidations, true);
      window.addEventListener("focusin", handleFocusInEvent, true);
    }

    //Implement webhare fields extensions, eg 'now' for date fields or 'enablecomponents'
    webharefields.setup(this.node);
    //Implement page navigation
    addDocEventListener(this.node, "click", evt => this._checkClick(evt));
    addDocEventListener(this.node, "dompack:takefocus", evt => this._onTakeFocus(evt));
    addDocEventListener(this.node, "input", evt => this._onInputChange(), { capture: true });
    addDocEventListener(this.node, "change", evt => this._onInputChange(), { capture: true });
    addDocEventListener(this.node, 'submit', evt => this._submit(evt, null));
    addDocEventListener(this.node, 'wh:form-dosubmit', evt => { throw new Error(`wh:form-dosubmit is no longer supported`); });
    addDocEventListener(this.node, "wh:form-setfielderror", evt => this._doSetFieldError(evt));
    addDocEventListener(this.node, "mousedown", doDelayValidation);
    addDocEventListener(this.node, "focusout", handleFocusOutEvent, { capture: true });
    addDocEventListener(this.node, "input", handleValidateAfterEvent, { capture: true });
    addDocEventListener(this.node, "change", handleValidateAfterEvent, { capture: true });
    this.node.noValidate = true;

    this._rewriteEnableOn();
    this._updateConditions(true); //Update required etc handlers
    this._applyPrefills();

    //Update page navigation
    const pagestate = this._getPageState();
    this._updatePageVisibility(pagestate.pages, 0);
    this._updatePageNavigation();
  }

  static getForNode<DataShape extends object = Record<string, unknown>>(node: HTMLElement): FormBase<DataShape> | null {
    return (node.propWhFormhandler as FormBase<DataShape>) || null;
  }

  ///like namedItem but improves on the types returned. does *not* lookup by data-wh-form-name!
  getElementByName(name: string): FormControlElement | ConstrainedRadioNodeList | null {
    return this.node.elements.namedItem(name) as FormControlElement | ConstrainedRadioNodeList | null;
  }

  /** Get language for this form */
  getLangCode() {
    return this.node.closest<HTMLElement>('[lang]')?.lang ?? 'en';
  }

  protected __formStarted() { //we can remove this once we merge formbase + rpc
  }

  protected sendFormEvent(event?: FormAnalyticsSubEvents) {
    const now = Date.now();

    if (!this._firstinteraction) {   //The user hasn't interacted with the form yet
      if (!this.isInteractive) { //ignore events triggered by code, eg a form prefill
        if (event?.event && debugFlags.anl)
          console.log(`[anl] Form is supressing broadcast of '${event?.event}' because it hasn't been interacted with yet`);
        return;
      }

      //The user has interacted, start the clock!
      this._firstinteraction = now; //set for calculation base *and* to prevent endless loops
      this.sendFormEvent({ event: "started" });
      this.__formStarted();
    }

    if (!event)
      return; //we were only triggered to signal First Interaction
    this._firstinteraction ||= now;

    const pagestate = this._getPageState();
    const eventdata: FormAnalyticsEventData = {
      ...event,
      id: this.node.dataset.whFormId || '',
      session: this._formsessionid,
      pagetitle: this._getPageTitle(pagestate.curpage),
      pagenum: pagestate.curpage + 1,
      time: now - this._firstinteraction,
      objref: this.node.dataset.whFormObjref || ''
    };

    if (this._submitstart) //is set during a pending submission
      eventdata.waittime = Date.now() - this._submitstart;

    dompack.dispatchCustomEvent(this.node, "wh:form-analytics", { bubbles: true, cancelable: false, detail: eventdata });
  }

  _rewriteEnableOn() { //ADDME move this to webhare server
    // EnablingComponents may set data-wh-form-enable. input(radio/checkbox) and option qualify
    type EnablingComponent = HTMLInputElement | HTMLOptionElement;

    // This is the initialization, check the enable components for all elements within the form
    for (const control of dompack.qSA<EnablingComponent>(this.node, "*[data-wh-form-enable]"))
      for (const element of control.dataset.whFormEnable!.split(" ")) {
        const target = this.getElementByName(element);
        if (target && target instanceof HTMLElement) {
          const name = (control instanceof HTMLOptionElement ? control.closest<HTMLSelectElement>("select") : control)?.name;
          if (!name) //duplicated node?
            continue;

          let ourcondition: FormCondition = { field: name, matchtype: "IN", value: control.value };
          if (target.dataset.whFormEnabledIf) //append to existing criterium
            ourcondition = { conditions: [parseCondition(target.dataset.whFormEnabledIf), ourcondition], matchtype: "AND" };
          target.dataset.whFormEnabledIf = JSON.stringify({ c: ourcondition });
        }
      }
  }

  _applyPrefills() {
    //Apply prefills. Set in field order, so controls-enabling-controls things will generally work
    const searchparams = new URL(location.href).searchParams;
    for (const field of this._queryAllFields()) {
      const allvalues = searchparams.getAll(field.name);
      if (!allvalues.length)
        continue;

      if (field.multi && field.nodes[0].type === 'checkbox') {
        for (const node of field.nodes) {
          const shouldbechecked = allvalues.includes(node.value);
          if (shouldbechecked !== node.checked) //NOTE: used to read 'field.checked' which doesn't exist so this if() would always evaluate to true
            this.setFieldValue(node, shouldbechecked);
        }
      } else if (field.multi) { //implies radio
        const tocheck = field.nodes.filter(_ => _.value === allvalues[allvalues.length - 1])[0];
        if (tocheck && !tocheck.checked)
          this.setFieldValue(tocheck, true);
        if (!tocheck)
          field.nodes.filter(_ => _.checked).forEach(_ => this.setFieldValue(_, false));
      } else if (field.node.matches("input:not([type=file]),select,textarea")) { //Limit URL prefills to simple elements - TODO allow custom components to decide on this themselves OR *explicitly* require fields to opt-in to being prefillable
        if (!this._isNowSettable(field.node))
          continue;
        this.setFieldValue(field.node, allvalues[allvalues.length - 1]); //last value wins
      }
    }
  }

  /**
   * Set or update the message for the specified field
   * @param field - node on which the validation triggered
   * @param type - type of the message ("error" or "suggestion") - a field or group can have both an "error" and "suggestion" visible
   * @param getError - function which returns a reference to the error node (or DocumentFragment) or a text
   *
   * .wh-form__field--error      - Used to indicate this element has an error
   * .wh-form__field--suggestion - Used to indicate this element has an suggestion
   * .wh-form__error             - The error message container
   * .wh-form_suggestion         - The suggestion message container
   */
  _updateFieldGroupMessageState(field: HTMLElement, type: "error" | "suggestion", getError: (field: HTMLElement) => FormFrontendMessage | null) {
    //Please note that _updateFieldGroupMessageState doesn't *validate* anything - it takes the current error/suggestion status and updates the DOM accordingly

    /*
    ADDME: ability to show multiple messages in case both the toplevel and a subfield have an error/suggestion.
           Example: a checkboxgroup in which too many options are selected AND the required textfield of a selected option is empty.

    ADDME: how should an error message reference a required nested textfield?

    ADDME: Support progressive enhancements such as splitdatetime which use a native form element
           to store the value. (it's probably confusing that aria-described by ends up on an
           element which needs receives focus and cannot be used to influence/fix the value).
           (such as the splitdatetime)

           Suggestion for possible solution:
           - have the progressive enchancement code add an attribute to the native form element
             with the ID of the (group)element.
    */
    const fieldgroup = field.closest<HTMLElement>(".wh-form__fieldgroup");
    //console.log("_updateFieldGroupMessageState", field, fieldgroup);
    if (!fieldgroup)
      return;

    /* Within the group this field belongs to we lookup the first node we can find which is marked as having the
       type of message we want ("error" or "suggestion").
       First we'll see if the fieldgroup wants to report something (radio & checkboxes handle their errors at the group level)
       otherwise whe'll look for the first node which has a message.
    */
    const field_with_message = fieldgroup.classList.contains("wh-form__field--" + type) ? fieldgroup : fieldgroup.querySelector<HTMLElement>(".wh-form__field--" + type);
    //Do not pick up errors from deeper groups (array rows)
    const error = (field_with_message && field_with_message.closest(".wh-form__fieldgroup") === fieldgroup ? getError(field_with_message) : null) || null;

    // Now mark the whole .wh-form__fieldgroup as having an error/suggestion
    fieldgroup.classList.toggle("wh-form__fieldgroup--" + type, Boolean(error));

    // Lookup the error message from the field metadata
    if (error) { //mark the field has having failed at one point. we will now switch to faster updating error state
      if (!field.classList.contains('wh-form__field--everfailed')) {
        if (debugFlags.fhv)
          console.log('[fhv] marking as everfailed', field, 'because of error', error);
        field.classList.add('wh-form__field--everfailed');
      }
    }

    // Determine the contextnode to set ARIA attributes on

    // ADDME: before looking up a group, check if there an attribute specifying
    //        another element with role="group" handled the input.

    // Find the first role="group" we can find
    // (ineither the .wh-form__subfield or .wh-form__field)
    const potentialgroupnode = field.closest<HTMLElement>("[role=group],.wh-form__subfield,wh-form__fieldgroup");
    const group = potentialgroupnode?.role === "group" ? potentialgroupnode : null;
    const contextnode = group ?? field;

    let messageid = "";
    let messagenode = fieldgroup.querySelector(".wh-form__" + type); //either wh-form__error or wh-form__suggestion

    // Create a container for the suggestion or error
    if (messagenode) {
      messageid = messagenode.id; // reuse the existing messagenode
    } else {
      if (!error)
        return; //nothing to do

      // Generate a temporary id for the message which we can use in
      // the aria-describedby to point to the message.
      const random = Math.floor((1 + Math.random()) * 0x10000000).toString(16);
      messageid = "whform-msg-" + random; // `${fieldname}-${random}`;

      const suggestionholder = field.closest('.wh-form__fields') || fieldgroup.querySelector('.wh-form__fields') || fieldgroup;
      messagenode = dompack.create("div", { className: "wh-form__" + type }); // add a wh-form__error or wh-form__suggestion message container
      messagenode.id = messageid; // id to reference to in the aria-describedby
      suggestionholder.appendChild(messagenode);
    }

    if (error) { // Do we show a message?
      messagenode.replaceChildren(typeof error === "string" ? lineFeedsToBreaks(error) : error);
      this._addDescribedBy(contextnode, messageid);

      if (type === "error")
        contextnode.setAttribute("aria-invalid", "true");
    } else {
      messagenode.replaceChildren(); // remove previous errors/suggestions texts from the errornode
      this._removeDescribedBy(contextnode, messageid);
      contextnode.removeAttribute("aria-invalid");
    }

  }

  // add the specified id of the message element to the list of elements in aria-describedby
  _addDescribedBy(contextnode: HTMLElement, messageid: string) {
    const describedby = contextnode.getAttribute("aria-describedby") ?? "";
    const describedby_fields = describedby !== "" ? describedby.split(" ") : [];

    if (describedby_fields.indexOf(messageid) === -1) {

      describedby_fields.push(messageid);
      contextnode.setAttribute("aria-describedby", describedby_fields.join(" "));
    }
  }

  // remove the specified id of the message element from the list of elements in aria-describedby
  _removeDescribedBy(contextnode: HTMLElement, messageid: string) {
    const describedby = contextnode.getAttribute("aria-describedby") ?? "";
    const describedby_fields = describedby !== "" ? describedby.split(" ") : [];

    for (let idx = 0; idx < describedby_fields.length; idx++) {
      if (describedby_fields[idx] === messageid) {
        describedby_fields.splice(idx, 1); // remove that item
        break;
      }
    }

    if (describedby_fields.length > 0)
      contextnode.setAttribute("aria-describedby", describedby_fields.join(" "));
    else
      contextnode.removeAttribute("aria-describedby");
  }

  _updateFieldGroupErrorState(field: HTMLElement) {
    this._updateFieldGroupMessageState(field, 'error', failedfield => getValidationState(failedfield).getError());
  }

  _updateFieldGroupSuggestionState(field: HTMLElement) {
    this._updateFieldGroupMessageState(field, 'suggestion', failedfield => failedfield.propWhValidationSuggestion || '');
  }

  _doSetFieldError(evt: DocEvent<CustomEvent<SetFieldErrorData>>) {
    //FIXME properly handle multiple fields in this group reporting errors
    dompack.stop(evt);


    this._reportFieldValidity(evt.target);
  }

  /** @returns false on error */
  _reportFieldValidity(node: HTMLElement): boolean {
    const state = getValidationState(node).getState();
    node.classList.toggle("wh-form__field--error", Boolean(state?.error));
    node.classList.toggle("wh-form__field--suggestion", Boolean(state?.suggested));

    this._updateFieldGroupErrorState(node);
    this._updateFieldGroupSuggestionState(node);
    return !(state && "error" in state);
  }

  //validate and submit. normal submissions should use this function, directly calling submit() skips validation and busy locking
  async validateAndSubmit(extradata: ExtraData) {
    await this._submit(null, extradata);
  }

  /** Override beforeSubmit to have a last chance to block/confirm actual form submission
   * @returns true to continue submitting
  */
  beforeSubmit(extradata: ExtraData): boolean | Promise<boolean> {
    return true;
  }

  async _submit(evt: SubmitEvent | null, extradata: ExtraData) {
    if (this.node.classList.contains('wh-form--submitting') || this.inSubmit) //already submitting
      return;

    //A form element's default button is the first submit button in tree order whose form owner is that form element.
    const submitter = this._submitter || this.node.querySelector(submitselector);
    this._submitter = null;

    if (debugFlags.fhv)
      console.log('[fhv] received submit event, submitter:', submitter);

    let tempbutton = null;
    if (submitter) { //temporarily add a hidden field representing the selected button
      tempbutton = document.createElement('input');
      tempbutton.name = submitter.name;
      tempbutton.value = submitter.value;
      tempbutton.type = "hidden";
      this.node.appendChild(tempbutton);
    }

    try {
      this.inSubmit = true;
      const beforeResult = this.beforeSubmit(extradata);
      if (!beforeResult || (isPromise(beforeResult) && !await beforeResult))
        return;

      /* DEPRECATED - Switch to onBeforeSubmit in 5.7+ */
      if (!dompack.dispatchCustomEvent(this.node, 'wh:form-beforesubmit', { bubbles: true, cancelable: true })) { //allow parsley to hook into us
        console.error("The use of wh:form-beforesubmit is deprecated and will be removed in a future version. Use onBeforeSubmit instead");
        return;
      }

      await this._doSubmit(evt, extradata);
    } finally {
      tempbutton?.remove();
      this.inSubmit = false;
    }
  }

  private _shouldValidateField(el: HTMLElement) {
    //TODO maybe we can get rid of the data attributes by checking for explicit symbols like whFormsApiChecker
    return (el.whFormsApiChecker || el.matches(`${queryFormFieldLike},*[data-wh-form-name],*[data-wh-form-custom-validator`)) &&
      this._isPartOfForm(el);
  }

  _getFieldsToValidate(startingpoint?: HTMLElement) {
    return dompack.qSA<HTMLElement>(startingpoint ?? this.node, "*").filter(el => this._shouldValidateField(el));
  }

  //reset any serverside generated errors (generally done when preparing a new submission)
  resetServerSideErrors() {
    for (const field of this._getFieldsToValidate()) {
      const state = getValidationState(field);
      if (state?.explicit?.serverside && field.propWhCleanupFunction)
        field.propWhCleanupFunction();
    }
  }

  async _doSubmit(evt: SubmitEvent | null, extradata: ExtraData) {
    if (evt)
      evt.preventDefault();

    const lock = dompack.flagUIBusy({ modal: true });
    this._submitstart = Date.now();
    this._submittimeout = setTimeout(() => this._submitHasTimedOut(), 5000);
    this.node.classList.add('wh-form--submitting');

    try {
      this.resetServerSideErrors();

      const validationresult = await this.validate();
      if (validationresult.valid) {
        const result = await this.submit(extradata);
        if (result.result && result.result.submittype && result.result.submittype !== this._getVariableValueForConditions("formsubmittype")) {
          this.node.setAttribute("data-wh-form-var-formsubmittype", result.result.submittype);
          this._updateConditions(false);
        }
      } else {
        this.sendFormEvent({ event: "failed", errorfields: getErrorFields(validationresult), errorsource: 'client' });
      }
    } finally {
      lock.release();
      this.node.classList.remove('wh-form--submitting');
      if (this._submittimeout) {
        clearTimeout(this._submittimeout);
        this._submittimeout = undefined;
      }
      this._submitstart = undefined;
    }
  }

  _submitHasTimedOut() { //TODO extend this to (background) RPCs too, and make waitfor more specific. also check whether we're stuck on client or server side
    this.sendFormEvent({ event: "slow", waitfor: "submit" });
  }

  //default submission function. eg. RPC will override this
  async submit(extradata?: ExtraData): Promise<{ result?: FormSubmitEmbeddedResult }> {
    this.node.submit();
    return {};
  }

  _onTakeFocus(evt: DocEvent<TakeFocusEvent>) {
    const containingpage = evt.target.closest('.wh-form__page');
    if (containingpage && containingpage.classList.contains('wh-form__page--hidden')) {
      //make sure the page containing the errored component is visible
      const pagenum = dompack.qSA(this.node, '.wh-form__page').findIndex(page => page === containingpage);
      if (pagenum >= 0)
        this.gotoPage(pagenum);
    }
  }

  _checkClick(evt: DocEvent<MouseEvent>) {
    const actionnode = evt.target?.closest<HTMLElement>("*[data-wh-form-action]");
    if (!actionnode) {
      const submitter = evt.target.closest<SubmitSelectorType>(submitselector);
      if (submitter?.form === this.node) { //if we found the submit buton AND it's for *this* form. don't intercept otherwise
        if (!this.node.classList.contains('wh-form--allowsubmit')) { //we're not allowed to submit yet (not on a final page)
          dompack.stop(evt);
          if (this.node.classList.contains('wh-form--allownext'))  //but we can convert your action to a NextPage! which is likely what you intended
            this.executeFormAction('next');
          return;
        }

        this._submitter = submitter; //store as submitter in case a submit event actually occurs
        setTimeout(() => this._submitter = null); //but clear it as soon as event processing ends
      }
      return;
    }

    dompack.stop(evt);
    this.executeFormAction(actionnode.dataset.whFormAction!);
  }

  private _getPageState(): PageState {
    const pages = dompack.qSA<HTMLElement>(this.node, '.wh-form__page');
    const curpage = pages.findIndex(page => !page.classList.contains('wh-form__page--hidden'));
    return { pages, curpage };
  }

  _updatePageVisibility(pagelist: HTMLElement[], currentpage: number) {
    pagelist.forEach((page, idx) => {
      page.classList.toggle('wh-form__page--hidden', idx !== currentpage);
      page.classList.toggle('wh-form__page--visible', idx === currentpage);
    });
  }

  ///Get the currently opened page (page node)
  getCurrentPage() {
    const state = this._getPageState();
    return state.curpage >= 0 ? state.pages[state.curpage] : null;
  }

  /** Position the specified element's group or the form itself into view, using `.wh-anchor` nodes to correct for fixed headers
      @param scrollto -  Element to position into view. If not set, the form it scrolled into view */
  scrollIntoView(scrollto?: HTMLElement) {
    const origscrollto = scrollto;
    scrollto = (scrollto ? scrollto.closest<HTMLElement>('.wh-form__fieldgroup') : undefined) || this.node;
    scrollto = scrollto.querySelector<HTMLElement>('.wh-anchor') || scrollto;
    if (origscrollto && scrollto !== origscrollto && debugFlags.fhv)
      console.log('[fhv] Modified scroll target from ', origscrollto, ' to anchor ', scrollto);
    else if (debugFlags.fhv)
      console.log('[fhv] Scroll to ', scrollto);

    scrollto.scrollIntoView();
  }

  /** Get the current page number
      @returns 0-based index of page to jump to */
  getCurrentPageNumber() {
    return this._getPageState().curpage;
  }

  /** Goto a specific page
      @param page - 0-based index of page or the HTML element of the page to jump to */
  async gotoPage(page: number | HTMLElement, { __isSubmit = false } = {}): Promise<void> {
    const state = this._getPageState();
    const pageidx = getPageIdx(state, page);
    if (state.curpage === pageidx)
      return;

    const goingforward = pageidx > state.curpage;
    if (!__isSubmit)
      this.sendFormEvent({
        event: goingforward ? __isSubmit ? 'submitted' : 'nextpage' : 'previouspage',
        targetpagenum: pageidx + 1,
        targetpagetitle: this._getPageTitle(pageidx)
      });

    this._updatePageVisibility(state.pages, pageidx);
    if (goingforward) //only makes sense to update if we're making progress
      merge.run(state.pages[pageidx], { form: await this.getFormValue() });

    this._updatePageNavigation();

    //scroll back up
    this.scrollIntoView();

    /* tell the page it's now visible - note that we specifically don't fire this on init, as it's very likely
       users would 'miss' the event anyway - registerHandler usually executes faster than your wh:form-pagechange
       registrations, if you wrapped those in a dompack.register */
    dompack.dispatchCustomEvent(state.pages[pageidx], "wh:form-pagechange", { bubbles: true, cancelable: false, detail: { formHandler: this } });
  }

  private _getDestinationPage(pagestate: PageState, direction: number) {
    let pagenum = pagestate.curpage + direction;
    while (pagenum >= 0 && pagenum < pagestate.pages.length && (pagestate.pages[pagenum].propWhFormCurrentVisible === false || pagestate.pages[pagenum].dataset.whFormPagerole === "captcha"))
      pagenum = pagenum + direction;
    if (pagenum < 0 || pagenum >= pagestate.pages.length)
      return -1;
    return pagenum;
  }

  _getPageTitle(pagenum: number) {
    const pagenode = this._getPageState().pages[pagenum];
    if (!pagenode)
      return "";
    return pagenode.dataset.whFormPagetitle || ("#" + (pagenum + 1));
  }

  async executeFormAction(action: string) {
    switch (action) {
      case 'previous':
        {
          if (this.node.classList.contains('wh-form--allowprevious')) {
            const pagestate = this._getPageState();
            if (pagestate.curpage > 0)
              this.gotoPage(this._getDestinationPage(pagestate, -1));
            else if (this.node.dataset.whFormBacklink)
              navigateTo({ type: "redirect", url: this.node.dataset.whFormBacklink });
          }
          return;
        }
      case 'next':
        {
          const pagestate = this._getPageState();
          if (this.node.classList.contains('wh-form--allownext')) {
            this.resetServerSideErrors();

            const validationstatus = await this.validate(pagestate.pages[pagestate.curpage]);
            if (validationstatus.valid) {
              this.gotoPage(this._getDestinationPage(pagestate, +1));
            } else {
              this.sendFormEvent({ event: "failed", errorfields: getErrorFields(validationstatus), errorsource: 'nextpage' });
            }
          }
          return;
        }
      case 'exit': {
        if (!this.exitButtonNavigateTo)
          throw new Error("No exit navigation target set for this form");

        navigateTo(this.exitButtonNavigateTo);
        return;
      }
      default: {
        console.error(`Unknown form action '${action}'`);
      }
    }
  }

  async refreshConditions() {
    await this._updateConditions(false);
  }

  _onInputChange() {
    this.sendFormEvent(); //only trigger implicit _firstinteraction event
    this._updateConditions(false);
  }

  async _updateConditions(isinit: boolean) {
    // Check pages visibility
    const hiddenPages = [];
    const mergeNodes = [];
    let anychanges = false;

    for (const formpage of dompack.qSA(this.node, ".wh-form__page")) {
      let visible = true;
      if (formpage.dataset.whFormVisibleIf) {
        visible = this._matchesCondition(formpage.dataset.whFormVisibleIf);
        if (!visible)
          hiddenPages.push(formpage); // We don't have to check fields on this page any further

        if (visible !== formpage.propWhFormCurrentVisible) {
          anychanges = true;
          formpage.propWhFormCurrentVisible = visible;
          mergeNodes.push(formpage);
        }
      }
    }
    if (anychanges)
      this._updatePageNavigation();

    const tovalidate = new Array<HTMLElement>;
    const hiddengroups = [], enabledgroups = [], requiredgroups = [];
    for (const formgroup of dompack.qSA(this.node, ".wh-form__fieldgroup")) {
      const groupPage = formgroup.closest<HTMLElement>(".wh-form__page");
      const visible = (!groupPage || !hiddenPages.includes(groupPage)) && this._matchesCondition(formgroup.dataset.whFormVisibleIf);
      if (!visible)
        hiddengroups.push(formgroup);

      const enabled = visible
        && this._matchesCondition(formgroup.dataset.whFormEnabledIf);

      if (enabled)
        enabledgroups.push(formgroup);

      //load initial status?
      if (formgroup.propWhFormInitialRequired === undefined)
        formgroup.propWhFormInitialRequired = formgroup.classList.contains("wh-form__fieldgroup--required");

      const required = enabled
        && (formgroup.dataset.whFormRequiredIf ? this._matchesCondition(formgroup.dataset.whFormRequiredIf) : formgroup.propWhFormInitialRequired);

      if (required)
        requiredgroups.push(formgroup);

      if (visible !== formgroup.propWhFormCurrentVisible // These are initially undefined, so this code will always run first time
        || enabled !== formgroup.propWhFormCurrentEnabled
        || required !== formgroup.propWhFormCurrentRequired) {
        formgroup.propWhFormCurrentVisible = visible;
        formgroup.propWhFormCurrentEnabled = enabled;
        formgroup.propWhFormCurrentRequired = required;

        formgroup.classList.toggle("wh-form__fieldgroup--disabled", !enabled);
        formgroup.classList.toggle("wh-form__fieldgroup--hidden", !visible);
        formgroup.classList.toggle("wh-form__fieldgroup--required", required);

        mergeNodes.push(formgroup);
      }
    }

    for (const formline of dompack.qSA(this.node, ".wh-form__fieldline")) {
      const formgroup = formline.closest<HTMLElement>(".wh-form__fieldgroup");
      if (!formgroup)
        continue;
      const visible = !hiddengroups.includes(formgroup) && this._matchesCondition(formline.dataset.whFormVisibleIf);
      const enabled = visible && enabledgroups.includes(formgroup) && this._matchesCondition(formline.dataset.whFormEnabledIf);
      const required = enabled && requiredgroups.includes(formgroup);

      if (visible !== formline.propWhFormlineCurrentVisible) {  // These are initially undefined, so this code will always run first time
        formline.propWhFormlineCurrentVisible = visible;
        formline.classList.toggle("wh-form__fieldline--hidden", !visible);
      }

      // Look for nodes that are explicit enable state (enablee/require) listeners, or that need to do so because they're real input controls
      const inputtargets = dompack.qSA(formline, `${queryFormFieldLike},[data-wh-form-state-listener='true']`);

      for (const node of inputtargets) {
        //Record initial states
        if (node.propWhFormSavedEnabled === undefined)
          node.propWhFormSavedEnabled = "disabled" in node ? !node.disabled : !("whFormDisabled" in node.dataset);

        if (node.propWhFormSavedRequired === undefined)
          node.propWhFormSavedRequired = Boolean("required" in node && node.required);

        // The field is enabled if all of these are matched:
        // - we're setting it to enabled now
        // - it hasn't been disabled explicitly (set initially on the node)
        // - it hasn't been disabled through enablecomponents
        const node_enabled = enabled && node.propWhFormSavedEnabled && this._matchesCondition(node.dataset.whFormEnabledIf);

        if (node_enabled !== node.propWhNodeCurrentEnabled) {
          node.propWhNodeCurrentEnabled = node_enabled;

          // Give the formgroup a chance to handle it
          if (dompack.dispatchCustomEvent(node, "wh:form-enable", { bubbles: true, cancelable: true, detail: { enabled: node_enabled } })) {
            // Not cancelled, so run our default handler
            if (isFormFieldLike(node)) //For true html5 inputs we'll use the native attributes. formstatelisteners: we use data attributes
              node.disabled = !node_enabled;
            else if (node_enabled)
              node.removeAttribute("data-wh-form-disabled");
            else
              node.setAttribute("data-wh-form-disabled", "");
          }

          if (!isinit && !node_enabled && !tovalidate.includes(node))
            tovalidate.push(node); // to clear errors for this disabled field
        }

        const node_required = (node.propWhFormSavedRequired || required) && node_enabled && visible;
        if (node.propWhNodeCurrentRequired !== node_required) {
          node.propWhNodeCurrentRequired = node_required;

          // Give the formgroup a chance to handle it
          if (dompack.dispatchCustomEvent(node, "wh:form-require", { bubbles: true, cancelable: true, detail: { required: node_required } })) {
            // Not cancelled, so run our default handler
            if (isFormFieldLike(node)) { //For true html5 inputs we'll use the native attributes. formstatelisteners: we use data attributes
              if (!isFormControl(node) || node.type !== 'checkbox') //don't set required on checkboxes, that doesn't do what you want
                node.required = node_required;
            } else if (node_required)
              node.setAttribute("data-wh-form-required", "");
            else
              node.removeAttribute("data-wh-form-required");
          }

          if (!isinit && !node_required && formgroup.classList.contains("wh-form__fieldgroup--error") && !tovalidate.includes(node))
            tovalidate.push(node); // to clear errors for this now optional field
        }
      }
    }

    for (const option of dompack.qSA<HTMLOptionElement>(this.node, ".wh-form__fieldgroup select option")) {
      const visible = this._matchesCondition(option.dataset.whFormVisibleIf);

      //Record initial states
      if (option.propWhFormSavedEnabled === undefined)
        option.propWhFormSavedEnabled = !option.disabled;
      if (option.propWhFormSavedHidden === undefined)
        option.propWhFormSavedHidden = option.hidden;

      const option_enabled = visible && option.propWhFormSavedEnabled;
      const option_hidden = !visible || option.propWhFormSavedHidden;

      if (option_enabled !== option.propWhNodeCurrentEnabled || option_hidden !== option.propWhNodeCurrentHidden) {
        option.propWhNodeCurrentEnabled = option_enabled;
        option.propWhNodeCurrentHidden = option_hidden;
        option.disabled = !option_enabled;
        option.hidden = option_hidden;

        // If this option was the selected option, but is now disabled (but not the placeholder), reset the select's value
        const selectnode = option.closest<HTMLSelectElement>("select");
        if (selectnode && option.selected && (!option_enabled || option_hidden) && option.dataset.placeholder === undefined) {
          if (selectnode.options[0].dataset.placeholder !== undefined) { //we have a placeholder...
            selectnode.selectedIndex = 0;
          } else {
            selectnode.selectedIndex = -1;
            if (!selectnode.__didPlaceholderWarning) {
              selectnode.__didPlaceholderWarning = true;
              console.warn("This <select> lacks an explicit placeholder so we had to set selectedIndex to -1", selectnode);
            }
          }
        }

        if (selectnode && !isinit && !tovalidate.includes(selectnode))
          tovalidate.push(selectnode); // to clear errors for this option's select field
      }
    }

    if (tovalidate.length)
      await this.validate(tovalidate, { focusfailed: false, iffailedbefore: true });

    this.fixupMergeFields(mergeNodes);
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- FIXME: needs API rework
  __scheduleUpdateConditions = wrapSerialized(() => this._updateConditions(false), { coalesce: true });

  async fixupMergeFields(nodes: HTMLElement[]) {
    // Rename the data-wh-merge attribute to data-wh-dont-merge on hidden pages and within hidden formgroups to prevent
    // merging invisible nodes
    // FIXME 'merge' has a filter option now - convert to that!
    const formvalue = await this.getFormValue();
    for (const node of nodes) {
      if (node.propWhFormCurrentVisible) {
        for (const mergeNode of dompack.qSA(node, '*[data-wh-dont-merge]')) {
          mergeNode.dataset.merge = mergeNode.dataset.whDontMerge;
          mergeNode.removeAttribute("data-wh-dont-merge");
        }
        merge.run(node, { form: formvalue });
      } else {
        for (const mergeNode of dompack.qSA(node, '*[data-merge]')) {
          mergeNode.dataset.whDontMerge = mergeNode.dataset.merge;
          mergeNode.removeAttribute("data-merge");
        }
      }
    }
  }

  _matchesCondition(conditiontext: string | undefined) {
    if (!conditiontext)
      return true;

    return this._matchesConditionRecursive(parseCondition(conditiontext));
  }

  _getConditionRawValue(fieldname: string, options?: { checkdisabled?: boolean }) {
    if (this.node.hasAttribute("data-wh-form-var-" + fieldname))
      return this.node.getAttribute("data-wh-form-var-" + fieldname);

    const matchfield = this.getElementByName(fieldname);
    if (!matchfield) {
      console.error(`No match for conditional required field '${fieldname}'`);
      return null;
    }

    if (isRadioNodeList(matchfield)) {
      let currentvalue = null;

      for (const field of matchfield)
        if (((options && options.checkdisabled) || this._isNowSettable(field)) && field.checked) {
          if (field.type !== "checkbox")
            return field.value;

          if (!currentvalue)
            currentvalue = [];
          currentvalue.push(field.value);
        }
      return currentvalue;
    } else {
      //Can we set this field?
      if ((!options || !options.checkdisabled) && !this._isNowSettable(matchfield))
        return null;
    }

    if (matchfield.type === "checkbox")
      return (matchfield as HTMLInputElement).checked ? [matchfield.value] : null;

    if (matchfield.type === "radio")
      return (matchfield as HTMLInputElement).checked ? matchfield.value : null;

    return matchfield.value;
  }

  _getVariableValueForConditions(conditionfield: string, options?: { matchcase?: boolean; checkdisabled?: boolean }) {
    if (this.node.hasAttribute("data-wh-form-var-" + conditionfield))
      return this.node.getAttribute("data-wh-form-var-" + conditionfield);

    const fields = conditionfield.split("$");

    if (fields.length > 1) {
      // If the condition field has a subfield, check if it's available through a form var
      // The '$' in the attribute name is replaced with '.' to make the attribute name valid
      const attrname = fields.join(".");
      if (this.node.hasAttribute("data-wh-form-var-" + attrname))
        return this.node.getAttribute("data-wh-form-var-" + attrname);
    }

    let currentvalue = this._getConditionRawValue(fields[0], options);
    if (fields.length === 1 || currentvalue === null) //no subs to process
      return currentvalue;

    // Look for an extrafield match
    const matchfield = this.getElementByName(fields[0]);
    if (!matchfield) {
      console.error(`No match for conditional required field '${conditionfield}'`);
      return null;
    }

    if (matchfield instanceof HTMLSelectElement) {
      if (Array.isArray(currentvalue)) {
        const selectedvalue = currentvalue;
        currentvalue = [];
        for (const val of selectedvalue) {
          const selected = dompack.qS<HTMLOptionElement>(matchfield, `option[value="${CSS.escape(val)}"]`);
          if (!selected?.dataset.__extrafields)
            return null;
          const extrafields = JSON.parse(selected.dataset.__extrafields);
          currentvalue.push(extrafields[fields[1]]);
        }
      } else {
        const selected = dompack.qS<HTMLOptionElement>(matchfield, `option[value="${CSS.escape(currentvalue)}"]`);
        if (!selected?.dataset.__extrafields)
          return null;
        const extrafields = JSON.parse(selected.dataset.__extrafields);
        currentvalue = extrafields[fields[1]];
      }
      return currentvalue;
    } else {
      console.error("Subfield matching not supported for non-select fields");
      return null;
    }
  }


  _matchesConditionRecursive(condition: FormCondition): boolean {
    switch (condition.matchtype) {
      case "AND":
        for (const subcondition of condition.conditions)
          if (!this._matchesConditionRecursive(subcondition))
            return false;
        return true;

      case "OR":
        for (const subcondition of condition.conditions)
          if (this._matchesConditionRecursive(subcondition))
            return true;
        return false;

      case "NOT":
        return !this._matchesConditionRecursive(condition.condition);

      case "AGE<":
      case "AGE>=": {
        const currentvalue = this._getVariableValueForConditions(condition.field);
        if (!currentvalue)
          return false;

        const now = new Date, birthdate = new Date(Array.isArray(currentvalue) ? currentvalue[0] : currentvalue); //should never be an array, but _getVariableValueForConditions is generic
        let age = now.getFullYear() - birthdate.getFullYear();
        //birthdate not hit yet this year? then you lose a year
        if (now.getMonth() < birthdate.getMonth()
          || (now.getMonth() === birthdate.getMonth() && now.getDate() < birthdate.getDate())) {
          --age;
        }

        return (condition.matchtype === 'AGE<' ? age < condition.value : age >= condition.value);
      }
    }

    const currentvalue = this._getVariableValueForConditions(condition.field, condition.options);

    if (condition.matchtype === "HASVALUE")
      return Boolean(currentvalue) === Boolean(condition.value);

    if (["IN", "HAS", "IS"].includes(condition.matchtype)) {
      const matchcase = condition.options?.matchcase !== false; // Defaults to true
      const compareagainst = Array.isArray(condition.value) ? condition.value : condition.value ? [condition.value] : [];
      const currentValArray: string[] = Array.isArray(currentvalue) ? currentvalue : currentvalue ? [currentvalue] : [];

      // If the match is not case-sensitive, the condition value is already uppercased, so we only have to uppercase the
      // current value(s) when checking
      if (!matchcase)
        currentValArray.forEach((_, idx) => currentValArray[idx] = currentValArray[idx].toUpperCase());

      // The current value and the condition value should (at least) overlap
      if (!currentValArray.some(value => compareagainst.includes(value)))
        return false;

      // For "HAS" and "IS" conditions, all of the required values should be selected (there shouldn't be required values
      // that are not selected)
      if ((condition.matchtype === "HAS" || condition.matchtype === "IS") && compareagainst.some(value => !currentValArray.includes(value)))
        return false;

      // For an "IS" condition, all of the selected values should be required (there shouldn't be selected values that are
      // not required)
      if (condition.matchtype === "IS" && currentValArray.some(value => !compareagainst.includes(value)))
        return false;

      return true;
    }

    return console.error(`No support for conditional type '${condition.matchtype}'`), false;
  }

  _updatePageNavigation() {
    const pagestate = this._getPageState();
    const nextpage = this._getDestinationPage(pagestate, +1);
    const morepages = nextpage !== -1;
    const curpagerole = pagestate.pages[pagestate.curpage] ? pagestate.pages[pagestate.curpage].dataset.whFormPagerole : '';
    const nextpagerole = morepages ? pagestate.pages[nextpage].dataset.whFormPagerole : "";

    this.node.classList.toggle("wh-form--allowprevious", Boolean((pagestate.curpage > 0 && curpagerole !== 'thankyou') || (pagestate.curpage <= 0 && this.node.dataset.whFormBacklink)));
    this.node.classList.toggle("wh-form--allownext", morepages && nextpagerole !== 'thankyou');
    this.node.classList.toggle("wh-form--allowsubmit", curpagerole === 'thankyou'
      ? pagestate.pages[pagestate.curpage].dataset.whFormExitButton !== undefined
      : (!morepages || nextpagerole === 'thankyou'));
  }

  _navigateToThankYou(richvalues?: RichValues) {
    const state = this._getPageState();

    if (state.curpage >= 0) {
      const nextpage = this._getDestinationPage(state, +1);
      if (nextpage !== -1 && state.pages[nextpage] && state.pages[nextpage].dataset.whFormPagerole === 'thankyou') {
        const rawNavigateTo = state.pages[nextpage].dataset.whFormNavigateTo;
        const exitButton = state.pages[nextpage].dataset.whFormExitButton;
        const parsedNavTo = rawNavigateTo ? JSON.parse(rawNavigateTo) : null;
        if (parsedNavTo)
          this.exitButtonNavigateTo = parsedNavTo;

        const redirectdelay = parseInt(state.pages[nextpage].dataset.whFormPageredirectDelay ?? "");

        if (exitButton) {
          const submitButton = this.node.querySelector<HTMLElement>(".wh-form__button--submit");
          const submitButtonLabel = submitButton?.querySelector<HTMLElement>(".wh-form__buttonlabel");
          if (submitButton && submitButtonLabel) {
            submitButton.dataset.whFormAction = "exit";
            submitButtonLabel.textContent = exitButton;
          } else {
            console.error(`Unable to find the submit button '.wh-form__button--submit .wh-form__buttonlabel' - I need to replace its label with '${exitButton}'!`);
          }
        }

        if (parsedNavTo && !(redirectdelay >= 0) && !exitButton) {
          navigateTo(parsedNavTo);
          return;
        }

        this.updateRichValues(state.pages[nextpage], richvalues);
        this.gotoPage(nextpage, { __isSubmit: true });
        if (parsedNavTo && redirectdelay >= 0) {
          // If redirectdelay==0 (redirect immediately, while showing the thank you page), redirect after a small delay to
          // give the browser time to hide the busy layer
          // Might be caused by this: https://stackoverflow.com/a/60439478
          setTimeout(() => navigateTo(parsedNavTo), redirectdelay * 1000 || 100);
        }
      }
    }
  }
  updateRichValues(page: HTMLElement, richvalues?: RichValues) {
    if (richvalues) {
      for (const { field, value } of richvalues) {
        const node = page.querySelector(`.wh-form__fieldgroup--richtext[data-wh-form-group-for="${CSS.escape(field)}"] .wh-form__richtext`);
        if (node) {
          node.innerHTML = value;
          dompack.registerMissed(node);
        }
      }
    }
  }

  private ensureLegacyWarning(field: HTMLElement) {
    if (!this.didLegacyWarning && !isLive)
      console.warn(`[form] ${getFieldDisplayName(field)} is using wh:form-getvalue/wh:form-setvalue events. It should switch to RegisteredFieldBase in WebHare 5.6+`);

    this.didLegacyWarning = true;
  }

  /* Override this to overwrite the processing of individual fields. Note that
     radio and checkboxes are not passed through getFieldValue, and that
     getFieldValue may return undefined or a promise. */
  async getFieldValue(field: HTMLElement) {
    if (field[rfSymbol])
      return field[rfSymbol].getValue();

    if (field.hasAttribute('data-wh-form-name') || field.whUseFormGetValue) {
      //create a deferred promise for the field to fulfill
      const deferred = Promise.withResolvers<unknown>();
      //if cancelled, we'll assume the promise is taken over
      if (!dompack.dispatchCustomEvent(field, 'wh:form-getvalue', { bubbles: true, cancelable: true, detail: { deferred } })) {
        this.ensureLegacyWarning(field);
        return deferred.promise;
      }
    }
    if (!isFormFieldLike(field)) {
      /* Can't fail on these, weird embeddings do weird things. Eg google's recaptcha v2 triggers this because it assigns a random name=
         to the iframe it injects and then we pick that up.. (may need to move this error behind a debugflag if that's the only likely cause) */
      console.error(`Cannot get value on non-FormControl`, field);
      return undefined; //TODO throw? but wasn't currently fatal
    }

    if (field.matches('input[type=file]')) //We don't care for multiple yet, as our form RPC APIs don't support that either
      return [...(field as HTMLInputElement).files || []].map(file => ({ fileName: file.name, file: file, link: null })) satisfies FormFileValue[];

    return field.value;
  }

  /* Override this to overwrite the setting of individual fields. In contrast
     to getFieldValue, this function will also be invoked for radio and checkboxes */
  setFieldValue(fieldnode: HTMLElement, value: unknown) {
    if (fieldnode[rfSymbol])
      return fieldnode[rfSymbol].setValue(value);

    if (fieldnode.hasAttribute('data-wh-form-name')) {
      if (!dompack.dispatchCustomEvent(fieldnode, 'wh:form-setvalue', { bubbles: true, cancelable: true, detail: { value } })) {
        this.ensureLegacyWarning(fieldnode);
        return;
      }
      // Event is not cancelled, set node value directly
    }

    if (!isFormFieldLike(fieldnode)) {
      console.error(`Cannot set value on non-FormControl`, fieldnode, value);
      return; //TODO throw? but wasn't currently fatal
    }

    //NOTE this blocks a lot of 'new sets' being done through setFieldValue, eg resetting an array by setting it to []. which is fine for me, just use the data proxy..
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      console.error(`Setting value of type ${typeof value} on a FormControl`, fieldnode, value);
      return; //TODO throw? but wasn't currently fatal
    }

    const saveInteractive = this.isInteractive;
    try {
      this.isInteractive = false;
      if (isFormControl(fieldnode))
        dompack.changeValue(fieldnode, value);
      else
        fieldnode.value = value;
    } finally {
      this.isInteractive = saveInteractive;
    }
  }

  _isPartOfForm(el: HTMLElement) {
    //In HTML terms, an input must either have *no* form attribute or explicitly point to us. eg <input form> is *outside* a form
    //However nodes may live in fragments (eg arrayedits) that are not in the DOM and not attached anywhere, so we also consider anything outside the DOM to be in our form...
    return !("form" in el) || el.form === this.node || !document.contains(el)
      || (!this.node && !el.hasAttribute("form")); //FIXME remove this workaround needed now to work around form init race where arrayfields try to use _queryAllFields
  }

  _queryAllFields(options?: {
    skiparraymembers?: boolean;
    skipfield?: HTMLElement;
    onlysettable?: boolean;
    startnode?: HTMLElement;
  }): FormControlDescription[] {
    const foundfields = new Array<FormControlDescription>;
    const skiparraymembers = options && options.skiparraymembers;

    for (const field of this._getFieldsToValidate(options?.startnode)) {
      if (options && field === options.skipfield) //arrayfield.es needs it
        continue;
      if (!this._isPartOfForm(field))
        continue;
      if (options && options.onlysettable && !this._isNowSettable(field))
        continue;
      if (skiparraymembers && field.closest(".wh-form__arrayrow"))
        continue;

      const name = getFieldName(field);
      if (!name)
        continue;

      let addto = foundfields.find(_ => _.name === name);
      if (isRadioOrCheckbox(field)) { //expect multiple inputs with this name?
        if (!addto) {
          addto = { name: name, multi: true, nodes: [] };
          foundfields.push(addto);
        } else if (!addto.multi) {
          console.error(`[fhv] Encountered duplicate field '${name}'`, field);
          continue;
        }
        addto.nodes.push(field);
      } else {
        if (addto) {
          console.error(`[fhv] Encountered duplicate field '${name}'`, field);
          continue;
        }

        foundfields.push({ name: name, multi: false, node: field });
      }
    }

    return foundfields;
  }

  /** Return the names of all form elements */
  getFormElementNames() {
    return this._queryAllFields().map(_ => _.name);
  }

  /** getValue from a field as returned by _queryAllFields (supporting both multilevel and plain fields)
      @returns promise */
  _getQueryiedFieldValue(field: FormControlDescription) {
    if (!field.multi)
      return this.getFieldValue(field.node);

    return field.nodes.filter(node => node.checked).map(node => node.value);
  }

  /** Return a promise resolving to the submittable form value */
  getFormValue(): Promise<FormResultValue> {
    return new Promise<FormResultValue>((resolve, reject) => {
      const outdata = {};
      const fieldpromises = new Array<Promise<void>>;

      for (const field of this._queryAllFields({ onlysettable: true, skiparraymembers: true }))
        this._processFieldValue(outdata, fieldpromises, field.name, this._getQueryiedFieldValue(field));

      Promise.all(fieldpromises).then(() => resolve(outdata)).catch(e => reject(e as Error));
    });
  }

  _isNowSettable(node: HTMLElement) {
    // If the node is disabled, it's not settable
    if ("disabled" in node && node.disabled)
      return false;

    // If the node's field group is disabled or hidden, it's not settable
    const formgroup = node.closest(".wh-form__fieldgroup");
    if (formgroup) {
      if (formgroup.classList.contains("wh-form__fieldgroup--disabled"))
        return false;
      if (formgroup.classList.contains("wh-form__fieldgroup--hidden"))
        return false;
    }

    // If the node's form page is hidden dynamically, it's not settable
    const formpage = node.closest<HTMLElement>(".wh-form__page");
    if (formpage) {
      if (formpage.propWhFormCurrentVisible === false)
        return false;
    }
    // The node is settable
    return true;
  }

  _processFieldValue(outdata: FormResultValue, fieldpromises: Array<Promise<void>>, fieldname: string, receivedvalue: unknown) {
    if (receivedvalue === undefined)
      return;
    if (isPromise(receivedvalue)) {
      fieldpromises.push(new Promise<void>((resolve, reject) => {
        receivedvalue.then(result => {
          if (result !== undefined)
            outdata[fieldname] = result;

          resolve();
        }).catch(e => reject(e as Error));
      }));
    } else {
      outdata[fieldname] = receivedvalue;
    }
  }

  //get the option lines associated with a specific radio/checkbox group
  getOptions(name: string) {
    const nodes = this.getElementByName(name);
    if (!(nodes instanceof RadioNodeList))
      return [];

    return [...nodes].map(node => ({
      inputnode: node,
      fieldline: node.closest<HTMLElement>('.wh-form__fieldline'),
      value: node.value
    }));
  }

  /** gets the selected option associated with a radio/checkbox group as an array
      */
  getSelectedOptions(name: string) {
    let opts = this.getOptions(name);
    opts = opts.filter(node => node.inputnode.checked);
    return opts;
  }

  /** get the selected option associated with a radio/checkbox group. returns an object that's either null or the first selected option
      */
  getSelectedOption(name: string) {
    const opts = this.getSelectedOptions(name);
    return opts.length ? opts[0] : null;
  }

  /** get the fieldgroup for an element */
  getFieldGroup(name: string): HTMLElement | null {
    let node = this.getElementByName(name);
    if (node instanceof RadioNodeList)
      node = node[0];

    return node ? node.closest<HTMLElement>('.wh-form__fieldgroup') : null;
  }

  /** get the values of the currently selected radio/checkbox group */
  private getValues(name: string) {
    return this.getSelectedOptions(name).map(node => node.value);
  }
  /** get the value of the first currently selected radio/checkbox group */
  private getValue(name: string) {
    const vals = this.getValues(name);
    return vals.length ? vals[0] : null;
  }

  /** @deprecated Just import setupValidator from \@mod-publisher/js/forms */
  static setupValidator(node: HTMLElement, checker: (node: HTMLElement) => Promise<string> | string) {
    setupValidator(node, checker);
  }

  /** @deprecated Just import setFieldError from \@mod-publisher/js/forms */
  static setFieldError(field: HTMLElement, error: string, options?: Partial<FieldErrorOptions>) {
    setFieldError(field, error, options);
  }

  setFieldError(field: HTMLElement, error: string, options?: Partial<FieldErrorOptions>) {
    setFieldError(field, error, options);
  }

  async validateSingleFormField(field: HTMLElement): Promise<boolean> {
    return true;
  }

  async _validateSingleFieldOurselves(field: HTMLElement): Promise<boolean> {
    const state = getValidationState(field);

    if (!state.explicit && isFieldNativeErrored(field)) {
      //browser checks go first, any additional checks are always additive (just disable browserchecks you don't want to apply)
      updateFieldError(field);
      return this._reportFieldValidity(field);
    }

    //TODO we probably *shouldn't* be bothering running our validations if state.explicit is set, but then setFieldError needs to rerun the checks once the explicit error is dropped
    state.dynamicError = null;
    await this.validateSingleFormField(field);

    if (!state.dynamicError)
      for (const validator of state.validators) {
        state.dynamicError = await validator(field) || null;
        if (state.dynamicError)
          break; //one is enough
      }

    if (!state.dynamicError && field.whFormsApiChecker)
      await field.whFormsApiChecker();

    return this._reportFieldValidity(field);
  }

  /** validate the form
      @param limitset - A single element, nodelist or array of elements to validate (or their children)
      @returns a promise that will fulfill when the form is validated
       */
  async validate(limitset?: LimitSet, options?: ValidationOptions): Promise<ValidationResult> {
    if (debugFlags.fdv) {
      console.warn(`[fdv] Validation of form was skipped`);
      return { valid: true, failed: [], firstfailed: null };
    }

    //Overlapping validations are dangerous, because we can't evaluate 'hasEverFailed' too early... if an earlier validation is still running it may still decide to mark fields as failed.
    const defer = Promise.withResolvers<ValidationResult>();
    this.validationqueue.push({ defer, limitset, options });
    if (this.validationqueue.length === 1)
      this._executeNextValidation(); //we're first on the queue so process it

    return defer.promise;
  }

  async _executeNextValidation() {
    while (this.validationqueue.length) {
      const item = this.validationqueue[0];
      try {
        const result = await this._executeQueuedValidation(item.limitset, item.options);
        item.defer.resolve(result);
      } catch (error) {
        item.defer.reject(error as Error);
      }
      this.validationqueue.shift(); //remove the top item
    }
  }

  async _executeQueuedValidation(limitset?: LimitSet, options?: ValidationOptions): Promise<ValidationResult> {
    const original = limitset;
    if (!limitset)  //validate entire form if unspecified what to validate
      limitset = this._getFieldsToValidate();

    const tovalidate = new Set<HTMLElement>;
    for (const node of Array.isArray(limitset) ? limitset : [limitset]) {
      /* If you're explicitly validating a radio/checkbox, we need to validate its group (but not recurse down) as that's where radiogroup.es and checkboxgroup.es attach their validations
         If you're targeting a group, we'll end up validating both the radio/checkbox (directly attached here) and any eg. embedded textedits  */
      if (node.matches(`input[type=radio],input[type=checkbox]`)) {
        const group = node.closest<HTMLElement>(".wh-form__fieldgroup");
        if (group)
          tovalidate.add(group);
        continue;
      }

      if (this._shouldValidateField(node))
        tovalidate.add(node);
      for (const subnode of this._getFieldsToValidate(node)) //TODO this is overly recursive esp. if limitset is empty...
        tovalidate.add(subnode);
    }

    /* This was:
    tovalidate = Array.from(tovalidate); //we need an array now for further processing
       but that breaks on some old mootools integrations, see https://gitlab.webhare.com/webharebv/codekloppers/-/issues/677#note_146801
       wokaround: */
    let tovalidatelist = [...tovalidate]; //we need an array now for further processing

    if (options && options.iffailedbefore)
      tovalidatelist = tovalidatelist.filter(node => hasEverFailed(node));

    if (debugFlags.fhv)
      console.log("[fhv] Validation of %o expanded to %d elements: %o", original, tovalidatelist.length, [...tovalidatelist]);

    const lock = dompack.flagUIBusy();
    try {
      if (!tovalidatelist.length)
        return { valid: true, failed: [], firstfailed: null };

      const validationresults = await Promise.all(tovalidatelist.map(fld => this._validateSingleFieldOurselves(fld)));
      //remove the elements from validate for which the promise failed
      const failed = tovalidatelist.filter((fld, idx) => !validationresults[idx]);
      const result: ValidationResult = {
        valid: failed.length === 0,
        failed: failed,
        firstfailed: null
      };

      result.firstfailed = result.failed.length ? result.failed[0] : null;
      if (result.firstfailed && (!options || options.focusfailed)) {
        //FIXME shouldn't getFocusableComponents also return startnode if focusable?
        const tofocus = domfocus.canFocusTo(result.firstfailed) ? result.firstfailed : domfocus.getFocusableComponents(result.firstfailed)[0];
        if (tofocus)
          dompack.focus(tofocus, { preventScroll: true });

        this.scrollIntoView(result.firstfailed);
      }

      if (debugFlags.fhv)
        console.log(`[fhv] Validation of ${tovalidatelist.length} fields done, ${result.failed.length} failed`, result);

      return result;
    } finally {
      lock.release();
    }
  }

  reset() {
    this.node.reset();
  }
}
