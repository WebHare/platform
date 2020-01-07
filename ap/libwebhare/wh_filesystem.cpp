#include <ap/libwebhare/allincludes.h>

#include "wh_filesystem.h"

#include "whcore.h"
#include <blex/path.h>
#include <blex/pipestream.h>

/*ADDME: Unused?
const unsigned CacheTime = 2;   // Time between re-checks in seconds
*/



//////////////////////////////////////////////////////////////////////////
//
// HTTP connection class for compiler
//

class HTTPConnection
{
        ///HTTP connection
        Blex::Socket sock;
        ///Current authorization string (only supporting BASIC now)
        std::string auth;
        ///Address to connect to (if connection is lost)
        Blex::SocketAddress address;
        ///Hostname we wanted to connect to (virtual hosted webservers)
        std::string hostname;
        ///Returned request header parser
        Blex::Mime::HeaderParser headerparser;
        ///Callback for the above header parser
        void HeaderCallback(std::string const &data);
        ///Reset internal state to handle a new response
        void ResetResponseParser();
        ///Did we receive the first response line yet(statuscode)
        bool firstheaderline;
        ///Status code for the request
        unsigned statuscode;
        ///Complete status line (first response line)
        std::string statusline;
        ///Status message (line after status code)
        std::string statusmsg;
        ///Body/Content length
        Blex::FileOffset contentlength;
        ///Last modification time of content
        Blex::DateTime lastmod;
        ///User agent to use in requests
        std::string useragent;
        ///User-specified custom request headesr
        std::string customheaders;
        ///User-specified custom body stream
        Blex::Stream *custombodystream;
        Blex::FileOffset custombodylength;

        ///Incoming data buffer
        uint8_t receivebuffer[8192];
        ///Bytes of incoming buffer in used
        unsigned receivebuffersize;
        ///Bytes of body data remaining
        Blex::FileOffset bodydataremaining;
        ///Last error
        Blex::SocketError::Errors lasterror;

        public:
        HTTPConnection(std::string const &useragent);
        /** Connect to a HTTP server
            @return true on Success */
        bool Connect(std::string const &servername, uint16_t port);
        void AddRequestHeader(std::string const &headername, std::string const &headerdata);
        void AddRequestHeader(std::string const &headername, Blex::DateTime date);
        void ResetForRequest();
        void AddRequestBodyStream(Blex::Stream &str, Blex::FileOffset numbytes);

        std::string const & GetStatusMsg() { return statusmsg; }

        /** Get the last socket error */
        Blex::SocketError::Errors GetLastError() const
        {
                return lasterror;
        }

        /** Do a request on the specified URI
            @return HTTP status code, or -1 on I/O error */
        int DoRequest(std::string const &requesttype, std::string const &requesturi);

        /** Get the remaining body length */
        Blex::FileOffset GetRemainingBodyLength()
        {
                return bodydataremaining;
        }
        /** Read body data */
        unsigned ReadBody(void *store, unsigned numbytes);
        /** Send body to a stream */
        Blex::FileOffset SendAllTo(Blex::Stream &outstream);

        Blex::DateTime GetLastModification() const
        {
                return lastmod;
        }
        void SetAuthorization(std::string const &username, std::string const &password);
};


HTTPConnection::HTTPConnection(std::string const &useragent)
: sock(Blex::Socket::Stream)
, headerparser(std::bind(&HTTPConnection::HeaderCallback, this, std::placeholders::_1))
, useragent(useragent)
, lasterror(Blex::SocketError::NoError)
{
        bodydataremaining = 0;
        ResetForRequest();
}
void HTTPConnection::ResetForRequest()
{
        custombodystream = 0;
        custombodylength = 0;
        customheaders.clear();
}
void HTTPConnection::ResetResponseParser()
{
        firstheaderline=true;
        headerparser.Reset();
        statuscode = 0;
        contentlength = 0;
        lastmod = Blex::DateTime::Invalid();
        bodydataremaining = 0;
        receivebuffersize = 0;
}
void HTTPConnection::HeaderCallback(std::string const &data)
{
        if (firstheaderline)
        {
                std::string::const_iterator first_space = std::find(data.begin(), data.end(), ' ');
                statusline=data;
                statuscode=first_space!=data.end() ? Blex::DecodeUnsignedNumber<uint32_t>(first_space+1, data.end()).first : 0;
                statusmsg=first_space!=data.end() ? std::string(first_space, data.end()) : data;
                firstheaderline=false;
                return;
        }
        std::string::const_iterator colon = std::find(data.begin(),data.end(),':');
        if(colon!=data.end())
        {
                std::string header = std::string(data.begin(), colon);
                if(Blex::StrCaseCompare(header,"CONTENT-LENGTH")==0)
                {
                        ++colon;
                        while(colon!=data.end() && *colon==32)
                           ++colon;
                        contentlength = Blex::DecodeUnsignedNumber<Blex::FileOffset>(colon, data.end()).first;
                }
                if(Blex::StrCaseCompare(header,"LAST-MODIFIED")==0)
                {
                        ++colon;
                        while(colon!=data.end() && *colon==32)
                           ++colon;
                        lastmod = Blex::DateTime::FromText(&*colon, &*data.end());
                }
        }
}
bool HTTPConnection::Connect(std::string const &servername, uint16_t port)
{
        sock.Close(); //close if necessary

        hostname = servername;
        if (!servername.empty() && Blex::IsDigit(servername[servername.size()-1]))
            address.SetIPAddress(servername);
        else
            address = Blex::ResolveHostname(servername);

        address.SetPort(port);
        if (address.IsAnyAddress())
        {
                lasterror = Blex::SocketError::UnableToResolveHostname;
                return false;
        }

        lasterror = sock.Connect(address);
        if(lasterror != Blex::SocketError::NoError)
            return false;

        return true;
}
void HTTPConnection::SetAuthorization(std::string const &username, std::string const &password)
{
        auth = "Basic " ;
        std::string userpass=username + ":" + password;
        Blex::EncodeBase64(userpass.begin(), userpass.end(), std::back_inserter(auth));
}

