#include <ap/libwebhare/allincludes.h>

#include <blex/logfile.h>
#include <blex/utils.h>

#include "webserve.h"
#include "webscon.h"
#include <memory>

namespace WebServer
{

//Internal server error MUST always be the first error on this list
StatusData storedstatus[]=
{ StatusData( 500, "500 Internal server error", "The webserver encountered an internal error while processing your request"),
  StatusData( 101, "101 Switching protocols", "" ),
  StatusData( 200, "200 OK", "" ),
  StatusData( 201, "201 Created", "The requested resource was created" ),
  StatusData( 202, "202 Accepted", "The request has been accepted" ),
  StatusData( 203, "203 Non-Authoritative Information", "The request has been accepted" ),
  StatusData( 204, "204 No Content", "" ),
  StatusData( 205, "205 Reset Content", "" ),
  StatusData( 206, "206 Partial Content", "" ),
  StatusData( 207, "207 Multi-Status", "Multi status response" ), //RFC4918 - webdav
  StatusData( 208, "208 Already Reported", "" ), //RFC5842 - webdav
  StatusData( 226, "226 IM Used", "" ), //RFC3229
  StatusData( 300, "300 Multiple Choices", "Multiple locations are available for the resource" ),
  StatusData( 301, "301 Moved Permanently", "The requested resource has been moved" ),
  StatusData( 302, "302 Found", "The requested resource has been found at a different location" ),
  StatusData( 303, "303 See other", "The results of the request can be found at a different location" ),
  StatusData( 304, "304 Not modified", "The resource has not been modified" ),
  StatusData( 305, "305 Use proxy", "The resource has not been modified" ),
  StatusData( 306, "306 Switch proxy", "" ),
  StatusData( 307, "307 Temporary Redirect", "The requested resource resides temporarily under a different URI" ), //HTTP1.1
  StatusData( 308, "308 Permanent Redirect", "" ), //experimental
  StatusData( 400, "400 Bad request", "An invalid request was sent to the webserver" ),
  StatusData( 401, "401 Authorization Required", "You are not allowed to access the requested resource with your current credentials"),
  StatusData( 402, "402 Payment Required", ""),
  StatusData( 403, "403 Forbidden", "You are not allowed to access the requested resource" ),
  StatusData( 404, "404 Not found", "The requested resource could not be found" ),
  StatusData( 405, "405 Method not allowed", "The requested method was not allowed on this resource" ),
  StatusData( 406, "406 Not acceptable", "The request was not acceptable" ),
  StatusData( 407, "407 Proxy authentication required", "Proxy authentication required" ),
  StatusData( 408, "408 Request timeout", "No timely request was received" ),
  StatusData( 409, "409 Conflict", "The request conflicted" ),
  StatusData( 410, "410 Gone", "The requested resource is permanently unavailable" ),
  StatusData( 411, "411 Length Required", "A content-length must be specified" ), //FIXME Use this ourselves too!
  StatusData( 412, "412 Precondition Failed", "The preconditions for executing this method were not met" ),
  StatusData( 413, "413 Request Entity Too Large", "The request was too large to be processed" ), //FIXME Use this ourselves too!
  StatusData( 414, "414 Request-URI Too Long", "The request URI was too large to be processed" ), //FIXME Use this ourselves too!
  StatusData( 415, "415 Unsupported Media Type", "The request entity is in a format not supported by the request resource" ),
  StatusData( 416, "416 Requested range not satisfiable", "" ),
  StatusData( 417, "417 Expectation failed", "" ),
  StatusData( 418, "418 I'm a teapot", "" ), //RFC2324
  StatusData( 419, "419 Authentication Timeout", "" ), //non standard
  StatusData( 420, "420 Enhance Your Calm", "" ), //Twitter
  StatusData( 422, "422 Unprocessable Entity", "" ), //WEBDAV RFC 4918
  StatusData( 423, "423 Locked", "" ), //WEBDAV RFC 4918
  StatusData( 424, "424 Failed Dependency", "" ), //WEBDAV RFC 4918
  StatusData( 501, "501 Not Implemented", "The request method was not recognized" ), //FIXME Use this ourselves too!
  StatusData( 502, "502 Bad Gateway", "Bad Gateway" ),
  StatusData( 503, "503 Service Unavailable", "The requested service is currently unavailable" ),
  StatusData( 504, "504 Gateway Timeout", "Gateway Timeout" ),
  StatusData( 505, "505 HTTP Version Not Supported", "HTTP Version Not Supported" ),
  StatusData( 0,"","")
};
const unsigned InitialIdleGrace = 60; //Initial grace period for connections to start talking (ADDME: proper HTTP/1.1 timeout?)


WebSite::WebSite(std::string const &_folder)
: documentroot(_folder)
, lowercasemode(false)
, forcehttps(false)
, forcehttpsport(0)
{
        if (!documentroot.empty() && documentroot.end()[-1] != '/')
            documentroot.push_back('/');
}

Server::Server (std::string const &_tmpdir,AccessLogFunction const &_accesslogfunction, ErrorLogFunction const &_errorlogfunction)
: uploadfs(Blex::CreateTempName(Blex::MergePath(_tmpdir, "uploads-")), true)
, boottime(Blex::DateTime::Now())
, dispatcher( std::bind(&Server::CreateConnection,this,std::placeholders::_1) )
, accesslogfunction(_accesslogfunction)
, errorlogfunction(_errorlogfunction)
{
        ServerConfigPtrHolder::WriteRef currentconfigptr(currentconfig);
        *currentconfigptr = std::make_shared<ServerConfig const>();
}

Server::~Server()
{
}

void Server::SetJobManager(HareScript::JobManager *jobmgr)
{
        jobmanager = jobmgr;
}

Blex::Dispatcher::Connection* Server::CreateConnection(void *disp)
{
        return new Connection(this,disp);
}

ServerConfig::ServerConfig()
: script_timeout(15*60)
{
}

void ServerConfig::SetupVirtualName(std::string const &hostname, unsigned sitenum)
{
        bool is_glob = std::find(hostname.begin(), hostname.end(), '?') != hostname.end()
                       || std::find(hostname.begin(), hostname.end(), '*') != hostname.end();
        if (is_glob)
        {
                globmasks.push_back(std::make_pair(hostname, sitenum));
        }
        else
        {
                DEBUGPRINT(sitenum << " " << hostname);
                exactsitematches.insert(std::make_pair(hostname, sitenum));
        }
}

ServerConfigPtr Server::ObtainConfig() const
{
        ServerConfigPtrHolder::ReadRef currentconfigptr(currentconfig);
        return *currentconfigptr;
}

bool Server::ApplyConfig(ServerConfigPtr newconfig, std::vector<Blex::Dispatcher::ListenAddress> *broken_listeners)
{
        //Now apply those changes that affect this object
        std::vector<Blex::Dispatcher::ListenAddress> addresses;

        for (unsigned i=0;i<newconfig->listeners.size();++i)
            addresses.push_back(newconfig->listeners[i].listener);

        ServerConfigPtrHolder::WriteRef currentconfigptr(currentconfig);
        *currentconfigptr = newconfig;
        dispatcher.UpdateListenPorts(addresses.size(),&addresses[0]);
        return dispatcher.RebindSockets(broken_listeners);
}

Server::CategoryData & Server::CatConnData::FindCategory(unsigned category)
{
        std::map< unsigned, CategoryData >::iterator it = cats.find(category);
        if (it == cats.end())
            throw std::runtime_error("Cannot find specified data of category " + Blex::AnyToString(category));

        return it->second;
}

void Server::RegisterConnectionCategory(unsigned category, unsigned max_concurrent)
{
        if (max_concurrent == 0)
            throw std::runtime_error("Illegal maximum number of concurrent connections specified");
        if (category == 0)
            throw std::runtime_error("Category 0 cannot be registered");

        Server::LockedCatConnData::WriteRef catconndata(lockedcatconndata);

        if (catconndata->cats.find(category) != catconndata->cats.end())
            throw std::runtime_error("Connection category registred twice");

        // Create empty category data, set max_concurrent
        catconndata->cats[category].max_concurrent = max_concurrent;
}

bool Server::InterruptHandler(int sig)
{
        return dispatcher.InterruptHandler(sig);
}

void Server::MainLoop(unsigned numworkers)
{
        dispatcher.Start(numworkers, InitialIdleGrace, false);
}

Blex::DateTime Server::GetBootTime() const
{
        return boottime;
}

StatusData::StatusData(unsigned _code, std::string const &_title, std::string const &_description)
: code(_code)
, title(_title)
, description(_description)
{
}

const StatusData* Server::GetStatusData(unsigned status)
{
        //Look up the error data
        StatusData *curstatus=storedstatus;
        while (!curstatus->title.empty())
        {
                if (curstatus->code==status)
                    return curstatus;
                ++curstatus;
        }
        return storedstatus;
}

ContentType::ContentType(std::string const &_contenttype, ContentHandler const &_handler)
: contenttype(_contenttype)
, handler(_handler)
, parse_body(false)
, force_disposition_attachment(false)
, is_websocket(false)
{
}

void ServerConfig::SetDefaultContentType(std::string const &extension)
{
        default_contenttype_extension = extension;
}

std::shared_ptr< ContentType > ServerConfig::AddContentType
     (const std::string &extension,
      const std::string &contenttype,
      ContentHandler const &handler)
{
        assert(handler!=NULL);

        //FIXME: Protect against duplicates, ensure validity, et-al
        //       We want contenttypes like this: '.html','text/html'
        std::shared_ptr< ContentType > new_contenttype(new ContentType(contenttype,handler));

        contenttypesbyct.insert(std::make_pair(contenttype, new_contenttype));
        if (!extension.empty())
            return contenttypes.insert(std::make_pair(extension, new_contenttype)).first->second;
        else
            return new_contenttype;
}

std::shared_ptr< ContentType > ServerConfig::GetContentTypeByContentType(const std::string &contenttype)
{
        ContentTypes::iterator it = contenttypesbyct.find(contenttype);
        if (it != contenttypesbyct.end())
            return it->second;

        return std::shared_ptr< ContentType >();
}

ContentType const * ServerConfig::GetContentType (std::string const &filename) const
{
        static const char dot='.';
        std::string::const_iterator dotpos=std::find_end(filename.begin(),filename.end(),&dot,&dot+1);

        if (dotpos!=filename.end())
        {
                //look for content type associated with extension
                std::string extension(dotpos+1,filename.end());
                ContentTypes::const_iterator contenttype=contenttypes.find(extension);

                if (contenttype!=contenttypes.end()) //we've got a match!
                    return contenttype->second.get();
        }
        ContentTypes::const_iterator contenttype = contenttypes.find(default_contenttype_extension);
        if (contenttype == contenttypes.end())
            return NULL;
        else
            return contenttype->second.get();
}

WebSite* ServerConfig::FindWebSiteById(int32_t id)
{
        for (unsigned i=0;i<sites.size();++i)
          if (sites[i].webserver_id==id)
            return &sites[i];

        return NULL;
}

Listener const * ServerConfig::FindBinding(Blex::SocketAddress const &addr) const
{
        /*  Attempt to track down our listener */
        for (unsigned i=0;i<listeners.size();++i)
          if (listeners[i].listener.sockaddr.Matches(addr))
            return &listeners[i];

        return NULL;
}

Listener const * ServerConfig::FindBindingById(int32_t id) const
{
        /*  Attempt to track down our listener */
        for (unsigned i=0;i<listeners.size();++i)
          if (listeners[i].id == id)
            return &listeners[i];

        return nullptr;
}

WebSite const * ServerConfig::FindWebSite(Listener const *accepter, std::string const &hostname) const
{
        if (accepter->virtualhosting)
        {
                auto exactmatch = exactsitematches.find(hostname);
                if(exactmatch != exactsitematches.end())
                    return &sites[ exactmatch->second ];

                //If we didn't find an exact match, try without a portnumber
                std::string hostwithoutport;
                auto colon = std::find(hostname.begin(), hostname.end(), ':');
                if(colon != hostname.end())
                {
                        hostwithoutport.assign(hostname.begin(), colon);
                        exactmatch = exactsitematches.find(hostwithoutport);
                        if(exactmatch != exactsitematches.end())
                            return &sites[ exactmatch->second ];
                }

                for(GlobMasks::const_iterator itr=globmasks.begin(); itr!=globmasks.end(); ++itr)
                  if (Blex::StrCaseLike(hostname, itr->first))
                    return &sites[ itr->second ];

                if(!hostwithoutport.empty())
                {
                        for(GlobMasks::const_iterator itr=globmasks.begin(); itr!=globmasks.end(); ++itr)
                          if (Blex::StrCaseLike(hostwithoutport, itr->first))
                            return &sites[ itr->second ];
                }
        }
        else if (accepter->sitenum>=1)
        {
                return &sites[accepter->sitenum-1];
        }

        return NULL;
}

AccessRule::AccessRule()
: id(0)
, matchtype(MatchExact)
, accepttype(AcceptType::Unrecognized)
, redirecttarget_is_folder(true)
, authrequired(true)
, customhandler(NULL)
, redirect(false)
, all_methods(false)
, matchassubdir(true)
, redirectcode(0)
, fixcase(false)
{
}

IPRule::IPRule(std::string const &ipmask, bool is_allow)
: is_allow(is_allow)
{
        std::string::const_iterator slash=std::find(ipmask.begin(),ipmask.end(),'/');
        if(slash==ipmask.end())
        {
                DEBUGPRINT("Corrupted ip mask " << ipmask);
                return;
        }

        std::string ip(ipmask.begin(), slash);
        address.SetIPAddress(ip);
        prefixlength = Blex::DecodeUnsignedNumber<uint32_t>(slash+1, ipmask.end()+1).first;
        DEBUGPRINT("ipmask: " << ipmask << " = " << address << " prefixlength " << prefixlength);
}

void HandleSendAsIs(WebServer::Connection *webcon, std::string const &path)
{
        //When handling an error, there is no point in all the checks below..
        if (webcon->protocol.status_so_far == StatusOK)
        {
                if (webcon->request->condition_ifmodifiedsince != Blex::DateTime::Invalid()
                    && webcon->request->filestatus.ModTime() <= webcon->request->condition_ifmodifiedsince)
                {
                        //this was a conditional request, as the resource hasn't been modified, don't retransmit it
                        webcon->protocol.status_so_far = StatusNotModified;
                }
                webcon->SetLastModified(webcon->request->filestatus.ModTime());
        }

        webcon->AddHeader("Content-Type",12,&webcon->contenttype->contenttype[0],webcon->contenttype->contenttype.size(),false);
        if (webcon->protocol.status_so_far != StatusNotModified)
            webcon->SendFile(path);
}

} //end namespace WebServer
