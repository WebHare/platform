#include <ap/libwebhare/allincludes.h>

#include "webscon.h"
#include <blex/utils.h>
#include <blex/logfile.h>

//#define WEBSCONDEBUG    //Define to enable debugging

#if defined(WEBSCONDEBUG) && defined(DEBUG)
 #define WS_PRINT(x) DEBUGPRINT(x)
 #define WS_ONLY(x) x
#else
 #define WS_PRINT(x)
 #define WS_ONLY(x)
#endif

/* Anatomy of a HTTP request.
   the dealing with connections, SLL, requests and persistence is done by webscon-io.cpp
   the general syntax of a 'proper' request is

   -> (incoming connection)
   -> ResetNewConnection() is called (constructor or webscon-io.cpp)

   for every request the following functions contained in THIS file are called:
   -> ResetNewRequest(): clear state for new request
   -> IF header is completely received AND statuscode_so_far = 200
      -> ProcessRequestHeader()
   -> IF body is completely received AND statuscode_so_far = 200
      -> ProcessRequest()
   -> ExecuteRequest() is called
*/

//ADDME: Better division of labour between webscon-response and webscon, and others.

namespace WebServer
{

namespace
{
const unsigned int WebSocketBufferSize = 65536;
}

void RemoveBangParts(std::string *path)
{
        //Remove any semicolon parts. /!xxx/ is an ignored path component, /! and /!/ terminate the path completely
        //  /!xx/!yy/ should translate to '/'.
        std::string::iterator pos = path->begin();
        while(pos != path->end())
        {
                if(*pos != '!')
                {
                        std::string::iterator nextslash = std::find(pos, path->end(), '/');
                        if(nextslash == path->end())
                                return; //done
                        pos = nextslash+1;
                        continue;
                }

                if((pos + 1) == path->end() || pos[1]=='/') //truncation of URL
                {
                        path->erase(pos, path->end());
                        return;
                }

                std::string::iterator slash = std::find(pos, path->end(), '/');
                path->erase(pos, slash == path->end() ? path->end() : slash + 1);
        }
}

/* FIXMEs an ADDMEs
   - Reimplement timeouts, avoid DoS.
   - Replace Internal errors with true HTTP errors
   - Bad output buffering - we buffer and send data in multiples of KBs, but
     the socket layer will send in multiples of MTUs. This lowers our
     performance because we will be sending out too-short packets.*/

// -----------------------------------------------------------------------------
//
// Authentication
//

void Authentication::Reset()
{
        auth_type = None;
        seen_username.clear();
        password.clear();
}

// -----------------------------------------------------------------------------
//
// Connection
//

Connection::Connection(Server *base, void *disp)
: Blex::Dispatcher::Connection(disp)
, server(base)
, current_category(0)
, requested_category(0)
, is_sleeping(false)
, is_sleeping_for_flush(false)
, is_sleeping_for_signal(false)
{
        WS_PRINT("Generated a connection!");
        webserver=base;
        connection.config=NULL;
        connection.binding=NULL;
        ResetNewConnection();
}

Connection::~Connection()
{
        ResetNewConnection();
        WS_PRINT("A connection died!");
}

void Connection::ResetNewConnection()
{
        connection.Reset();
        ResetNewRequest();
}

bool Connection::ExpandDefaultPages()
{
        unsigned current_pathsize=disk_file_path.size();

        if (!Blex::PathStatus(disk_file_path).Exists())
            return false;

        std::vector<std::string>::const_iterator curpage;
        if(request->website)
        {
                for (curpage = request->website->defaultpages.begin();
                     curpage != request->website->defaultpages.end();
                     ++curpage)
                {
                        //We can try this default page!
                        disk_file_path.insert(disk_file_path.end(),curpage->begin(),curpage->end());
                        if (request->header_debugging)
                            AddHeader("X-WH-TryPath", disk_file_path, true);
                        request->filestatus.Stat(disk_file_path);
                        if (request->filestatus.IsFile())
                        {
                                requested_path.insert(requested_path.end(),curpage->begin(),curpage->end());
                                return true;
                        }

                        //Didn't work, restore original disk_file_path
                        disk_file_path.erase(disk_file_path.begin()+current_pathsize,disk_file_path.end());
                }
        }
        return false;
}

bool CompareCaseInsensitive(char lhs, char rhs)
{
        return std::toupper(lhs) == std::toupper(rhs);
}


bool Connection::RedirectAlternativePath(std::string const &inpath)
{
        DEBUGPRINT("******** RedirectAlternativePath " <<  inpath);

        //FIXME get from config
        std::vector<std::string> const &stripextensions = connection.config->stripextensions;

        for (unsigned i=0;i<stripextensions.size();++i)
        {
                DEBUGPRINT("******** Find " << stripextensions[i] <<  " in " << inpath);
                std::string::const_iterator extpos = std::search(inpath.begin(), inpath.end()
                                                                ,stripextensions[i].begin(), stripextensions[i].end()
                                                                ,CompareCaseInsensitive);

                if(extpos == inpath.end())
                    continue;

                //the extension must be followed by a '/' or the end of the pathname
                std::string::const_iterator after_extension = extpos + stripextensions[i].size();
                if(after_extension != inpath.end())
                {
                        if(after_extension[0] != '/')
                            continue;
                        if(std::find(after_extension+1, inpath.end(), '/') != inpath.end()) //too many components, this can't be an old style redirect
                            continue;
                }

                DEBUGPRINT("************ Match " << std::string(extpos,inpath.end()));

                //Remove the extension. does that lead us to an existing file?
                std::string copypath(inpath);
                std::copy(after_extension, inpath.end(), copypath.begin() + std::distance(inpath.begin(), extpos));
                copypath.resize(copypath.size () - stripextensions[i].size());
                DEBUGPRINT("Check on disk: " << copypath);

                if (request->header_debugging)
                    AddHeader("X-WH-TryPath", copypath, true);
                Blex::PathStatus alternative(copypath);
                if(alternative.Exists())
                {
                        DEBUGPRINT("Alternative exists. Find a redirect");
                        RequestParser const &reqparser = GetRequestParser();

                        std::string newlocation = reqparser.GetReceivedUrl();
                        std::string::iterator urlextpos = std::search(newlocation.begin(), newlocation.end()
                                                                     ,stripextensions[i].begin(), stripextensions[i].end()
                                                                     ,CompareCaseInsensitive);
                        if(urlextpos != newlocation.end())
                        {
                                std::copy(urlextpos + stripextensions[i].size(), newlocation.end(), urlextpos);
                                newlocation.resize(newlocation.size() - stripextensions[i].size());

                                AddHeader("Location",8,&newlocation[0],newlocation.size(),false);
                                protocol.status_so_far = StatusMovedPermanently;
                                return true;
                        }
                }
        }

        if (!base_file_path.empty())
        {
                if (!Blex::StrStartsWith(disk_file_path, base_file_path.c_str()))
                {
                        Blex::ErrStream() << "base_file_path is not a prefix of disk_file_path " << base_file_path << " " << disk_file_path << " for " << request->reqparser.GetReceivedUrl();
                        return false;
                }

                std::string testpath = base_file_path; //start at webserver root
                std::string::iterator itr = disk_file_path.begin() + base_file_path.size();
                std::string capturing_index_folder;
                for (unsigned i = 0; i < 15; ++i) // test max 15 path components
                {
                        if (request->header_debugging)
                            AddHeader("X-WH-TryUseIndexMarker", testpath, true);

                        Blex::PathStatus marker(testpath + "^^useindex");
                        if(marker.Exists())
                                capturing_index_folder = testpath;

                        std::string::iterator compend = std::find(itr, disk_file_path.end(), '/');
                        if (compend == disk_file_path.end())
                            break;

                        ++compend;
                        std::copy(itr, compend, std::back_inserter(testpath));
                        itr = compend;
                }
                if(!capturing_index_folder.empty())
                {
                        disk_file_path = capturing_index_folder;
                        return ExpandDefaultPages();
                }
        }
        return false;
}

unsigned Connection::TryPath(bool fixcase)
{
        if (request->header_debugging)
            AddHeader("X-WH-TryPath", disk_file_path, true);

        request->filestatus.Stat(disk_file_path);
        if(!request->filestatus.Exists() && fixcase)
        {
                DEBUGPRINT("Initial request failed for " << disk_file_path << ", look for alternative names");

                std::string tryupdatepath = disk_file_path;
                //ADDME: optimization is probably possible if/when this becomes a bottleneck, eg work backwards and first do 'stat' syscalls to determine for existence
                //ADDME: this'll probably fail on UNC names, we need to find the 'unmodifiable' part of a path
                std::string::iterator properpart = base_file_path.empty()
                        ? std::find(tryupdatepath.begin()+1, tryupdatepath.end(),'/')
                        : tryupdatepath.begin() + base_file_path.size() - 1;

                while(properpart != tryupdatepath.end())
                {
                        std::string::iterator partend = std::find(properpart+1, tryupdatepath.end(),'/');
                        std::string dirtoscan(tryupdatepath.begin(), properpart);
                        std::string parttofind(properpart+1, partend);

                        DEBUGPRINT("Scan " << dirtoscan << " for " << parttofind);
                        bool found=false;
                        for(Blex::Directory diritr(dirtoscan,"*");diritr;++diritr)
                        {
                                if(Blex::StrCaseCompare(diritr.CurrentFile(), parttofind)==0)
                                {
                                        DEBUGPRINT("Matched with " << diritr.CurrentFile());
                                        //overwrite it
                                        std::copy(diritr.CurrentFile().begin(), diritr.CurrentFile().end(), properpart+1);
                                        found=true;
                                        break;
                                }
                        }

                        if(!found)
                        {
                                DEBUGPRINT("Failed, bailing out");
                                return 1;
                        }
                        properpart = partend;
                }
                DEBUGPRINT("The fixed path is: " << tryupdatepath);
                disk_file_path = tryupdatepath;

                if (request->header_debugging)
                    AddHeader("X-WH-TryPath", disk_file_path, true);

                request->filestatus.Stat(disk_file_path);
        }

        if (request->filestatus.IsDir())
            return 2;

        //See if the file is there
        if (!request->filestatus.IsFile())
        {
                return 1;
        }
        return 0;
}

void Connection::RedirectIntoDirectory()
{
        RequestParser const &reqparser = GetRequestParser();

        std::string newlocation = reqparser.GetReceivedUrl();
        //insert a slash at the URL variables position
        newlocation.insert(reqparser.GetReceivedUrlVarSeparator() - reqparser.GetReceivedUrl().begin(), 1, '/');

        AddHeader("Location",8,&newlocation[0],newlocation.size(),false);
        protocol.status_so_far = StatusMovedPermanently;
}

//-----------------------------------------------------------------------------
//
//
// Main request protocol
//
//
//-----------------------------------------------------------------------------

void Connection::CheckHeaderDebugging()
{
        if (connection.config->debugurlmasks.empty())
            return;

        std::string serverrequesturl = request->GetRequestURL(RequestURLType::ForServer);
        for (auto &itr: connection.config->debugurlmasks)
            if (Blex::StrCaseLike(serverrequesturl, itr))
            {
                    AddHeader("X-WH-ServerRequestURL", serverrequesturl, false);
                    request->header_debugging = true;
                    break;
            }
}

void Connection::ProcessRequestHeader()
{
        if (!OkToContinue())
            return; //if we're already failed, we're broken at protocol level and then there's no need to process the request

        RequestParser &reqparser = GetRequestParser();

        //Clear the output disk_file_path, so we can detect when an Access rule has already updated it
        disk_file_path.clear();
        base_file_path.clear();
        //Clear the content type, so we can detect when an Access rule has already updated it
        contenttype = NULL;

        //Re-configure if necessary, because we reset the config between requests
        if (!connection.config)
        {
                connection.config=webserver->ObtainConfig(); //ADDME: probably a RefreshConfig would be enough..
                //ADDME: Ugly fix - binding gets 'destroyed' by ObtainConfig if a new config is available so we need to rebuild it.
                connection.binding=connection.config->FindBinding(GetListeningAddress());
                if (!connection.binding)
                {
                        FailRequest(StatusServiceUnavailable, "Got a connection on a non-existing binding");

                        // Disconnect, and make sure processing stops
                        AsyncSignal(Blex::Dispatcher::Signals::Hangup);
                        return;
                }
        }

        // Binding to use for lookup
        request->binding = connection.binding;

        // Process parsed X-WH-Proxy header only for trusted sites
        if (GetRequestParser().GetHaveWHProxy() && request->binding->istrustedport)
        {
                request->remoteaddress = GetRequestParser().GetWHProxyRemoteAddr();
                request->remoteaddress.SetPort(0);
                request->scheme = GetRequestParser().GetWHProxyProto();
                if(request->scheme == "https")
                    request->is_client_secure = true;

                Listener const *bindingoverride = nullptr;
                if (GetRequestParser().GetWHProxyBindingOverride() != 0)
                    bindingoverride = connection.config->FindBindingById(GetRequestParser().GetWHProxyBindingOverride());

                if (bindingoverride)
                {
                        request->binding = bindingoverride;
                        request->is_virtual_host = bindingoverride->virtualhosting;
                        if (bindingoverride->virtualhosting)
                        {
                                if (request->is_client_secure)
                                    request->is_secure = true;
                        }
                        else if (!bindingoverride->listener.privatekey.empty()) // ADDME: fails for invalid settings
                            request->is_secure = true;
                }
                else if (request->is_client_secure)
                    request->is_secure = true;

                if (!GetRequestParser().GetWHProxyLocalAddr().IsAnyAddress())
                    request->localaddress = GetRequestParser().GetWHProxyLocalAddr();
        }
        //Process xforwarded for overwrites, if any (ADDME store whole xforwardedfor chain for more trusted ips)
        else if(!GetRequestParser().GetXforwardedFor().IsAnyAddress() || !GetRequestParser().GetXforwardedProto().empty())
        {
                bool trusted = connection.binding->istrustedport;
                if(!trusted)
                  for(unsigned i=0;i<connection.config->trust_xforwarded_for.size();++i)
                    if(connection.config->trust_xforwarded_for[i].IsSameIPAs(request->remoteaddress))
                {
                        trusted = true;
                        break;
                }

                if(trusted)
                {
                        WS_PRINT("Accepting X-Forwarded-For from " << GetRemoteAddress() << " telling us the request actually came from " << GetRequestParser().GetXforwardedFor());
                        request->remoteaddress = GetRequestParser().GetXforwardedFor();
                        request->remoteaddress.SetPort(0);
                        request->scheme = GetRequestParser().GetXforwardedProto();
                        if(request->scheme == "https")
                        {
                                request->is_client_secure = true;
                                // Only works for virtual hosted sites, so we can set is_secure
                                request->is_secure = true;
                        }
                }
        }

        //Resolve the URL to a website
        //DEBUGPRINT("Resolve url:" << reqparser.GetReceivedUrl() << " persistent:" << protocol.persistent);
        if(reqparser.IsProxyRequest()) //forward all proxy server traffic to a fake server called '_proxy' - not for trusted ports, but for request of full URLs
            request->hostname = "_proxy";

        request->website = connection.config->FindWebSite(request->binding, request->hostname);

        // Check if header debugging is enabled for this url
        CheckHeaderDebugging();

        //Some paths are globally handled: not hit by website specific rules
        bool is_globally_handled = Blex::StrCaseLike(requested_path,"/.well-known/acme-challenge/*") || Blex::StrCaseLike(requested_path,"/.webhare/direct/*");

        //Any HTTPS redirect MUST be done before matching IP or requesting auth, as they may change or cause unencrypted logins
        //We'll now move them to the webserver level itself - if you're access a https://-marked webserver over http, you'll be redirected
        if(request->website && request->website->forcehttps && !request->is_client_secure && !is_globally_handled)
        {
                std::string desturl = "https://";
                request->AddRequestHostTo(&desturl, request->website->forcehttpsport);
                desturl.insert(desturl.end(), request->reqparser.GetReceivedUrl().begin(), request->reqparser.GetReceivedUrl().end());

                Methods method = reqparser.GetProtocolMethod();
                RedirectRequest(desturl, (method == Methods::Get || method == Methods::Head) ? WebServer::StatusMovedPermanently : WebServer::StatusTemporaryRedirect);
                return;
        }

        //Remove any bang parts
        RemoveBangParts(&requested_path);

        if (request->website && request->website->lowercasemode)
            Blex::ToLowercase(requested_path.begin(), requested_path.end());

        DoAccessCheck(connection.config->globalrules, requested_path, is_globally_handled ? nullptr : request->website);

        // Log the hit rules in headers when header debugging is on
        if (request->header_debugging)
        {
                std::string rules_hit;
                for (auto &itr: request->rules_hit)
                    rules_hit += (rules_hit.empty() ? "" : ",") + std::to_string(itr.rule->id);
                AddHeader("X-WH-AccessRules", rules_hit, false);
        }

        if (!OkToContinue())
             return; //If the access checks failed, stop, the remainer of the rules are only about the URL's file on disk which we'll never retrieve anyway

        //Allow access rules to specify a disk_file_path first
        DoDiskPathRewrites(requested_path, request->website, request->fixcase);
        if (!OkToContinue())
             return;

        if (disk_file_path.empty() && !contenttype) //No disk_file_path resolved, and not forced into a handler yet? (eg consilio,compiler)
        {
                bool expandable_to_defaultpage = !requested_path.empty() && requested_path.end()[-1]=='/';
                if (!request->website)
                {
                        if (request->hostname.empty())
                            FailRequest(StatusNotFound,"Unable to match request for " + GetLocalAddress().ToString() + " to any configured webserver");
                        else
                            FailRequest(StatusNotFound,"Unable to match request for host " + request->hostname + " on " + GetLocalAddress().ToString() + " to any configured webserver");
                }
                else if(expandable_to_defaultpage)
                    FailRequest(StatusNotFound,"Request for index of " + requested_path + " cannot be resolved, no disk path configured");
                else
                    FailRequest(StatusNotFound,"Request for " + requested_path + " cannot be resolved, no disk path configured");
                return;
        }

        if (!contenttype)
        {
                DEBUGPRINT("No contenttype, determining by path");

                contenttype=connection.config->GetContentType(disk_file_path);
                if (!contenttype) //give up...
                {
                        FailRequest(StatusInternalError,"Cannot determine the content type of the requested resource, path: " + disk_file_path);
                        return;
                }
        }

        std::string const *hdr_upgrade = reqparser.GetHeader("Upgrade");
        const char *str_websocket = "websocket";
        bool is_websocket = hdr_upgrade && Blex::StrCaseCompare(*hdr_upgrade, str_websocket, 9) == 0;

        if (contenttype->is_websocket && !is_websocket)
            FailRequest(StatusBadRequest, "This resource only supports websocket connections, path: " + disk_file_path);
        else if (!contenttype->is_websocket && is_websocket)
            FailRequest(StatusBadRequest, "This resource does not support websocket connections, path: " + disk_file_path);

        if (!contenttype->parse_body) //don't decode the header
            reqparser.PreserveBody();

        /* We are now going to check if the method is allowed on this url */
        Methods method = reqparser.GetProtocolMethod();
        if(method != Methods::Get && method != Methods::Post && method != Methods::Head && method != Methods::Options && !GetHandleAllMethods())
        {
                /* This is not your standard get, post, head request
                   do we really want to handle this ? */
                std::string error = "Method '" + reqparser.GetProtocolMethodString() + "' not allowed for " + request->GetRequestURL(RequestURLType::ForServer);
                AddHeader("Allow",5,"GET, HEAD, POST, OPTIONS",24,false);
                FailRequest(StatusMethodNotAllowed, error);
        }
}

/* Does this request want to handle ALL methods (DELETE, COPY, whatever...)
   as opposed to the simple methods (GET and PUT). */
bool Connection::GetHandleAllMethods() const
{
        for (auto &ruleinfo: request->rules_hit)
          if(ruleinfo.rule->all_methods)
            return true;

        return false;
}

void Connection::ProcessRequest()
{
        // Set request processing timeout
        if (connection.config->script_timeout > 0)
        {
                unsigned script_timeout_secs = connection.config->script_timeout;

                WS_PRINT("Setting timeout to " << script_timeout_secs << " seconds");
                SetTimer(Blex::DateTime::Now() + Blex::DateTime::Seconds(script_timeout_secs));
        }
        else
            SetTimer(Blex::DateTime::Invalid());
}

void Connection::DecodeStatusHeader(std::string const &blamescript)
{
        std::string const *status_str = GetPreparedHeader("Status", 6);
        if (status_str)
        {
                /* Set status number */
                WS_PRINT("Found status header, value is: " << *status_str);
                std::pair<uint32_t, std::string::const_iterator> status_decode = Blex::DecodeUnsignedNumber<uint32_t>(status_str->begin(), status_str->end());

                uint32_t statuscode = status_decode.first;
                if ((statuscode<200 || statuscode>599) && !(statuscode == 101 && protocol.is_websocket))
                {
                        //ADDME: Validate and handle status code (eg 1xx, 304 requires us to take special action?)
                        FailRequest(StatusInternalError,"Handler tried to set an invalid status code " + Blex::AnyToString(statuscode));
                }
                else
                {
                        protocol.status_so_far = (StatusCodes)statuscode;
                        while (status_decode.second != status_str->end() && *status_decode.second==' ')
                            ++status_decode.second;
                        if(status_decode.second != status_str->end())
                            protocol.status_additional_message.assign(status_decode.second, status_str->end());

                        if(statuscode == StatusInternalError) //internal server error. log to errors.log because unlogged 500s confuse webmasters
                        {
                                if(!protocol.status_additional_message.empty())
                                    request->ErrorLog("Script " + blamescript + " manually set status code 500 with message: " + protocol.status_additional_message);
                                else
                                    request->ErrorLog("Script " + blamescript + " manually set status code 500 without further information");
                        }
                }
                /* Delete status, it's not really a header line */
                AddHeader("Status", 6, "", 0, false);
        }
        std::string const *conn_str = GetPreparedHeader("Connection", 10);
        if (conn_str) //FIXME: Properly parse tokens
        {
                if (Blex::StrCaseCompare(*conn_str,"Close")==0)
                    protocol.persistent=false;
                else if (Blex::StrCaseCompare(*conn_str,"Keep-Alive")==0)
                    protocol.persistent=true;
                else
                    protocol.persistent=false; // Unknown connection-token
        }
}

void Connection::SetContentDispAttach(const char *filename_begin, unsigned filename_length)
{
        std::string header = "attachment";
        if(filename_length)
        {
                header += "; filename=\"";
                Blex::EncodeJava(filename_begin, filename_begin + filename_length, std::back_inserter(header));
                header += "\"";
        }
        AddHeader("Content-Disposition",19,header.data(),header.size(),false);
}

void Connection::WaitForSignal()
{
        is_sleeping=true;
        is_sleeping_for_signal=true;
}

bool Connection::FlushResponse(FlushCallback const &_flushcallback)
{
        if(protocol.responded && !protocol.continuing_response)
        {
                request->ErrorLog("FlushResponse after already sending a response");
                return false;
        }

        protocol.persistent = false;
        protocol.continuing_response = true;
        if(!protocol.sent_headers)
        {
                DecodeStatusHeader(disk_file_path);
                SetupFinalHeaders();
                ScheduleHeaderForSending();
        }
        protocol.responded = true;

        {
                LockedOutputData::WriteRef lock(lockedoutputdata);
                if (lock->output_body.Empty() && !protocol.is_websocket)
                    return false;

                if (GetRequestParser().GetProtocolMethod() != Methods::Head) //send a body?
                {
                        total_output_size += lock->output_body.Length();
                        lock->output_body.AddToQueue(&final_senddata);
                }
        }
        ScheduleOutgoingData();

        is_sleeping=true;
        is_sleeping_for_flush=true;
        if (protocol.async_response)
            flushcallback = _flushcallback;
        else
            flushcallback = 0;
        return true;
}

void Connection::PostProcessAfterHandler()
{
        if(protocol.responded && protocol.continuing_response) //If we're part of a continuing response, no need to rewrite headers
           return;

        if (protocol.status_so_far == StatusOK)
        {
                if (contenttype && contenttype->force_disposition_attachment && !IsHeaderSet("Content-Disposition",19))
                {
                        std::string::size_type lastslash = disk_file_path.rfind('/');
                        if(lastslash!=std::string::npos)
                            SetContentDispAttach(disk_file_path.c_str()+lastslash+1, disk_file_path.size()-lastslash-1);
                        else
                            SetContentDispAttach(NULL, 0);
                }
        }

        if(protocol.status_so_far >= 200 && protocol.status_so_far <= 399 && !IsHeaderSet("Cache-Control",13))
        {
                std::string const *cachecontrol = nullptr;

                for (auto &ruleinfo: request->rules_hit)
                    if (!ruleinfo.rule->cachecontrol.empty())
                        cachecontrol = &ruleinfo.rule->cachecontrol;

                if(cachecontrol)
                        AddHeader("Cache-Control", 13, &(*cachecontrol)[0], cachecontrol->size(), true);
        }

        if (!IsHeaderSet("Content-Type",12) && contenttype && GetRequestParser().GetProtocolMethod() != Methods::Options)
            AddHeader("Content-Type",12,&contenttype->contenttype[0],contenttype->contenttype.size(),true);
        DecodeStatusHeader(disk_file_path);
}

void Connection::ExecuteRequest()
{
        //ADDME: Only set headers that weren't yet: SetDefaultWebvars();

        if (OkToContinue() && GetRequestParser().GetProtocolMethod() == Methods::Options && !GetHandleAllMethods())
        {
                AddHeader("Allow",5,"GET, HEAD, POST, OPTIONS",24,false);
        }
        else if (OkToContinue() && contenttype)
        {
                try
                {
                        // Execute content handler
                        (contenttype->handler)(this,disk_file_path);

                        if (is_sleeping && !is_sleeping_for_flush && !is_sleeping_for_signal) //We have been put to sleep for async request
                        {
                                EnableIncomingData(false);
                                return;
                        }

                        // Disable the script timeout
                        SetTimer(Blex::DateTime::Invalid());

                        if (is_sleeping) //We have been put to sleep for flush or category change
                        {
                                EnableIncomingData(false);
                                return;
                        }
                }
                catch(std::exception &e)
                {
                        FailRequest(StatusInternalError,e.what());
                }
        }
        if (!is_sleeping || !protocol.async_response)
            FinishRequest();
}

void Connection::FinishRequest()
{
        try
        {
                PostProcessAfterHandler();
        }
        catch(std::exception &e)
        {
                FailRequest(StatusInternalError,e.what());
        }

        RequestParser const &reqparser = GetRequestParser();

        bool is_normal_page = false;
        if(protocol.continuing_response)
        {
                //Terminating it
                protocol.continuing_response = false;
                LockedOutputData::WriteRef lock(lockedoutputdata);
                lock->output_body.AddToQueue(&final_senddata);
        }
        else
        {
                is_normal_page = !protocol.responded;
                if (reqparser.GetProtocolMajor()==1 && reqparser.GetProtocolMinor()==0)
                {
                        //303 responses don't exist in HTTP/1.1, so convert them to 302s
                        if (protocol.status_so_far == StatusSeeOther)
                            protocol.status_so_far = StatusFound;
                }

                //Redirection statuses (except 300 Multiple choices) REQUIRE a location header
                if (protocol.status_so_far != 304 && protocol.status_so_far >= 301 && protocol.status_so_far <= 399 && !IsHeaderSet("Location",8))
                    FailRequest(StatusInternalError,"Request caused a Redirection (3xx) response without the required Location header");

                //ADDME: Clean up PrepareResponse et al, the 'is_normal_page' stuff is a bit tricky..
                if (is_normal_page)
                {
                        bool outputempty = LockedOutputData::ReadRef(lockedoutputdata)->output_body.Empty();

                        //SendFile and SendStream weren't invoked yet, so conjure up a response ourselves?
                        if (! (protocol.status_so_far >= 200 && protocol.status_so_far <= 206) //DON'T interact with 'okay' responses
                            && protocol.status_so_far != StatusNotModified
                            && protocol.status_so_far != StatusSwitchingProtocols
                            && outputempty && !protocol.running_error_handler)
                        {
                                //No error body was created yet, so generate one ourselves
                                GenerateErrorContent();

                                // If generating an async response
                                if (protocol.async_response)
                                {
                                        EnableIncomingData(false);
                                        protocol.running_error_handler = true;
                                        return;
                                }
                                PostProcessAfterHandler();
                        }
                        if (!protocol.responded)
                        {
                                unsigned length = LockedOutputData::ReadRef(lockedoutputdata)->output_body.Length();
                                PrepareResponse(length);
                        }
                        else
                            is_normal_page=false;
                }


                //Log any pending errors
                if(!protocol.pending_error_message.empty() && protocol.status_so_far >= 400)
                {
                        request->ErrorLog(protocol.pending_error_message);
                        protocol.pending_error_message.clear();
                }

                SetupFinalHeaders();
                ScheduleHeaderForSending();
        }

        if (reqparser.GetProtocolMethod() != Methods::Head) //send a body?
        {
                if (is_normal_page)
                {
                        LockedOutputData::WriteRef lock(lockedoutputdata);
                        lock->output_body.AddToQueue(&final_senddata);
                }
                else
                {
                        PullFromStreamOrMapping();
                }
        }

        if ( (bool)webserver->accesslogfunction && protocol.status_so_far != StatusRequestTimeout)
            webserver->accesslogfunction(*this, protocol.status_so_far, protocol.status_so_far==StatusNotModified || reqparser.GetProtocolMethod() == Methods::Head ? 0 : total_output_size);

        LeaveCurrentCategory();
        ScheduleOutgoingData();
}

void Connection::AsyncResponseDone()
{
        WS_PRINT("Connection " << this << " has got the full asynchronous response");

        // Not async anymore FIXME: finishrequest can go async again. What about other functions that check for async, can they be called in between now?
        protocol.async_response = false;
        FinishRequest();
}

void Connection::SwitchToWebsocket()
{
        if (!protocol.is_websocket)
        {
                protocol.is_websocket = true;
                EnableIncomingData(true);
        }
}

bool Connection::GetCategoryRunPermission(unsigned category)
{
        if (category == 0)
        {
                LeaveCurrentCategory();
                return true;
        }

        if (current_category == category)
            return true;

        Server::LockedCatConnData::WriteRef catconndata(webserver->lockedcatconndata);

        // Have we already requested a category change before? If so, this is a change of request,a grant of request or a spurious wakeup.
        if (requested_category != 0)
        {
                Server::CategoryData &req_cat = catconndata->FindCategory(requested_category);

                // Find this connection in the queue
                Server::ConnQueue::iterator it = FindThisConnectionInQueue(req_cat.queue);
                if (it == req_cat.queue.end())
                    throw std::runtime_error("Connection category queueing error: expected a connection to be in queue, but could not find it");

                // See if we have run-permission
                bool had_permission = it->second;

                if (requested_category == category && !had_permission)
                {
                        // No, spurious wakeup, wait for the next.
                        return false;
                }

                // Either a grant or change of request. Either way, we don't need the queue entry no more.
                req_cat.queue.erase(it);

                if (requested_category != category)
                {
                        // Change of request; queue other runnables in the old category if needed
                        SignalCategoryRunnables(req_cat);
                }
                else if (had_permission)
                {
                        WS_PRINT("Connection " << this << " entered category " << category);

                        // Grant of request. Yeey!
                        ++req_cat.runcount;
                        current_category = category;
                        requested_category = 0;
                        return true;
                }
        }

        // This is a request for another category, we are not in queue.
        Server::CategoryData &catdata = catconndata->FindCategory(category);

        // See if there is room left for this connection to run
        bool may_run = SignalCategoryRunnables(catdata);
        is_sleeping = !may_run;

        if (may_run)
        {
                // There is room, run immediately
                WS_PRINT("Connection " << this << " entered category " << category);

                ++catdata.runcount;
                current_category = category;
                requested_category = 0;
        }
        else
        {
                // Other connections may run first, wait for them
                WS_PRINT("Connection " << this << " waiting for category " << category);

                catdata.queue.push_back(std::make_pair(this, false));
                requested_category = category;

                WaitForSignal();
        }
        return may_run;
}

bool Connection::SignalCategoryRunnables(Server::CategoryData &catdata)
{
        // Calculate the number of connections that may be run right now.
        unsigned may_run = catdata.max_concurrent - catdata.runcount;
        WS_PRINT("Signalling category runnables, room for " << may_run << " more, " << catdata.queue.size() << " in queue");

        // Make sure the first may_run connections in the queue have run permission, and are signalled at least once.
        for (Server::ConnQueue::iterator it = catdata.queue.begin(), end = catdata.queue.end();
                it != end && may_run != 0;
                ++it, --may_run)
        {
                if (it->second)
                    continue;

                WS_PRINT("*** Signal connection " << it->first << " because of room in category");
                if (it->first->AsyncSignal(Blex::Dispatcher::Signals::Signalled))
                {
                        it->second = true;
                        break;
                }
        }

        // There is room for more connections to run when catdata.runcount + catdata.queue.size() < catdata.max_concurrent
        return may_run != 0;
}

Server::ConnQueue::iterator Connection::FindThisConnectionInQueue(Server::ConnQueue &queue)
{
        Server::ConnQueue::iterator it = queue.begin();
        for (Server::ConnQueue::iterator end = queue.end(); it != end; ++it)
            if (it->first == this)
                break;
        return it;
}

bool Connection::IsSignalValidRunPermission()
{
        // If you are not requesting another category, you don't want to be woken up
        if (requested_category == 0)
            return false;

        Server::LockedCatConnData::WriteRef catconndata(webserver->lockedcatconndata);

        Server::CategoryData &catdata = catconndata->FindCategory(requested_category);
        if (catdata.runcount == catdata.max_concurrent)
            return false;

        Server::ConnQueue::iterator it = FindThisConnectionInQueue(catdata.queue);
        return it->second;
}

void Connection::LeaveCurrentCategory()
{
        if (current_category == 0 && requested_category == 0)
            return;

        WS_PRINT("Connection " << this << " leaving category " << current_category << ", requested " << requested_category);

        Server::LockedCatConnData::WriteRef catconndata(webserver->lockedcatconndata);

        if (requested_category != 0)
        {
                Server::CategoryData &old_req_cat = catconndata->FindCategory(requested_category);

                Server::ConnQueue::iterator it = FindThisConnectionInQueue(old_req_cat.queue);
                if (it == old_req_cat.queue.end())
                    throw std::runtime_error("Connection category queueing error: trying to remove a connection not in the queue");

                old_req_cat.queue.erase(it);
                requested_category = 0;

                SignalCategoryRunnables(old_req_cat);
        }

        if (current_category != 0)
        {
                Server::CategoryData &catdata = catconndata->FindCategory(current_category);
                --catdata.runcount;
                current_category = 0;

                SignalCategoryRunnables(catdata);
        }
}

void Connection::FailRequest(StatusCodes errorcode, std::string const &reason)
{
        protocol.status_so_far = errorcode;
        if (errorcode != StatusRequestTimeout && errorcode != StatusMethodNotAllowed)
            protocol.pending_error_message = reason;
}

void Connection::SetValidatedUsername(std::string const &username)
{
        request->verified_username=username;
}

void Connection::HookEventSignalled(Blex::Event */*event*/)
{
}

// -----------------------------------------------------------------------------
//
// Connection::CurrentConn
//

void Connection::CurrentConn::Reset()
{
        WS_PRINT("Resetting binding");
        binding=NULL;
}

// -----------------------------------------------------------------------------
//
// Connection::Request
//

Request::Request(Server *server)
: refcount(1)
, server(server)
, reqparser(server->GetTempFS())
, requestkeeper(server->GetRequestRegistrator())
{
        Reset();
}

void Request::Reset()
{
        authentication.Reset();
        connected=true;
        binding=NULL;
        website=NULL;
        user_agent=NULL;
        referrer=NULL;
        hostname.clear();
        verified_username.clear();
        condition_ifmodifiedsince=Blex::DateTime::Invalid();
        rules_hit.clear();

        conndata_set = false;
        is_client_secure = false;
        is_secure = false;
        is_virtual_host = false;

        reqparser.ClearState();
        requestkeeper.Reset();

        fixcase=false;
        request_start = 0;
        accept_contentencoding_gzip = false;
        header_debugging = false;
}

void Request::ErrorLog(std::string const &error) const
{
        if (server->errorlogfunction)
            server->errorlogfunction(remoteaddress, error);
}

void Request::AddRequestHostTo(std::string *addto, int32_t overrideport, bool forcehostheader) const
{
        unsigned oldsize = addto->size();

        const std::string *hostheader = reqparser.GetHeader("Host");
        if ((is_virtual_host || forcehostheader) && hostheader) //re-use client specified host
        {
                addto->insert(addto->end(),hostheader->begin(),hostheader->end());
        }
        else if (is_virtual_host && website) //use hostname from host specification
        {
                std::string const &hostname=website->hostname;
                addto->insert(addto->end(), hostname.begin(), hostname.end());
        }
        else
        {
                *addto += localaddress.ToString();
        }

        if (overrideport)
        {
                // Find start of port spec in added host
                auto itr = std::find(addto->begin() + oldsize, addto->end(), ':');
                if (itr != addto->end())
                    addto->erase(itr, addto->end());

                *addto += ":" + Blex::AnyToString(overrideport);
        }

        bool is_https = addto->size() >= 8 && addto->compare(0, 8, "https://") == 0;
        bool is_http = !is_https && addto->size() >= 7 && addto->compare(0, 7, "http://") == 0;

        //strip standard port number from url
        if (is_https && addto->compare(addto->size()-4, 4, ":443") == 0)
            addto->resize(addto->size()-4);
        else if (is_http && addto->compare(addto->size()-3, 3, ":80") == 0)
            addto->resize(addto->size()-3);
}

std::string Request::GetRequestURL(RequestURLType type) const
{
        std::string url;
        if(!reqparser.GetReceivedUrl().empty() && reqparser.GetReceivedUrl()[0] != '/')
        {
                //It's a proxy reuquest
                url="proxy:";
                url.insert(url.end(), reqparser.GetReceivedUrl().begin(), reqparser.GetReceivedUrl().end());
                return url;
        }

        if (type == RequestURLType::ForClient ? is_client_secure : is_secure)
            url="https://";
        else
            url="http://";

        /* FIXME: If the client came in on a vhost, try to use that name first,
                  including (hopefully) any port number. Then, fall back
                  to the client specified host, and add the port number if
                  necessary. Third, fall back on our local address */
        AddRequestHostTo(&url, 0, type == RequestURLType::ForClient);


        //received URL already starts with a '/'
        url.insert(url.end(), reqparser.GetReceivedUrl().begin(), reqparser.GetReceivedUrl().end());

        return url;
}

// -----------------------------------------------------------------------------
//
// Connection::RequestRef
//

Blex::Mutex RequestRef::refmutex;

RequestRef::RequestRef(RequestRef const &rhs)
{
        Blex::Mutex::AutoLock lock(refmutex);
        request = rhs.request;
        if (request)
            ++request->refcount;
}

RequestRef::~RequestRef()
{
        bool must_destroy;
        {
                Blex::Mutex::AutoLock lock(refmutex);
                must_destroy = request && (--request->refcount) == 0;
        }
        if (must_destroy)
            delete request;
}

// -----------------------------------------------------------------------------
//
// Connection::Protocol
//

void Connection::Protocol::Reset()
{
        status_so_far=StatusOK;
        status_additional_message.clear();

        WS_PRINT("Resetting protocol data for conn " << this);

        /* ADDME: Doesthe stuff below really need to be reset always? */
        persistent=false;
        responded=false;
        sent_headers=false;
        continuing_response=false;
        running_error_handler=false;
        async_response=false;
        is_websocket=false;
        pending_error_message.clear();
        errorid.clear();
}

void Connection::ResetNewRequest()
{
        if (bool(flushcallback))
        {
                flushcallback();
                flushcallback = 0;
        }

        if (request.get())
            request->requestkeeper.Reset();
        request.reset(new Request(server));

        if (async_itf.get())
        {
                async_itf->ResetConnection();
                WS_PRINT("Webcon " << this << ": Reset async_itf");
                async_itf.reset();
        }

        //WS_PRINT("ResetNewRequest(); parse_data" << parse_http_data << ", linefeed = " << eat_next_linefeed);
        //if (is_sleeping)
        EnableIncomingData(true);
        is_sleeping = false;
        is_sleeping_for_flush = false;
        is_sleeping_for_signal = false;
        contenttype = NULL;

        ontimerelapsed = nullptr;

        LeaveCurrentCategory();

        total_output_size = 0;
        LockedOutputData::WriteRef(lockedoutputdata)->output_body.Clear();
        output_header.Clear();

        protocol.Reset();

        send_headers.clear();
        final_senddata.clear();

        if (outmmap_file.get())
        {
                if (outmmap_mapping)
                {
                        WS_PRINT("Warning! Still remaining outgoing data, " << outmmap_mappedsize << " bytes at " << (void*)outmmap_mapping);
                        outmmap_file->Unmap(outmmap_mapping, outmmap_mappedsize);
                }
                outmmap_file.reset(0);
        }
        outmmap_mapping = NULL;
        outstream_str.reset();
        connection.config.reset();
        connection.binding=NULL;
        async_itf.reset(new ConnectionAsyncInterface(this));
        WS_PRINT("Webcon " << this << ": New async_itf");
}

// -----------------------------------------------------------------------------
//
// ConnectionTask
//

ConnectionTask::ConnectionTask()
: is_running(false)
, success(false)
{
}

ConnectionTask::~ConnectionTask()
{
}

// -----------------------------------------------------------------------------
//
// ConnectionAsyncInterface
//

ConnectionAsyncInterface::ConnectionAsyncInterface(Connection *_webcon)
{
        WS_PRINT("Creating ConnectionAsyncInterface " << this << ", webcon: " << _webcon);

        LockedData::WriteRef lock(lockeddata);
        lock->webcon = _webcon;
        lock->got_hup = false;
}

ConnectionAsyncInterface::~ConnectionAsyncInterface()
{
        WS_PRINT("Destroying ConnectionAsyncInterface " << this);
}

void ConnectionAsyncInterface::PushTask(std::unique_ptr< ConnectionTask > &task)
{
        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;
        {
                LockedData::WriteRef lock(lockeddata);
                LockedPushTask(lock, task);
        }
        if (task.get())
            task->OnFinished(this, false);
}

void ConnectionAsyncInterface::LockedPushTask(Blex::InterlockedData< Data, Blex::Mutex >::WriteRef &lock, std::unique_ptr< ConnectionTask > &task)
{
        if (lock->webcon)
        {
                std::shared_ptr< ConnectionTask > s_task;
                s_task.reset(task.release());

                bool need_signal = lock->tasks.empty();
                lock->tasks.push_back(s_task);

                if (need_signal)
                {
                        // ADDME: keep creation of tasks outside of the lock?
                        std::unique_ptr< Blex::Dispatcher::Task > task;
                        task.reset(new Blex::Dispatcher::Task);
                        lock->webcon->QueueRemoteTask(lock->webcon, task, false);
                }
        }
}


void ConnectionAsyncInterface::DoTasks(Connection *webcon, bool just_clear)
{
        while (true)
        {
                std::shared_ptr< ConnectionTask > task;
                {
                        LockedData::WriteRef lock(lockeddata);
                        if (lock->tasks.empty())
                            return;

                        task = lock->tasks[0];

                        // Don't rerun an already running task
                        if (task->is_running)
                            return;

                        task->is_running = true;
                }

                if (!just_clear)
                {
                        bool completed = task->OnExecute(webcon);
                        if (!completed)
                            return;
                }

                {
                        LockedData::WriteRef lock(lockeddata);

                        Tasks::iterator it = lock->tasks.begin();
                        if (it != lock->tasks.end() && it->get() == task.get())
                            lock->tasks.erase(it);
                }
                task->OnFinished(this, !just_clear);
        }
}

void ConnectionAsyncInterface::MarkCurrentTaskFinished(bool success)
{
        std::shared_ptr< ConnectionTask > task;
        {
                LockedData::WriteRef lock(lockeddata);
                if (lock->tasks.empty())
                    return;

                task = lock->tasks[0];

                // Don't mark finished a non-run task
                if (!task->is_running)
                    return;

                lock->tasks.erase(lock->tasks.begin());
        }

        task->success = success;
        task->OnFinished(this, true);

        {
                // Signal the webscon again if there are more tasks
                LockedData::WriteRef lock(lockeddata);
                if (lock->webcon && !lock->tasks.empty())
                {
                        // ADDME: keep creation of tasks outside of the lock?
                        std::unique_ptr< Blex::Dispatcher::Task > task;
                        task.reset(new Blex::Dispatcher::Task);
                        lock->webcon->QueueRemoteTask(lock->webcon, task, false);
                }
        }
}

void ConnectionAsyncInterface::ResetConnection()
{
        WS_PRINT("Reset ConnectionAsyncInterface " << this);

        Connection *webcon = LockedData::ReadRef(lockeddata)->webcon;
        {
                LockedData::WriteRef lock(lockeddata);
                lock->webcon = 0;
        }

        // Empty task list AFTER resetting locked webcon, so new tasks aren't
        // accepted after we clean the list.
        DoTasks(webcon, true);

}

Connection * ConnectionAsyncInterface::GetSyncWebcon()
{
        return LockedData::ReadRef(lockeddata)->webcon;
}

void ConnectionAsyncInterface::ClearOutput()
{
        LockedData::WriteRef lock(lockeddata);
        if (!lock->webcon)
            return;

        Connection::LockedOutputData::WriteRef lock2(lock->webcon->lockedoutputdata);
        lock2->output_body.Clear();
}

unsigned ConnectionAsyncInterface::OutputLength()
{
        LockedData::WriteRef lock(lockeddata);
        if (!lock->webcon)
            return 0;

        Connection::LockedOutputData::WriteRef lock2(lock->webcon->lockedoutputdata);
        return lock2->output_body.Length();
}

void ConnectionAsyncInterface::StoreData(const void* start, unsigned length)
{
        LockedData::WriteRef lock(lockeddata);
        if (!lock->webcon)
            return;

        Connection::LockedOutputData::WriteRef lock2(lock->webcon->lockedoutputdata);
        lock2->output_body.StoreData(start, length);
}

uint8_t const * ConnectionAsyncInterface::StoreIncomingData(uint8_t const *begin, uint8_t const *end)
{
        uint8_t const *orgend = end;

        LockedData::WriteRef lock(lockeddata);

        // Store max 16384 bytes
        unsigned currentfill = lock->incomingdata.size();
        if (currentfill + std::distance(begin, end) > WebSocketBufferSize)
        {
                if (currentfill < WebSocketBufferSize)
                    end = begin + (WebSocketBufferSize - currentfill);
                else
                    end = begin; // Just for safety
        }

        lock->incomingdata.insert(lock->incomingdata.end(), begin, end);
        lock->blocked = end != orgend;

        incomingdata_event.SetSignalled(!lock->incomingdata.empty() || lock->got_hup);
        return end;
}

class UnblockWebSocketTask: public WebServer::ConnectionTask
{
        bool OnExecute(WebServer::Connection *webconn);
        void OnFinished(WebServer::ConnectionAsyncInterface*, bool);
};

bool UnblockWebSocketTask::OnExecute(WebServer::Connection *webconn)
{
        WS_PRINT("Running UnblockWebSocketTask on conn " << webconn);
        webconn->EnableIncomingData(true);
        return true;
}

void UnblockWebSocketTask::OnFinished(WebServer::ConnectionAsyncInterface*, bool)
{
}

unsigned ConnectionAsyncInterface::ReadIncomingData(uint8_t *buf, unsigned maxread)
{
        LockedData::WriteRef lock(lockeddata);
        maxread = std::min< unsigned >(maxread, lock->incomingdata.size());
        if (maxread)
        {
                uint8_t *until = lock->incomingdata.begin() + maxread;
                std::copy(lock->incomingdata.begin(), until, buf);
                lock->incomingdata.erase(lock->incomingdata.begin(), until);
                incomingdata_event.SetSignalled(!lock->incomingdata.empty() || lock->got_hup);

                if (lock->blocked)
                {
                        std::unique_ptr< WebServer::ConnectionTask > c_task(new UnblockWebSocketTask);
                        LockedPushTask(lock, c_task);

                        lock->blocked = false;
                }
        }
        return maxread;
}

void ConnectionAsyncInterface::SignalHangup()
{
        LockedData::WriteRef lock(lockeddata);
        lock->got_hup = true;
        incomingdata_event.SetSignalled(true);
}

bool ConnectionAsyncInterface::HasHangup()
{
        LockedData::WriteRef lock(lockeddata);
        return lock->incomingdata.empty() && lock->got_hup;
}

} //end namespace WebServer
