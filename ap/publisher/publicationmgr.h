#ifndef blex_webhare_schedule_publicationmgr
#define blex_webhare_schedule_publicationmgr

/* The publisher manager */

#include <blex/utils.h>
#include <blex/threads.h>
#include <ap/libwebhare/whcore.h>
#include "processmgr.h"

enum PublisherLogLevel
{
        PLog_FatalErrors, //<Log only fatal publishing errors
        PLog_Statistics,  //<Log statistic information (queue runs, status reports)
        PLog_Debug        //<Log as much actions as possible
};

struct QueuedFile
{
        QueuedFile(int32_t _fileid, int32_t _folderid, int32_t _publishtime, int32_t _templateid, int32_t _profileid, unsigned _priority)
        : fileid(_fileid)
        , folderid(_folderid)
        , publishtime(_publishtime)
        , templateid(_templateid)
        , profileid(_profileid)
        , priority(_priority)
        {
        }

        int32_t fileid;
        int32_t folderid;
        int32_t publishtime;
        int32_t templateid;
        int32_t profileid;
        unsigned priority;
};

struct RepublishTimeEstimation
{
        RepublishTimeEstimation()
        : howmany_to_do(0)
        , howmany_measured(0)
        , total_measured(0)
        , howmany_workers(0)
        {
        }
        int32_t howmany_to_do;
        int32_t howmany_measured;
        int32_t total_measured;
        int32_t howmany_workers;
};

struct PublisherState
{
        RepublishTimeEstimation queueestimate;
        unsigned outputanalyzerqueue;
        std::string queuetop;
        std::string processes;
};

/** The publication manager thread. Manages output folders and Hare processes */
class PublicationManager
{
        public:
        typedef std::function< void(PublisherState const &) > PublisherStateCallback;
        typedef std::function< void(RepublishTimeEstimation const &) > RepublishTimeCallback;

        PublicationManager(WHCore::Connection &conn, ProcessManager &processmanager);

        ~PublicationManager();

        ///Set worker count
        void SetWorkerCount(int32_t count);
        ///Get current publisher state
        void GetPublisherState(PublisherStateCallback const &callback);
        ///Set publisher timeout
        void SetPublisherTimeout(int32_t count);
        ///Add an instance check action  certain file is in the publish queue
        void AddToQueue(QueuedFile const &file, bool restart_if_running);
        ///Dequeue a certain file (eg. file deleted or unpublished!)
        void DequeueFile(int32_t fileid);
        /** Update log level */
        void SetLogLevel(PublisherLogLevel newloglevel);
        /** Get a publication length for the specified file */
        void GetFileEstimation(int32_t fileid, RepublishTimeCallback const &callback);
        /** Inform us of a directory that needs rescanning */
        void RescanFolder(int32_t folderid, bool recursive);
        /** Inform us of a need for full rescanning (database reconnect)  */
        void RescanAll();

        void RestartOutputAnalyzer();

        private:
        ///Number of queues we offer
        static const unsigned NumQueues = 6;
        ///Number of priority levels per queue
        static const unsigned QueueWidth = 5;
        ///Lowest priority (1=published)
        static const unsigned LowestPriority = 1;
        ///Minimum priority for interesting files
        static const unsigned InterestedFilePriorityBoost = 16;

        struct Hare
        {
                Hare();

                ///Subprocess assigned to this hare
                SubProcess *process;
                ///ID of this hare (1-based sequence number)
                unsigned id;
                ///Current file assigned to this process, or 0 if the process is idle
                QueuedFile curfile;
                ///Number of tasks finished by this process
                unsigned numtasks;
                ///Timer after which this hare should be restarted
                Blex::DateTime restart_at;
        };
        struct Task
        {
                Task(QueuedFile const &_file)
                : file(_file)
                , publishing(0)
                , mustrestart(false)
                {
                }

                QueuedFile file;
                ///If not 0, running on the specified hare
                Hare *publishing;
                ///If true, restart this hare immediately after it completed
                bool mustrestart;
                ///Start time of this conversion
                Blex::DateTime starttime;
        };

        typedef std::shared_ptr<Hare> HarePtr;

        typedef std::list< Task > TaskQueue;

        typedef std::map< int32_t , TaskQueue::iterator> ReversedTaskQueue;

        typedef std::vector<HarePtr> Hares;

        void RestartHare(Hare *hare);

        void StartHare(Hare *hare);

        Hare& GetHare(SubProcess *process);

        void ProcessReply(SubProcess *subprocess, ProcessEvents::Event event, std::string const &data);

        ///Given a priority, get the allocated queue id
        unsigned GetQueueForPriority(unsigned prio) const
        { return Blex::Bound<unsigned>(0,NumQueues-1,(prio-LowestPriority)/QueueWidth); }

        ///process incoming events from the output analyzer script
        void ProcessOutputAnalyzer(ProcessEvents::Event event, std::string const &data);
        ///check if we have a job for the output analyzer
        void CheckOutputAnalyzerQueue();

        ///handle a complete response for a process
        void ProcessHareResponse(Hare &hare, std::string const &response);

        ///check the scheduling queue and schedule tasks on available hares
        bool CheckHareQueue(Hare *availablehare);

        /** Remove a file as finished from the queue.
            Takes the QMState lock. */
        void RemoveFromQueue(QueuedFile file);

        /** Check if we can queue some processes */
        void CheckQueue();

        void SchedulePublication(int32_t fileid, int32_t maxtimeout, Hare *availablehare);

        void RegisterBrokenConversion(QueuedFile const &_file, unsigned errorcode);

        /** Add a new task on its queue: assumes that the task was not on queue yet */
        void AddNewTask(QueuedFile const &file);


        /// The central process manager
        ProcessManager &processmanager;

        /// Central
        WHCore::Connection &conn;

        /// The publication processes
        Hares hares;
        /// The output folder scan/manager script
        SubProcess *output_analyzer;

        ///Number of workers to enable
        unsigned workercount;
        ///Maximum publication time
        unsigned maxpublishtime;
        ///Requested loglevel
        PublisherLogLevel loglevel;
        ///Is the output analyzer busy?
        bool output_analyzer_busy;
        ///Should the output analyzer analyze ALL folders?
        bool analyze_all_folders;
        ///Should the output analyzer be restarted?
        bool analyze_restart_first;

        ///Folders that need scanning
        typedef std::deque< std::pair<int32_t, bool> > AnalyzeDeque;
        AnalyzeDeque analyze_folders;

        ///Index into the scanning queue
        typedef std::map<int32_t, AnalyzeDeque::iterator> AnalyzeLookupMap;
        AnalyzeLookupMap analyze_lookupmap;

        Blex::FastTimer queuetimer;
        bool queuetimer_running;
        TaskQueue task_queue[NumQueues];
        unsigned task_queue_size;
        ReversedTaskQueue reversed_task_queue;
};

#endif
