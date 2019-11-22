//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include <cmath>
#include <set>
#include <limits>
#include "../testing.h"
#include "../podvector.h"
#include "../datetime.h"
#include "../objectowner.h"
#include "../decimalfloat.h"
#include "../logfile.h"

#ifdef __GNUC__ /* GCC (at least >= 3.4) requires a LL qualifier for huge numbers) */
#define HUGENUM(x) x ## LL
#define HUGEUNUM(x) x ## ULL
#else
#define HUGENUM(x) x
#define HUGEUNUM(x) x
#endif

BLEX_TEST_FUNCTION(TestSimpleTypes)
{
       BLEX_TEST_CHECK(sizeof(int8_t)==1);
       BLEX_TEST_CHECK(sizeof(uint8_t)==1);
       BLEX_TEST_CHECK(sizeof(int16_t)==2);
       BLEX_TEST_CHECK(sizeof(uint16_t)==2);
       BLEX_TEST_CHECK(sizeof(int32_t)==4);
       BLEX_TEST_CHECK(sizeof(uint32_t)==4);
       BLEX_TEST_CHECK(sizeof(int64_t)==8);
       BLEX_TEST_CHECK(sizeof(uint64_t)==8);
}

BLEX_TEST_FUNCTION(TestDoubleStore)
{
        uint8_t store[8];

        BLEX_TEST_CHECK(sizeof(F64) == 8);

        //Some simple storage tests
        Blex::PutLsb<F64>(store,1.0);
        BLEX_TEST_CHECK(Blex::GetLsb<F64>(store) == 1.0);

        Blex::PutLsb<F64>(store,2.3673882e90);
        BLEX_TEST_CHECK(std::fabs(Blex::GetLsb<F64>(store) - 2.3673882e90) < 1e85);

        //swap all bytes to test the reversed functions
        std::swap(store[0],store[7]);
        std::swap(store[1],store[6]);
        std::swap(store[2],store[5]);
        std::swap(store[3],store[4]);

        BLEX_TEST_CHECK(std::fabs(Blex::GetMsb<F64>(store) - 2.3673882e90) < 1e85);

        const uint8_t test_ieee_double[8]={0xA3,0x2D,0xA9,0xB5,0x42,0x98,0xB2,0x52};
        BLEX_TEST_CHECK(std::fabs(Blex::GetLsb<F64>(test_ieee_double) - 2.3673882e90) < 1e85);

        const uint8_t test_ieee_reversed_double[8]={0x52,0xb2,0x98,0x42,0xb5,0xa9,0x2d,0xa3};
        BLEX_TEST_CHECK(std::fabs(Blex::GetMsb<F64>(test_ieee_reversed_double) - 2.3673882e90) < 1e85);

}

void VerifyTM(Blex::DateTime const &date, unsigned year, unsigned mon, unsigned day, unsigned hour, unsigned min, unsigned sec)
{
        std::tm my_tm = date.GetTM();
        BLEX_TEST_CHECKEQUAL(year, (unsigned)my_tm.tm_year + 1900);
        BLEX_TEST_CHECKEQUAL(mon,  (unsigned)my_tm.tm_mon + 1);
        BLEX_TEST_CHECKEQUAL(day,  (unsigned)my_tm.tm_mday);
        BLEX_TEST_CHECKEQUAL(hour, (unsigned)my_tm.tm_hour);
        BLEX_TEST_CHECKEQUAL(min,  (unsigned)my_tm.tm_min);
        BLEX_TEST_CHECKEQUAL(sec,  (unsigned)my_tm.tm_sec);
}

