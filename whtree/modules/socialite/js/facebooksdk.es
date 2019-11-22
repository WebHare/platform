import * as facebooksdk from './facebook/sdk';

module.exports = { configure: facebooksdk.configure
                 , load: facebooksdk.load
                 , isLoaded: facebooksdk.isLoaded
                 , launchFeedDialog: facebooksdk.launchFeedDialog
                 , launchLoginDialog: facebooksdk.launchLoginDialog
                 , launchShareDialog: facebooksdk.launchShareDialog
                 , getSocialiteToken: facebooksdk.getSocialiteToken
                 , onready: facebooksdk.onready
                 };
