#include <ap/libwebhare/allincludes.h>

#include <blex/path.h>
#include <blex/logfile.h>
#include <blex/getopt.h>
#include <blex/utils.h>
#include <blex/dispat.h>
#include <csignal>
#include <iostream>
//#include <blex/platform/mswin.h>

//#include "dbase_io.h"
#include "dbase_janitor.h"
#include "dbservermain.h"
#include "restore.h"

/*ADDME: Unused?
static const unsigned MaxLowPriorityAsyncBuffers = 8;
*/

//wh_dbase.cpp:
void WHDBase_SetupDatabasePlugins(Database::Plugins *plugins, Blex::ContextRegistrator *trans_registrator);

//FIXME: Ensure that long-idle and long-total-time transactions are killed!
DBServer::DBServer()
: dispatcher( std::bind(&DBServer::CreateConnection,this,std::placeholders::_1) )
{
}

DBServer::~DBServer()
{
}

int DBServer::Execute (std::vector<std::string> const &args)
{
        Blex::OptionParser::Option optionlist[] =
        {
          Blex::OptionParser::Option::StringOpt("restore"),
          Blex::OptionParser::Option::StringOpt("restoreto"),
          Blex::OptionParser::Option::StringOpt("recordsto"),
          Blex::OptionParser::Option::StringOpt("missingblobs"),
          Blex::OptionParser::Option::StringOpt("blobsource"),
          Blex::OptionParser::Option::StringOpt("blobimportmode"),
          Blex::OptionParser::Option::StringOpt("listen"),
          Blex::OptionParser::Option::StringOpt("dbasefolder"),
          Blex::OptionParser::Option::StringOpt("recordfolder"),
          Blex::OptionParser::Option::StringOpt("indexfolder"),
          Blex::OptionParser::Option::StringOpt("janitor_maxwait"),
          Blex::OptionParser::Option::Switch("recoverymode", false),
          Blex::OptionParser::Option::Switch("nojanitor", false),
          Blex::OptionParser::Option::Switch("savedeletedblobs", false),
          Blex::OptionParser::Option::Switch("logtrans", false),
          Blex::OptionParser::Option::Switch("noindex", false),
          Blex::OptionParser::Option::Switch("nosync", false),
          Blex::OptionParser::Option::ListEnd()
        };

        try
        {
                Blex::OptionParser optparse(optionlist);

                if (!optparse.Parse(args))
                {
                        std::cerr << "Syntax: dbserver [options]\n\n";

                        //            --xxxxxxxxxxxxxxxxxxxxxxxxx  ddddddddddddddddddddddddddddddddddddddddddddddd\n
                        std::cerr << "--restore <file>             Restore the backup starting with file <file>\n";
                        std::cerr << "--restoreto <path>           Restore destination directory (must not exist yet)\n";
                        std::cerr << "--recordsto <path>           Optional separate record store directory (must exist!)\n";
                        std::cerr << "--blobsource <path>          Path to the blob directory of an incremental backup\n";
                        std::cerr << "--blobimportmode <mode>      How to import database blobs: hardlink, softlink, softlinkverify\n";
                        std::cerr << "                             copy or ignore.\n";
                        std::cerr << "--listen host:port           Listen host & port\n";

                        std::cerr << "\n" << optparse.GetErrorDescription() << "\n";
                        return EXIT_FAILURE;
                }
                if (optparse.Exists("restore"))
                {
                        std::string backupname=optparse.StringOpt("restore");
                        std::string restoredir=optparse.StringOpt("restoreto");
                        std::string recordsdir=optparse.StringOpt("recordsto");
                        std::string missingblobs=optparse.StringOpt("missingblobs");
                        std::string blobsource=optparse.StringOpt("blobsource");
                        std::string blobimportmode_str=optparse.StringOpt("blobimportmode");
                        if (!optparse.Exists("restoreto"))
                        {
                                Blex::ErrStream() << "Restore option requires a restoreto parameter";
                                return EXIT_FAILURE;
                        }
                        if(recordsdir.empty())
                            recordsdir = restoredir;

                        BlobImportMode::Type blobimportmode(BlobImportMode::FromBackup);
                        if (blobimportmode_str != "")
                        {
                                if (blobimportmode_str == "hardlink")
                                    blobimportmode = BlobImportMode::HardLink;
                                else if (blobimportmode_str == "softlink")
                                    blobimportmode = BlobImportMode::SoftLink;
                                else if (blobimportmode_str == "softlinkverify")
                                    blobimportmode = BlobImportMode::SoftLinkVerify;
                                else if (blobimportmode_str == "copy")
                                    blobimportmode = BlobImportMode::Copy;
                                else if (blobimportmode_str == "ignore")
                                    blobimportmode = BlobImportMode::Ignore;
                                else
                                {
                                        Blex::ErrStream() << "Illegal value for --blobimportmode, allowed are: hardlink, softlink, softlinkverify, copy, ignore";
                                        return EXIT_FAILURE;
                                }
                        }

                        //If backupname ends with a .bk000 extension, remove that
                        if (Blex::StrCaseLike(backupname,"*.bk000"))
                            backupname.resize(backupname.size()-6);

                        return RunRestore(backupname, restoredir, recordsdir, missingblobs, blobsource, blobimportmode) ? EXIT_SUCCESS : EXIT_FAILURE;
                }
                if (!optparse.Exists("restore") && optparse.Exists("restoreto"))
                {
                        Blex::ErrStream() << "Restoreto option can only be used with the restore parameter";
                        return EXIT_FAILURE;
                }

                if (optparse.Exists("listen"))
                {
                        std::string server = optparse.StringOpt("listen");
                        try
                        {
                                dbaseaddr = Blex::SocketAddress(server);
                        }
                        catch (std::invalid_argument const &e)
                        {
                                Blex::ErrStream() << "Invalid listen address '" << server << "': " << e.what();
                        }
                }
                else
                    dbaseaddr = Blex::SocketAddress("127.0.0.1:13679");

                bool recovery_mode = optparse.Switch("recoverymode");
                basedbasefolder = optparse.StringOpt("dbasefolder");
                recordfolder = optparse.StringOpt("recordfolder");
                indexfolder = optparse.StringOpt("indexfolder");
                janitor_maxwait = std::atol(optparse.StringOpt("janitor_maxwait").c_str());
                if(!janitor_maxwait)
                    janitor_maxwait = 24*60*60;

                if(recordfolder.empty())
                    recordfolder = basedbasefolder;
                if(indexfolder.empty())
                    indexfolder = basedbasefolder;

                nojanitor = optparse.Switch("nojanitor");
                sync = !optparse.Switch("nosync");
                savedeletedblobs = optparse.Switch("savedeletedblobs");
                logtrans = optparse.Switch("logtrans");
                noindex = optparse.Switch("noindex");
                sync = !optparse.Switch("nosync");

                //WHCore::Connection conn(optparse, "dbserver", true, WHCore::WHManagerConnectionType::None);
                if(basedbasefolder.empty())
                {
                        Blex::ErrStream() << "Database folder not specified";
                        Blex::ErrStream() << "Usual syntax: dbserver --listen 127.0.0.1:13679 --dbasefolder /opt/whdata/dbase/";
                        return EXIT_FAILURE;
                }

                //Database::DatabaseLocation dbaseloc(optparse.StringOpt("dbroot"));
                if (!RunServer(recovery_mode))
                    return EXIT_FAILURE;

                return EXIT_SUCCESS;
        }
        catch (Database::Exception &e)
        {
                Blex::ErrStream() << "Database error caused server termination: " << e.what();
                return EXIT_FAILURE;
        }
        catch (std::bad_alloc &e)
        {
                Blex::ErrStream() << "A lack of memory caused server termination: " << e.what();
                return EXIT_FAILURE;
        }
        catch (std::exception &e)
        {
                Blex::ErrStream() << "Internal error caused server termination: " << e.what();
                return EXIT_FAILURE;
        }
        catch (...)
        {
                Blex::ErrStream() << "An unknown exception caused server termination";
                return EXIT_FAILURE;
        }
}