BLEX_TEST_FUNCTION(TestDateTime)
{
        Blex::DateTime jan_01_1970 ( Blex::DateTime::FromTimeT(0) );
        Blex::DateTime jan_01_1970_noon ( Blex::DateTime::FromTimeT(12*60*60) );
        Blex::DateTime jan_02_1970_noon ( Blex::DateTime::FromTimeT(12*60*60 + 86400) );
        Blex::DateTime feb_28_1970 ( Blex::DateTime::FromTimeT((31+27) * 86400 ));
        Blex::DateTime mar_01_1970 ( Blex::DateTime::FromTimeT((31+28) * 86400 ));
        Blex::DateTime mar_31_1970 ( Blex::DateTime::FromTimeT((31+28+30) * 86400 ));
        Blex::DateTime dec_31_1970 ( Blex::DateTime::FromTimeT((364) * 86400 ));

        Blex::DateTime feb_27_1972 ( Blex::DateTime::FromTimeT((31+26) * 86400 + (2*365*86400)));
        Blex::DateTime feb_28_1972 ( Blex::DateTime::FromTimeT((31+27) * 86400 + (2*365*86400)));
        Blex::DateTime feb_29_1972 ( Blex::DateTime::FromTimeT((31+28) * 86400 + (2*365*86400)));
        Blex::DateTime mar_01_1972 ( Blex::DateTime::FromTimeT((31+29) * 86400 + (2*365*86400)));
        Blex::DateTime dec_31_1972 ( Blex::DateTime::FromTimeT((365) * 86400 + (2*365*86400)));
        Blex::DateTime jan_01_1973 ( Blex::DateTime::FromTimeT((366) * 86400 + (2*365*86400)));

        //Verify correct roundtrips
        BLEX_TEST_CHECKEQUAL((std::time_t) 0, jan_01_1970.GetTimeT() );
        BLEX_TEST_CHECKEQUAL((std::time_t) 12*60*60, jan_01_1970_noon.GetTimeT() );
        BLEX_TEST_CHECKEQUAL((std::time_t) 12*60*60 + 86400, jan_02_1970_noon.GetTimeT() );
        BLEX_TEST_CHECKEQUAL((std::time_t) (31+27)*86400, feb_28_1970.GetTimeT() );
        BLEX_TEST_CHECKEQUAL((std::time_t) (31+28)*86400, mar_01_1970.GetTimeT() );
        BLEX_TEST_CHECKEQUAL((std::time_t) (31+28+30)*86400, mar_31_1970.GetTimeT() );
        BLEX_TEST_CHECKEQUAL((std::time_t) (364)*86400, dec_31_1970.GetTimeT() );

        BLEX_TEST_CHECKEQUAL((std::time_t) (31+26) * 86400 + (2*365*86400), feb_27_1972.GetTimeT() );
        BLEX_TEST_CHECKEQUAL((std::time_t) (31+27) * 86400 + (2*365*86400), feb_28_1972.GetTimeT() );
        BLEX_TEST_CHECKEQUAL((std::time_t) (31+28) * 86400 + (2*365*86400), feb_29_1972.GetTimeT() );
        BLEX_TEST_CHECKEQUAL((std::time_t) (31+29) * 86400 + (2*365*86400), mar_01_1972.GetTimeT() );
        BLEX_TEST_CHECKEQUAL((std::time_t) (365) * 86400 + (2*365*86400), dec_31_1972.GetTimeT() );
        BLEX_TEST_CHECKEQUAL((std::time_t) (366) * 86400 + (2*365*86400), jan_01_1973.GetTimeT() );

        //Verify convert TMs
        VerifyTM(jan_01_1970,      1970,  1,  1,  0,  0,  0);
        VerifyTM(jan_01_1970_noon, 1970,  1,  1, 12,  0,  0);
        VerifyTM(jan_02_1970_noon, 1970,  1,  2, 12,  0,  0);
        VerifyTM(feb_28_1970,      1970,  2, 28,  0,  0,  0);
        VerifyTM(mar_01_1970,      1970,  3,  1,  0,  0,  0);
        VerifyTM(mar_31_1970,      1970,  3, 31,  0,  0,  0);
        VerifyTM(dec_31_1970,      1970, 12, 31,  0,  0,  0);

        VerifyTM(feb_27_1972,      1972,  2, 27,  0,  0,  0);
        VerifyTM(feb_28_1972,      1972,  2, 28,  0,  0,  0);
        VerifyTM(feb_29_1972,      1972,  2, 29,  0,  0,  0);
        VerifyTM(mar_01_1972,      1972,  3,  1,  0,  0,  0);
        VerifyTM(dec_31_1972,      1972, 12, 31,  0,  0,  0);
        VerifyTM(jan_01_1973,      1973,  1,  1,  0,  0,  0);
}

