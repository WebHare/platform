/**
import * as whintegration from '@mod-system/js/wh/integration';
*/

import * as dompack from 'dompack';

export let config = {};

function generateForm(action, values, method)
{
  var form = dompack.create("form", { action: action, method: method || "POST", charset: "utf-8" });
  if(values instanceof Array)
  {
    values.forEach(function(item)
    {
      form.appendChild(dompack.create("input", { type: "hidden", name: item.name, value: item.value }));
    });
  }
  else Object.keys(values, key =>
  {
    form.appendChild(dompack.create("input", { type: "hidden", name: key, value: values[key] }));
  });
  return form;
}

function submitForm(action, values, method)
{
  var form = generateForm(action, values, method);
  document.body.appendChild(form);
  form.submit();
}

export function executeSubmitInstruction(instr, options)
{
  if(!instr)
    throw Error("Unknown instruction received");

  options = Object.assign({ ismodal: true }, options);
  //Are there any cirumstances where you would want to reelase this lock?
  dompack.flagUIBusy({ ismodal: options.ismodal });

  if (options.iframe)
  {
    switch (instr.type)
    {
      case "redirect":
      {
        options.iframe.src = instr.url;
      } break;

      case "form":
      {
        // FIXME: Clear iframe if document is not cross-domain accessible
        var idoc = options.iframe.document || options.iframe.contentDocument || options.iframe.contentWindow.document;

        var form = generateForm(instr.form.action, instr.form.vars, instr.method);
        var adopted_form = idoc.adoptNode(form);
        idoc.body.appendChild(adopted_form);
        adopted_form.submit();
      } break;

      default:
      {
        throw Error("Unknown submit instruction '" + instr.type + "' for iframe received");
      }
    }
    return;
  }

  switch (instr.type)
  {
    case "redirect":
    {
      location.href=instr.url;
    } break;

    case "form":
    {
      submitForm(instr.form.action, instr.form.vars, instr.form.method);
    } break;

    case "refresh":
    case "reload":
    {
      window.location.reload();
    } break;

    case "postmessage":
    {
      if (!instr.target || instr.target === "parent")
        parent.postMessage(instr.message, "*");
      else if (instr.target === "opener")
      {
        opener.postMessage(instr.message, "*");
        window.close();
      }
      else
        throw Error("Unknown postmessage target '" + instr.target + "' received");
    } break;

    case "close":
    {
      window.close();
    } break;

    default:
    {
      throw new Error("Unknown submit instruction '" + instr.type + "' received");
    }
  }
}

if(typeof window !== 'undefined') //check we're in a browser window, ie not serverside or some form of worker
{
  let whconfigel = typeof document != "undefined" ? document.querySelector('script#wh-config') : null;
  if(whconfigel)
    config = JSON.parse(whconfigel.textContent);

  // Make sure we have obj/site as some sort of object, to prevent crashes on naive 'if ($wh.config.obj.x)' tests'
  if(!config.obj)
    config.obj={};
  if(!config.site)
    config.site={};

  let errhandler = config["system:errorhandler"];
  if(errhandler)
    console.error(errhandler.statuscode + " " + errhandler.statusmessage);

  if(config.dtapstage == "development")
  {
    dompack.onDomReady(() => setTimeout(() =>
    {
      if(!dompack.qS('wh-outputtools'))
       console.log("You may want to enable the debugging tools for faster CSS/JS updates at", location.origin + "/.publisher/common/debug/");
    },200));
  }

  dompack.initDebug();
}