void HTTPConnection::AddRequestHeader(std::string const &headername, std::string const &headerdata)
{
        //ADDME: Check against overwriting of our standard headers
        customheaders += headername;
        customheaders += ": ";
        customheaders += headerdata;
        customheaders += "\r\n";
}
void HTTPConnection::AddRequestHeader(std::string const &headername, Blex::DateTime date)
{
        //ADDME: Check against overwriting of our standard headers
        customheaders += headername;
        customheaders += ": ";
        Blex::CreateHttpDate(date, &customheaders);
        customheaders += "\r\n";
}
void HTTPConnection::AddRequestBodyStream(Blex::Stream &str, Blex::FileOffset numbytes)
{
        custombodystream = &str;
        custombodylength = numbytes;
}

int HTTPConnection::DoRequest(std::string const &requesttype, std::string const &requesturi)
{
        lasterror = Blex::SocketError::NoError;
        if(bodydataremaining)
            return -1; //handle body first

        bool dont_expect_body = Blex::StrCaseCompare(requesttype,"HEAD")==0;
        std::string msg = requesttype;
        msg += ' ';
        msg += requesturi;
        msg += " HTTP/1.1\r\n";
        if (!auth.empty())
        {
                msg+="Authorization: ";
                msg+=auth;
                msg+="\r\n";
        }
        if (!useragent.empty())
        {
                msg+="User-Agent: ";
                msg+=useragent;
                msg+="\r\n";
        }
        if(custombodylength)
        {
                msg+="Content-Length: ";
                msg+=Blex::AnyToString(custombodylength);
                msg+="\r\n";
        }

        msg += customheaders;

        msg += "Host: ";
        msg += hostname;
        if (address.GetPort() != 80) //ADDME: check for 443 for ssl
        {
                msg += ":";
                msg += Blex::AnyToString(address.GetPort());
        }
        msg += "\r\n\r\n";

        //ADDME: Safe, timed and nonblocking send
        //ADDME: Deal with server disconnecting us or sending a Request SocketError::Timeout
        std::pair<Blex::SocketError::Errors, int32_t> retval;
        sock.SetBlocking(false);
        sock.SetNagle(false);
        retval = sock.TimedSend(&msg[0], msg.size(), Blex::DateTime::Max());
        if(retval.first != Blex::SocketError::NoError || retval.second!=static_cast<int32_t>(msg.size()))
        {
                lasterror = retval.first;
                return -1;
        }

        while(custombodylength)
        {
                uint8_t temp[8192];
                std::size_t toread = (unsigned)std::min<Blex::FileOffset>(sizeof(temp), custombodylength);
                std::size_t haveread = custombodystream->Read(temp, toread);
                if(haveread<toread)
                    return -1; //FIXME: Report the I/O error

                //ADDME: Safe, timed and nonblocking send
                retval = sock.TimedSend(temp, toread, Blex::DateTime::Max());
                if(retval.first != Blex::SocketError::NoError || retval.second!=static_cast<int32_t>(toread))
                {
                        lasterror = retval.first;
                        return -1;
                }

                custombodylength -= haveread;
        }

        //Grab the response headers (FIXME: Non blocking, timed, etc Receive loop)
        ResetResponseParser();
        sock.SetBlocking(true);
        while (!headerparser.IsDone())
        {
                int retval = sock.Receive (receivebuffer, sizeof receivebuffer);
                if (retval<0)
                {
                        lasterror = (Blex::SocketError::Errors)retval;
                        return false;
                }

                const void *datastart = headerparser.ParseHeader(&receivebuffer[0], &receivebuffer[retval]);
                if (datastart != &receivebuffer[retval])
                {
                        assert(headerparser.IsDone());

                        receivebuffersize = int(&receivebuffer[retval] - static_cast<const uint8_t*>(datastart)) ;
                        memmove(receivebuffer, datastart, receivebuffersize);
                }
        }

        if(!dont_expect_body && statuscode!=304/*not modified*/)
            bodydataremaining = std::max<Blex::FileOffset>(contentlength, receivebuffersize);

        if(bodydataremaining==0)
           ResetForRequest();

        return statuscode;
}