BLEX_TEST_FUNCTION(TestDateTimeCalcs)
{
        BLEX_TEST_CHECKEQUAL(Blex::DateTime(5,0), Blex::DateTime(4,0) + Blex::DateTime::Days(1));
        BLEX_TEST_CHECKEQUAL(Blex::DateTime(5,0), Blex::DateTime(4,0) + Blex::DateTime::Seconds(24*60*60));
        BLEX_TEST_CHECKEQUAL(Blex::DateTime(5,0), Blex::DateTime(3,0) + Blex::DateTime::Days(1) + Blex::DateTime::Seconds(24*60*60));
        BLEX_TEST_CHECKEQUAL(Blex::DateTime(5,0), Blex::DateTime(3,1) + Blex::DateTime::Days(1) + Blex::DateTime::Seconds(24*60*60) - Blex::DateTime::Msecs(1));
        BLEX_TEST_CHECKEQUAL(Blex::DateTime(5,0), Blex::DateTime(7,1) - Blex::DateTime::Days(2) - Blex::DateTime::Msecs(1));
        BLEX_TEST_CHECKEQUAL(Blex::DateTime(4,24*60*60*1000-1), Blex::DateTime(5,0) - Blex::DateTime::Msecs(1));
}

BLEX_TEST_FUNCTION(TestDatetimeDecode)
{
        Blex::DateTime reference = Blex::DateTime::FromDateTime (2003, 05, 15, 13, 15, 30);

        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("15 May 03 13:15:30 GMT"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("15 May 2003 15:15:30 +0200"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("Fri, 15 May 03 13:15:30 GMT"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("Fri, 15 May 03 08:15:30 EST"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("Fri, 15 May 03 13:15:30 Z"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("Fri, 15 May 03 13:15:30 +0000"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("Fri, 15 May 03 15:45:30 +0230"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("Fri, 15 May 03 10:45:30 -0230"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("Fri, 15 May 2003 13:15:30 +0000"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T13:15:30Z"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("Tue May 15 13:15:30 2003"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText(" 15-May-03 13:15:30"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("15/May/2003:13:15:30 +0000"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("15/May/2003:15:45:30 +0230"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("15/May/2003:10:45:30 -0230"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("14/May/2003:23:15:30 -1400"));

        reference += Blex::DateTime::Msecs(120);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("15/May/2003:10:45:30.12 -0230"));
        reference += Blex::DateTime::Msecs(3);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("15/May/2003:10:45:30.123 -0230"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("15/May/2003:10:45:30.1234 -0230"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("15/May/2003:10:45:30.12345 -0230"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("15/May/2003:10:45:30.123456 -0230"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("15/May/2003:10:45:30.1234567 -0230"));

        reference = Blex::DateTime::FromDateTime (2003, 05, 14, 23, 15, 30);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("15/May/2003:01:45:30 +0230"));

        reference = Blex::DateTime::FromDateTime (2003, 6, 9, 0, 0, 0);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-6-9"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-06-09"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-6-09"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20030609"));

        reference = Blex::DateTime::FromDateTime (2003, 05, 15, 0, 0, 0);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-5-15"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20030515"));

        reference = Blex::DateTime::FromDateTime (2003, 05, 01, 0, 0, 0);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05"));

        reference = Blex::DateTime::FromDateTime (2003, 01, 01, 0, 0, 0);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003"));

        reference = Blex::DateTime::FromDateTime (20031, 05, 15, 0, 0, 0);
        //We'll accept longer than 9999 years (because datetime range is larger than iso86010) but only where the data is unambiguous. eg, you can't use year-only format
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20031-05-15"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("200310515"));

        reference = Blex::DateTime::FromDateTime (20031, 05, 15, 16, 17, 18);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20031-05-15T16:17:18"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("200310515T161718"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20031-05-15 16:17:18"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("200310515 161718"));

        reference = Blex::DateTime::FromDateTime (2003, 05, 15, 1, 2, 3);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T01:02:03"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20030515T01:02:03"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20030515T010203"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T010203"));

        reference += Blex::DateTime::Msecs(100);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T01:02:03.100"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T01:02:03.1"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20030515T010203.100"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20030515T010203.1"));

        reference = Blex::DateTime::FromDateTime (2003, 05, 15, 1, 6, 0);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T01:06"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T0106"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20030515T01:06"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20030515T0106"));

        reference = Blex::DateTime::FromDateTime (2003, 05, 15, 1, 0, 0);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T01"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20030515T01"));

        //timezones
        reference = Blex::DateTime::FromDateTime (2003, 05, 15, 1, 2, 3);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T01:02:03Z"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T02:02:03+01"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T02:03:03+0101"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T02:03:03+01:01"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T00:02:03-01"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T00:01:03-0101"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T00:01:03-01:01"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-14T23:00:03-0202"));

        reference += Blex::DateTime::Msecs(100);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-14T23:00:03.1-0202"));
        reference += Blex::DateTime::Msecs(20);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-14T23:00:03.12-0202"));
        reference += Blex::DateTime::Msecs(3);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-14T23:00:03.123-0202"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-14T23:00:03.1234-0202"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-14T23:00:03.12345-0202"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-14T23:00:03.123456-0202"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-14T23:00:03.1234567-0202"));

        // Cross day
        reference = Blex::DateTime::FromDateTime (2003, 05, 14, 23, 2, 3);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-05-15T01:02:03+0200"));

        //Date+timezone, no time
        reference = Blex::DateTime::FromDateTime (2003, 6, 8, 22, 0, 0);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-06-09+02:00"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20030609+02:00"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20030609+0200"));

        reference = Blex::DateTime::FromDateTime (2003, 6, 9, 0, 0, 0);
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("2003-06-09Z"));
        BLEX_TEST_CHECKEQUAL(reference, Blex::DateTime::FromText("20030609Z"));

        Blex::DateTime reference2 = Blex::DateTime::FromDateTime (2006, 10, 17, 23, 0, 1);
        Blex::DateTime reference3 = Blex::DateTime::FromDateTime (2006, 10, 17, 23, 0, 0);
        Blex::DateTime reference4 = Blex::DateTime::FromDateTime (2008, 9, 9, 6, 2, 14);
        Blex::DateTime reference10 = Blex::DateTime::FromDateTime (2006, 10, 18, 23, 0, 0);
        BLEX_TEST_CHECKEQUAL(reference2, Blex::DateTime::FromText("Wed, 18 Oct 2006 00:00:01 +0100"));
        BLEX_TEST_CHECKEQUAL(reference3, Blex::DateTime::FromText("Wed, 18 Oct 2006 00:00:00 +0100"));
        BLEX_TEST_CHECKEQUAL(reference4, Blex::DateTime::FromText("Wed, 8 Sep 2008 22:02:14 -0800"));
        BLEX_TEST_CHECKEQUAL(reference10, Blex::DateTime::FromText("Wed, 18 Oct 2006 24:00:00 +0100"));
        BLEX_TEST_CHECKEQUAL(Blex::DateTime::Invalid(), Blex::DateTime::FromText("Wed, 18 Oct 2006 24:01:00 +0100"));
        BLEX_TEST_CHECKEQUAL(Blex::DateTime::Invalid(), Blex::DateTime::FromText("Wed, 18 Oct 2006 24:00:01 +0100"));

        BLEX_TEST_CHECKEQUAL(reference4, Blex::DateTime::FromText("9 Sep 2008 08:02:14 +0200"));
        BLEX_TEST_CHECKEQUAL(reference4, Blex::DateTime::FromText("8 Sep 2008 22:02:14 -0800"));
        BLEX_TEST_CHECKEQUAL(reference3, Blex::DateTime::FromText("18 Oct 2006 01:00:00 +0200"));

        Blex::DateTime reference5 = Blex::DateTime::FromDateTime (2007, 6, 28, 5, 54, 43);
        BLEX_TEST_CHECKEQUAL(reference5, Blex::DateTime::FromText("qui, 28 jun 2007 02:54:43 -0300"));
        BLEX_TEST_CHECKEQUAL(reference5, Blex::DateTime::FromText("qui, 28 jun 2007, 02:54:43 -0300"));

        BLEX_TEST_CHECKEQUAL(Blex::DateTime::Invalid(), Blex::DateTime::FromText("0000-00-00T12:34:56Z"));

        Blex::DateTime reference6 = Blex::DateTime::FromDateTime (2093, 05, 15, 13, 15, 30);
        BLEX_TEST_CHECKEQUAL(reference6, Blex::DateTime::FromText("15 May 2093 13:15:30 GMT"));
        Blex::DateTime reference7 = Blex::DateTime::FromDateTime (1993, 05, 15, 13, 15, 30);
        BLEX_TEST_CHECKEQUAL(reference7, Blex::DateTime::FromText("15 May 1993 13:15:30 GMT"));

        Blex::DateTime reference8 = Blex::DateTime::FromDateTime (2063, 05, 15, 13, 15, 30);
        BLEX_TEST_CHECKEQUAL(reference8, Blex::DateTime::FromText("15 May 63 13:15:30 GMT"));
        Blex::DateTime reference9 = Blex::DateTime::FromDateTime (1993, 05, 15, 13, 15, 30);
        BLEX_TEST_CHECKEQUAL(reference9, Blex::DateTime::FromText("15 May 93 13:15:30 GMT"));
}

