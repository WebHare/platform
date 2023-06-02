#ifndef blex_harescript_vm_ipc
#define blex_harescript_vm_ipc

#include "outputobject.h"
#include "hsvm_externals.h"

namespace HareScript
{

class MarshalPacket;
class JobManager;
//class IPCPort;
class IPCNamedPort;
class IPCLinkEndPoint;

class IPCMessage2
{
    public:
        inline IPCMessage2()
        : msgid(0), replyto(0)
        { }

        ~IPCMessage2();

        void Reset();

        /// Id of this message (globally unique)
        uint64_t msgid;

        /// Id of message this message is a reply to
        uint64_t replyto;

        /// Marshalled data
        std::unique_ptr< MarshalPacket > data;
};

class BLEXLIB_PUBLIC IPCNamedPort : public OutputObject
{
    private:
        JobManager &jobmgr;

        IPCNamedPort(JobManager &_jobmgr);

    public:
        /// Backlog of connections
        typedef std::list< std::shared_ptr< IPCLinkEndPoint > > BackLog;
        BackLog backlog;

        /// Name of the port
        std::string name;

        /// Event to support waiting on this object
        Blex::StatefulEvent event;

        ~IPCNamedPort();

        /// Create a new connection to this port
        std::shared_ptr< IPCLinkEndPoint > Connect();

        /// Accept a new connection on this port
        std::shared_ptr< IPCLinkEndPoint > Accept();

        /** Adds this port to a waiter
            @param waiter Waiter to add to
            @return Returns whether connection requests are pending
        */
        virtual bool AddToWaiterRead(Blex::PipeWaiter &waiter);

        /** Checks whether the port is read-signalled (if any messages are in queue, or
            the port this port was connected to has disappeared)
            @return Returns whether any message is in queue, or the port is broken.
        */
        virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);

        /** Removes this port from a waiter
            @param waiter Waiter to remove from
        */
        virtual void RemoveFromWaiterRead(Blex::PipeWaiter &waiter);

        inline Blex::Event & GetEvent() { return event; }

        friend class JobManager;
};


/** Shared data for an IPC link
*/
class IPCLinkData
{
    public:
        typedef std::list< std::shared_ptr< IPCMessage2 > > MessageQueue;

        class Data;

        /** Custom event, becomes signalled when the corresponding endpoint is
            signalled (message in queue or endpoint gone)

            The event doesn't automatically broadcast state changes to its waiters,
            that must be done manually by calling StateChanged when an action is done
            that might have changed the signalled state.
        */
        class IPCLinkEvent : public Blex::Event
        {
            private:
                /// Link of this event
                IPCLinkData &link;

                /// Endpoint of this event
                bool endpoint_side;

            public:
                IPCLinkEvent(IPCLinkData &_link, bool endpoint_side);

                /** Calculates whether the event is signalled (queue for this endpoint isn't
                    empty, or an endpoint is gone
                */
                virtual bool IsSignalled();
        };

        class Data
        {
            public:
                Data() : refcount(0), gen_id(0) { }

                unsigned refcount;

                IPCLinkEndPoint *endpoints[2];

                MessageQueue queues[2];

                uint64_t gen_id;
        };

        /// Constructor
        IPCLinkData();

        /// Returns the event for a specific endpoint
        inline IPCLinkEvent & GetEvent(bool endpoint_side) { return endpoint_side ? event_true : event_false; }

        // Events for both endpoints
        IPCLinkEvent event_false;
        IPCLinkEvent event_true;

        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;
        LockedData data;
};

namespace SendResult
{
enum Type
{
        Sent,
        LinkFull,
        Gone
};
}

class BLEXLIB_PUBLIC IPCLinkEndPoint : public OutputObject
{
    private:
        /// Jobmanager (for msgid generation)
        JobManager &jobmgr;

        /// Link data
        std::shared_ptr< IPCLinkData > link;

        /// Endpoint side
        bool endpoint_side;

    private:
        IPCLinkEndPoint(JobManager &_jobmgr, std::shared_ptr< IPCLinkData > const &_link, bool _endpoint_side);

    public:
        ~IPCLinkEndPoint();

        /** Returns whether this link is broken. Returns TRUE when other endpoint is gone
            and no messages are left in the queue
            @return Whether the ipc link is broken
        */
        bool IsBroken();

        /** Sends a messsage to the other endpoint. Generates a message id, puts it in the message and returns
            that id if succesfull.
            @param msg Message to send. SendMessage takes ownership and clears the contents of this parameter.
            @return Assigned id of the message. 0 if the other endpoint is gone.
        */
        std::pair< SendResult::Type, uint64_t > SendMessage(std::unique_ptr< IPCMessage2 > *msg, bool allow_flowcontrol);

        /** Sends a messsage to the other endpoint. Generates a message id, puts it in the message and returns
            that id if succesfull. It is recommended to allocate messages by using
            @param msg Message to send. SendMessage clears the contents of this parameter.
            @return Assigned id of the message. 0 if the other endpoint is gone.
        */
        std::pair< SendResult::Type, uint64_t > SendMessage(std::shared_ptr< IPCMessage2 > *msg, bool allow_flowcontrol);

        /** Tries to receive a message from the other endpoint. If succesfull, returns true, and puts the message
            in @a msg. It is recommended to discard the message in a call to DiscardMessage in the jobmanager.
            @param msg Shared pointer in which the message is placed.
            @return Returns true when a message has been received, false otherwise.
        */
        bool ReceiveMessage(std::shared_ptr< IPCMessage2 > *msg);

        /** Adds this port to a waiter
            @param waiter Waiter to add to
            @return Returns whether this port is already signalled (
        */
        virtual bool AddToWaiterRead(Blex::PipeWaiter &waiter);

        /** Checks whether the port is read-signalled (if any messages are in queue, or
            the port this port was connected to has disappeared)
            @return Returns whether any message is in queue, or the port is broken.
        */
        virtual SignalledStatus IsReadSignalled(Blex::PipeWaiter *waiter);

        /** Removes this port from a waiter
            @param waiter Waiter to remove from
        */
        virtual void RemoveFromWaiterRead(Blex::PipeWaiter &waiter);

        /** Returns the event for this endpoint. This event becomes signalled when messages are in queue, or the
            other endpoint is gone
        */
        inline Blex::Event & GetEvent() { return link->GetEvent(endpoint_side); }

        friend class JobManager;
        friend class IPCNamedPort;
};

} // namespace HareScript

#endif