unsigned HTTPConnection::ReadBody(void *store, unsigned numbytes)
{
        lasterror = Blex::SocketError::NoError;
        unsigned bytesread = 0;
        if(receivebuffersize>0 && numbytes>0)
        {
                unsigned tocopy = std::min(receivebuffersize, numbytes);
                memcpy(store, receivebuffer, tocopy);

                receivebuffersize -= tocopy;
                numbytes -= tocopy;
                bodydataremaining -= tocopy;
                store = static_cast<char*>(store) + tocopy;
                bytesread += tocopy;

                if(receivebuffersize>0) // still data left
                    memmove(receivebuffer, receivebuffer+tocopy, receivebuffersize);
        }

        while(numbytes>0 && bodydataremaining>0)
        {
                unsigned todownload = (unsigned)std::min<Blex::FileOffset>(bodydataremaining, numbytes);

                //ADDME: Safe, timed and nonblocking send
                //ADDME: Deal with Connection: Close or timeouts
                int retval = sock.Receive (store, todownload);
                if (retval<0)
                {
                        lasterror = (Blex::SocketError::Errors)retval;
                        return false;
                }

                store = static_cast<char*>(store) + retval;
                numbytes -= retval;
                bodydataremaining -= retval;
                bytesread += retval;
        }
        if(bodydataremaining==0)
           ResetForRequest();
        return bytesread;
}

Blex::FileOffset HTTPConnection::SendAllTo(Blex::Stream &outstream)
{
        Blex::FileOffset total=0;

        uint8_t temp[8192];
        while(true)
        {
                unsigned read = ReadBody(&temp[0],8192);
                if(read==0)
                    break;

                std::size_t byteswritten = outstream.Write(&temp[0], read);
                total += byteswritten;
                if(byteswritten < read)
                    break;
        }
        return total;
}


int32_t DecodeNumber(std::string const &src)
{
        return Blex::DecodeUnsignedNumber<unsigned>(src.begin(),src.end()).first;
}


/// Base file class that has a cached compiled file
class WHFileSystem::DirectFile : public HareScript::FileSystem::File
{
    private:
        /// Cached compiled library file
        std::string const sourcefile;
        std::string const clibfile;

    public:
        DirectFile(std::string const *sourcefile, std::string const &clibfile);

        /// Get the modification time of the source, Invalid if it does not exist.
        virtual Blex::DateTime GetSourceModTime();

        /// Returns source file or 0 if not exists. Caller is responsible for deleting
        virtual void GetSourceData(std::unique_ptr< Blex::RandomStream > *str, Blex::DateTime *modtime);

        /** Returns stream with compiled library file contents
            @return Stream with library file. Caller is responsible for deleting */
        virtual void GetClibData(std::unique_ptr< Blex::RandomStream > *str, Blex::DateTime *modtime);

        /** Returns the path of the clib file */
        virtual std::string GetClibPath();

        /// Removes the compiled library file
        virtual void RemoveClib();

        /** Creates a compiled library file
            @param str Stream with contents for new file
            @return Whether operation succeeded */
        virtual bool CreateClib(Blex::RandomStream &str);

        /** Return a description for this file
        */
        virtual std::string GetDescription();

        friend class WHFileSystem; // ADDME remove when possible, only needed to retrieve real source-file name
};

/** Context data for the WHFileSystem class */
class WHFileSystem::ContextData
{
    public:
        ContextData(WHCore::Connection *whconn);
        ~ContextData();

        /// WHCore connection
        WHCore::Connection *whconn;

        /// Cache of all direct files in this context
        std::map<std::string, FilePtr> directfiles;
};

// -----------------------------------------------------------------------------
//
//      WHFileSystem
//
WHFileSystem::WHFileSystem(WHCore::Connection &_conn, CompilationPriority::Class priorityclass, bool allow_direct_compilations)
: HareScript::FileSystem(_conn.GetTmpRoot(), _conn.GetModuleFolder("system") + "whres")
, dataroot(_conn.GetWebHareRoot())
, compilecache(_conn.GetCompileCache())
, dynamicmodulepath(_conn.GetLibRoot())
, priorityclass(priorityclass)
, conn(&_conn)
, allow_direct_compilations(allow_direct_compilations)
{
}

void WHFileSystem::Register(Blex::ContextRegistrator &reg)
{
        Context::Register(reg, conn);
}

std::string WHFileSystem::GetLibraryCompiledName(Blex::ContextKeeper &, std::string const &prefix, std::string const &uri) const
{
        // No need to collapse, the uri has been collapsed already
        std::string filename = prefix;
        filename.reserve(prefix.size() + uri.size() * 2 + 6);
        filename.push_back('_');

        for (std::string::const_iterator it = uri.begin(); it != uri.end(); ++it)
        {
                if (*it == '_') //duplicate all _s
                    filename.push_back('_');

                if (*it=='#' || *it == '/' || *it == '\\' ||*it == ':' || *it=='_' || *it==' ')
                    filename.push_back('_');
                else
                    filename.push_back(*it);
        }

        const char *clib_ext = ".clib";
        filename.insert(filename.end(), clib_ext, clib_ext + 5);

        return Blex::MergePath(compilecache, filename);
}


HareScript::FileSystem::FilePtr const &WHFileSystem::GetDirectClibFile(Blex::ContextKeeper &keeper, std::string const &liburi) const
{
        Context context(keeper);

        std::map<std::string, FilePtr>::iterator it = context->directfiles.find(liburi);
        if (it != context->directfiles.end())
            return it->second;

        std::string clibname = liburi;

        FilePtr file(new DirectFile(0, clibname));
        std::pair<std::map<std::string, FilePtr>::iterator, bool> res =
                context->directfiles.insert(std::make_pair(liburi, file));

        return res.first->second;
}

