#include <ap/libwebhare/allincludes.h>

#include <ap/libwebhare/whcore.h>
#include <iostream>
#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hsvm_context.h>
#include "notify.h"

NotifyAsyncThread::NotifyAsyncThread(WHCore::Connection &_webhare,
                                             PublicationManager *publishmgr,
                                             ProcessManager &processmanager)
: Database::AsyncThread(Requests(publishmgr != NULL),"publisher",_webhare.GetDbase())
, publishmgr(publishmgr)
, processmanager(processmanager)
, webhare(_webhare)
{
        StartConnecting();
}

NotifyAsyncThread::~NotifyAsyncThread()
{
        Stop(true);
}

Database::NotificationRequests NotifyAsyncThread::Requests(bool with_queuemanager)
{
        static const char *fs_objects_columns[11] = {
                "ID",
                "PUBLISHED",
                "PARENT",
                "MODIFICATIONDATE",
                "LASTPUBLISHTIME",
                "NAME",
                "TEMPLATE",
                "PROFILE",
                "TYPE",
                "ISFOLDER",
                "INDEXDOC" };

        static const char *sitecolumns[5]=  {
                "LOCKED",
                "ROOT",
                "OUTPUTWEB",
                "OUTPUTFOLDER"};

        using Database::NotificationRequests;
        NotificationRequests notes;
        if (with_queuemanager)
        {
                fs_objects_notifyid = notes.AddRequest("SYSTEM","FS_OBJECTS",11,fs_objects_columns);
                publisher_sites_notifyid = notes.AddRequest("SYSTEM","SITES",4,sitecolumns);
        }
        return notes;
}

void NotifyAsyncThread::NotifyConnected()
{
        const std::unique_ptr<Database::TransFrontend> trans(dbconn->BeginFullyPrivilegedTransaction(false, false));

        if (publishmgr)
        {
                DEBUGPRINT("PREP PUBLISHMGR");
                processmanager.CallSynchronized(std::bind(&PublicationManager::RescanAll, publishmgr));
                ReadPublisherSettings(*trans);
        }

        //ADDME: do NOT open new transactions during Async handler! May deadlock? But even in this case?
        delete trans->SendSQLCommand("WAIT INDEX"); //ADDME: Perhaps we can remove this hack later, but stop publisher from bashing the dbserver when the indexes aren't there yet
}

void NotifyAsyncThread::ReadPublisherSettings(Database::TransFrontend &trans)
{
        //keys are 'hson:' so we can still sort of parse them...
        int32_t workercount = std::atol(webhare.GetConfigKey(trans, "publisher.publication.numworkers").substr(5).c_str());
        int32_t maxpubtime = std::atol(webhare.GetConfigKey(trans, "publisher.publication.maxpublishtime").substr(5).c_str());
        PublisherLogLevel newloglevel = (PublisherLogLevel)std::atol(webhare.GetConfigKey(trans, "publisher.publication.loglevel").substr(5).c_str());

        DEBUGONLY(newloglevel=PLog_Debug);
        DEBUGPRINT("Workercount " << workercount << " Maxpubtime " << maxpubtime << " Newloglevel " << newloglevel);
        processmanager.CallSynchronized(std::bind(&PublicationManager::SetWorkerCount, publishmgr, workercount));
        processmanager.CallSynchronized(std::bind(&PublicationManager::SetPublisherTimeout, publishmgr, maxpubtime));
        processmanager.CallSynchronized(std::bind(&PublicationManager::SetLogLevel, publishmgr, newloglevel));
}

void NotifyAsyncThread::ReanalyzeFolder(int32_t folderid, bool recursive)
{
        if (publishmgr)
            processmanager.CallSynchronized(std::bind(&PublicationManager::RescanFolder, publishmgr, folderid, recursive));
}

void NotifyAsyncThread::SitesChanged(Database::Actions action, Database::Record removedrec, Database::Record addedrec)
{
        // Columns: 0: LOCKED, 1: ROOT, 2: OUTPUTWEB, 3: OUTPUTFOLDER, 4: FORCELOWERCASE

        if (action == Database::ActionDelete)
            return; //site deletion: not interested

        bool oldlock = removedrec.GetCell(0).Boolean();
        bool newlock = addedrec.GetCell(0).Boolean();
        int32_t oldweb = removedrec.GetCell(2).Integer();
        int32_t newweb = addedrec.GetCell(2).Integer();
        Database::Cell oldfolder = removedrec.GetCell(3);
        Database::Cell newfolder = addedrec.GetCell(3);

        if (newweb == 0 || newlock)
            return; //publishing disabled: not interested

        if (oldlock == newlock
            && oldweb == newweb
            && Blex::StrCompare(oldfolder.Begin(),oldfolder.End(),newfolder.Begin(),newfolder.End()) == 0)
            return; //site did not move its output: not interested

        //recursively re-analyze the site
        ReanalyzeFolder(addedrec.GetCell(1).Integer(),true);
}

