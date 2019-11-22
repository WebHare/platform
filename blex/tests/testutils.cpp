//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../utils.h"
#include "../mapvector.h"
#include "../testing.h"

BLEX_TEST_FUNCTION(TestBound)
{
        BLEX_TEST_CHECKEQUAL(Blex::Bound(2,15,7),7);
        BLEX_TEST_CHECKEQUAL(Blex::Bound(2,15,19),15);
        BLEX_TEST_CHECKEQUAL(Blex::Bound(2,15,-8),2);
        BLEX_TEST_CHECKEQUAL(Blex::Bound(-2,15,-8),-2);
        BLEX_TEST_CHECKEQUAL(Blex::Bound(-2,15,1),1);
}

struct CharLessFunction
{
        bool operator() (std::string::value_type lhs, std::string::value_type rhs)
        {
                return lhs < rhs;
        }
};

struct CharCaseInsensitiveLessFunction
{
        bool operator() (std::string::value_type lhs, std::string::value_type rhs)
        {
                if (lhs>='a' && lhs<='z') lhs&=~0x20;
                if (rhs>='a' && rhs<='z') rhs&=~0x20;
                return lhs<rhs;
        }
};

BLEX_TEST_FUNCTION(TestMapVector)
{
        using namespace std; //using std::make_pair would suffice but crashes BCB6

        typedef Blex::MapVector<uint32_t, uint32_t, std::less<uint32_t> > TheMap;

        TheMap::iterator pos;
        TheMap the_map;

        //test simple insertions

        BLEX_TEST_CHECKEQUAL( (unsigned)0, the_map.Size());

        pos = the_map.Insert( make_pair( 2,222) ).first;
        BLEX_TEST_CHECK( pos == the_map.Begin() + 0);

        pos = the_map.Insert( make_pair( 3,333) ).first;
        BLEX_TEST_CHECK( pos == the_map.Begin() + 1);

        pos = the_map.Insert( make_pair( 8,888) ).first;
        BLEX_TEST_CHECK( pos == the_map.Begin() + 2);

        pos = the_map.Insert( make_pair( 1,111) ).first;
        BLEX_TEST_CHECK( pos == the_map.Begin() + 0);

        the_map.PushBack( make_pair(44,444) );
        BLEX_TEST_CHECK( the_map.Find(44) == the_map.Begin() + 4);
        BLEX_TEST_CHECK( the_map.Insert( make_pair( 6,666) ).first== the_map.Begin() + 3);

        BLEX_TEST_CHECKEQUAL( 6, (int)the_map.Size());
        BLEX_TEST_CHECK( the_map.Find(2)== the_map.Begin()+1);
        BLEX_TEST_CHECKEQUAL( 222, (int)the_map.Find(2)->second);
        BLEX_TEST_CHECK( the_map.Find(8)== the_map.Begin()+4);
        BLEX_TEST_CHECK( the_map.Find(8)->second == 888);
        BLEX_TEST_CHECK( the_map.Find(7)== the_map.End());

        //try dupe keys
        BLEX_TEST_CHECK( the_map.Insert( make_pair(44,666) ).second == false );
        BLEX_TEST_CHECKEQUAL(   6, (int)the_map.Size());
        BLEX_TEST_CHECK( the_map.Find(44) == the_map.Begin()+5);
        BLEX_TEST_CHECKEQUAL( 444, (int)the_map.Find(44)->second);

        //test removing keys
        BLEX_TEST_CHECKEQUAL( false, the_map.Delete(48) );
        BLEX_TEST_CHECKEQUAL(   6, (int)the_map.Size());
        BLEX_TEST_CHECKEQUAL( true,  the_map.Delete(44) );
        BLEX_TEST_CHECKEQUAL(   5, (int)the_map.Size());
        BLEX_TEST_CHECK( the_map.End() == the_map.Find(44));
}