HareScript::FileSystem::FilePtr const &WHFileSystem::GetDirectFile(Blex::ContextKeeper &keeper, std::string const &_liburi) const
{
        Context context(keeper);

        std::string liburi(_liburi);
        bool whroot_relative = false;

        std::string libsub = liburi.substr(0, dataroot.size());
        bool matches = Blex::StrCompare(libsub, dataroot) == 0;
        if (matches)
        {
                whroot_relative = true;
                liburi.erase(0, dataroot.size());
        }

        std::string realliburi;
        if (whroot_relative)
            realliburi = Blex::MergePath(dataroot, liburi);
        else
            realliburi = liburi;

        std::map<std::string, FilePtr>::iterator it = context->directfiles.find(realliburi);
        if (it != context->directfiles.end())
            return it->second;

        std::string clibname = GetLibraryCompiledName(keeper, whroot_relative ? "whroot" : "direct", liburi);

        std::shared_ptr<DirectFile> file(new DirectFile(&realliburi, clibname));
        std::pair<std::map<std::string, FilePtr>::iterator, bool> res =
                context->directfiles.insert(std::make_pair(realliburi, file));

        return res.first->second;
}

enum Type
{
        FSWH,
        FSWHRes,
        FSMod,
        FSModule,
        FSModuleData,
        FSModuleScript,
        FSModuleRoot,
        FSStorage,
        FSWHFS,
        FSSite,
        FSCurrentSite,
        FSDirect,
        FSDirectClib,
        FSRelative,
        FSTest
};

Type GetPrefix(std::string const &liburi)
{
        // Determine the prefix
        std::string::const_iterator it = std::find(liburi.begin(), liburi.end(), ':');

        Blex::StringPair prefix(liburi.begin(), it);
        if (prefix == Blex::StringPair::FromStringConstant("wh"))
            return FSWH;
        else if (prefix == Blex::StringPair::FromStringConstant("whres"))
            return FSWHRes;
        else if (prefix == Blex::StringPair::FromStringConstant("moduledata"))
            return FSModuleData;
        else if (prefix == Blex::StringPair::FromStringConstant("storage"))
            return FSStorage;
        else if (prefix == Blex::StringPair::FromStringConstant("mod"))
            return FSMod;
        else if (prefix == Blex::StringPair::FromStringConstant("moduleroot"))
            return FSModuleRoot;
        else if (prefix == Blex::StringPair::FromStringConstant("module"))
            return FSModule;
        else if (prefix == Blex::StringPair::FromStringConstant("modulescript"))
            return FSModuleScript;
        else if (prefix == Blex::StringPair::FromStringConstant("whfs"))
            return FSWHFS;
        else if (prefix == Blex::StringPair::FromStringConstant("site"))
            return FSSite;
        else if (prefix == Blex::StringPair::FromStringConstant("currentsite"))
            return FSCurrentSite;
        else if (prefix == Blex::StringPair::FromStringConstant("direct"))
            return FSDirect;
        else if (prefix == Blex::StringPair::FromStringConstant("directclib")) /* ADDME directclib could be a security risk (what happens if you just compiler-load a corrupted or dangeroulsy engineerd CLIB file?) and should go !*/
            return FSDirectClib;
        else if (prefix == Blex::StringPair::FromStringConstant("relative"))
            return FSRelative;
        else if (prefix == Blex::StringPair::FromStringConstant("test"))
            return FSTest;

        throw HareScript::VMRuntimeError(HareScript::Error::UnknownFilePrefix, prefix.stl_str());
}

const char * GetPrefixString(Type type)
{
        switch (type)
        {
        case FSWH:              return "wh";
        case FSWHRes:           return "whres";
        case FSModule:          return "module";
        case FSStorage:         return "storage";
        case FSModuleData:      return "moduledata";
        case FSMod:             return "mod";
        case FSModuleScript:    return "modulescript";
        case FSModuleRoot:      return "moduleroot";
        case FSSite:            return "site";
        case FSWHFS:            return "whfs";
        case FSCurrentSite:     return "currentsite";
        case FSDirect:          return "direct";
        case FSDirectClib:      return "directclib";
        case FSRelative:        return "relative";
        case FSTest:            return "test";
        }
        return "";
}


std::string StripPrefix(std::string const &liburi, bool strip_initial_slashes)
{
        // Determine the prefix
        std::string::const_iterator it = std::find(liburi.begin(), liburi.end(), ':');
        if (it == liburi.end() || ++it == liburi.end() || *it != ':')
            return liburi;

        ++it; //skip last of the double colon

        if (strip_initial_slashes)
        {
                while (it != liburi.end() && *it=='/')
                    ++it;
        }

        return std::string(it,liburi.end());
}

