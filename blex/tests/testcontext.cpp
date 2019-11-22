//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../context.h"

void *res;

void * Create(void *a)
{
        return a;
}

void Destroy(void*a,void *b)
{
        BLEX_TEST_CHECKEQUAL(a,b);
        res = b;
}

struct ContextData1
{
        ContextData1(unsigned *a)
        : a(a) {}
        ~ContextData1()
        {
                res = a;
        }

        unsigned *a;
};

struct ContextData2
{
        ContextData2()
        {
                res = (void *)61;
        }
        ~ContextData2()
        {
                res = (void *)62;
        }
};

namespace Blex {
namespace Test {
BLEX_TEST_FUNCTION(TestTheKeeper)
{
        // Tests without registered context
        {
        Blex::ContextRegistrator reg;
        Blex::ContextKeeper keeper(reg);

        keeper.GetContext(2,true);
        BLEX_TEST_CHECK(keeper.GetContext(2,true) == (void *)0);
        keeper.AddContext(2, (void *)5);
        BLEX_TEST_CHECK(keeper.GetContext(2,true) == (void *)5);
        keeper.RemoveContext(2);
        BLEX_TEST_CHECK(keeper.GetContext(2,true) == (void *)0);
        keeper.AddContext(2, (void *)4);
        BLEX_TEST_CHECK(keeper.GetContext(2,true) == (void *)4);
        keeper.Reset();
        BLEX_TEST_CHECK(keeper.GetContext(2,true) == (void *)0);
        }

        {
        res = (void *)0;
        Blex::ContextRegistrator reg;
        Blex::ContextKeeper keeper(reg);
        BLEX_TEST_CHECK(keeper.GetContext(10,true) == (void *)0);
        reg.RegisterContext(10, Create, Destroy, (void *)77);
        BLEX_TEST_CHECK(keeper.GetContext(10,true) == (void *)77);
        BLEX_TEST_CHECK(res == (void *)0);
        keeper.Reset();
        BLEX_TEST_CHECK(res == (void *)77);
        }
}

}
}

BLEX_TEST_FUNCTION(TestContext)
{
        {
        res = (void *)0;
        Blex::ContextRegistrator reg;
        Blex::ContextKeeper keeper(reg);

        typedef Blex::Context<ContextData1, 22, unsigned> Context;
        Context::Register(reg, (unsigned *)66);
        Context context(keeper);
        BLEX_TEST_CHECK(context->a == (unsigned *)66);
        }
        BLEX_TEST_CHECK(res == (unsigned *)66);

        {
        res = (void *)0;
        Blex::ContextRegistrator reg;
        Blex::ContextKeeper keeper(reg);

        typedef Blex::Context<ContextData2, 23, void> Context;
        Context::Register(reg);
        Context context(keeper);
        BLEX_TEST_CHECK(res == (unsigned *)61);
        }
        BLEX_TEST_CHECK(res == (unsigned *)62);
}
