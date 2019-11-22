#ifndef blex_utility
#define blex_utility

#ifndef blex_threads
#include "threads.h"
#endif

#include <functional>

namespace Blex
{

/** Ensure that a value is within a given range
    @param lowerbound Lower bound for return value
    @param upperbound Upper bound for return value
    @param checkedvalue Value to re-bound
    @return lowerbound if checkedvalue<lowerbound, upperbound if checkedvalue>upperbound, else checkedvalue */
template <class value_type> value_type Bound(value_type lowerbound,
                                             value_type upperbound,
                                             value_type checkedvalue)
{
        return std::max(std::min(checkedvalue,upperbound),lowerbound);
}

/** Binary search inside a range.
    Like the std::binary_search, but this returns an iterator to the found item
    @param first Begin of range
    @param last End of range
    @param value value to search for
    @return Iterator to the item equivalent to T, or last if item was not found */
template<class ForwardIterator, class T>
  ForwardIterator BinaryFind(ForwardIterator first, ForwardIterator last, const T& value)
{
        ForwardIterator i = std::lower_bound(first, last, value);
        if (i != last && !(value < *i))
            return i;
        else
            return last;
}

/** Binary search inside a range with user supplied comparison function.
    Like the std::binary_search, but this returns an iterator to the found item
    @param first Begin of range
    @param last End of range
    @param value value to search for
    @param comp Compare function
    @return Iterator to the item equivalent to T, or last if item was not found */
template<class ForwardIterator, class T, class Compare>
  ForwardIterator BinaryFind(ForwardIterator first, ForwardIterator last, const T& value, Compare comp)
{
        ForwardIterator i = std::lower_bound(first, last, value,comp);
        if (i != last && !comp(value, *i))
            return i;
        else
            return last;
}

/** Binary search inside a range to find the closest match.
    Like BinaryFind, but only returns last if the range is empty
    @param first Begin of range
    @param last End of range
    @param value value to search for
    @return Iterator to the item closest to T, or last if the range was emtpy */
template<class BidirectionalIterator, class T>
  BidirectionalIterator BinaryClosestFind(BidirectionalIterator first, BidirectionalIterator last, const T& value)
{
        if (first==last)
            return last;

        BidirectionalIterator i = std::lower_bound(first, last, value);
        if (i!=last && (i==first || ( *i - value) < (value - *(i-1)) ))
            return i;
        else
            return i-1;
}

/** Find the first value *not* equal to the specified value
    @param first Begin of range
    @param last End of range
    @param value value to skip */
template<class InputIterator, class T>
  InputIterator FindNot(InputIterator begin,InputIterator end,T const &value)
{
        return std::find_if(begin,end,std::bind(std::not_equal_to<T>(), value, std::placeholders::_1));
}

/** Find the range which certainly will not contain a searched range of characters,
    even if the range throws.
    Eg, searchuncontained 'abcd' in 'abcxabc' will return 'abcx', because the
    second 'abc' may be the start of the sequence we were looking for
    @param ForwardIterator Type of the iterators
    @param start_range Start of the range to search in
    @param limit_range Limit of the range to search in
    @param start_search Start of the data to search for
    @param limit_search Limit of the data to search for
    @return Limit of the 'search in' range that certainly will not contain the
            searched characters */
template <typename ForwardIterator1, typename ForwardIterator2>
  ForwardIterator1 SearchUncontained(ForwardIterator1 start_range, ForwardIterator1 limit_range,
                                              ForwardIterator2 start_search, ForwardIterator2 limit_search)

{
        if (start_search==limit_search)
            return start_range;

        //Look for matches.
        while (start_range != limit_range)
        {
                //The first character matches!
                if (*start_range == *start_search)
                {
                        //Do the remaining characters match, or will we fall
                        //of the end of the string before finding a match?
                        ForwardIterator1 current_scanner = start_range + 1;
                        ForwardIterator2 current_search_match = start_search + 1;

                        while (current_scanner != limit_range
                               && current_search_match != limit_search
                               && *current_scanner == *current_search_match)
                        {
                                ++current_scanner;
                                ++current_search_match;
                        }

                        if (current_scanner == limit_range
                            || current_search_match == limit_search)
                        {
                                /* We fell off the end. The safest range not
                                   containing the search string ends at start_range */
                                return start_range;
                        }
                        //We didn't find a real match, so continue searching
                }
                ++start_range;
        }

        return limit_range;
}

/** Get the extension for dynamic libraries on this system
    (includes extension dot, eg ".dll" or ".so") */
BLEXLIB_PUBLIC const char * GetDynamicLibExtension();

/** Load the specified library into memory. Libraries are reference counted,
    so multiple calls for the same library are permitted.
    @param path Absolute path to library
    @param error String that will receive the load error message, if any. NULL to not receive any error
    @return NULL if the library can't be found or loaded */
BLEXLIB_PUBLIC void* LoadDynamicLib(std::string const &path, std::string *errormessage);

/** Decrease the reference count for the specified library, and if it drops
    to zero, unload it
    @param library Library pointer, as retunred by LoadDynamicLib */
BLEXLIB_PUBLIC void ReleaseDynamicLib(void *library);

///Type for a function available in a DLL
extern "C"
{
typedef void (*DynamicFunction)(void);
}

//work around warning: ISO C++ forbids casting between pointer-to-function and pointer-to-object
template<class OutType, class InType> inline OutType FunctionPtrCast(InType indata)
{
      void *ptr = &indata;
      return *reinterpret_cast<OutType*>(ptr);
}

/** Look up a function in a dynamic library. It must have been declared as extern "C"
    @param library Library to look in
    @param funcname Function to look for
    @return The function, or NULL if the function was not found */
BLEXLIB_PUBLIC DynamicFunction FindDynamicFunction(void *library, char const *funcname);

/** The initial startup arguments */
std::vector<std::string> const & GetStartupArguments();

/** The (unique) process id of this process */
BLEXLIB_PUBLIC uint32_t GetProcessId();

///The path to the current executable
BLEXLIB_PUBLIC std::string GetExecutablePath();

/** Invoke the user's main function, recoding arguments to UTF-8 if necessary */
BLEXLIB_PUBLIC int InvokeMyMain(int _argc,
                         char *_argv[],
                         int (*utf8main)(std::vector<std::string> const &args));

typedef std::function< bool(int) > UserInterruptHandler;

/** Configure the process's SIGINT/SIGTERM/SIGHUP handler */
BLEXLIB_PUBLIC void SetInterruptHandler(UserInterruptHandler const &interrupthandler, bool allow_multiple_signals);

/** Remove the process's SIGINT/SIGTERM/SIGHUP handler */
inline void ResetInterruptHandler()
{
        UserInterruptHandler resetter;
        SetInterruptHandler(resetter, false);
}

/** Call interrupt handler if shutdown hasn't been initiated yet */
BLEXLIB_PUBLIC bool InitiateShutdownWithInterrupt();

/** Parse the current enviornmenvironment */
BLEXLIB_PUBLIC void ParseEnvironment(Blex::Process::Environment *destenv); //note: implemented in threads.cpp

/** Retrieve the number of ticks per second GetTickFrequency uses (this
    may not be the actual accuracy of the measurements) */
BLEXLIB_PUBLIC uint64_t GetSystemTickFrequency();

/** Get the number of ticks elapsed, with the highest possible accuracy */
BLEXLIB_PUBLIC uint64_t GetSystemCurrentTicks();

BLEXLIB_PUBLIC Blex::DateTime GetProcessStartTime();

/** Get a human-readable string describing this system
    (such as Linux bunny.b-lex.com) */
BLEXLIB_PUBLIC std::string GetSystemDescription();

/** Get the number of processors in the system */
BLEXLIB_PUBLIC unsigned GetSystemCPUs(bool physical_cpus_only);

/** A fasttimer allows to measure elapsed time ('wall clock') as accurate as
    the system permits, and is mainly intended for profiling uses. */
class BLEXLIB_PUBLIC FastTimer
{
        public:
        /** Initialize the timer, giving it a name that will be shown in Print()s.
            This call does not start the timer */
        FastTimer();
        ///Destroy the timer
        ~FastTimer();
        ///Start the clock
        void Start();
        ///Stop the clock
        void Stop();