// Translates direct:: to module::, site:: stuff.
std::string WHFileSystem::TranslateLibraryURI(Blex::ContextKeeper &keeper, std::string const &directuri) const
{
        if (directuri.size()>=8 && Blex::StrCompare(directuri,"direct::",8) == 0)
        {
                Context context(keeper);

                // First, find a matching module (FIXME move to whcore?)
                std::vector< std::string > modules;
                context->whconn->GetModuleNames(&modules);

                for (std::vector< std::string >::iterator it = modules.begin(); it != modules.end(); ++it)
                {
                        std::string folder = context->whconn->GetModuleFolder(*it);

                        /* Is loader located inside this folder? */
                        if (directuri.size() >= folder.size()+8
                            && Blex::StrCaseCompare<std::string::const_iterator>
                                                  (folder.begin(),folder.end()
                                                  ,directuri.begin()+8,directuri.begin()+8+folder.size()) == 0)
                        {
                                // test for wh:: and whres:: if we're inside the system folder
                                if (*it == Blex::StringPair::FromStringConstant("system"))
                                {
                                        std::string whfolder = folder + "whlibs/";

                                        if (directuri.size() >= folder.size()+8
                                            && Blex::StrCaseCompare<std::string::const_iterator>
                                                                  (whfolder.begin(),whfolder.end()
                                                                  ,directuri.begin()+8,directuri.begin()+8+whfolder.size()) == 0)
                                            return "wh::" + std::string(directuri.begin() + 8 + whfolder.size(), directuri.end());

                                        std::string whresfolder = folder + "whres/";

                                        if (directuri.size() >= folder.size()+8
                                            && Blex::StrCaseCompare<std::string::const_iterator>
                                                                  (whresfolder.begin(),whresfolder.end()
                                                                  ,directuri.begin()+8,directuri.begin()+8+whresfolder.size()) == 0)
                                            return "whres::" + std::string(directuri.begin() + 8 + whresfolder.size(), directuri.end());
                                }

                                // Folders ends with '/'
                                int32_t match_amount = folder.size();
                                std::string subpath = std::string(directuri.begin() + 8 + match_amount, directuri.end());
                                return "mod::" + *it + "/" + subpath;
                        }
                }

                return directuri;
        }

        // Couldn't translate
        return directuri;
}

void WHFileSystem::ResolveAbsoluteLibrary(Blex::ContextKeeper &keeper, std::string const &rawloader, std::string *libname) const
{
        Type type = GetPrefix(*libname);
        *libname = StripPrefix(*libname, type != FSRelative);

        if (type == FSRelative)
        {
                std::string loader = TranslateLibraryURI(keeper, rawloader); // the module:: source library
                bool savefirstpart = false;
                bool allowreset = false;

                Type loaderprefix = GetPrefix(loader);

                switch (loaderprefix)
                {
                case FSModule:
                case FSSite:
                case FSModuleData:
                case FSStorage:
                case FSModuleScript:
                case FSModuleRoot:
                case FSMod:
                    savefirstpart = true;
                    //fallthrough
                case FSWH:
                case FSTest:
                    allowreset = true;
                    break;

                case FSWHRes:
                case FSDirect:
                case FSDirectClib:
                    throw HareScript::VMRuntimeError(HareScript::Error::PrefixDoesNotAllowRelativeAddressing, GetPrefixString(loaderprefix));

                default:
                    {
                            std::string::iterator it = std::find(loader.begin(), loader.end(), ':');
                            throw HareScript::VMRuntimeError(HareScript::Error::UnknownFilePrefix, std::string(loader.begin(), it));
                    }
                }

                // Get the prefix path (and maybe the first string part for sites & modules), that needs to be fixed
                std::string::iterator prefixend = std::find(loader.begin(), loader.end(), ':');
                if (prefixend != loader.end())
                {
                        ++prefixend;
                        if (prefixend != loader.end() && *prefixend == ':')
                        {
                                if (savefirstpart)
                                    prefixend = std::find(prefixend + 1, loader.end(), '/');
                                if (prefixend != loader.end())
                                    ++prefixend;
                        }
                }

                std::string oldpath = Blex::GetDirectoryFromPath(std::string(prefixend, loader.end()));

                // relative::/ goes back to base of current module/site
                std::string stripped = StripPrefix(*libname, false);
                if (allowreset && !stripped.empty() && stripped[0] == '/')
                    oldpath.clear();

                std::string merged = Blex::MergePath(oldpath, *libname);
                if (Blex::MergePath("/canary/", merged) != Blex::MergePath("/canary/" + oldpath, *libname))
                    throw HareScript::VMRuntimeError(HareScript::Error::RelativePathMayNotEscape);

                type = loaderprefix;
                *libname = std::string(loader.begin(), prefixend) + Blex::MergePath(oldpath, *libname);
                *libname = StripPrefix(*libname, type != FSRelative);
        }

        *libname = Blex::CollapsePathString(*libname, true);

        if (type == FSModule || type == FSModuleData || type == FSModuleScript || type == FSModuleRoot) //module:: should be rewritten to mod:: /lib/
        {

                std::string::iterator firstslash = std::find(libname->begin(), libname->end(), '/');
                if (firstslash == libname->end())
                    return;

                std::string modulename = std::string(libname->begin(),firstslash);
                std::string subpart;

                if(type==FSModuleData)
                {
                        subpart = "/data/";
                }
                else if(type==FSModuleScript)
                {
                        subpart = "/scripts/";
                }
                else if(type==FSModuleRoot)
                {
                        subpart = "/";
                }
                else
                {
                        //See if /include/ exists, otherwise we'll go for lib (lib is considered default)
                        bool useinclude = false;

                        Context context(keeper);
                        std::string modroot = context->whconn->GetModuleFolder(modulename);
                        if (!modroot.empty())
                        {
                                std::string trylib = modroot + "include/" + std::string(firstslash+1,libname->end());
                                useinclude = Blex::PathStatus(trylib).Exists();
                        }
                        subpart = useinclude ? "/include/" : "/lib/";
                }
                *libname = "mod::" + modulename + subpart + std::string(firstslash+1,libname->end());
        }
        else
        {
                *libname = std::string(GetPrefixString(type)) + (type == FSDirect || type == FSDirectClib ? "::/" : "::") + *libname;
        }

        if (Blex::StrStartsWith(*libname, "mod::system/whlibs/"))
            *libname = "wh::" + std::string(libname->begin() + 19, libname->end());
        else if (Blex::StrStartsWith(*libname, "mod::system/whres/"))
            *libname = "whres::" + std::string(libname->begin() + 18, libname->end());
}

