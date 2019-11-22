#include <ap/libwebhare/allincludes.h>


#include <blex/logfile.h>
#include <ap/libwebhare/webscon.h>
#include "consilio_main.h"
#include "consilio_janitor.h"
#include "indexwriter.h"

//ADDME: The proper way to handle this would be the Context mechnanism ?
IndexManager *global_index_manager = NULL;

void GlobalHandleIndexRequest(WebServer::Connection *webcon, std::string const &path)
{
        if (global_index_manager)
            global_index_manager->HandleIndexRequest(webcon, path);
        else
            webcon->FailRequest(WebServer::StatusInternalError, "Index manager not available");
}

int UTF8Main(const std::vector<std::string> & args)
{
        Blex::OptionParser::Option optionlist[] =
        { Blex::OptionParser::Option::StringOpt("indexdir")
        , Blex::OptionParser::Option::StringOpt("listenip")
        , Blex::OptionParser::Option::StringOpt("listenport")
        , Blex::OptionParser::Option::Switch("rebuild",false)
        , Blex::OptionParser::Option::ListEnd()
        };

        Blex::OptionParser optparse(optionlist);
        WHCore::Connection::AddOptions(optparse);

        if (!optparse.Parse(args))
        {
                Blex::ErrStream() << optparse.GetErrorDescription();
                return EXIT_FAILURE;
        }

        WHCore::Connection whconn(optparse, "consilio", WHCore::WHManagerConnectionType::Connect);

        std::string indexdir = optparse.StringOpt("indexdir");
        if(indexdir.empty())
            indexdir = Blex::MergePath(whconn.GetBaseDataRoot(),"index");

        IndexManagerConfig config;
        config.stemming = true;
        config.loglevel = Log_FatalErrors;

        if (optparse.Exists("listenip"))
            config.listenport.SetIPAddress(optparse.StringOpt("listenip"));
        else
            config.listenport.SetIPAddress("127.0.0.1");

        if (optparse.Exists("listenport"))
            config.listenport.SetPort(static_cast<uint16_t>(std::atol(optparse.StringOpt("listenport").c_str())));

//        if (inet_addr(config.ip_address.c_str()) == INADDR_NONE)
//        {
//                Blex::ErrStream() << "Invalid IP address '" << config.ip_address << "'";
//                return EXIT_FAILURE;
//        }
        if (config.listenport.GetPort() == 0)
        {
                Blex::ErrStream() << "Invalid port";
                return EXIT_FAILURE;
        }

        std::unique_ptr<IndexManager> indexmanager;
        try
        {
                indexmanager.reset(new IndexManager(whconn, indexdir, config, optparse.Switch("rebuild")));
        }
        catch (std::runtime_error const &e)
        {
                Blex::ErrStream() << "Could not start the IndexManager (another instance of Consilio already running?)";
                Blex::ErrStream() << "Error message: " << e.what();
                return EXIT_FAILURE;
        }
        indexmanager->SetNewLogLevel(config.loglevel);

        std::unique_ptr<ConsilioBroadcastListener> conflisten(new ConsilioBroadcastListener(whconn, *indexmanager));

        Blex::SetInterruptHandler(std::bind(&WebServer::Server::InterruptHandler,&indexmanager->webserver,std::placeholders::_1),false);

        int ret = indexmanager->Execute();

        Blex::ResetInterruptHandler();

        conflisten.reset();

        indexmanager->ProperShutdown();
        return ret;
}

int main(int argc, char * argv[])
{
        return Blex::InvokeMyMain(argc, argv, &UTF8Main);
}

ConsilioBroadcastListener::ConsilioBroadcastListener(WHCore::Connection &_conn, IndexManager &_indexmanager)
: NotificationEventReceiver(_conn.GetNotificationEventMgr())
, conn(_conn)
, indexmanager(_indexmanager)
{
        Register();
}

ConsilioBroadcastListener::~ConsilioBroadcastListener()
{
        Unregister();
}

