/* globals dymo */ //needed for eslint

function buildLabel(labelxml, fields)
{
  var label = dymo.label.framework.openLabelXml(labelxml);
  var names = label.getObjectNames();
  for(var i=0;i<fields.length;++i)
  {
    if(names.indexOf(fields[i].name)==-1)
    {
      console.warn("No such field '" + fields[i].name + "' to set value '" + fields[i].value + "'");
      continue;
    }
    console.log("Setting '" + fields[i].name + "' to '" + fields[i].value + "'");
    label.setObjectText(fields[i].name, fields[i].value);
  }
  return label;
}

function onMessage(event)
{
  console.log('dymointegration onmessage',event);
  var label;

  //FIXME print & render paden samenvoegen zoveel mogelijk
  if(event.data.msgtype=="print")
  {
    var labelSet = new dymo.label.framework.LabelSetBuilder();
    for(var i=0;i<event.data.labels.length;++i)
    {
      var fields = event.data.labels[i].fields;
      var record = labelSet.addRecord();
      for(var j=0;j<fields.length;++j)
        record.setText(fields[j].name, fields[j].value);
    }
    //let's print what the user actually requested
    label = dymo.label.framework.openLabelXml(event.data.labelxml);
    label.print(event.data.printer, '', labelSet);

    //ik denk dat we printLabel moeten gebruikne om meerdere labels te printen via labelSetXml? dat lijkt records aan te nemen
    //zie ook http://developers.dymo.com/2010/06/17/dymo-label-framework-javascript-library-print-multiple-labels/
  }

  else if(event.data.msgtype=="save")
  {
    //let's print what the user actually requested
    let fields = event.data.labels[0].fields;
    label = buildLabel(event.data.labelxml, fields);
    window.parent.postMessage({ label: label.getLabelXml(), __requesttoken: event.data.__requesttoken},'*');
  }
  else if(event.data.msgtype=="render")
  {
    let fields = event.data.labels[0].fields;
    label = buildLabel(event.data.labelxml, fields);
    dymo.label.framework.renderLabelAsync(label.getLabelXml(), '', event.data.printer).then(function(res)
      {
        window.parent.postMessage({ msgtype: "dymo.gotrender", data: res },"*");
      }).thenCatch(function(err)
      {
        console.error("DYMO reported error:",err);
      });
  }
}

function informParentAboutPrinters(printers)
{
  var printerlist = [];
  for(var i=0;i<printers.length;++i)
  {
    var printerdata = printers[i];
    printerlist.push( { name: printerdata.name
                      , modelname:printerdata.modelName
                      , printertype: printerdata.printerType
                      , isconnected: printerdata.isConnected
                      , islocal: printerdata.isLocal
                      , istwinturbo: printerdata.isTwinTurbo
                      });
  }
  window.parent.postMessage({ msgtype: "dymo.gotprinters", printerlist: printerlist },'*');
}

function startupCode()
{
  //informParentAboutPrinters(dymo.label.framework.getPrinters());
  dymo.label.framework.getPrintersAsync().then(informParentAboutPrinters); // this seems slower and still xhr sync ??
}

console.log("DYMO",dymo);
dymo.label.framework.init(startupCode);


window.addEventListener("message", onMessage);