HareScript::FileSystem::FilePtr WHFileSystem::OpenLibrary(Blex::ContextKeeper &keeper, std::string const &_liburi) const
{
        Context context(keeper);
        std::string liburi(_liburi);

        for (std::string::iterator it = liburi.begin(); it != liburi.end(); ++it)
            if ((*it >= 0 && *it < ' ') || *it == 127)
                throw HareScript::VMRuntimeError(HareScript::Error::IllegalLibraryName, liburi);

        // Determine file type and strip the prefix, if any, from the file
        Type type = GetPrefix(liburi);
        if (type == FSModule || type == FSModuleData || type == FSModuleScript || type == FSModuleRoot) //rewrite all to mod::
        {
                ResolveAbsoluteLibrary(keeper, _liburi, &liburi);
                type = GetPrefix(liburi);
        }
        liburi = StripPrefix(liburi,type == FSCurrentSite);

        HareScript::FileSystem::FilePtr file;
        switch (type)
        {
        case FSDirect:
                file = GetDirectFile(keeper, liburi);
                break;
         case FSDirectClib: //loaded by SQL client to run SQL queries
                file = GetDirectClibFile(keeper, liburi);
                break;
        case FSWH:
                {
                        std::string templatepath = context->whconn->GetModuleFolder("system");
                        if(templatepath.empty())
                            return FilePtr();

                        templatepath = Blex::MergePath(templatepath + "whlibs", liburi);
                        file = GetDirectFile(keeper, templatepath);
                } break;
        case FSWHRes:
                {
                        std::string templatepath = context->whconn->GetModuleFolder("system");
                        if(templatepath.empty())
                            return FilePtr();

                        templatepath = Blex::MergePath(templatepath + "whres", liburi);
                        file = GetDirectFile(keeper, templatepath);
                } break;
        case FSTest:
                {
                        std::string templatepath = context->whconn->GetModuleFolder("webhare_testsuite");
                        if(templatepath.empty())
                            return FilePtr();

                        templatepath = Blex::MergePath(templatepath + "tests/baselibs/hsengine/", liburi);
                        file = GetDirectFile(keeper, templatepath);
                } break;

        case FSMod:
                {
                        std::string::iterator firstslash=std::find(liburi.begin(),liburi.end(),'/');
                        if (firstslash == liburi.end())
                            return FilePtr();

                        std::string templatepath;
                        templatepath = context->whconn->GetModuleFolder(std::string(liburi.begin(),firstslash));
                        if (templatepath.empty())
                            return FilePtr();

                        templatepath = Blex::MergePath(templatepath, std::string(firstslash+1,liburi.end()));

                        file = GetDirectFile(keeper, templatepath);
                        break;
                }

        case FSStorage:
                {
                        std::string::iterator firstslash=std::find(liburi.begin(),liburi.end(),'/');
                        if (firstslash == liburi.end())
                            return FilePtr();

                        std::string templatepath = context->whconn->GetBaseDataRoot() + "storage";
                        templatepath += std::string(firstslash,liburi.end());
                        file = GetDirectFile(keeper, templatepath);
                        break;
                }

        case FSSite:
                {
                        DEBUGPRINT("Mapping " << liburi);
                        std::string filepath = Blex::MergePath(context->whconn->GetEphemeralRoot(), "system.dbcode");
                        filepath += '/';
                        Blex::ToLowercase(liburi.begin(), liburi.end());
                        filepath += liburi;

                        DEBUGPRINT("To " << filepath);
                        file = GetDirectFile(keeper, filepath);
                }
        default: ; // Ignore other prefixes
        }

        return file;
}

bool WHFileSystem::ParseError(const char *start, const char *limit, HareScript::ErrorHandler *handler)
{
        std::vector<std::string> errorparts;
        Blex::TokenizeString(std::string(start, limit), '\t', &errorparts);

        if (errorparts.size() != 7)
            throw HareScript::VMRuntimeError(HareScript::Error::InternalError, "Unrecognized error string");

        HareScript::VMRuntimeError m(HareScript::Error::InternalError);
        m.iserror = errorparts[0].empty() || errorparts[0][0]!='W';
        m.position.line = DecodeNumber(errorparts[1]);
        m.position.column = DecodeNumber(errorparts[2]);
        m.filename = errorparts[3];
        m.code = DecodeNumber(errorparts[4]);
        m.msg1 = errorparts[5];
        m.msg2 = errorparts[6];
        handler->AddMessage(m);

        return m.iserror;
}