void ConsilioBroadcastListener::ReceiveNotificationEvent(std::string const &event, uint8_t const *hsvmdata, unsigned hsvmdatalen)
{
        if (event == "consilio:indexmanager.config")
        {
                DEBUGPRINT("Got remote config change");

                using namespace HareScript;

                ColumnNames::GlobalMapper globalmapper;
                ColumnNames::LocalMapper localmapper(globalmapper);
                StackMachine stackm(localmapper);
                Marshaller marshaller(stackm, HareScript::MarshalMode::SimpleOnly);
                VarId msgvar(stackm.NewHeapVariable());

                marshaller.Read(msgvar, hsvmdata, hsvmdata + hsvmdatalen);

                if (stackm.GetType(msgvar) == VariableTypes::Record)
                {
                        ColumnNameId col_loglevel = localmapper.GetMapping("LOGLEVEL");
                        VarId var_loglevel = stackm.RecordCellGetByName(msgvar, col_loglevel);
                        if (var_loglevel && stackm.GetType(var_loglevel) == VariableTypes::Integer)
                        {
                                LogLevel newloglevel = static_cast< LogLevel >(stackm.GetInteger(var_loglevel));
                                DEBUGPRINT("- new log level: " << newloglevel);
                                indexmanager.SetNewLogLevel(newloglevel);
                        }
                }
        }
        else
            DEBUGPRINT("Got unknown broadcast event " << event);
}

IndexManager::IndexManager(WHCore::Connection &conn, std::string const &basedir, IndexManagerConfig const &_conf, bool force_rebuild)
: webserver(conn.GetTmpRoot()
           ,std::bind(&IndexManager::AccessLogFunction, this, std::placeholders::_1, std::placeholders::_2, std::placeholders::_3)
           ,std::bind(&IndexManager::ErrorLogFunction, this, std::placeholders::_1, std::placeholders::_2))
, sanityfile(Blex::MergePath(basedir, "index-is-sane"))
, conf(_conf)
{
        SetNewLogLevel(Log_FatalErrors);

        std::string indexbase = Blex::MergePath(basedir, "searchindex");
        std::string cachebase = Blex::MergePath(basedir, "searchcache");

        IndexStatus newindexstatus = IndexOk;
        bool rebuild_index = false;

        if (force_rebuild)
        {
                newindexstatus = IndexCheck;
                rebuild_index = true;
        }
        else if (Blex::PathStatus(sanityfile).IsFile())
        {
                // index-is-sane only exists when the previous IndexManager closed correctly
                if (CheckIndexVersion(indexbase))
                {
                        // IndexManager exited cleanly and index version is ok
                        if (GetLogLevel() >= Log_Debug)
                            Blex::ErrStream() << "Reopening index";
                        Blex::RemoveFile(sanityfile);
                }
                else
                {
                        // Wrong version, rebuild index
                        newindexstatus = IndexCheck;
                        rebuild_index = true;
                }
        }
        else if (Blex::PathStatus(basedir).IsDir())
        {
                // Index directory exists, validate it
                if (!ValidateIndex(indexbase, cachebase))
                    rebuild_index = true; // Index could not be validated, rebuild it
                newindexstatus = IndexCheck;
        }
        else
        {
                // Rebuild index completely
                newindexstatus = IndexCheck;
                rebuild_index = true;
        }

        if (force_rebuild)
        {
                BackupIndex(basedir);
                Blex::CreateDirRecursive(basedir,false);
                DEBUGPRINT("Index will be recreated");
                Blex::ErrStream() << "Recreating index";
        }
        else if (rebuild_index)
        {
                BackupIndex(basedir);
                Blex::CreateDirRecursive(basedir,false);
                DEBUGPRINT("Index will be recreated");
                Blex::ErrStream() << "Recreating index (wrong version or index corrupt/not found)";
        }
        else if (newindexstatus == IndexCheck)
        {
                DEBUGPRINT("Index will be checked");
                Blex::ErrStream() << "Checking index (Consilio not properly shut down)";
        }

        *(LockedStatus::WriteRef(indexstatus)) = newindexstatus;
        *(LockedConfigured::WriteRef(indexmanagerconfigured)) = false;
        indexdirectory.reset(new Blex::ComplexFileSystem(indexbase, rebuild_index, Blex::ComplexFileSystem::BufferAll, true));//, false, IndexFs_BlockSize, IndexFs_BlocksPerFile, IndexFs_CacheSize, IndexFs_EntriesPerFatPage, false));
        cachefs.reset(new Blex::ComplexFileSystem(cachebase, rebuild_index, Blex::ComplexFileSystem::BufferAll, true));//, false, CacheFs_BlockSize, CacheFs_BlocksPerFile, CacheFs_CacheSize, CacheFs_EntriesPerFatPage, false));
        ramfs.reset(new Blex::ComplexFileSystem);
        cache.Clear();

        // Set standard file buffer size for index directory to 4k
        indexdirectory->SetStandardBufferSize(4096);

        Lucene::IndexWriter writer(commit_lock, *indexdirectory, *ramfs, cache, rebuild_index);

        janitor.reset(new Janitor(*this));
}

IndexManager::~IndexManager()
{
        janitor->Stop();
        cache.Clear();
}

