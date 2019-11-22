#include <ap/libwebhare/allincludes.h>

#include <blex/crypto.h>
#include <blex/utils.h>
#include "session_users.h"

const unsigned UserCacheTrust = 15*60; //trust cached users for 15 minutes

Session::Session()
: type(SessionType::Session)
, creationtime(Blex::DateTime::Now())
, lastcacheuse(creationtime)
, userid(0)
, userentityid(0)
, can_close(false)
, limited_to_webserver(false)
, webserverid(0)
, trust_until(Blex::DateTime::Max())
, auto_increment(UserCacheTrust)
, refcount(0)
, deleted(false)
//, waitgen(0)
{
}

Session::~Session()
{
}

void Session::Reset()
{
        type = SessionType::Session;
        sessdata.reset();
        displayname.clear();
        creationtime = Blex::DateTime::Now();
        lastcacheuse = creationtime;
        ipaddr = Blex::SocketAddress();
        userid = 0;
        userentityid = 0;
        accessruleids.clear();
        can_close = false;
        session_username.clear();
        basicauth_password.clear();
        limited_to_webserver = false;
        webserverid = 0;
        trust_until = Blex::DateTime::Max();
}

void Session::AddRef()
{
        ++refcount;
}

SUCache::SUCache()
//: seqcount(0)
{
}

SUCache::~SUCache()
{
}

void SUCache::DeleteSessionRef(std::string const &sessionid, Blex::DateTime now)
{
        SessionMap::iterator cursession = sessionidx.find(sessionid);
        if (cursession == sessionidx.end())
            return;

        if(--cursession->second->refcount > 0)
            return;

        if(cursession->second->deleted || cursession->second->auto_increment==0)
            DoEraseSession(cursession->second);
        else
            cursession->second->lastcacheuse = now;
}

void SUCache::ExpireSessions()
{
        Blex::DateTime curtime=Blex::DateTime::Now();
        Sessions::iterator itr = sessionlist.begin();
        while (itr != sessionlist.end())
        {
                if (itr->IsExpired(curtime))
                    DoEraseSession(itr++);
                else
                    ++itr;
        }
}

Session* SUCache::GenerateSession()
{
        Sessions::iterator itr = sessionlist.insert(sessionlist.end(), Session());
        while(true)
        {
                std::string sessionid = Blex::GenerateUFS128BitId();

                std::pair<SessionMap::iterator,bool> retval = sessionidx.insert(std::make_pair(sessionid,itr));
                if (retval.second) //not a dupe session id
                {
                        itr->sessionid = sessionid;
                        return &*itr;
                }
        }
}

void SUCache::FlushUserCache()
{
        for(Sessions::iterator itr=sessionlist.begin();itr!=sessionlist.end();++itr)
            itr->trust_until = Blex::DateTime::Min();
}

void SUCache::FlushUserCacheForUser(int32_t userid)
{
        DEBUGPRINT("Session caches for user " << userid << " flushed");
        for(Sessions::iterator itr=sessionlist.begin();itr!=sessionlist.end();++itr)
            if (itr->userid == userid)
                itr->trust_until = Blex::DateTime::Min();
}

void SUCache::FlushUserCacheForWRDUser(int32_t wrdentitid)
{
        DEBUGPRINT("Session caches for WRD user " << wrdentitid << " flushed");
        for(Sessions::iterator itr=sessionlist.begin();itr!=sessionlist.end();++itr)
            if (itr->userentityid == wrdentitid)
                itr->trust_until = Blex::DateTime::Min();
}


Session* SUCache::OpenBasicAuth(WebServer::Connection const &conn, bool create_if_new)
{
        WebServer::Authentication const &auth = conn.GetRequest().authentication;

        if (auth.auth_type != WebServer::Authentication::Basic)
            return 0;

        for (Sessions::iterator itr=sessionlist.begin();itr!=sessionlist.end();++itr)
        {
                if (itr->session_username != auth.seen_username || itr->basicauth_password != auth.password)
                    continue;

                //Found a match!
                Blex::DateTime now = Blex::DateTime::Now();
                itr->lastcacheuse = now;

                if(create_if_new)
                    itr->trust_until = std::max(itr->trust_until, now + Blex::DateTime::Seconds(UserCacheTrust));
                else if(itr->trust_until < now)
                    return NULL; //failure (untrustable data)

                return &*itr;
        }
        if (create_if_new)
        {
                Session *newsess = CreateSession(UserCacheTrust, true, -1, std::string());
                newsess->session_username = auth.seen_username;
                newsess->trust_until = newsess->creationtime + Blex::DateTime::Seconds(UserCacheTrust);
                newsess->basicauth_password = auth.password;
                return newsess;
        }
        return NULL;
}