BLEX_TEST_FUNCTION(MultiMapVector)
{
        using namespace std; //using std::make_pair would suffice but crashes BCB6

        typedef Blex::MultiMapVector<int, int, std::less<int> > TheMap;

        TheMap::iterator pos;
        TheMap the_map;

        //test simple insertions

        BLEX_TEST_CHECKEQUAL( (unsigned)0, the_map.Size());

        pos = the_map.Insert( make_pair( 2,222) ).first;
        BLEX_TEST_CHECK( pos == the_map.Begin() + 0);

        pos = the_map.Insert( make_pair( 3,333) ).first;
        BLEX_TEST_CHECK( pos == the_map.Begin() + 1);

        pos = the_map.Insert( make_pair( 8,888) ).first;
        BLEX_TEST_CHECK( pos == the_map.Begin() + 2);

        pos = the_map.Insert( make_pair( 1,111) ).first;
        BLEX_TEST_CHECK( pos == the_map.Begin() + 0);

        the_map.PushBack( make_pair(44,444) );
        BLEX_TEST_CHECK( the_map.Find(44) == the_map.Begin() + 4);
        BLEX_TEST_CHECK( the_map.Insert( make_pair( 6,666) ).first== the_map.Begin() + 3);

        BLEX_TEST_CHECKEQUAL( 6, (int)the_map.Size());
        BLEX_TEST_CHECK( the_map.Find(2)== the_map.Begin()+1);
        BLEX_TEST_CHECKEQUAL( 222, (int)the_map.Find(2)->second);
        BLEX_TEST_CHECK( the_map.Find(8)== the_map.Begin()+4);
        BLEX_TEST_CHECK( the_map.Find(8)->second == 888);
        BLEX_TEST_CHECK( the_map.Find(7)== the_map.End());

        //try dupe keys
        BLEX_TEST_CHECK( the_map.Insert( make_pair(44,666) ).second == true );
        BLEX_TEST_CHECKEQUAL(   7, (int)the_map.Size());
        BLEX_TEST_CHECK( the_map.Find(44) == the_map.Begin()+5);
        BLEX_TEST_CHECKEQUAL( 444, (int)the_map.Find(44)->second);

        //test removing keys
        BLEX_TEST_CHECKEQUAL( false, the_map.Delete(make_pair(48,4)) );
        BLEX_TEST_CHECKEQUAL(   7, (int)the_map.Size());
        BLEX_TEST_CHECKEQUAL( true,  the_map.Delete(make_pair(44,666)) );
        BLEX_TEST_CHECKEQUAL(   6, (int)the_map.Size());
        BLEX_TEST_CHECK( the_map.Find(44) == the_map.Begin()+5);
        BLEX_TEST_CHECKEQUAL( 444, (int)the_map.Find(44)->second);
        BLEX_TEST_CHECKEQUAL( true,  the_map.Delete(make_pair(44,444)) );
        BLEX_TEST_CHECKEQUAL(   5, (int)the_map.Size());
        BLEX_TEST_CHECK( the_map.End() == the_map.Find(44));
}

