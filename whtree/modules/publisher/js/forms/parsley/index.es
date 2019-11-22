import * as dompack from 'dompack';
import * as encoding from "dompack/types/text";
import setLanguageTexts from './language';

export default class ParsleyForm
{
  constructor(jQuery, formnode, options)
  {
    console.error("The WebHare forms/parsleyjs integration has been deprecated and WILL be removed in the future");

    this.validationlock = null;
    this.node = formnode;
    this._pendingvaliditychange = false;
    this.jQuery = jQuery;
    setLanguageTexts();

    options = { trigger: 'focusout'
              , triggerAfterFailure: 'input'
              , errorsContainer: field => this._getErrorsContainer(field)
              , focus: 'none'
              , ...options
              };

    let node = this.jQuery(formnode);
    if(!node.parsley)
      throw new Error("The parsley module was not imported");

    this.parsley = node.parsley(options);
    this.node.__parsley = this.parsley;
    node.on('submit.parsleybackend', (evt) =>
    {
      if(!dompack.dispatchCustomEvent(this.node, 'wh:form-dosubmit', {bubbles:true, cancelable:true}))
        evt.preventDefault();
    });
    this.parsley.on('form:validate', () =>  { if(!this.validationlock) this.validationlock = dompack.flagUIBusy(); });
    this.parsley.on('form:validated', () => { if(this.validationlock) { this.validationlock.release(); this.validationlock= null; }});

    this.parsley.on('field:error', instance =>
    { //if not valid, set error class on wh-form__fieldgroup wrapper
      let group = dompack.closest(instance.$element[0],'.wh-form__fieldgroup');
      if(group)
        group.classList.add('wh-form__fieldgroup--error');
      this._triggerFormValidityChange();
    });

    this.parsley.on('field:success', instance =>
    {
     //if valid, remove error class from fieldgroup wrapper
      if(instance.$element[0].propWhSetFieldError && !instance.$element[0].propWhErrorServerSide)
        return; //do not clear error state if the error is still there
      let group = dompack.closest(instance.$element[0],'.wh-form__fieldgroup');
      if(group)
        group.classList.remove('wh-form__fieldgroup--error');
      this._triggerFormValidityChange();
    });

    this.parsley.on('field:validate', function()
    {
      if(this.$element && this.$element[0].whFormsApiChecker)
        this.$element[0].whFormsApiChecker();
    });

    this.parsley.on('form:error', instance =>
    {
      if(!dompack.dispatchCustomEvent(this.node, 'wh:form-validationfailed', {bubbles:true, cancelable:false }))
        return;

      //Focus first failed element in a dompack-compatible way
      let firstfailed = this.node.querySelector('.parsley-error');
      if(firstfailed)
        dompack.focus(firstfailed);
    });
    this.parsley.on('form:submit', async instance =>
    {
      if(this.node.querySelector('.wh-form__fieldgroup--error')) //block submit if any fields are in (custom) error state
        return false;
      return true;
    });

    this.node.addEventListener("wh:form-beforesubmit", evt => evt.preventDefault()); //this blocks RPC handlers from processing the submit
    this.node.addEventListener("wh:form-validate", evt => this._onValidate(evt));
    this.node.addEventListener("wh:form-response", evt => this._handleResponse(evt.detail));
    this.node.addEventListener('wh:form-setfielderror', evt => this._doSetFieldError(evt));
  }
  _onValidate(evt)
  {
    evt.preventDefault();

    var faillist = [];
    let validationdone = dompack.createDeferred();
    let numtovalidate = evt.detail.tovalidate.length;
    let lock = dompack.flagUIBusy();

    for(let node of evt.detail.tovalidate)
    {
      if(node && node.whFormsApiChecker)
        node.whFormsApiChecker();

      if(node.propWhSetFieldError && !node.propWhErrorServerSide)
      {
        faillist.push(node);
        if(--numtovalidate == 0)
          validationdone.resolve();
        continue;
      }
      this.jQuery(node).parsley().whenValidate().fail( () =>
      {
        faillist.push(node);
      }).always( () =>
      {
        if(--numtovalidate == 0)
          validationdone.resolve();
      });
    }

    validationdone.promise.then( () =>
    {
      lock.release();
      evt.detail.deferred.resolve( { valid: faillist.length == 0
                                   , failed: faillist
                                   });
    });
  }
  _getErrorsContainer(field)
  {
    let detail = { field: field, errorcontainer: null };
    dompack.dispatchCustomEvent(field.$element[0], 'wh:form-geterrorscontainer', { bubbles:true, cancelable: true, detail: detail});
    if(detail.errorcontainer)
      return this.jQuery(detail.errorcontainer);

    let group = dompack.closest(field.$element[0], '.wh-form__fields');
    if(!group)
    {  //just append behind
      let errorhandler = dompack.create('div', { className: 'wh-form__errorlist'
                                               });
      dompack.after(field.$element[0], errorhandler);
      return this.jQuery(errorhandler);
    }

    let errorhandler = group.querySelector('.wh-form__errorlist');
    if(!errorhandler)
    {
      errorhandler = dompack.create('div', { className: 'wh-form__errorlist'
                                           });
      group.appendChild(errorhandler);
    }
    return this.jQuery(errorhandler);
  }
  _doSetFieldError(evt)
  {
    evt.preventDefault();
    this._setError(evt.target, evt.detail.error);
  }
  _setError(field, error)
  {
    let fieldgroupnode = dompack.closest(field, ".wh-form__fieldgroup");
    if(!fieldgroupnode)
    {
      console.error("[fhv] Unable to find .wh-form__fieldgroup parent for node, cannot report error " + error, field);
      return;
    }

    this.jQuery(field).parsley().removeError("formsapierror");
    if(error)
    {
      if(typeof error=='string')
        error = encoding.encodeTextNode(error);

      this.jQuery(field).parsley().addError("formsapierror", { message: error });
      fieldgroupnode.classList.add('wh-form__fieldgroup--error');
    }
    else
    {
      fieldgroupnode.classList.remove('wh-form__fieldgroup--error');
    }
  }
  _handleResponse(result)
  {
    //Parsley bug? first remove old custom error text(s)
    for (let node of this.node.querySelectorAll(".parsley-errors-list"))
      dompack.empty(node);
  }
  _triggerFormValidityChange()
  {
    if(this._pendingvaliditychange)
      return;

    this._pendingvaliditychange = true;
    setTimeout(() => this._doTriggerFormValidityChange(), 0);
  }
  _doTriggerFormValidityChange()
  {
    this._pendingvaliditychange = false;
    dompack.dispatchCustomEvent(this.node, 'wh:form-validitychange', {bubbles:true, cancelable:true});
  }
}

