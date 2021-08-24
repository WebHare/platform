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

NotificationEventKeeperBase::NotificationEventKeeperBase(NotificationEventManager &_eventmgr)
: eventmgr(_eventmgr)
{
        eventmgr.Register(this);
}

NotificationEventKeeperBase::~NotificationEventKeeperBase()
{
        eventmgr.Unregister(this);
}

NotificationEventQueue::~NotificationEventQueue()
{
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
        {
                lock->queue.erase(itr, lock->queue.end());
                if (lock->queue.empty())
                    SetSignalled(false);
        }
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

NotificationEventCollector::~NotificationEventCollector()
{
}

void NotificationEventCollector::TryAddEvent(std::shared_ptr< NotificationEvent > const &event)
{
        LockedData::WriteRef lock(data);
        if (MatchesSubscription(lock, event->name))
        {
                lock->events.insert(event->name);
                SetSignalled(true);
        }
}

std::set< std::string > NotificationEventCollector::GetEvents()
{
        LockedData::WriteRef lock(data);
        std::set< std::string > toreturn = std::move(lock->events);
        SetSignalled(false);
        lock->events.clear();
        return toreturn;
}

bool NotificationEventCollector::MatchesSubscription(LockedData::WriteRef &lock, std::string const &eventname) const
{
        EVT_PRINT("test " << eventname);
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

void NotificationEventCollector::FilterQueue(LockedData::WriteRef &lock)
{
        for (auto itr = lock->events.begin(), last = lock->events.end(); itr != last; )
            if (!MatchesSubscription(lock, *itr))
                itr = lock->events.erase(itr);
            else
                ++itr;

        SetSignalled(!lock->events.empty());
}

void NotificationEventCollector::ModifySubscription(LockedData::WriteRef &lock, std::string const &mask, bool active)
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

void NotificationEventManager::Register(NotificationEventKeeperBase *keeper)
{
        LockedData::WriteRef lock(data);
        lock->keepers.insert(keeper);
}

void NotificationEventManager::Unregister(NotificationEventKeeperBase *keeper)
{
        LockedData::WriteRef lock(data);
        lock->keepers.erase(keeper);
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

        for (auto &itr: lock->keepers)
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

NotificationEventManager::EventLock NotificationEventManager::GetTemporaryEventLock()
{
        return EventLock(new LockedData::WriteRef(data));
}


} // End of namespace Blex