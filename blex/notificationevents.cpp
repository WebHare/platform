#include <blex/blexlib.h>

#include <blex/notificationevents.h>

// Show all events debugging stuff
//#define SHOW_EVENTS

#if defined(SHOW_EVENTS) && defined(DEBUG)
 #define EVT_PRINT(x) DEBUGPRINT(x)
 #define EVT_ONLY(x) x
#else
 #define EVT_PRINT(x)
 #define EVT_ONLY(x)
#endif


namespace Blex
{

NotificationEventQueue::NotificationEventQueue(NotificationEventManager &_eventmgr)
: eventmgr(_eventmgr)
{
        eventmgr.Register(this);
}

NotificationEventQueue::~NotificationEventQueue()
{
        eventmgr.Unregister(this);
}

void NotificationEventQueue::TryAddEvent(std::shared_ptr< NotificationEvent > const &event)
{
        LockedData::WriteRef lock(data);
        if (MatchesSubscription(lock, event))
        {
                lock->queue.push_back(event);
                SetSignalled(true);
        }
}

std::shared_ptr< NotificationEvent > NotificationEventQueue::ShiftEvent()
{
        std::shared_ptr< NotificationEvent > event;

        LockedData::WriteRef lock(data);
        if (!lock->queue.empty())
        {
                event = std::move(lock->queue.front());
                lock->queue.pop_front();
                if (lock->queue.empty())
                    SetSignalled(false);
        }
        return event;
}

bool NotificationEventQueue::MatchesSubscription(LockedData::WriteRef &lock, std::shared_ptr< NotificationEvent > const &event) const
{
        EVT_PRINT("test " << event);
        std::string const &eventname = event->name;
        for (auto &itr: lock->subscriptions)
        {
            if (Blex::StringGlob< std::string::const_iterator >(itr.begin(), itr.end(), eventname.begin(), eventname.end(), false))
            {
                    EVT_PRINT(" test on " << itr << ": ok");
                    return true;
            }
            EVT_PRINT(" test on " << itr << ": fail");
        }
        return false;
}

void NotificationEventQueue::FilterQueue(LockedData::WriteRef &lock)
{
        auto itr = std::remove_if(lock->queue.begin(), lock->queue.end(), [this, &lock](auto const &event) {return !MatchesSubscription(lock, event); });
        if (itr != lock->queue.end())
            lock->queue.erase(itr, lock->queue.end());
}

void NotificationEventQueue::ModifySubscription(LockedData::WriteRef &lock, std::string const &mask, bool active)
{
        auto itr = std::find(lock->subscriptions.begin(), lock->subscriptions.end(), mask);
        if ((itr == lock->subscriptions.end()) == active)
        {
                if (active)
                    lock->subscriptions.push_back(mask);
                else
                    lock->subscriptions.erase(itr);
        }
}

NotificationEventReceiver::NotificationEventReceiver(NotificationEventManager &_eventmgr)
: eventmgr(_eventmgr)
, registered(false)
{
}

NotificationEventReceiver::~NotificationEventReceiver()
{
        Unregister();
}

void NotificationEventReceiver::Register()
{
        if (!registered)
        {
                eventmgr.Register(this);
                registered = true;
        }
}

void NotificationEventReceiver::Unregister()
{
        if (registered)
        {
                eventmgr.Unregister(this);
                registered = false;
        }
}

void NotificationEventReceiver::ReceiveNotificationEvent(std::string const &/*event*/,  uint8_t const */*hsvmdata*/, unsigned /*hsvmdatalen*/)
{
}


void NotificationEventManager::Register(NotificationEventReceiver *receiver)
{
        LockedData::WriteRef lock(data);
        lock->eventreceivers.insert(receiver);
}

void NotificationEventManager::Unregister(NotificationEventReceiver *receiver)
{
        LockedData::WriteRef lock(data);
        lock->eventreceivers.erase(receiver);
}

void NotificationEventManager::Register(NotificationEventQueue *queue)
{
        LockedData::WriteRef lock(data);
        lock->queues.insert(queue);
}

void NotificationEventManager::Unregister(NotificationEventQueue *queue)
{
        LockedData::WriteRef lock(data);
        lock->queues.erase(queue);
}

void NotificationEventManager::SetExportCallback(ExportCallback onexport)
{
        LockedExportCallbackData::WriteRef lock(exportcallbackdata);
        lock->onexport = onexport;
}

void NotificationEventManager::QueueEventNoExport(std::shared_ptr< NotificationEvent > const &event)
{
        LockedData::WriteRef lock(data);

        for (auto &itr: lock->eventreceivers)
            itr->ReceiveNotificationEvent(event->name, event->payload.begin(), event->payload.size());

        for (auto &itr: lock->queues)
            itr->TryAddEvent(event);
}

void NotificationEventManager::QueueEvent(std::shared_ptr< NotificationEvent > const &event)
{
        // Lock so events are exported in the same order as they are received locally
        LockedExportCallbackData::WriteRef lock(exportcallbackdata);

        // Export may block due to backpressure, so don't call it with the data lock
        // QueueEventNoExport must still be callable
        if (lock->onexport)
            lock->onexport(event);

        QueueEventNoExport(event);
}

} // End of namespace Blex