void NotifyAsyncThread::FS_ObjectsChanged(Database::Actions action, Database::Record removedrec, Database::Record addedrec)
{
        // Columns: 0: ID, 1: PUBLISHED, 2: PARENT, 3: MODIFICATIONDATE
        // 4: LASTPUBLISHTIME, 5: NAME, 6: TEMPLATE, 7: PROFILE, 8: TYPE,
        // 9: ISFOLDER, 10: INDEXDOC

        bool isfolder = removedrec.GetCell(9).Boolean();

        Database::Cell oldname = removedrec.GetCell(5);
        Database::Cell newname = addedrec.GetCell(5);

        if(isfolder)
        {
                // Rescan parent if folder is deleted, moved, renamed
                if (action != Database::ActionUpdate
                    || removedrec.GetCell(2).Integer() != addedrec.GetCell(2).Integer()
                    || Blex::StrCompare(oldname.Begin(),oldname.End(),newname.Begin(),newname.End())!=0)
                {
                        //Rescan (old) parent
                        int32_t parentid = (action==Database::ActionInsert ? addedrec : removedrec).GetCell(2).Integer();
                        if (parentid != 0) //don't rescan after site deletion..
                            ReanalyzeFolder(parentid ,true);
                }

                // Rescan folder self if indexdoc changed
                if (action == Database::ActionUpdate
                    && removedrec.GetCell(10).Integer() != addedrec.GetCell(10).Integer())
                {
                        //Rescan folder itself
                        int32_t folderid = action==Database::ActionDelete ? removedrec.GetCell(0).Integer()
                                                                      : addedrec.GetCell(0).Integer();
                        ReanalyzeFolder(folderid,false);
                }
        }
        else
        {
                int32_t fileid = action==Database::ActionDelete ? removedrec.GetCell(0).Integer()
                                                            : addedrec.GetCell(0).Integer();

                if (action==Database::ActionUpdate || action==Database::ActionInsert)
                {
                        int32_t old_published = removedrec.GetCell(1).Integer();
                        int32_t new_published = addedrec.GetCell(1).Integer();
                        int32_t templateid = addedrec.GetCell(6).Integer();
                        int32_t profileid = addedrec.GetCell(7).Integer();

                        int32_t published_status = WHCore::GetStatusFromPublished(new_published);
                        if ( published_status >= 1 && published_status <= 100) //will publish?
                        {
                                int32_t folderid = addedrec.GetCell(2).Integer();
                                int32_t publishtime = addedrec.GetCell(4).Integer();

                                QueuedFile newfile(fileid, folderid, publishtime, templateid, profileid, published_status);
                                if (publishmgr)
                                    processmanager.CallSynchronized(std::bind(&PublicationManager::AddToQueue, publishmgr, newfile, true));
                        }
                        else if (WHCore::IsPublishPublished(old_published) //disabling publish?
                                 && !WHCore::IsPublishPublished(new_published)
                                 && action==Database::ActionUpdate)
                        {
                                int32_t parentid = removedrec.GetCell(2).Integer();
                                ReanalyzeFolder(parentid,false);

                                if (publishmgr)
                                    processmanager.CallSynchronized(std::bind(&PublicationManager::DequeueFile, publishmgr, fileid));
                        }
                }
                else if (action==Database::ActionDelete)
                {
                        // Send command to fetcher (ADDME: Both calls are dupe with unpublish action, so combine into separate functions ?)
                        if (publishmgr)
                            processmanager.CallSynchronized(std::bind(&PublicationManager::DequeueFile, publishmgr, fileid));
                }


                //rescan parent if file is deleted, moved, renamed
                Database::Cell oldname = removedrec.GetCell(5);
                Database::Cell newname = addedrec.GetCell(5);
                if (action == Database::ActionDelete
                    || (action == Database::ActionUpdate
                        && (removedrec.GetCell(2).Integer() != addedrec.GetCell(2).Integer()
                            || Blex::StrCompare(oldname.Begin(),oldname.End(),newname.Begin(),newname.End())!=0 ) ) )
                {
                        //Rescan (old) parent
                        int32_t parentid = removedrec.GetCell(2).Integer();
                        ReanalyzeFolder(parentid,false);
                }
        }
}