void IndexManager::AccessLogFunction(WebServer::Connection&conn,unsigned responsecode,uint64_t bytessent)
{
        if (GetLogLevel() >= Log_Statistics)
        {
                Blex::ErrStream() << conn.GetRemoteAddress()
                              << ": "
                              << conn.GetRequestParser().GetRequestLine()
                              << " "
                              << responsecode
                              << " "
                              << bytessent;
        }
}
void IndexManager::ErrorLogFunction(Blex::SocketAddress const &remoteaddr,std::string const&error)
{
        if (GetLogLevel() >= Log_Statistics)
        {
                Blex::ErrStream() << remoteaddr
                              << ": "
                              << error;
        }
}

void IndexManager::ProperShutdown()
{
        //create&close the file (ADDME: Shouldn't we close the FSDirectory first?)
        if (*LockedStatus::ReadRef(indexstatus) == IndexOk)
            delete Blex::FileStream::OpenWrite(sanityfile,true,false,Blex::FilePermissions::PrivateRead);
}

int IndexManager::Execute()
{
        if (GetLogLevel() >= Log_Debug)
            Blex::ErrStream() << "Consilio is starting...";

        // Configure and start dispatcher
        WebServer::Listener la;
        la.listener.sockaddr = GetConfig().listenport;
        la.sitenum = 1; //point to the first website
        la.virtualhosting = false;

        std::shared_ptr< WebServer::ContentType > indextype(new WebServer::ContentType("x-webhare-builtin/consilio", &GlobalHandleIndexRequest));
        indextype->parse_body = true;

        WebServer::AccessRule totalrule;
        totalrule.matchtype=WebServer::AccessRule::MatchInitial;
        totalrule.force_content_type=indextype;
        totalrule.all_methods=true;
        totalrule.path="/";

        WebServer::WebSite website(""); //we need 'a' website for the webserver to accept path resolving

        auto indexmgr_config = std::make_shared<WebServer::ServerConfig>();
        indexmgr_config->listeners.push_back(la);
        indexmgr_config->sites.push_back(website);
        indexmgr_config->globalrules.push_back(totalrule);

        std::vector<Blex::Dispatcher::ListenAddress> broken_listeners;
        if(!webserver.ApplyConfig(indexmgr_config, &broken_listeners))
        {
                if(!broken_listeners.empty())
                        Blex::ErrStream() << "Consilio is unable to bind to its port " << GetConfig().listenport << ": " << Blex::SocketError::GetErrorText(broken_listeners[0].lasterror);
                else
                        Blex::ErrStream() << "Consilio is unable to apply its configuration binding to  port " << GetConfig().listenport;

                Blex::SleepThread(3000); //prevent bind flood if 2 consilios are running
                return 1;
        }

        global_index_manager = this;
        webserver.RegisterConnectionCategory(1, 1); // Category 1 (index writing action), max 1 concurrent connection
        webserver.RegisterConnectionCategory(2, 1); // Category 2 (configuration writing action), max 1 concurrent connection
        webserver.MainLoop(NumWorkers);
        global_index_manager = NULL;

        // The dispatcher runs until asynchronously terminated
        DEBUGPRINT("Dispatcher has terminated");

        if (GetLogLevel() >= Log_Debug)
            Blex::ErrStream() << "Consilio is shutting down";

        return 0;
}

LogLevel IndexManager::GetLogLevel() const
{
        return *LockedLogLevel::ReadRef(loglevel);
}

void IndexManager::SetNewLogLevel(LogLevel _loglevel)
{
        DEBUGONLY(_loglevel = Log_Debug);
        *(LockedLogLevel::WriteRef (loglevel)) = _loglevel;
        DEBUGPRINT("Log level set to " << _loglevel);
}

void IndexManager::BackupIndex(std::string const &basedir)
{
        if(basedir.empty())
              throw std::runtime_error("Empty basedir");

        std::string backupdir = basedir; // "path/to/webhare/var/index/"
        if (backupdir[backupdir.size()-1] == '/')
            backupdir.resize(backupdir.size()-1); // "path/to/webhare/var/index"
        backupdir = Blex::GetDirectoryFromPath(backupdir); // "path/to/webhare/var/"

        // Create a temp name with the current date
        char name[44];
        struct std::tm time = Blex::DateTime::Now().GetTM();
        std::sprintf(name ,"oldindex-%04d%02d%02d-",
                time.tm_year+1900,
                time.tm_mon+1,
                time.tm_mday);

        cache.Clear();

        backupdir = Blex::MergePath(backupdir, Blex::CreateTempName(name)); // "path/to/webhare/var/oldindex..."
        Blex::MovePath(basedir, backupdir);
}

