// Necessary includes (these aren't #included at all)
#include <string>
#include <memory>
#include <algorithm>
#include <vector>
#include <set>
#include <deque>
#include <queue>
#include <list>
#include <map>
#include <sstream>
#include <stack>
#include <iterator>
#include <blex/blexlib.h>
#include <blex/logfile.h>

// Optional includes to speed up compilation (probably not all #included)

#include <blex/datetime.h>
#include <blex/threads.h>
#include <blex/stream.h>
#include <blex/unicode.h>
#include <blex/utils.h>
#include <blex/objectowner.h>

// compiler specific
#include "../vm/errors.h"
#include "../vm/filesystem.h"
#include "../vm/hsvm_stackmachine.h"
#include "../vm/hsvm_columnnamemapper.h"
#include "../vm/hsvm_marshalling.h"
#include <iostream>

#define COMPILER_PREINCLUDES_DONE