        /** Get the total elapsed time
            @return elapsed time, in microseconds */
        uint64_t GetTotalTime() const;

        /** Get the timer overhead
            @return overhead time, in microseconds */
        uint64_t GetOverhead() const;

        private:
        ///Ticks when current measuring started
        uint64_t start;
        ///Total ticks spent
        uint64_t total;
        ///Ticks overhead per Start()/Stop() call
        uint64_t overhead;
        ///Number of recursive timers now running
        unsigned running;
        ///Number of measurements taken so far
        unsigned measurements;
};

/** A scoped fast timer will time the period between its construction and
    destruction, and can be useful to quickly time a section of code */
class BLEXLIB_PUBLIC ScopedFastTimer
{
        public:
        /** Start a scoped timer
            @param timername Name for this timer */
        ScopedFastTimer(std::string const &timername);

        /** Destroy a scoped timer and print its duration to std::clog */
        ~ScopedFastTimer();

        private:
        Blex::FastTimer timer;
        std::string timername;
};

/** Round a value up to a multiple of */
template <typename T> inline T RoundUpToMultipleOf(T val, T multiple)
{ return (((val + multiple-1) / multiple) * multiple); }

BLEXLIB_PUBLIC std::ostream& operator << (std::ostream &str, FastTimer const &timer);

BLEXLIB_PUBLIC std::size_t ReadConsoleBytes(void *buf, unsigned numbytes);
BLEXLIB_PUBLIC bool IsConsoleClosed();
BLEXLIB_PUBLIC bool IsConsoleATerminal();
BLEXLIB_PUBLIC std::pair< unsigned, unsigned > GetConsoleSize();
BLEXLIB_PUBLIC bool ReadConsoleLine(std::string *line);
BLEXLIB_PUBLIC bool GetConsoleLineBuffered();
BLEXLIB_PUBLIC void SetConsoleLineBuffered(bool newstate);
BLEXLIB_PUBLIC bool GetConsoleEcho();
BLEXLIB_PUBLIC void SetConsoleEcho(bool newstate);


} //end namespace Blex
#endif