namespace Test
{

template <unsigned A> struct B
{
        std::vector<unsigned> &b;
        B(std::vector<unsigned> &o) : b(o) {}
        ~B()
        {
                b.push_back(A);
        };
};
template <unsigned A, unsigned D> struct C : public B<A>
{
        std::vector<unsigned> &b;
        C(std::vector<unsigned> &o) : B<A>(o), b(o) {}
        ~C()
        {
                b.push_back(D);
        };
};

}//end anonymous namespace

BLEX_TEST_FUNCTION(TestGenericOwner)
{
        std::vector<unsigned> order;
        {
                Blex::GenericOwner o;
                o.Adopt(new Test::B<1>(order));
                o.Adopt(new Test::B<2>(order));
                o.Adopt(new Test::C<3, 4>(order));
                o.Adopt(new Test::C<5, 6>(order));
                BLEX_TEST_CHECKEQUAL(4,o.Size());
        };
        BLEX_TEST_CHECKEQUAL(6,order.size()); //Number of destructors called as expected?

        //check call ordering
        std::set<unsigned> s( order.begin(), order.end() );
        BLEX_TEST_CHECKEQUAL(1,*s.begin());
        BLEX_TEST_CHECKEQUAL(6,*(--s.end()));
}

BLEX_TEST_FUNCTION(TestPow10)
{
        BLEX_TEST_CHECK(Blex::FloatPow10(-1) < 0.1 + 1e-16);
        BLEX_TEST_CHECK(Blex::FloatPow10(-1) > 0.1 - 1e-16);

        F64 expect = 1;
        for (unsigned i = 0; i <= 22; ++i)
        {
                BLEX_TEST_CHECKEQUAL(expect, Blex::FloatPow10(i));
                expect *= 10;
        }
        BLEX_TEST_CHECKEQUAL(1e22, Blex::FloatPow10(22));
        BLEX_TEST_CHECK(std::pow(double(10), 23) - 1e9 < Blex::FloatPow10(23));
        BLEX_TEST_CHECK(std::pow(double(10), 23) + 1e9 > Blex::FloatPow10(23));
}

