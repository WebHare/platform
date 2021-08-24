#ifndef blex_notificationevents
#define blex_notificationevents

#ifndef blex_blexlib
#include "blexlib.h"
#endif

#include "pipestream.h"
#include "podvector.h"
#include "threads.h"

#include <deque>
#include <set>


namespace Blex
{

class NotificationEventManager;

/** Contains a notification event
*/
class BLEXLIB_PUBLIC NotificationEvent
{
    public:
        /// Name of the event
        std::string name;

        /// Payload data for the event
        Blex::PodVector< uint8_t > payload;

        NotificationEvent() {}
        NotificationEvent(std::string const &str): name(str) {}
        NotificationEvent(std::string const &str, uint8_t const *dataptr, size_t len): name(str) { payload.assign(dataptr, dataptr + len); }
};

/** Event queue. Receives only those events whose name matches the subscribed glob masks
    Is signalled iff there are any events in the queue
*/
class BLEXLIB_PUBLIC NotificationEventKeeperBase: public Blex::StatefulEvent
{
    protected:
        NotificationEventManager &eventmgr;

        /// Call to unregister
        void Unregister();

        /// Adds an event to the queue, but only if it matches the registration masks
        virtual void TryAddEvent(std::shared_ptr< NotificationEvent > const &event) = 0;

    public:
        NotificationEventKeeperBase(NotificationEventManager &eventmgr);
        virtual ~NotificationEventKeeperBase();

        friend class NotificationEventManager;
};

/** Event queue. Receives only those events whose name matches the subscribed glob masks
    Is signalled iff there are any events in the queue
*/
class BLEXLIB_PUBLIC NotificationEventQueue: public NotificationEventKeeperBase
{
        /// Locked data
        struct Data
        {
                /// List of glob masks for events this queue is subscribed to
                std::vector< std::string > subscriptions;

                /// Current event queue
                std::deque< std::shared_ptr< NotificationEvent > > queue;
        };

        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;
        LockedData data;

        /// Tests whether an event matches the subscriptions
        bool MatchesSubscription(LockedData::WriteRef &lock, std::shared_ptr< NotificationEvent > const &event) const;

        /// Refilters the queue based on the current subscriptions
        void FilterQueue(LockedData::WriteRef &lock);

        /// Modifies a single mask in the subscriptions, does not refilter
        void ModifySubscription(LockedData::WriteRef &lock, std::string const &mask, bool active);

        /// Adds an event to the queue, but only if it matches the registration masks
        void TryAddEvent(std::shared_ptr< NotificationEvent > const &event);

    public:
        NotificationEventQueue(NotificationEventManager &eventmgr) : NotificationEventKeeperBase(eventmgr) { }
        ~NotificationEventQueue();

        /// Pop the next event from the queue
        std::shared_ptr< NotificationEvent > ShiftEvent();

        /** Modifies the event subscriptions. Adds the events in the range add_begin - add_end, then removes those from
            remove_begin - remove_end. If reset is true, the subscription list is reset first. Afterwards, the list is
            refiltered so it only contains events that match the subscriptions
        */
        template< class Itr > void ModifySubscriptions(Itr add_begin, Itr add_end, Itr remove_begin, Itr remove_end, bool reset)
        {
                LockedData::WriteRef lock(data);

                if (reset)
                    lock->subscriptions.clear();

                for (Itr itr = add_begin; itr != add_end; ++itr)
                    ModifySubscription(lock, *itr, true);
                for (Itr itr = remove_begin; itr != remove_end; ++itr)
                    ModifySubscription(lock, *itr, false);

                FilterQueue(lock);
        }
};

/** Event queue. Keeps a set of names of received events. Receives only those events whose name matches the subscribed glob masks
    Is signalled iff there are any events in the queue
*/
class BLEXLIB_PUBLIC NotificationEventCollector: public NotificationEventKeeperBase
{
        /// Locked data
        struct Data
        {
                /// List of glob masks for events this queue is subscribed to
                std::vector< std::string > subscriptions;

                /// Current event queue
                std::set< std::string > events;
        };

        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;
        LockedData data;

        /// Tests whether an event matches the subscriptions
        bool MatchesSubscription(LockedData::WriteRef &lock, std::string const &eventname) const;