void NotifyAsyncThread::ReceiveTell(Database::Record data)
{
        if(data.GetCell(1).Integer()==65534) //instruction ADDME: add enumeration
        {
                std::vector <std::string> toks;
                Blex::TokenizeString(data.GetCell(2).String(), ' ', &toks);
                /*
                if (std::count(toks.begin(), toks.end(), "AUTHDATA"))
                    server->AsyncDoConfigRescan();
                if (std::count(toks.begin(), toks.end(), "MODULES"))
                    server->webhare->ReloadPluginConfig();
                */
                if (std::count(toks.begin(), toks.end(), "PUBLISHMGR"))
                {
                        const std::unique_ptr<Database::TransFrontend> trans(dbconn->BeginFullyPrivilegedTransaction(false, false));
                        if (publishmgr)
                            ReadPublisherSettings(*trans);
                }
                /*
                if (std::count(toks.begin(), toks.end(), "MODULES"))
                {
                        processmanager.CallSynchronized(std::bind(&TasksScheduler::ExecuteTasks, tasksscheduler, true));
                }
                */


                DEBUGPRINT("Got remote config flush");
        }
        else
        {
                DEBUGPRINT("asyncthread: got unknown message type");
        }
}

void CopyState(Database::WritableRecord *out, RepublishTimeEstimation const &src)
{
        out->SetInteger(1,src.howmany_to_do);
        out->SetInteger(2,src.howmany_measured);
        out->SetInteger(3,src.total_measured);
        out->SetInteger(4,src.howmany_workers);
}

void NotifyAsyncThread::ReceiveAsk(uint32_t msgid, Database::Record data)
{
        //FIXME: All this code deeply sucks, as soon as we figure out how Ask-s will work in practice, we should start fixing all this
        int32_t type = data.GetCell(1).Integer();

        //ADDME: Add an enumeration for requests? Protect certain requests depending on DB rights?
        if(publishmgr && type==2)
        {
                RequestEstimate(msgid, data.GetCell(2).Integer());
        }
        else if(publishmgr&&type==5)
        {
                RequestPublisherState(msgid);
        }
        else
        {
                SendReply(msgid,Database::WritableRecord());
                return;
        }
}

void NotifyAsyncThread::RequestEstimate(uint32_t msgid, int32_t id)
{
        PublicationManager::RepublishTimeCallback callback = std::bind(&NotifyAsyncThread::ProcessEstimateResult, this, msgid, std::placeholders::_1);
        processmanager.CallSynchronizedInteractive( std::bind(&PublicationManager::GetFileEstimation, publishmgr, id, callback) );
}
void NotifyAsyncThread::ProcessEstimateResult(uint32_t msgid, RepublishTimeEstimation const &estimate)
{
        Database::WritableRecord out;
        CopyState(&out, estimate);
        SendReply(msgid,out);
}
void NotifyAsyncThread::RequestPublisherState(uint32_t msgid)
{
        PublicationManager::PublisherStateCallback callback = std::bind(&NotifyAsyncThread::ProcessPublisherState, this, msgid, std::placeholders::_1);
        processmanager.CallSynchronizedInteractive( std::bind(&PublicationManager::GetPublisherState, publishmgr, callback) );
}
void NotifyAsyncThread::ProcessPublisherState(uint32_t msgid, PublisherState const &state)
{
        Database::WritableRecord out;
        CopyState(&out, state.queueestimate);
        out.SetString(5, state.queuetop);
        out.SetString(6, state.processes);
        out.SetInteger(7, state.outputanalyzerqueue);
        SendReply(msgid,out);
}

void NotifyAsyncThread::NotifyTableChange()
{
        std::unique_ptr< Database::NotificationScanner > scanner;

        if (publishmgr != NULL)
        {
                scanner.reset(GetNotifications(fs_objects_notifyid).release());
                while (scanner.get() && scanner->Next())
                    FS_ObjectsChanged(scanner->GetAction(), scanner->GetDeletedRow(), scanner->GetAddedRow());

                scanner.reset(GetNotifications(publisher_sites_notifyid).release());
                while (scanner.get() && scanner->Next())
                    SitesChanged(scanner->GetAction(), scanner->GetDeletedRow(), scanner->GetAddedRow());
        }
        //WHCore::ConfigListener::DBEvents(*this,config_notifyid);
}