BLEX_TEST_FUNCTION(TestDecimalFloat)
{
        // ADDME: tests for floats
        Blex::DecimalFloat df, dfneg;

// Int
        df.digits = 1;
        df.exponent = 0;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToS32());
        BLEX_TEST_CHECKEQUAL(1, df.ToS32());

        df.digits = 2004000000;
        df.exponent = 0;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToS32());
        BLEX_TEST_CHECKEQUAL(2004000000, df.ToS32());

        df.digits = 1;
        df.exponent = 1;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToS32());
        BLEX_TEST_CHECKEQUAL(10, df.ToS32());

        df.digits = 10;
        df.exponent = -1;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToS32());
        BLEX_TEST_CHECKEQUAL(1, df.ToS32());

        df.digits = 2147483647; // Max int32_t
        df.exponent = 0;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToS32());
        BLEX_TEST_CHECKEQUAL(2147483647, df.ToS32());

        df.digits = uint64_t(2147483647)+1; // Max int32_t + 1
        df.exponent = 0;
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(false, df.ConvertableToS32());
        BLEX_TEST_CHECKEQUAL(true, dfneg.ConvertableToS32());
        BLEX_TEST_CHECKEQUAL(-(int64_t)2147483648UL, dfneg.ToS32());

        df.digits = 2; // Min int32_t / 10 ^9
        df.exponent = 9;
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(true, dfneg.ConvertableToS32());
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToS32());
        BLEX_TEST_CHECKEQUAL(2000000000, df.ToS32());

        df.digits = 3; // Ceil(Min int32_t / 10 ^9)
        df.exponent = 9;
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(false, df.ConvertableToS32());
        BLEX_TEST_CHECKEQUAL(false, dfneg.ConvertableToS32());

        df.digits = 1; // Ceil(Min int32_t / 10 ^10)
        df.exponent = 10;
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(false, df.ConvertableToS32());
        BLEX_TEST_CHECKEQUAL(false, dfneg.ConvertableToS32());