void MigrateFiles(std::string const &srcfolder, std::string const &dstfolder, std::string const &masks)
{
        std::vector<std::string> splitmasks;
        Blex::TokenizeString(masks, ',', &splitmasks);

        std::vector<std::string> inpaths;
        std::vector<Blex::FileStream*> outfiles;

        for(unsigned i=0;i<splitmasks.size();++i)
          for(Blex::Directory entry(srcfolder,splitmasks[i]);entry;++entry)
        {
                if (Blex::PathStatus(entry.CurrentPath() + ".movebackup").Exists())
                    throw std::runtime_error(".movebackup files already exist, earlier migration failed ?");

                Blex::ErrStream() << "Migrating " << entry.CurrentPath();
                std::string outpath = Blex::MergePath(dstfolder, entry.CurrentFile());

                std::unique_ptr< Blex::FileStream > const infile(Blex::FileStream::OpenRead(entry.CurrentPath()));
                if (!infile.get())
                    throw std::runtime_error("Failed to open input file");

                Blex::FileStream *outfile = Blex::FileStream::OpenWrite(outpath, true, false, Blex::FilePermissions::PublicRead);
                if(!outfile)
                    throw std::runtime_error("Failed to open output file " + outpath);
                outfile->SetFileLength(0);

                if (infile->SendAllTo(*outfile) != infile->GetFileLength())
                    throw std::runtime_error("Failed to copy file contents");

                inpaths.push_back(entry.CurrentPath());
                outfiles.push_back(outfile);
        }

        //Now that all files have been copied, start flushing them. (we do it afterwards, hoping that pdflush might have picked up some slack)
        for(unsigned i=0;i<outfiles.size();++i)
        {
                if(!outfiles[i]->OSFlush())
                    throw std::runtime_error("Failed to sync copied files");
                delete outfiles[i];
        }

        //All files have been safely committed. Rename originals
        for(unsigned i=0;i<inpaths.size();++i)
          if(!Blex::MovePath(inpaths[i], inpaths[i] + ".movebackup"))
            throw std::runtime_error("Failed to rename " + inpaths[i]);

        Blex::ErrStream() << "Migration completed. The '.movebackup' files can be safely removed";
}