Session* SUCache::CreateSession(int32_t auto_increment, bool limited_to_webserver, int32_t webserverid, std::string const &password)
{
        Session *newsession = GenerateSession();
        newsession->auto_increment = auto_increment;
        newsession->scope = password;
        newsession->limited_to_webserver = limited_to_webserver && webserverid != 0;
        newsession->webserverid = webserverid;
        return newsession;
}

std::pair< Session*, bool >  SUCache::OpenOrCreateSession(std::string const &sessionid, std::string const &scope, int32_t auto_increment)
{
        bool existed = false;
        SessionMap::iterator cursession = sessionidx.find(sessionid);
        if (cursession == sessionidx.end())
        {
                Sessions::iterator itr = sessionlist.insert(sessionlist.end(), Session());
                std::pair< SessionMap::iterator, bool > retval = sessionidx.insert(std::make_pair(sessionid, itr));

                itr->sessionid = sessionid;
                cursession = retval.first;
        }
        else
        {
            if (cursession->second->IsDeleted() || cursession->second->scope != scope) //changing password just kills existing session data
                cursession->second->Reset();
            else
                existed = true;
        }

        cursession->second->auto_increment = auto_increment;
        cursession->second->scope = scope;
        return std::make_pair(&*cursession->second, existed);
}

Session* SUCache::OpenSessionNochecks(std::string const &sessionid, bool only_if_trusted)
{
        SessionMap::iterator cursession = sessionidx.find(sessionid);
        if (cursession == sessionidx.end())
            return NULL;

        //Session expired?
        Session &session = *cursession->second;
        Blex::DateTime now=Blex::DateTime::Now();
        if (session.IsExpired(now))
        {
                DoEraseSession(cursession->second); //destroy the session
                return NULL;
        }
        if(only_if_trusted && session.trust_until < now)
            return NULL;

        session.lastcacheuse = now;
        return &session;
}

void SUCache::DoEraseSession(Sessions::iterator sessionitr)
{
        if (!sessionitr->sessionid.empty())
            sessionidx.erase(sessionitr->sessionid);
        sessionlist.erase(sessionitr);
}
void SUCache::CloseSession(Session *session)
{
        if (session->sessionid.empty())
            throw std::runtime_error("CloseSession requires named sessions");
        session->deleted=true;
}

void SUCache::SetSessionAutoIncrement(Session *session, unsigned seconds)
{
        if (session->sessionid.empty())
            throw std::runtime_error("SetSessionExpiry requires named sessions");

        SessionMap::iterator it = sessionidx.find(session->sessionid);
        if (it != sessionidx.end())
            it->second->auto_increment = seconds;
}

void SUCache::SetSessionAuth(Session *session, std::string const &username, bool canclose, int32_t userid, int32_t userentityid, Blex::SocketAddress const &ipaddr, int32_t accessruleid)
{
        session->displayname = username;
        session->ipaddr = ipaddr;
        session->can_close = session->can_close || canclose;
        if (!session->userid)
            session->userid = userid;
        if (!session->userentityid)
            session->userentityid = userentityid;

        if (accessruleid && std::find(session->accessruleids.begin(), session->accessruleids.end(), accessruleid) == session->accessruleids.end()) //add a new access rule to the allowed list?
            session->accessruleids.push_back(accessruleid);
}

void SUCache::RevokeAuthentication(Session *session)
{
        session->userid=0;
        session->userentityid=0;
        session->accessruleids.clear();
        session->displayname.clear();
}

void SUCache::Clear()
{
        sessionlist.clear();
        sessionidx.clear();
}