BLEX_TEST_FUNCTION(TestBinaryFind)
{
                           //01234567890123456789
        std::string range = "abcdefhijkopqrtuvxz";

        BLEX_TEST_CHECKEQUAL( 6,Blex::BinaryFind(range.begin(),range.end(),'h')-range.begin());
        BLEX_TEST_CHECKEQUAL(11,Blex::BinaryFind(range.begin(),range.end(),'p')-range.begin());
        BLEX_TEST_CHECKEQUAL(19,Blex::BinaryFind(range.begin(),range.end(),'y')-range.begin());
        BLEX_TEST_CHECKEQUAL(19,Blex::BinaryFind(range.begin(),range.end(),'D')-range.begin());
        BLEX_TEST_CHECKEQUAL( 0,Blex::BinaryFind(range.begin(),range.end(),'a')-range.begin());
        BLEX_TEST_CHECKEQUAL(18,Blex::BinaryFind(range.begin(),range.end(),'z')-range.begin());
        BLEX_TEST_CHECKEQUAL(19,Blex::BinaryFind(range.begin(),range.end(),'m')-range.begin());

        BLEX_TEST_CHECKEQUAL( 6,Blex::BinaryFind(range.begin(),range.end(),'h',CharLessFunction())-range.begin());
        BLEX_TEST_CHECKEQUAL(11,Blex::BinaryFind(range.begin(),range.end(),'p',CharLessFunction())-range.begin());
        BLEX_TEST_CHECKEQUAL(19,Blex::BinaryFind(range.begin(),range.end(),'y',CharLessFunction())-range.begin());
        BLEX_TEST_CHECKEQUAL(19,Blex::BinaryFind(range.begin(),range.end(),'D',CharLessFunction())-range.begin());
        BLEX_TEST_CHECKEQUAL( 0,Blex::BinaryFind(range.begin(),range.end(),'a',CharLessFunction())-range.begin());
        BLEX_TEST_CHECKEQUAL(18,Blex::BinaryFind(range.begin(),range.end(),'z',CharLessFunction())-range.begin());
        BLEX_TEST_CHECKEQUAL(19,Blex::BinaryFind(range.begin(),range.end(),'m',CharLessFunction())-range.begin());

        BLEX_TEST_CHECKEQUAL( 6,Blex::BinaryFind(range.begin(),range.end(),'h',CharCaseInsensitiveLessFunction())-range.begin());
        BLEX_TEST_CHECKEQUAL(11,Blex::BinaryFind(range.begin(),range.end(),'p',CharCaseInsensitiveLessFunction())-range.begin());
        BLEX_TEST_CHECKEQUAL(19,Blex::BinaryFind(range.begin(),range.end(),'y',CharCaseInsensitiveLessFunction())-range.begin());
        BLEX_TEST_CHECKEQUAL( 3,Blex::BinaryFind(range.begin(),range.end(),'D',CharCaseInsensitiveLessFunction())-range.begin());
        BLEX_TEST_CHECKEQUAL( 0,Blex::BinaryFind(range.begin(),range.end(),'a',CharCaseInsensitiveLessFunction())-range.begin());
        BLEX_TEST_CHECKEQUAL(18,Blex::BinaryFind(range.begin(),range.end(),'z',CharCaseInsensitiveLessFunction())-range.begin());
        BLEX_TEST_CHECKEQUAL(19,Blex::BinaryFind(range.begin(),range.end(),'m',CharCaseInsensitiveLessFunction())-range.begin());

        BLEX_TEST_CHECKEQUAL( 6,Blex::BinaryClosestFind(range.begin(),range.end(),'h')-range.begin());
        BLEX_TEST_CHECKEQUAL(11,Blex::BinaryClosestFind(range.begin(),range.end(),'p')-range.begin());
        BLEX_TEST_CHECKEQUAL(17,Blex::BinaryClosestFind(range.begin(),range.end(),'y')-range.begin());
        BLEX_TEST_CHECKEQUAL( 0,Blex::BinaryClosestFind(range.begin(),range.end(),'D')-range.begin());
        BLEX_TEST_CHECKEQUAL( 0,Blex::BinaryClosestFind(range.begin(),range.end(),'a')-range.begin());
        BLEX_TEST_CHECKEQUAL(18,Blex::BinaryClosestFind(range.begin(),range.end(),'z')-range.begin());
        BLEX_TEST_CHECKEQUAL( 9,Blex::BinaryClosestFind(range.begin(),range.end(),'m')-range.begin());
}

BLEX_TEST_FUNCTION(TestSearchUncontained)
{
                           //0123456789012345678901
        std::string sin   = "abcdefghabcefghabcdfg";
        std::string sfor1 = "defg";
        std::string sfor2 = "abcef";
        std::string sfor3 = "dfgh";
        std::string sfor4 = "dfghi";
        std::string sfor5 = "dfhi";

        BLEX_TEST_CHECKEQUAL(Blex::SearchUncontained(sin.begin(),sin.end(),sfor1.begin(),sfor1.end()) - sin.begin(), 3);
        BLEX_TEST_CHECKEQUAL(Blex::SearchUncontained(sin.begin(),sin.end(),sfor2.begin(),sfor2.end()) - sin.begin(), 8);
        BLEX_TEST_CHECKEQUAL(Blex::SearchUncontained(sin.begin(),sin.end(),sfor3.begin(),sfor3.end()) - sin.begin(), 18);
        BLEX_TEST_CHECKEQUAL(Blex::SearchUncontained(sin.begin(),sin.end(),sfor4.begin(),sfor4.end()) - sin.begin(), 18);
        BLEX_TEST_CHECKEQUAL(Blex::SearchUncontained(sin.begin(),sin.end(),sfor5.begin(),sfor5.end()) - sin.begin(), 21);
}
