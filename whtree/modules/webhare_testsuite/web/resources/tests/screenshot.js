function main()
{
  console.log("test message");
  new Promise( (resolve,reject) => reject("Test uncaught promise rejection"));
  var a = {};
  a.boem();
}

main();
