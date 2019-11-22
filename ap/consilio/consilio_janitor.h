#ifndef blex_search_indexmanager_janitor
#define blex_search_indexmanager_janitor

class IndexManager;             // Forward declaration for consilio.h

/** The Consilio maintenance task class.
    The Janitor only has one task, which is optimizing the index. This task is
    performed once ten minutes after Consilio started and then after each twelve
    hours. */
class Janitor
{
    public:
        Janitor(IndexManager &indexmanager);
        ~Janitor();

        /** Signal the janitor thread to stop its thread and exit ThreadCode(). */
        void Stop();

        /** Get the Janitor status.
            @return A string containing the status, for now only containing the
                    next time the Janitor will run */
        std::string GetStatus();

    private:
#ifdef DEBUG
        typedef Blex::InterlockedData<bool,Blex::DebugConditionMutex> AbortFlag;
#else
        typedef Blex::InterlockedData<bool,Blex::ConditionMutex> AbortFlag;
#endif

        /** Janitor main code. */
        void ThreadCode();

        /** Optimize the index. */
        void DoOptimize();

        /// Set to true when the janitor should abort
        AbortFlag abortflag;

        /// When will we execute the next task?
        Blex::DateTime next_time;

        /// The IndexManager we're performing our maintenance task for
        IndexManager &indexmanager;

        Blex::Thread threadrunner;
};

#endif