// Integer 64
        df.digits = 1;
        df.exponent = 0;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToS64());
        BLEX_TEST_CHECKEQUAL(1, df.ToS64());

        df.digits = 2004000000;
        df.exponent = 0;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToS64());
        BLEX_TEST_CHECKEQUAL(2004000000, df.ToS64());

        df.digits = 1;
        df.exponent = 1;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToS64());
        BLEX_TEST_CHECKEQUAL(10, df.ToS64());

        df.digits = 10;
        df.exponent = -1;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToS64());
        BLEX_TEST_CHECKEQUAL(1, df.ToS64());

        df.digits = HUGEUNUM(9223372036854775807); // Max int64_t
        df.exponent = 0;
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToS64());
        BLEX_TEST_CHECKEQUAL(true, dfneg.ConvertableToS64());
        BLEX_TEST_CHECKEQUAL(HUGENUM(9223372036854775807), df.ToS64());
        BLEX_TEST_CHECKEQUAL(HUGENUM(-9223372036854775807), dfneg.ToS64());

        df.digits = HUGEUNUM(9223372036854775808); // Min int64_t
        df.exponent = 0;
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(false, df.ConvertableToS64());
        BLEX_TEST_CHECKEQUAL(true, dfneg.ConvertableToS64());
        BLEX_TEST_CHECKEQUAL(-HUGENUM(9223372036854775807)-1, dfneg.ToS64());

        df.digits = HUGENUM(922337203685477580); // Max int64_t / 10
        df.exponent = 1;
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(true, dfneg.ConvertableToS64());
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToS64());
        BLEX_TEST_CHECKEQUAL(HUGENUM(9223372036854775800), df.ToS64());

        df.digits = 9; // Max int64_t / 10^18
        df.exponent = 18;
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(true, dfneg.ConvertableToS64());
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToS64());
        BLEX_TEST_CHECKEQUAL(HUGENUM(9000000000000000000), df.ToS64());

        df.digits = 1; // ceil(Max int64_t / 10^19)
        df.exponent = 19;
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(false, dfneg.ConvertableToS64());
        BLEX_TEST_CHECKEQUAL(false, df.ConvertableToS64());