bool WHFileSystem::ManualRecompile(std::string const &_liburi, HareScript::ErrorHandler *handler, bool force)
{
        //Try to manually compile the file
        Blex::Process manualcompiler;
        std::vector<std::string> args;

        if (std::find(_liburi.begin(), _liburi.end(), '\t') != _liburi.end())
            throw HareScript::VMRuntimeError(HareScript::Error::InternalError, "Illegal library name, tab characters (\\t) are not allowed");

        conn->AddStandardArguments(&args);
        if (force)
            args.push_back("-f");
        args.push_back("--quiet");
        args.push_back("--parseable");
        args.push_back(_liburi);

        //If we don't redirect, Win32 creates a console under some circumstances :-(
        Blex::PipeSet outputset;
        outputset.GetReadEnd().SetBlocking(false); //our end must be safe to read
        manualcompiler.RedirectOutput(outputset.GetWriteEnd(), false); //ignore debug messages

        //FIXME: Redirect compiler errors to our standard output?!
        DEBUGPRINT("Starting manual compilation, because the compiler server could not be contacted");
        if (!manualcompiler.Start(Blex::MergePath(conn->GetBinRoot(), "whcompile"),args,"",false))
            throw HareScript::VMRuntimeError(HareScript::Error::InternalError, "Could not start the compiler");

        //Read the process output
        Blex::PipeWaiter waiter;
        waiter.AddReadPipe(outputset.GetReadEnd());

        char inbuf[1024];
        unsigned bytesread;
        std::string output;
        while(true)
        {
                waiter.Wait(Blex::DateTime::Max());
                bytesread = outputset.GetReadEnd().Read(inbuf,1024);
                if (bytesread == 0 && outputset.GetReadEnd().EndOfStream()) //broken pipe
                    break;
                output.insert(output.end(), inbuf, inbuf+bytesread);
        }

        //Parse any errors
        std::string::iterator pos = output.begin();
        while (pos != output.end())
        {
                std::string::iterator next_line = std::find(pos,output.end(),'\n');
                ParseError(&*pos,
                           &*(pos != next_line && next_line[-1]=='\r' ? next_line-1 : next_line),
                           handler);

                pos = next_line==output.end() ? next_line : next_line+1;
        }

        manualcompiler.WaitFinish();

        //Parse the process output
        if (manualcompiler.GetReturnValue() != 0)
            return false;

        return true;
}

WHFileSystem::RecompileResult WHFileSystem::Recompile(Blex::ContextKeeper &keeper, std::string const &_liburi, bool isloadlib, HareScript::ErrorHandler *errorhandler)
{
        return RecompileInternal(keeper, _liburi, isloadlib, priorityclass, allow_direct_compilations, true, errorhandler);
}

WHFileSystem::RecompileResult WHFileSystem::RecompileExternal(Blex::ContextKeeper &keeper, std::string const &liburi, bool force, HareScript::ErrorHandler *errorhandler)
{
        return RecompileInternal(keeper, liburi, /*isloadlib=*/false, CompilationPriority::ClassBackground, /*allow_manual_recompilation=*/false, force, errorhandler);
}

WHFileSystem::RecompileResult WHFileSystem::RecompileInternal(Blex::ContextKeeper &keeper, std::string const &_liburi, bool /*isloadlib*/, CompilationPriority::Class priority, bool allow_manual_recompilation, bool force, HareScript::ErrorHandler *errorhandler)
{
        Context context(keeper);

        std::unique_ptr<HTTPConnection> httpconn;
        int result = 500;
        std::string resultmsg;
        errorhandler->SetCurrentFile(_liburi);

        try
        {
                std::string requesturi = "/compile/";
                Blex::EncodeUrl(_liburi.begin(), _liburi.end(), std::back_inserter(requesturi));

                //ADDME: Cache & share HTTP connections!
                httpconn.reset(new HTTPConnection("WHFileSystem"));

                if (httpconn->Connect("127.0.0.1",context->whconn->GetCompilerLocation().GetPort()))
                {
                        if(force)
                            httpconn->AddRequestHeader("X-WHCompile-Force", "true");
                        httpconn->AddRequestHeader("X-WHCompile-Priority", Blex::AnyToString((int32_t)priority));
                        result = httpconn->DoRequest("GET", requesturi);
                }
                else if (!allow_manual_recompilation)
                {
                        errorhandler->AddInternalError("Unable to connect to the compilation server: " + std::string(Blex::SocketError::GetErrorText(httpconn->GetLastError())) + (httpconn->GetStatusMsg() == "" ? "" : httpconn->GetStatusMsg()));
                        return RecompileError;
                }
                resultmsg = httpconn->GetStatusMsg();
        }
        catch (std::exception &e)
        {
                result = 500; // Emulate server error
                resultmsg = e.what();
        }

        if (result==200 || result==403)
        {
                std::vector<char> response(static_cast<uint32_t>(httpconn->GetRemainingBodyLength()));
                if (httpconn->ReadBody(&response[0], response.size()) != response.size())
                {
                        errorhandler->AddInternalError("Unable to grab response from the compilation server: " + std::string(Blex::SocketError::GetErrorText(httpconn->GetLastError())));
                        return RecompileError;
                }

                Blex::TokenIterator<std::vector<char> > tokenizer(response.begin(), response.end(), '\n');
                bool has_errors = false;
                for (;tokenizer;++tokenizer)
                    if(tokenizer.begin() != tokenizer.end())
                    {
                            bool is_error = ParseError(&*tokenizer.begin(), &*tokenizer.end(), errorhandler);
                            if (is_error)
                                has_errors = true;
                    }

                return has_errors ? RecompileError : RecompileSuccess;
        }
        else if (allow_manual_recompilation)
        {
                if (ManualRecompile(_liburi, errorhandler, force))
                    return RecompileSuccess;

                return RecompileError;
        }
        else if (result==-1)
        {
                errorhandler->AddInternalError("I/O error while communicating with the compilation server: " + std::string(Blex::SocketError::GetErrorText(httpconn->GetLastError())));
        }
        else
        {
                errorhandler->AddInternalError("Unable to understand compilation server response: " + Blex::AnyToString(result) + (resultmsg == "" ? "" : " - " + resultmsg));
        }
        return RecompileError;
}

