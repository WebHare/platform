const SocialiteNetwork = require('./socialitenetwork');

let linkedin = null;

function initializeSDK(appid)
{
  if(linkedin)
    throw new Error("LinkedIn SDK already initialized");

  linkedin = new SocialiteNetwork(appid);
}

function login(options)
{
  if(!linkedin)
    throw new Error("LinkedIn SDK not yet initialized");

  return new Promise( (resolve, reject) =>
  {
    try
    {
      linkedin.openLoginDialog( (result) => { result.accepted = true; resolve(result); }
                              , (result) => { result.accepted = false; resolve(result); }
                              , options
                              );
    }
    catch(e)
    {
      reject(e);
    }
  });
}


module.exports = { initializeSDK: initializeSDK
                 , launchLoginDialog: login
                 };
