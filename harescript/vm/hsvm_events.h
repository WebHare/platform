#ifndef blex_webhare_harescript_hsvm_events
#define blex_webhare_harescript_hsvm_events

#include <blex/context.h>
#include <blex/podvector.h>
#include <blex/pipestream.h>
#include <blex/socket.h>
#include <blex/threads.h>
#include "hsvm_constants.h"
#include "hsvm_marshalling.h"

namespace HareScript
{

void InitEvents(BuiltinFunctionsRegistrator &bifreg);

} // end of namespace HareScript

#endif // blex_webhare_harescript_hsvm_events
