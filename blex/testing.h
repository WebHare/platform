#ifndef blex_testing
#define blex_testing

#ifndef blex_blexlib
#include "blexlib.h"
#endif

#include "path.h"
#include <iostream>
#include <sstream>
#include <stdexcept>

namespace Blex
{
class Stream;

/// A cppunit inspired test framework
namespace Test
{
BLEXLIB_PUBLIC bool ReportAllTests();

/// Equality compare template. We need this to avoid constant optimization warnings
template <class LhsType> inline bool CompareTrue(LhsType lhs)
{
        return lhs;
}

/// Equality compare template. We need this to avoid constant optimization warnings
template <class LhsType, class RhsType> std::string CompareEqual(LhsType lhs, RhsType rhs)
{
        std::ostringstream errormsg;                                                                                                            \
        if (lhs!=rhs)
        {
                errormsg << "expected " << lhs << ", got " << rhs;
                return errormsg.str();
        }
        return std::string();
}

//override signed, unsigned case to suppress warnings.
template <> inline std::string CompareEqual<int,unsigned>(int lhs, unsigned rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }
template <> inline std::string CompareEqual<unsigned,int>(unsigned lhs, int rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }

template <> inline std::string CompareEqual<long int,long unsigned>(long int lhs, long unsigned rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }
template <> inline std::string CompareEqual<long unsigned,long int>(long unsigned lhs, long int rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }

template <> inline std::string CompareEqual<short int,short unsigned>(short int lhs, short unsigned rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }
template <> inline std::string CompareEqual<short unsigned,short int>(short unsigned lhs, short int rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }

template <> inline std::string CompareEqual<char,unsigned char>(char lhs, unsigned char rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }
template <> inline std::string CompareEqual<unsigned char,unsigned char>(unsigned char lhs, unsigned char rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }
template <> inline std::string CompareEqual<char,char>(char lhs, char rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }
template <> inline std::string CompareEqual<unsigned char,char>(unsigned char lhs, char rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }
template <> inline std::string CompareEqual<unsigned char,unsigned int>(unsigned char lhs, unsigned int rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }
template <> inline std::string CompareEqual<unsigned int,unsigned char>(unsigned int lhs, unsigned char rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }
template <> inline std::string CompareEqual<int,unsigned long>(int lhs, unsigned long rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }
template <> inline std::string CompareEqual<unsigned long,int >(unsigned long lhs, int rhs)
{ return CompareEqual(static_cast<long unsigned>(lhs),static_cast<long unsigned>(rhs)); }

/// Class to instantiate a new test
class BLEXLIB_PUBLIC AddTest
{
        public:
        AddTest(const char *testname, void (*testfunction)());
};

/// Get a temp directory for test output
BLEXLIB_PUBLIC const char* GetTempDir();

/** Get a file from the prespecified test directory
    (throws if the file does not exist, caller has to destroy the file) */
BLEXLIB_PUBLIC Blex::FileStream* OpenTestFile(std::string const &name);

/** Get the path to a file from the prespecified test directory */
BLEXLIB_PUBLIC std::string GetTestFilePath(std::string const &name);

/// Set the directory for test file storage
BLEXLIB_PUBLIC void SetTestDataDir(std::string const &testdatadir);

/// Options to pass to the test suite
enum TestOptions
{
        ///Noisy test results
        TestNoisy=1,
        ///Report every run test results
        ReportEveryTest=2,
        ///Abort on failure
        AbortOnFail=4
};

/** Return the hash of a stream as an uppercase HEX string */
BLEXLIB_PUBLIC std::string MD5Stream(Blex::Stream &infile);

/// Set our test framework name
BLEXLIB_PUBLIC void SetTestName(const char *testername);

/** Request to run all tests
    @return true if all tests succeeded
*/
BLEXLIB_PUBLIC bool Run(unsigned options, std::string const &mask);

//Don't touch this unless you have to! A lot of #define fiddling to get the compiler to generate unique function names. Found no way to simplify it so far
#define GETLINENUMBER(x) x
#define UNIQUENAME(x,y) x##y
#define DO_BLEX_TEST_REGISTER(name,function,line) namespace { ::Blex::Test::AddTest UNIQUENAME(addtest_,line) (name,function); }
#define BLEX_TEST_FUNCTION(function) void function(); DO_BLEX_TEST_REGISTER(#function,function,GETLINENUMBER(__LINE__)) void function()

/// Exception class to throw when a test fails
class Failure : public std::logic_error
{
        public:
        Failure(std::string const &failure) : std::logic_error(failure)
        {
        }
};

#define BLEX_TEST_FAIL(message) throw ::Blex::Test::Failure(message)

#define BLEX_TEST_CHECK(condition) do {                                                                                                         \
try {                                                                                                                                           \
if (::Blex::Test::ReportAllTests())                                                                                                                          \
    std::cerr << "Test " << __FILE__ << ":" << __LINE__ << ":" << #condition << std::endl;                                                      \
if (!::Blex::Test::CompareTrue(condition))                                                                                                              \
    throw ::Blex::Test::Failure(__FILE__ ":" +Blex::AnyToString(__LINE__)+ ":Test assertion failed: " #condition);               \
} catch (::Blex::Test::Failure &) { throw;                                                                                                      \
} catch (std::exception &e) {                                                                                                                   \
    throw ::Blex::Test::Failure(__FILE__ ":" +Blex::AnyToString(__LINE__)+ ":Test assertion failed: exception " +e.what());      \
} catch (...) {                                                                                                                                 \
    throw ::Blex::Test::Failure(__FILE__ ":" +Blex::AnyToString(__LINE__)+ ":Test assertion failed: unexpected exception");      \
} } while (0)

#define BLEX_TEST_CHECKEQUAL(expected,actual) do {                                                                                              \
try {                                                                                                                                           \
if (::Blex::Test::ReportAllTests())                                                                                                             \
    std::cerr << "Test " << __FILE__ << ":" << __LINE__ << ":" << #expected << "=" << #actual << std::endl;                                     \
std::string blex_test_error = ::Blex::Test::CompareEqual(expected,actual);                                                                                \
if (!blex_test_error.empty()) {                                                                                                                           \
        std::ostringstream errormsg;                                                                                                            \
        errormsg << __FILE__ << ":" << __LINE__ << ":Test assertion failed: " << blex_test_error;                                                         \
        throw ::Blex::Test::Failure(errormsg.str());                                                                                            \
} } catch (::Blex::Test::Failure &) {                                                                                                           \
        throw;                                                                                                                                  \
} catch (std::exception &e) {                                                                                                                   \
        std::ostringstream errormsg;                                                                                                            \
        errormsg << __FILE__ << ":" << __LINE__ << ":Test assertion failed: expected " << (expected) << ", got exception: " << e.what();        \
        throw ::Blex::Test::Failure(errormsg.str());                                                                                            \
} catch (...) {                                                                                                                                 \
        std::ostringstream errormsg;                                                                                                            \
        errormsg << __FILE__ << ":" << __LINE__ << ":Test assertion failed: expected " << (expected) << ", got unexpected exception";           \
        throw ::Blex::Test::Failure(errormsg.str());                                                                                            \
} } while (0)

#define BLEX_TEST_CHECKTHROW(code,except)  do { bool did_throw=false; \
if (::Blex::Test::ReportAllTests())                                                                                                             \
    std::cerr << "Test " << __FILE__ << ":" << __LINE__ << ":" << #code << " throw " << #except << std::endl;                                                      \
try { code ;                                                              \
} catch (::Blex::Test::Failure &) { throw;                                                                                                      \
} catch (except& e) { did_throw=true;                                 \
} catch(std::exception &e) { throw ::Blex::Test::Failure(__FILE__ ":" +Blex::AnyToString(__LINE__)+ ":Test assertion failed: expected exception " #except ", got exception: " + e.what());  \
} catch(...) { throw ::Blex::Test::Failure(__FILE__ ":" +Blex::AnyToString(__LINE__)+ ":Test assertion failed: expected exception " #except ", got different exception");  \
}                                                                                                                                                                                       \
if (!did_throw) throw ::Blex::Test::Failure(__FILE__ ":" +Blex::AnyToString(__LINE__)+ ":Test assertion failed: expected exception " #except ", got NO exception");  \
} while (0)

} //end namespace Test

} //end namespace Blex

#endif //Sentry

