#ifndef blex_webhare_webserver_session_users
#define blex_webhare_webserver_session_users

#include <blex/crypto.h>
#include <blex/socket.h>
#include <list>
#include "../libwebhare/webscon.h"
#include <harescript/vm/hsvm_marshalling.h>

///How long, in seconds, to accept user accounts in the cache?
extern const unsigned UserCacheTrust;

class SUCache;

namespace SessionType
{
enum Type
{
Session         = 0,
Basic           = 1
};
} // End of namespace SessionType


class Session
{
    public:
        Session();
        ~Session();

        /// Add a reference to this session
        void AddRef();

        /// Returns whether the session has been deleted by CloseSession
        inline bool IsDeleted() { return deleted; }

        void Reset();

        /// Type of this session
        SessionType::Type type;

        ///marshalled session record
        std::shared_ptr< HareScript::MarshalPacket > sessdata;

        ///Id for this session
        std::string sessionid;

        ///session storage/display name
        std::string displayname;

        ///Time of session creation
        Blex::DateTime creationtime;

        ///Time of last use of this cached account
        Blex::DateTime lastcacheuse;

        ///Socket address of this accesss
        Blex::SocketAddress ipaddr;

        ///WebHare User id for this user
        int32_t userid;

        ///WebHare User entity id for this user
        int32_t userentityid;

        ///Access rules this session gives access to, if any
        std::vector<int32_t> accessruleids;

        ///Can this session be involuntarily closed
        bool can_close;

        ///login username
        std::string session_username;
        ///basic authentication password
        std::string basicauth_password;

        /// Whether this session is limited to its webserver
        bool limited_to_webserver;

        ///webserver that created this session (0 if unknown)
        int32_t webserverid;

        ///session scope
        std::string scope;

    private:
        bool IsExpired(Blex::DateTime at)
        {
                /* sessions with refs are never expired. deleted sessions and 0-increment
                   sessions are always expired when unreferenced (but this can't be combined
                   into one flag, as deleted also blocks any GetWebSessionData calls */
                return refcount == 0 && (deleted || auto_increment==0 || lastcacheuse + Blex::DateTime::Seconds(auto_increment) < at);
        }

        ///Trust time for authentication data
        Blex::DateTime trust_until;

        ///auto-expiry increment for session
        unsigned auto_increment;

        /// Reference count. ShtmlContextDatas using this session manage this
        unsigned refcount;

        /// Deleted?
        bool deleted;

        friend class SUCache;
};
class SUCache
{
    public:
        typedef std::list<Session> Sessions;

        SUCache();
        ~SUCache();

        Sessions const &GetSessions() { return sessionlist; }

        ///Flush all directly authenticated users
        void FlushUserCache();
        ///Flush a specific authenticated user
        void FlushUserCacheForUser(int32_t userid);
        ///Flush a specific authenticated WRD user
        void FlushUserCacheForWRDUser(int32_t wrdentityid);
        ///Expire old sessionids and users
        void ExpireSessions();

        /// Delete a reference to the specified session. When unreferenced, the expiry clock will start running for the session
        void DeleteSessionRef(std::string const &sessionid, Blex::DateTime now);


//        Session* OpenBasicAuth(std::string const &username, std::string const &password, bool create_if_new);
        Session* OpenBasicAuth(WebServer::Connection const &conn, bool create_if_new);

        Session* CreateSession(int32_t auto_increment, bool limited_to_webserver, int32_t webserverid, std::string const &password);
        std::pair< Session*, bool > OpenOrCreateSession(std::string const &sessionid, std::string const &scope, int32_t auto_increment);
        Session* OpenSessionNochecks(std::string const &sessionid, bool only_if_trusted);
        void CloseSession(Session *session);
        void SetSessionAutoIncrement(Session *session, unsigned auto_increment);
        void SetSessionAuth(Session *session, std::string const &displayname, bool canclose, int32_t userid, int32_t userentityid, Blex::SocketAddress const &ipaddr, int32_t accessruleid);
        void RevokeAuthentication(Session *session);

        void Clear();

    private:
        typedef std::map<std::string, Sessions::iterator > SessionMap;

        Sessions sessionlist;
        SessionMap sessionidx;

        Session* GenerateSession();

        void DoEraseSession(Sessions::iterator sessionitr);
};

typedef Blex::InterlockedData<SUCache,Blex::Mutex> LockedSUCache;

#endif