        /// Refilters the queue based on the current subscriptions
        void FilterQueue(LockedData::WriteRef &lock);

        /// Modifies a single mask in the subscriptions, does not refilter
        void ModifySubscription(LockedData::WriteRef &lock, std::string const &mask, bool active);

        /// Adds an event to the queue, but only if it matches the registration masks
        void TryAddEvent(std::shared_ptr< NotificationEvent > const &event);

    public:
        NotificationEventCollector(NotificationEventManager &eventmgr) : NotificationEventKeeperBase(eventmgr) { }
        ~NotificationEventCollector();

        // Return the list of events, clearing the state
        std::set< std::string > GetEvents();

        /** Modifies the event subscriptions. Adds the events in the range add_begin - add_end, then removes those from
            remove_begin - remove_end. If reset is true, the subscription list is reset first. Afterwards, the list is
            refiltered so it only contains events that match the subscriptions
        */
        template< class Itr > void ModifySubscriptions(Itr add_begin, Itr add_end, Itr remove_begin, Itr remove_end, bool reset)
        {
                LockedData::WriteRef lock(data);

                if (reset)
                    lock->subscriptions.clear();

                for (Itr itr = add_begin; itr != add_end; ++itr)
                    ModifySubscription(lock, *itr, true);
                for (Itr itr = remove_begin; itr != remove_end; ++itr)
                    ModifySubscription(lock, *itr, false);

                FilterQueue(lock);
        }
};

/** Class that receive (all) notification events
*/
class BLEXLIB_PUBLIC NotificationEventReceiver
{
    protected:
        NotificationEventManager &eventmgr;
        bool registered;

    public:
        /** Construct an event receiver
            @param eventmgr Event manager
        */
        NotificationEventReceiver(NotificationEventManager &eventmgr);
        virtual ~NotificationEventReceiver();

        /// Call this to enable receiving events. Do not call from within ReceiveBroadcast
        void Register();

        /// Call this to disable receiving events. Do not call from within ReceiveBroadcast
        void Unregister();

        /// Called when a new notification event is called (before it is inserted in any NotificationEventQueue)
        virtual void ReceiveNotificationEvent(std::string const &event, uint8_t const *hsvmdata, unsigned hsvmdatalen) = 0;
};


/** Class to manage notification events
*/
class BLEXLIB_PUBLIC NotificationEventManager
{
    public:
        typedef std::function< void(std::shared_ptr< NotificationEvent > const &) > ExportCallback;

    private:

        /** Locked data with export callback. Must be split from queue/receiver data because the
            export callback can hang due to backpressure, but QueueEventNoExport must then still
            be callable (otherwise deadlocks can happen)
        */
        struct ExportCallbackData
        {
                /** Function called when a non-local event is received
                */
                ExportCallback onexport;
        };

        typedef Blex::InterlockedData< ExportCallbackData, Blex::Mutex > LockedExportCallbackData;
        LockedExportCallbackData exportcallbackdata;

        struct Data
        {
                /// List of registered event receivers
                std::set< NotificationEventReceiver * > eventreceivers;

                /// List of active notification event keepers
                std::set< NotificationEventKeeperBase * > keepers;
        };

        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;
        LockedData data;

        /// Register an notification queue
        void Register(NotificationEventReceiver *receiver);
        void Unregister(NotificationEventReceiver *receiver);
        void Register(NotificationEventKeeperBase *keeper);
        void Unregister(NotificationEventKeeperBase *keeper);

    public:
        /// Sets the export callback. The callbacks registered here may NOT call QueueEvent!
        void SetExportCallback(ExportCallback _onexport);

        /// Queues an event
        void QueueEvent(std::shared_ptr< NotificationEvent > const &event);

        /// Queues an event, without sending it to the onexport handler
        void QueueEventNoExport(std::shared_ptr< NotificationEvent > const &event);

        typedef std::unique_ptr< LockedData::WriteRef > EventLock;

        /** Get a temporary event lock (no events are dispatched when holding this lock, (de-)registrations
            are also blocked.
        */
        EventLock GetTemporaryEventLock();

        friend class NotificationEventReceiver;
        friend class NotificationEventKeeperBase;
};

} // End of namespace Blex

#endif // blex_notificationevents