std::string WHFileSystem::ReturnPath(Blex::ContextKeeper &keeper, std::string const &filename)
{
        if (filename.substr(0, 1) == "/")
            return filename;

        HareScript::FileSystem::FilePtr file = OpenLibrary(keeper, filename);
        if (!file)
            return "";

        DirectFile *directfile = dynamic_cast<DirectFile *>(file.get());
        if (directfile && !directfile->sourcefile.empty())
            return directfile->sourcefile;

        return "";
}

std::string WHFileSystem::GetDynamicModuleFullPath(std::string const &modulename) const
{
        return Blex::MergePath(dynamicmodulepath, "hsm_" + modulename + Blex::GetDynamicLibExtension());
}

void WHFileSystem::ReleaseResources(Blex::ContextKeeper &keeper)
{
        Context context(keeper);
        context->directfiles.clear();
}


// -----------------------------------------------------------------------------
//
//      WHFileSystem::ContextData
//
WHFileSystem::ContextData::ContextData(WHCore::Connection *_whconn)
: whconn(_whconn)
{
}

WHFileSystem::ContextData::~ContextData()
{
}

Blex::DateTime GetPathDateTime(std::string const &path)
{
        Blex::PathStatus status(path);
        return status.Exists() && !status.IsDir() ? status.ModTime() : Blex::DateTime::Invalid();
}

// -----------------------------------------------------------------------------
//
//      WHFileSystem::DirectFile
//
WHFileSystem::DirectFile::DirectFile(std::string const *_sourcefile, std::string const &_clibfile)
: sourcefile(_sourcefile ? *_sourcefile : std::string())
, clibfile(_clibfile)
{
}

Blex::DateTime WHFileSystem::DirectFile::GetSourceModTime()
{
        if (!sourcefile.empty())
            return GetPathDateTime(sourcefile);
        return Blex::DateTime::Invalid();
}

void WHFileSystem::DirectFile::GetSourceData(std::unique_ptr< Blex::RandomStream > *str, Blex::DateTime *modtime)
{
        std::unique_ptr<Blex::FileStream> stream;
        if(!sourcefile.empty())
            stream.reset(Blex::FileStream::OpenRead(sourcefile));
        if(stream.get())
        {
                *modtime = stream->GetStatus().ModTime();
                *str = std::move(stream);
        }
}

void WHFileSystem::DirectFile::GetClibData(std::unique_ptr< Blex::RandomStream > *str, Blex::DateTime *modtime)
{
        std::unique_ptr<Blex::FileStream> stream;
        if(!clibfile.empty())
            stream.reset(Blex::FileStream::OpenRead(clibfile));
        if(stream.get())
        {
                *modtime = stream->GetStatus().ModTime();
                *str = std::move(stream);

        }
}

std::string WHFileSystem::DirectFile::GetClibPath()
{
        return clibfile;
}

void WHFileSystem::DirectFile::RemoveClib()
{
        Blex::RemoveFile(clibfile);
}

bool CreateClibViaTmp(Blex::RandomStream &str, std::string const &path)
{
        /* First create a temporary file, to prevent unsynchronized filesystems
           from reading the incomplete library */
        std::unique_ptr<Blex::FileStream> newstr;
        std::string temppath = Blex::CreateTempName(path + ".tmp");
        newstr.reset(Blex::FileStream::OpenRW(temppath, true, true, Blex::FilePermissions::PrivateRead));
        if (!newstr.get()
            || str.SendAllTo(*newstr) != str.GetFileLength())
            return false;

        newstr.reset(); //close the file
        return Blex::MovePath(temppath, path);
}

bool WHFileSystem::DirectFile::CreateClib(Blex::RandomStream &str)
{
        if (!CreateClibViaTmp(str,clibfile))
            return false;

        return true;
}

std::string WHFileSystem::DirectFile::GetDescription()
{
        return "file:" + sourcefile;
}

// -----------------------------------------------------------------------------
void DisplayMessage(WHFileSystem &fsys, Blex::ContextKeeper *keeper, HareScript::Message const &m)
{
        std::string msg;
        if (keeper && !m.filename.empty())
                msg = fsys.ReturnPath(*keeper, m.filename);
        else
                msg = m.filename;

        msg += ":" + Blex::AnyToString(m.position.line) + ":" + Blex::AnyToString(m.position.column) + ": ";
        msg += (m.iserror ? "Error" : "Warning");
        msg += + ": " + HareScript::GetMessageString(m) + "\n";
        std::cerr << msg;
}

void DisplayStackLocation(WHFileSystem &fsys, Blex::ContextKeeper *keeper, HareScript::StackTraceElement const &m)
{
        std::string msg;
        if (keeper && !m.filename.empty())
                msg += fsys.ReturnPath(*keeper, m.filename);
        else
                msg += m.filename;

        msg += ":" + Blex::AnyToString(m.position.line) + ":" + Blex::AnyToString(m.position.column) + ": Called from ";
        msg += m.func;
        msg += "\n";
        std::cerr << msg;
}
