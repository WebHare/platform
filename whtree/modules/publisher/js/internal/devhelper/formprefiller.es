import { changeValue } from 'dompack/src/events';

function setupFormPrefiller(form)
{
  if(form.outputtools_prefiller)
    return;

  var prefiller = form.outputtools_prefiller = { form: form };
  prefiller.basename = 'wh-form:' + location.href.split('//')[1].split('?')[0].split('#')[0];
  prefiller.prefillarea = document.createElement('div');
  prefiller.prefillarea.className="wh-form__prefillarea";
  form.insertBefore(prefiller.prefillarea, form.firstChild);

  prefiller.prefillselect = document.createElement('select');
  prefiller.prefillselect.className="wh-form__prefillcontrol";
  prefiller.prefillarea.appendChild(prefiller.prefillselect);
  prefiller.prefillselect.addEventListener("change", onPrefillChoice);

  refreshPrefiller(prefiller);
}

function refreshPrefiller(prefiller)
{
  prefiller.prefillselect.innerHTML = '<option>Select prefill</option><option data-type="reset">Reset</option><option data-type="addnew">Add new...</option>';

  var names = window.localStorage[prefiller.basename + '$names'];
  if(names)
    names.split('\t').forEach(name =>
    {
      var opt = document.createElement('option');
      opt.textContent =  "Prefill '" + name + "'";
      opt.dataset.prefill = name;
      prefiller.prefillselect.insertBefore(opt, prefiller.prefillselect.childNodes[prefiller.prefillselect.childNodes.length-2]);
    });
}

function onPrefillChoice(event)
{
  var i, name, fields, el;

  var prefiller = this.form.outputtools_prefiller;
  var sel = prefiller.prefillselect.selectedOptions[0];
  if(sel.getAttribute("data-type") == "addnew")
  {
    name = prompt("Enter a name for the new prefill", prefiller.lastselection);
    if(!name)
    {
      prefiller.prefillselect.selectedIndex=0;
      return;
    }

    var names = (window.localStorage[prefiller.basename + '$names'] || '').split('\t').filter(function (val) { return val; });
    if(names.indexOf(name) == -1)
      names.push(name);

    window.localStorage[prefiller.basename + '$names'] = names.join('\t');

    fields = {};
    for (i=0;i<this.form.elements.length;++i)
    {
      el = this.form.elements[i];
      if(!el.name)
        continue;

      if(el.type=='radio' || el.type=='checkbox')
      {
        if(!el.checked)
          continue;
        if(!fields[el.name])
          fields[el.name] = [el.value];
        else
          fields[el.name].push(el.value);
      }
      else
      {
        fields[el.name] = el.value;
      }
    }

    window.localStorage[prefiller.basename + '$name-' + name] = JSON.stringify(fields);
    refreshPrefiller(prefiller);
  }
  else if(sel.dataset.type == "reset")
  {
    prefiller.form.reset();
  }
  else if(sel.dataset.prefill)
  {
    name = sel.dataset.prefill;
    prefiller.lastselection = name;

    fields = JSON.parse(window.localStorage[prefiller.basename + '$name-' + name]);
    for (i=0;i<this.form.elements.length;++i)
    {
      el = this.form.elements[i];
      if(!el.name || !(el.name in fields))
        continue;

      if(el.type=='radio' || el.type=='checkbox')
        changeValue(el, fields[el.name] && fields[el.name].includes(el.value));
      else
        changeValue(el, fields[el.name]);
    }
  }
  prefiller.prefillselect.selectedIndex=0;
}


export function scanPrefillableForms()
{
  if(document.documentElement.classList.contains('dompack--debug-nofhp'))
    return;
  var forms = document.querySelectorAll("form[method=post]:not(.wh-form--neverprefill)");
  for(var i=0;i<forms.length;++i)
    setupFormPrefiller(forms[i]);
}

window.addEventListener('dompack:debugflags-changed', scanPrefillableForms);
