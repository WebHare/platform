//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>


#include <blex/testing.h>
#include <harescript/vm/sharedpool.h>

using HareScript::SharedPool;
static const char abcdata[13]={"abcdefghijkl"};

BLEX_TEST_FUNCTION(BasicTest)
{
        SharedPool shpl;

   //     BLEX_TEST_CHECKEQUAL(0, shpl.GetCapacity());

        //Allocate and reallocate. shouldn't move the buffer, unless sharedpool is being stupid
        SharedPool::Allocation initialbuf = shpl.Allocate(13,32);
        BLEX_TEST_CHECKEQUAL(13, shpl.GetBufferSize(initialbuf));
        std::memcpy(shpl.GetWritePtr(initialbuf), abcdata, 13);

        SharedPool::Allocation relocatepos = shpl.MakePrivate(initialbuf, 32, true);
        BLEX_TEST_CHECKEQUAL(initialbuf, relocatepos);
        BLEX_TEST_CHECK(std::memcmp(shpl.GetReadPtr(initialbuf), abcdata, 13) == 0);

        //Allocate a big buffer. Whitebox thingy, allocate PoolMinSize + 1 to force big allocation
        //SharedPool::Allocation bigbuf = shpl.Allocate(SharedPool::PoolMinSize + 1, SharedPool::PoolMinSize + 1);
}