bool DBServer::RunServer (bool recovery_mode)
{
        // Set interrupt handler
        Blex::SetInterruptHandler(std::bind(&Blex::Dispatcher::Dispatcher::InterruptHandler, &dispatcher, std::placeholders::_1), false);

        // Do we need to migrate the record files ?
        if(recordfolder != basedbasefolder)
        {
                if (!Blex::PathStatus(recordfolder).Exists())
                {
                        Blex::ErrStream() << "The record storage folder " << recordfolder << " does not exist\n";
                        return false;

                }
                //Good, it's there. Do we need to migrate files?
                if(Blex::PathStatus(Blex::MergePath(basedbasefolder,"translog.whdb")).Exists())
                {
                        Blex::ErrStream() << "Starting record migration from " << basedbasefolder << " to " << recordfolder << "\n";
                        MigrateFiles(basedbasefolder, recordfolder, "*.whrf,*.whrfsc,blobmap.whdb,translog.whdb");
                }
        }

        // Do we need to migrate the index files ?
        if(indexfolder != basedbasefolder)
        {
                if (!Blex::PathStatus(indexfolder).Exists())
                {
                        Blex::ErrStream() << "The index storage folder " << indexfolder << " does not exist\n";
                        return false;

                }
                //Good, it's there. Do we need to migrate files?
                if(Blex::PathStatus(Blex::MergePath(basedbasefolder,"indexmetadata.whdb")).Exists())
                {
                        Blex::ErrStream() << "Starting index migration from " << basedbasefolder << " to " << indexfolder << "\n";
                        MigrateFiles(basedbasefolder, indexfolder, "indexdata.whdb,indexmetadata.whdb");
                }
        }

        //Now that we can be sure that no DB is running in parallel, open the main database
        unsigned numworkers;
        try
        {
                bool new_folder = !Blex::PathStatus(basedbasefolder).IsDir();
                bool new_dbase = new_folder || !Blex::PathStatus(Blex::MergePath(recordfolder,"translog.whdb")).Exists();

                if (new_dbase)
                {
                        Blex::ErrStream() << "Database " << basedbasefolder << " does not exist, initializing new database";

                        if(new_folder && !Blex::CreateDir(basedbasefolder,false/*private*/))
                            throw std::runtime_error("Database folder " + basedbasefolder + " could not be created");
                }

                try
                {
                        //Create the database itself
                        backend.reset(new Database::Backend(basedbasefolder,
                                                            recordfolder,
                                                            indexfolder,
                                                            plugins,
                                                            janitor_maxwait,
                                                            new_dbase,
                                                            recovery_mode,
                                                            nojanitor,
                                                            savedeletedblobs,
                                                            noindex,
                                                            sync));

                        WHDBase_SetupDatabasePlugins(&plugins, &backend->GetTransRegistrator());

                        backend->Open(); //start the backend itself

                        //Create the RPC server to allow remote access
                        connmgr.reset(new Database::ConnectionManager(*backend, logtrans));
                }
                catch(...)
                {
                        //if an error occured and we just inited the database, destroy it (if new)
                        if (new_folder || new_dbase)
                        {
                                connmgr.reset(NULL);
                                backend.reset(NULL);
                                if(new_folder)
                                    Blex::RemoveDirRecursive(basedbasefolder);
                        }
                        throw;
                }

                numworkers = 50; //ADDME: Make this configurable
        }
        catch (Database::Exception &e)
        {
                Blex::ErrStream() << "Error during server startup: " << e.what();
                return false;
        }

        DEBUGPRINT("Opening database port");
        Blex::Dispatcher::ListenAddress ports[2];
        ports[0].sockaddr = dbaseaddr;

        dispatcher.UpdateListenPorts(1, ports);
        if(!dispatcher.RebindSockets(NULL))
        {
                Blex::ErrStream()<<"Unable to bind to the database server port\n";
                return 1;
        }

        //ADDME: We have timeouts for connections now, but should also set an idle grace
        dispatcher.Start(numworkers, -1 /* Infinite idle grace (ADDME: Better timout detection) */, true);
        DEBUGPRINT("Database server shutting down");
        try
        {
                // First destroy connection manager
                connmgr.reset(NULL);
                DEBUGPRINT("Disconnected from connection manager");

                // Gracefull close of backend
                if (backend.get())
                    backend->Close();

                DEBUGPRINT("Closed the database storage");
                backend.reset(NULL);
        }
        catch (Database::Exception &e)
        {
                Blex::ErrStream() << "Error during server shutdown: " << e.what();
                return false;
        }

        Blex::ResetInterruptHandler();
        return true;
}

Blex::Dispatcher::Connection* DBServer::CreateConnection(void *disp)
{
        return new Database::Connection(*connmgr, disp, "(unknown)");
}


int UTF8Main(std::vector<std::string> const &args)
{
        DBServer myserver;
        int ret=myserver.Execute(args);
        return ret;
}

int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}