// Money
        df.digits = 1;
        df.exponent = 0;
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(true));
        BLEX_TEST_CHECKEQUAL(100000, df.ToMoney());
        BLEX_TEST_CHECKEQUAL(-100000, dfneg.ToMoney());

        df.digits = 1;
        df.negate = true;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(true));
        BLEX_TEST_CHECKEQUAL(-100000, df.ToMoney());

        df.exponent = 1;
        df.digits = 1;
        df.negate = false;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(true));
        BLEX_TEST_CHECKEQUAL(1000000, df.ToMoney());

        df.exponent = -5;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(true));
        BLEX_TEST_CHECKEQUAL(1, df.ToMoney());

        df.exponent = -6;
        BLEX_TEST_CHECKEQUAL(false, df.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(true));
        BLEX_TEST_CHECKEQUAL(0, df.ToMoney());

        df.digits = 9;
        df.exponent = -6;
        BLEX_TEST_CHECKEQUAL(false, df.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(true));
        BLEX_TEST_CHECKEQUAL(1, df.ToMoney());

        df.digits = 5;
        BLEX_TEST_CHECKEQUAL(1, df.ToMoney());
        df.digits = 4;
        BLEX_TEST_CHECKEQUAL(0, df.ToMoney());
        df.digits = 6;
        df.negate = true;
        BLEX_TEST_CHECKEQUAL(-1, df.ToMoney());
        df.digits = 5;
        BLEX_TEST_CHECKEQUAL(0, df.ToMoney());

        df.exponent = -7;
        df.digits = 50;
        df.negate = false;
        BLEX_TEST_CHECKEQUAL(1, df.ToMoney());
        df.digits = 49;
        BLEX_TEST_CHECKEQUAL(0, df.ToMoney());
        df.digits = 51;
        df.negate = true;
        BLEX_TEST_CHECKEQUAL(-1, df.ToMoney());
        df.digits = 50;
        BLEX_TEST_CHECKEQUAL(0, df.ToMoney());

        df.exponent = -6;
        df.digits = 10;
        df.negate = false;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(1, df.ToMoney());

        df.exponent = -5;
        df.digits = /*int64_t max */ HUGEUNUM(9223372036854775807);
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(true, dfneg.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(HUGENUM(9223372036854775807), df.ToMoney());
        BLEX_TEST_CHECKEQUAL(-HUGENUM(9223372036854775807), dfneg.ToMoney());

        df.exponent = -5;
        df.digits = /*int64_t min */ HUGEUNUM(9223372036854775808);
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(false, df.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(true, dfneg.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(-HUGENUM(9223372036854775807)-1, dfneg.ToMoney());

        df.exponent = -4;
        df.digits = /*int64_t max/10 */ HUGEUNUM(922337203685477580);
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(true, dfneg.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(HUGENUM(9223372036854775800), df.ToMoney());
        BLEX_TEST_CHECKEQUAL(-HUGENUM(9223372036854775800), dfneg.ToMoney());

        ++df.digits;
        BLEX_TEST_CHECKEQUAL(false, df.ConvertableToMoney(false));

        df.digits = /*int64_t min/10 */ HUGEUNUM(922337203685477580);
        df.negate = true;
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(true, dfneg.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(-HUGENUM(9223372036854775800), df.ToMoney());
        BLEX_TEST_CHECKEQUAL(HUGENUM(9223372036854775800), dfneg.ToMoney());

        ++df.digits;
        dfneg = df;
        dfneg.Negate();
        BLEX_TEST_CHECKEQUAL(false, df.ConvertableToMoney(false));
        BLEX_TEST_CHECKEQUAL(false, dfneg.ConvertableToMoney(false));

        df.digits = 1;
        df.exponent = 50;
        df.negate = false;
        BLEX_TEST_CHECKEQUAL(false, df.ConvertableToMoney(false));

// Float
        df.digits = 5;
        df.exponent = -1;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToFloat());
        BLEX_TEST_CHECKEQUAL(.5, df.ToFloat());

        df.digits = 55;
        df.exponent = -1;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToFloat());
        BLEX_TEST_CHECKEQUAL(5.5, df.ToFloat());

        df.digits = 1;
        df.exponent = 0;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToFloat());
        BLEX_TEST_CHECKEQUAL(1.0, df.ToFloat());

        df.exponent = 308;
        BLEX_TEST_CHECKEQUAL(true, df.ConvertableToFloat());
        BLEX_TEST_CHECK(df.ToFloat() - 1e+308 < 1e+295);

        df.exponent = 309;
        BLEX_TEST_CHECKEQUAL(false, df.ConvertableToFloat());

// Money divide
        // direct divide route
        BLEX_TEST_CHECKEQUAL(100000ll, Blex::MoneyDivide(100000ll, 100000ll));
        BLEX_TEST_CHECKEQUAL(384010000ll, Blex::MoneyDivide(38401000000000ll, 10000000000ll));
        BLEX_TEST_CHECKEQUAL(384010000ll, Blex::MoneyDivide(38401000049000ll, 10000000000ll));
        BLEX_TEST_CHECKEQUAL(384010001ll, Blex::MoneyDivide(38401000050000ll, 10000000000ll));
        BLEX_TEST_CHECKEQUAL(384010000ll, Blex::MoneyDivide(38401000053840ll, 10000000001ll));
        BLEX_TEST_CHECKEQUAL(384010001ll, Blex::MoneyDivide(38401000053841ll, 10000000001ll));

        // long division
        BLEX_TEST_CHECKEQUAL(200000000ll, Blex::MoneyDivide(2000000004900000ll, 1000000000000ll));
        BLEX_TEST_CHECKEQUAL(200000001ll, Blex::MoneyDivide(2000000005000000ll, 1000000000000ll));
        BLEX_TEST_CHECKEQUAL(200000001ll, Blex::MoneyDivide(2000000005100000ll, 1000000000000ll));
        BLEX_TEST_CHECKEQUAL(200000000ll, Blex::MoneyDivide(2000000005002000ll, 1000000000001ll));
        BLEX_TEST_CHECKEQUAL(200000001ll, Blex::MoneyDivide(2000000005002001ll, 1000000000001ll));

        // rounding
        BLEX_TEST_CHECKEQUAL(1099511627775ll, Blex::MoneyDivide(10995116277754ll, 1000000ll)); // 10*(2^40-1)+5
        BLEX_TEST_CHECKEQUAL(1099511627776ll, Blex::MoneyDivide(10995116277755ll, 1000000ll)); // 10*(2^40-1)+5

// Money multiply
        BLEX_TEST_CHECKEQUAL(1099511627775ll, Blex::MoneyMultiply(10995116277754ll, 10000ll)); // 10*(2^40-1)+5
        BLEX_TEST_CHECKEQUAL(1099511627776ll, Blex::MoneyMultiply(10995116277755ll, 10000ll)); // 10*(2^40-1)+5
}

BLEX_TEST_FUNCTION(TestPodVector)
{
        int testdata[]={15,45,75,25,55,85};
        int testdata_2[]={1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50};

        Blex::PodVector<int> testvector;
        BLEX_TEST_CHECKEQUAL(0, testvector.size());
        testvector.assign(testdata, testdata+6);
        BLEX_TEST_CHECKEQUAL(6, testvector.size());
        testvector.erase(testvector.begin()+2, testvector.begin()+4);
        BLEX_TEST_CHECKEQUAL(4, testvector.size());
        BLEX_TEST_CHECKEQUAL(45, testvector[1]);
        BLEX_TEST_CHECKEQUAL(55, testvector[2]);
        BLEX_TEST_CHECKEQUAL(85, testvector[3]);

        Blex::PodVector<int> testvector2(testvector);
        BLEX_TEST_CHECKEQUAL(4, testvector2.size());
        testvector.insert(testvector.end(), testdata_2, testdata_2+50);
        testvector2.insert(testvector2.begin(), testdata_2, testdata_2+50);
        BLEX_TEST_CHECKEQUAL(54, testvector2.size());
        BLEX_TEST_CHECKEQUAL(54, testvector.size());
        testvector.push_back(150);
        testvector2.insert(testvector2.begin(),150);
        BLEX_TEST_CHECKEQUAL(55, testvector2.size());
        BLEX_TEST_CHECKEQUAL(55, testvector.size());
        BLEX_TEST_CHECK(std::equal(testvector.begin() + 4, testvector.end() - 1, testdata_2));
        BLEX_TEST_CHECK(std::equal(testvector2.begin() + 1, testvector2.end() - 5, testdata_2));

        testvector.clear();
        BLEX_TEST_CHECKEQUAL(0, testvector.size());

        testvector.push_back(1);
        testvector.push_back(2);
        testvector.push_back(3);

        BLEX_TEST_CHECKEQUAL(3, testvector.size());
        testvector.pop_back();
        BLEX_TEST_CHECKEQUAL(2, testvector.size());

        Blex::PodVector<int>::reverse_iterator rit = testvector.rbegin();
        BLEX_TEST_CHECKEQUAL(2, *rit);
        ++rit;
        BLEX_TEST_CHECKEQUAL(1, *rit);
        BLEX_TEST_CHECK(testvector.begin() + 1 == rit.base());
        ++rit;
        BLEX_TEST_CHECK(testvector.rend() == rit);

        BLEX_TEST_CHECKEQUAL(2, testvector.back());

        int &new_pod = testvector.push_back();
        new_pod = 3;
        BLEX_TEST_CHECKEQUAL(3, testvector[2]);
}

//ADDME: Test get8,16,32 functions, with incorrect alignments

