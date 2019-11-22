#ifndef blex_webhare_schedule_notify
#define blex_webhare_schedule_notify

#include <ap/libwebhare/whcore.h>
#include "publicationmgr.h"

class PublicationManager;

///Asynchronous notify listener (ADDME inheriting from multiple bases is ugly, should probably derive ConfigListener from AsyncThread)
class NotifyAsyncThread : public Database::AsyncThread
{
        public:
        /** Notify listener, with queuemgr, scheduler and compiler support */
        NotifyAsyncThread(WHCore::Connection &webhare,
                                   PublicationManager *publishmgr,
                                   ProcessManager &processmanager);

        ~NotifyAsyncThread();

        private:
        virtual void NotifyTableChange();
        virtual void ReceiveTell(Database::Record data);
        virtual void ReceiveAsk(uint32_t msgid, Database::Record data);
        virtual void NotifyConnected();

        void FS_ObjectsChanged(Database::Actions action, Database::Record removedrec, Database::Record addedrec);
        void FS_SettingsChanged(Database::Actions action, Database::Record removedrec, Database::Record addedrec);
        void FS_InstancesChanged(Database::Actions action, Database::Record removedrec, Database::Record addedrec);
        void SitesChanged(Database::Actions action, Database::Record removedrec, Database::Record addedrec);

        void ReanalyzeFolder(int32_t folderid, bool recursive);

        /** Which notifications do we want? */
        Database::NotificationRequests Requests(bool with_queuemanager);

        void ReadPublisherSettings(Database::TransFrontend &trans);

        PublicationManager *const publishmgr;
        ProcessManager &processmanager;

        WHCore::Connection &webhare;

        unsigned fs_objects_notifyid;
        unsigned fs_settings_notifyid;
        unsigned fs_instances_notifyid;
        unsigned publisher_sites_notifyid;

        void RequestEstimate(uint32_t msgid, int32_t id);
        void ProcessEstimateResult(uint32_t msgid, RepublishTimeEstimation const &estimate);
        void RequestPublisherState(uint32_t msgid);
        void ProcessPublisherState(uint32_t msgid,PublisherState const &state);
};

#endif
