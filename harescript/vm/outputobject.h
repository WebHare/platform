#ifndef blex_webhare_harescript_hsvm_outputobject
#define blex_webhare_harescript_hsvm_outputobject

#include <blex/threads.h>
#include <blex/context.h>
#include <blex/podvector.h>
#include <blex/pipestream.h>
#include <blex/socket.h>
#include "hsvm_constants.h"

namespace HareScript
{

class AsyncStackTrace;

/** WebHare input/output object */
class BLEXLIB_PUBLIC OutputObject
{
    private:
        int id;

        const char *type;

    protected:
        HSVM *vm;

        // If true, this object must ignore the readbuffer when determining its signalled status
        bool wait_ignores_readbuffer;

    public:
        /// Registration stack trace
        std::unique_ptr< AsyncStackTrace > stacktrace;

        Blex::DateTime creationdate;

        inline int GetId() { return id; }
        inline const char * GetType() { return type; }

        /// Signalled status
        enum SignalledStatus
        {
                Unknown,
                Signalled,
                NotSignalled
        };

        static const unsigned MaxReadChunkSize = 32768;

        ///Read buffer (used for line reading functions)
        std::vector<char> readbuffer;

        /// Set new value of wait_ignores_readbuffer flag
        void SetWaitIgnoresReadBuffer(bool newwait);

        /** Reader function for this object..
            @return false on I/O error */
        virtual std::pair< Blex::SocketError::Errors, unsigned > Read(unsigned numbytes, void *data);
        /** Writer function for this object..
            @return false on I/O error */
        virtual std::pair< Blex::SocketError::Errors, unsigned > Write(unsigned numbytes, const void *data, bool allow_partial);

        virtual bool IsAtEOF();

        virtual bool ShouldYieldAfterWrite();

        /** Add to waiter for waiting; return TRUE if already ready
            @param waiter Waiter to add this object to (for read signalling only)
            @return Returns whether the object is already signalled, if that can
                be determined cheaply.
        */
        virtual bool AddToWaiterRead(Blex::PipeWaiter &/*waiter*/) { return true; }

        /** Check if an object is read-signalled, optionally with a waiter that waited on it
            If no waiter is specified, the object returns whether it is signalled, but
            only when that can be done without kernel calls.
            @param waiter Optional waiter
            @return Signalled status. May be Unknown only if waiter is null and signalled status could not be determined.
        */
        virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter * /*waiter*/) { return Signalled; }

        /** Add to waiter for writing; return TRUE if already ready
            @param waiter Waiter to add this object to (for write signalling only)
            @return Returns whether the object is already signalled, if that can
                be determined cheaply.
        */
        virtual bool AddToWaiterWrite(Blex::PipeWaiter &/*waiter*/) { return true; }

        /** Check if an object is write-signalled, optionally with a waiter that waited on it
            If no waiter is specified, the object returns whether it is signalled, but
            only when that can be done without kernel calls.
            @param waiter Optional waiter
            @return Signalled status. May be Unknown only if waiter is null and signalled status could not be determined.
        */
        virtual SignalledStatus IsWriteSignalled(Blex::PipeWaiter * /*waiter*/) { return Signalled; }

        OutputObject(HSVM *vm, const char *type);
        virtual ~OutputObject();

        int Register(HSVM *vm);
        void Unregister();
};

} // namespace HareScript

#endif