bool IndexManager::ValidateIndex(const std::string & indexdir, const std::string & cachedir)
{
        if (GetLogLevel() >= Log_Statistics)
            Blex::ErrStream() << "Validating index...";

        // If opening the ComplexFileSystem fails, it is catched in UTF8Main, which exits the program
        Blex::ComplexFileSystem cachefs(cachedir, false, Blex::ComplexFileSystem::BufferWrites);//, false, CacheFs_BlockSize, CacheFs_BlocksPerFile, CacheFs_CacheSize, CacheFs_EntriesPerFatPage, false);
        Blex::ComplexFileSystem indexfs(indexdir, false, Blex::ComplexFileSystem::BufferAll);//, false, IndexFs_BlockSize, IndexFs_BlocksPerFile, IndexFs_CacheSize, IndexFs_EntriesPerFatPage, false);
        cache.Clear();

        try
        {
                if (!indexfs.Exists("segments"))
                    return false; // No valid segments files: no index for you!

                // List of valid segments
                std::map<std::string, uint32_t> valid_segments;
                valid_segments.clear();

                // Read segments file
                std::unique_ptr<Blex::ComplexFileStream> segments(indexfs.OpenFile("segments",false,false));
                if (!segments.get())
                    return false;

                uint32_t indexversion = segments->ReadLsb<uint32_t>();
                if (indexversion != INDEX_VERSION)
                    return false; // wrong index version - should be rebuilt

                uint32_t nextseg = segments->ReadLsb<uint32_t>();
                uint32_t segcount = segments->ReadLsb<uint32_t>();

                // Read each segment
                for (uint32_t i = 0; i < segcount; ++i)
                {
                        bool segment_valid = true;

                        std::string segname;
                        segments->ReadLsb(&segname );
                        uint32_t segsize = segments->ReadLsb<uint32_t>();

                        // Check existence of all segment files:
                        // .fnm, .fdx, .fdt, .tii, .tid, .frq, .prx
                        segment_valid &= indexfs.Exists(segname + ".fnm")
                                         && indexfs.Exists(segname + ".fdx")
                                         && indexfs.Exists(segname + ".fdt")
                                         && indexfs.Exists(segname + ".tii")
                                         && indexfs.Exists(segname + ".tis")
                                         && indexfs.Exists(segname + ".frq")
                                         && indexfs.Exists(segname + ".prx")
                                         && indexfs.Exists(segname + ".nrm");
                        // Deleted pages (in a possibly missing .del file) are
                        // checked after the index is validated (using an index check)

                        std::string reason;
                        if (segment_valid)
                        {
                                DEBUGPRINT("Validating segment " << segname << " (" << segsize << " documents)");

                                // Try to open and read the segment. Catch unexpected
                                // Lucene errors locally, so the corrupt segment
                                // can be deleted instead of the whole index
                                try
                                {
                                        // Open a segment reader
                                        Lucene::SegmentInfo si(segname, segsize, &indexfs);
                                        const std::unique_ptr<Lucene::SegmentReader> reader(new Lucene::SegmentReader(commit_lock, si, cache));
                                        if (!reader.get())
                                            throw LuceneException("Cannot open SegmentReader",true);

                                        // Get a term enumerator
                                        const std::unique_ptr<Lucene::TermEnum> te(reader->Terms());
                                        if (!te.get())
                                            throw LuceneException("Cannot get SegmentTermEnum",true);

                                        std::shared_ptr<Lucene::TermDocs> td(reader->GetTermPositionsPtr());
                                        if (!td.get())
                                            throw LuceneException("Cannot get TermDocs",true);

                                        // Enumerate all terms in the segment
                                        while (te->Next())
                                        {

                                                // This includes deleted documents,
                                                // which are not enumerated by TermDocs.
                                                // We'll let TermDocs enumerate the
                                                // term documents
                                                uint32_t docfreq = te->DocFreq();
                                                if (docfreq > segsize)
                                                {
                                                        DEBUGPRINT(docfreq << " <= " << segsize);
                                                        throw LuceneException("Invalid document frequency",true);
                                                }

                                                // Enumerate all term documents
                                                td->Seek(te->GetTerm());
                                                uint32_t prevdoc = td->Doc();
                                                uint32_t numdocs = 0;
                                                while (td->Next())
                                                {
                                                        uint32_t doc = td->Doc();
                                                        ++numdocs;
                                                        if (numdocs > segsize // More document in term position than in segment
                                                             || doc >= segsize // Document id out of range
                                                             || (doc <= prevdoc && doc > 0 && numdocs > 1)) // Document ids should be ascending (only first document may have id = 0)
                                                        {
                                                                DEBUGPRINT(te->GetTerm().Field() << ":" << te->GetTerm().Text() << " " << prevdoc << " < " << doc << " < " << segsize << ", " << numdocs << " docs");
                                                                throw LuceneException("Invalid document id",true);
                                                        }
                                                        prevdoc = doc;

                                                        // Read all document positions
                                                        uint32_t freq = td->Freq();
                                                        uint32_t prevpos = 0;
                                                        for (uint32_t k = 0; k < freq; ++k)
                                                        {
                                                                uint32_t pos = td->NextPosition();
                                                                if (prevpos >= pos && k > 0)
                                                                {
                                                                        DEBUGPRINT(te->GetTerm().Field() << ":" << te->GetTerm().Text() << " " << prevpos << " < " << pos);
                                                                        throw LuceneException("Invalid position",true);
                                                                }

                                                                prevpos = pos;
                                                        }
                                                }
                                        }
                                }
                                catch(LuceneException const &e)
                                {
                                        // Error while reading the segment, delete it
                                        DEBUGPRINT("Segment invalid: " << e.what());
                                        reason = e.what();
                                        segment_valid = false;
                                }
                        }

                        if (segment_valid)
                        {
                                if (GetLogLevel() >= Log_Statistics)
                                    Blex::ErrStream() << "Adding valid segment " << segname;

                                // Add segment to segment list
                                valid_segments.insert(std::make_pair(segname, segsize));
                        }
                        else
                        {
                                if (GetLogLevel() >= Log_Statistics)
                                    Blex::ErrStream() << "Deleting invalid segment " << segname << (!reason.empty() ? " (" + reason + ")" : std::string());

                                // Delete all segment files (remember undeletable files)
                                std::vector<std::string> files = indexfs.ListDirectory(segname+".*");
                                for(unsigned i=0;i<files.size();++i)
                                    indexfs.DeletePath(files[i]);
                        }
                }

                // Delete all files not belonging to any valid segment
                std::vector<std::string> filenames = indexfs.ListDirectory("_*");
                for(unsigned i=0;i<filenames.size();++i)
                {
                        std::string::size_type dot = filenames[i].find('.');
                        if ((dot == std::string::npos) ||
                            (valid_segments.find(filenames[i].substr(0, dot))) == valid_segments.end())
                        {
                                // No '.' in file name or segment name not in valid segments list
                                indexfs.DeletePath(filenames[i]);
                        }
                }

                // Clear the cache
                cache.Clear();

                // Write valid segments
                uint32_t version = segments->ReadLsb<uint32_t>();
                segments.reset();
                indexfs.DeletePath("segments");
                segments.reset(indexfs.OpenFile("segments",true,true));

                segments->WriteLsb<uint32_t>(INDEX_VERSION);
                segments->WriteLsb<uint32_t>(nextseg);
                segments->WriteLsb<uint32_t>(valid_segments.size());
                for (std::map<std::string, uint32_t>::iterator i = valid_segments.begin(); i != valid_segments.end(); ++i)
                {
                        segments->WriteLsb<std::string>(i->first);
                        segments->WriteLsb<uint32_t>(i->second);
                }
                segments->WriteLsb<uint32_t>(++version);
                cache.Clear();
                return true;
        }
        catch(LuceneException const &e)
        {
                cache.Clear();
                return false;
        }
        catch(std::runtime_error const &e)
        {
                cache.Clear();
                return false;
        }
}

bool IndexManager::CheckIndexVersion(const std::string &indexbasename)
{
        if (GetLogLevel() >= Log_Debug)
            Blex::ErrStream() << "Checking index version";

        // If opening the ComplexFileSystem fails, it is catched in UTF8Main, which exits the program
        Blex::ComplexFileSystem indexfs(indexbasename, false, Blex::ComplexFileSystem::BufferAll);//, false, IndexFs_BlockSize, IndexFs_BlocksPerFile, IndexFs_CacheSize, IndexFs_EntriesPerFatPage, false);

        try
        {

                // Read segments file
                const std::unique_ptr<Blex::ComplexFileStream> segments(indexfs.OpenFile("segments",false,false));
                if (!segments.get())
                    return false;

                uint32_t indexversion = segments->ReadLsb<uint32_t>();
                return indexversion == INDEX_VERSION;
        }
        catch(LuceneException const &e)
        {
                return false;
        }
}
