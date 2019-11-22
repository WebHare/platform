#ifndef blex_blexlib
#define blex_blexlib

#if defined(__linux)
 #define PLATFORM_LINUX
#elif defined(__APPLE__)
 #define PLATFORM_DARWIN
 #define _DARWIN_C_SOURCE
#endif

#ifndef _XOPEN_SOURCE
 #define _XOPEN_SOURCE 600
#endif

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <algorithm>
#include <string>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <functional>
#include <memory>
#include <unistd.h>
#include <sstream>


#define BLEX_NOOP_STATEMENT (void)0

#define LOGPRINT(x) do { ::Blex::ErrStream() << x ; } while (0)

#ifdef DEBUG
  #define DEBUGONLY(x) do { x; } while (0)
  #define DEBUGONLYARG(x) x
  #define DEBUGPRINT(x) LOGPRINT(x)
#else
  //Supply dummy DEBUG defines. gcc doesn't err on 0
  #define DEBUGONLY(x) BLEX_NOOP_STATEMENT
  #define DEBUGONLYARG(x)
  #define DEBUGPRINT(x) BLEX_NOOP_STATEMENT
#endif

/** A define to properly embed big 64-bit number constants in source code */
#define BIGS64NUM(x) (x##LL)
#define BIGU64NUM(x) (x##ULL)

/** Make stuff visibile in -fvisiblity=hidden (much like DLL export/import) */
#define BLEXLIB_PUBLIC __attribute__((visibility("default")))
#define BLEXLIB_LOCAL  __attribute__((visibility("hidden")))

#define FUNCTION_NORETURN __attribute__((noreturn))

using std::uint8_t;
using std::uint16_t;
using std::uint32_t;
using std::uint64_t;
using std::int8_t;
using std::int16_t;
using std::int32_t;
using std::int64_t;

namespace Blex
{
        namespace Types
        {
        typedef float F32;
        typedef double F64;
        }

using namespace Types;

/** This platform's preferred type for handles to files */
typedef int FileHandle;
/** This platform's preferred type for file offsets */
typedef uint64_t FileOffset;

/** Error stream, an auto-serializing debugging/error logging class */
class BLEXLIB_PUBLIC ErrStream
{
        private:
        static std::stringstream stamp;
        static std::stringstream store;

        public:
        ErrStream();
        ~ErrStream();

        template <class Data> std::ostream& operator<<(Data const &data)
        {
                return store << data;
        }

        /** Place timestamps before log entries? */
        static void SetTimestamping(bool enable);
        /** Place thread ids before log entries? */
        static void SetThreadIds(bool enable);
        static bool OpenLogFile(std::string const &filename);
        static void CloseLogFile();
};

std::ptrdiff_t inline PtrDiff(const void *begin, const void *limit)
{
        return reinterpret_cast<const uint8_t*>(limit)
               - reinterpret_cast<const uint8_t*>(begin);
}

/** @name Value from raw memory read/write functions
    @memo Platform and alignment-requirement independent functions
          for reading and writing long (16 byte or more) values from raw memory */
//@{

uint8_t inline getu8(const void *where) __attribute__((nonnull(1)));
int8_t inline gets8(const void *where) __attribute__((nonnull(1)));
uint16_t inline getu16msb(const void *where) __attribute__((nonnull(1)));
uint16_t getu16lsb(const void *where) __attribute__((nonnull(1)));
int16_t gets16msb(const void *where) __attribute__((nonnull(1)));
int16_t gets16lsb(const void *where) __attribute__((nonnull(1)));
uint32_t getu32msb(const void *where) __attribute__((nonnull(1)));
uint32_t getu32lsb(const void *where) __attribute__((nonnull(1)));
int32_t gets32msb(const void *where) __attribute__((nonnull(1)));
int32_t gets32lsb(const void *where) __attribute__((nonnull(1)));
uint64_t getu64msb(const void *where) __attribute__((nonnull(1)));
uint64_t getu64lsb(const void *where) __attribute__((nonnull(1)));
int64_t gets64msb(const void *where) __attribute__((nonnull(1)));
int64_t gets64lsb(const void *where) __attribute__((nonnull(1)));
void putu8(void *where, uint8_t what) __attribute__((nonnull(1)));
void putu16lsb(void *where,uint16_t what) __attribute__((nonnull(1)));
void putu16msb(void *where,uint16_t what) __attribute__((nonnull(1)));
void puts8(void *where,int8_t what) __attribute__((nonnull(1)));
void puts16lsb(void *where,int16_t what) __attribute__((nonnull(1)));
void puts16msb(void *where,int16_t what) __attribute__((nonnull(1)));
void putu32lsb(void *where,uint32_t what) __attribute__((nonnull(1)));
void putu32msb(void *where,uint32_t what) __attribute__((nonnull(1)));
void puts32lsb(void *where,int32_t what) __attribute__((nonnull(1)));
void puts32msb(void *where,int32_t what) __attribute__((nonnull(1)));
void putu64lsb(void *where,uint64_t what) __attribute__((nonnull(1)));
void putu64msb(void *where,uint64_t what) __attribute__((nonnull(1)));
void puts64lsb(void *where,int64_t what) __attribute__((nonnull(1)));
void puts64msb(void *where,int64_t what) __attribute__((nonnull(1)));
F32 getf32msb(const void *where) __attribute__((nonnull(1)));
F64 getf64msb(const void *where) __attribute__((nonnull(1)));
void putf32msb(void *where,F32 what) __attribute__((nonnull(1)));
void putf64msb(void *where,F64 what) __attribute__((nonnull(1)));
F32 getf32lsb(const void *where) __attribute__((nonnull(1)));
F64 getf64lsb(const void *where) __attribute__((nonnull(1)));
void putf32lsb(void *where,F32 what) __attribute__((nonnull(1)));
void putf64lsb(void *where,F64 what) __attribute__((nonnull(1)));
template <typename GetType> GetType __attribute__((nonnull(1))) GetLsb(const void *where);
template <typename GetType> GetType __attribute__((nonnull(1))) GetMsb(const void *where);
template <typename PutType> void __attribute__((nonnull(1))) PutLsb(void *where, PutType const &data);
template <typename PutType> void __attribute__((nonnull(1))) PutMsb(void *where, PutType const &data);

/** Get an unsigned 8-bit word from a location */
uint8_t inline getu8(const void *where)
{
        return *static_cast<uint8_t const*>(where);
}
/** Get an signed 8-bit word from a location */
int8_t inline gets8(const void *where)
{
        return static_cast<int8_t>(getu8(where));
}

/** Get an unsigned 16-bit word from a MSB-ordered (Motorola, SUN) location */
uint16_t inline getu16msb(const void *where)
{
        return static_cast<uint16_t>( (getu8(where)<<8) | (getu8(static_cast<uint8_t const*>(where)+1)) );
}
/** Get an unsigned 16-bit word from a LSB-ordered (Intel, Alpha) location */
uint16_t inline getu16lsb(const void *where)
{
        return *static_cast<const uint16_t*>(where);
}
/** Get a signed 16-bit word from a MSB-ordered (Motorola, SUN) location */
int16_t inline gets16msb(const void *where)
{
        return static_cast<int16_t>(getu16msb(where));
}
/** Get an signed 16-bit word from a LSB-ordered (Intel, Alpha) location */
int16_t inline gets16lsb(const void *where)
{
        return static_cast<int16_t>(getu16lsb(where));
}
/** Get an unsigned 32-bit word from a MSB-ordered (Motorola, SUN) location */
uint32_t inline getu32msb(const void *where)
{
        return static_cast<uint32_t>( (getu8(where)<<24)
                                 | (getu8(static_cast<uint8_t const*>(where)+1)<<16)
                                 | (getu8(static_cast<uint8_t const*>(where)+2)<<8)
                                 | (getu8(static_cast<uint8_t const*>(where)+3))     );
}
/** Get an unsigned 32-bit word from a LSB-ordered (Intel, Alpha) location */
uint32_t inline getu32lsb(const void *where)
{
        return *static_cast<const uint32_t*>(where);
}
/** Get a signed 32-bit word from a MSB-ordered (Motorola, SUN) location */
int32_t inline gets32msb(const void *where)
{
        return static_cast<int32_t>(getu32msb(where));
}
/** Get an signed 32-bit word from a LSB-ordered (Intel, Alpha) location */
int32_t inline gets32lsb(const void *where)
{
        return static_cast<int32_t>(getu32lsb(where));
}

/** Get an unsigned 64-bit word from a MSB-ordered (Motorola, SUN) location */
uint64_t inline getu64msb(const void *where)
{
        return (static_cast<uint64_t>(getu32msb(where)) << 32)
               |  (static_cast<uint64_t>(getu32msb(static_cast<uint8_t const*>(where)+4)));
}

/** Get an unsigned 64-bit word from a LSB-ordered (Intel, Alpha) location */
uint64_t inline getu64lsb(const void *where)
{
        return *static_cast<const uint64_t*>(where);
}
/** Get a signed 64-bit word from a MSB-ordered (Motorola, SUN) location */
int64_t inline gets64msb(const void *where)
{
        return static_cast<int64_t>(getu64msb(where));
}
/** Get an signed 64-bit word from a LSB-ordered (Intel, Alpha) location */
int64_t inline gets64lsb(const void *where)
{
        return static_cast<int64_t>(getu64lsb(where));
}

/** Write an unsigned 8-bit word to a location */
void inline putu8(void *where, uint8_t what)
{
        *static_cast<uint8_t*>(where)=what;
}
/** Write an unsigned 16-bit word to a LSB-ordered (Intel, Alpha) location */
void inline putu16lsb(void *where,uint16_t what)
{
        *static_cast<uint16_t*>(where)=what;
}
/** Write an unsigned 16-bit word to a MSB-ordered (Motorola, SUN) location */
void inline putu16msb(void *where,uint16_t what)
{
        static_cast<uint8_t *>(where)[0]=static_cast<uint8_t>((what>> 8)&0xff);
        static_cast<uint8_t *>(where)[1]=static_cast<uint8_t>((what>> 0)&0xff);
}
/** Write a signed 8-bit word to a location */
void inline puts8(void *where,int8_t what)
{
        putu8(where,uint8_t(what));
}
/** Write a signed 16-bit word to a LSB-ordered (Intel, Alpha) location */
void inline puts16lsb(void *where,int16_t what)
{
        putu16lsb(where,uint16_t(what));
}
/** Write an signed 16-bit word to a MSB-ordered (Motorola, SUN) location */
void inline puts16msb(void *where,int16_t what)
{
        putu16msb(where,uint16_t(what));
}
/** Write an unsigned 32-bit word to a LSB-ordered (Intel, Alpha) location */
void inline putu32lsb(void *where,uint32_t what)
{
        *static_cast<uint32_t*>(where)=what;
}
/** Write an unsigned 32-bit word to a MSB-ordered (Motorola, SUN) location */
void inline putu32msb(void *where,uint32_t what)
{
        static_cast<uint8_t *>(where)[0]=static_cast<uint8_t>((what>>24)&0xff);
        static_cast<uint8_t *>(where)[1]=static_cast<uint8_t>((what>>16)&0xff);
        static_cast<uint8_t *>(where)[2]=static_cast<uint8_t>((what>> 8)&0xff);
        static_cast<uint8_t *>(where)[3]=static_cast<uint8_t>((what>> 0)&0xff);
}
/** Write an signed 32-bit word to a LSB-ordered (Intel, Alpha) location */
void inline puts32lsb(void *where,int32_t what)
{
        putu32lsb(where,uint32_t(what));
}
/** Write a signed 32-bit word to a MSB-ordered (Motorola, SUN) location */
void inline puts32msb(void *where,int32_t what)
{
        putu32msb(where,uint32_t(what));
}
/** Write an unsigned 64-bit word to a LSB-ordered (Intel, Alpha) location */
void inline putu64lsb(void *where,uint64_t what)
{
        *static_cast<uint64_t*>(where)=what;
}
/** Write an unsigned 64-bit word to a MSB-ordered (Motorola, SUN) location */
void inline putu64msb(void *where,uint64_t what)
{
        putu32msb(where,  static_cast<uint32_t>(what>>32));
        putu32msb(static_cast<uint8_t *>(where)+4,static_cast<uint32_t>(what&0xFFFFFFFFL));
}
/** Write an signed 64-bit word to a LSB-ordered (Intel, Alpha) location */
void inline puts64lsb(void *where,int64_t what)
{
        putu64lsb(where,uint64_t(what));
}
/** Write a signed 64-bit word to a MSB-ordered (Motorola, SUN) location */
void inline puts64msb(void *where,int64_t what)
{
        putu64msb(where,uint64_t(what));
}

/** Get an unsigned 32-bit word from a MSB-ordered (Motorola,SUN) location */
F32 inline getf32msb(const void *where)
{
        F32 return_value;
        uint8_t *raw_ptr = static_cast<uint8_t*>(static_cast<void*>(&return_value));
        putu32msb(raw_ptr, getu32lsb(where));
        return return_value;
}

/** Get an unsigned 64-bit word from a MSB-ordered (Motorola,SUN) location */
F64 inline getf64msb(const void *where)
{
        F64 return_value;
        uint8_t *raw_ptr = static_cast<uint8_t*>(static_cast<void*>(&return_value));
        putu32msb(raw_ptr+4, getu32lsb(where));
        putu32msb(raw_ptr, getu32lsb(static_cast<const uint8_t*>(where)+4));
        return return_value;
}

/** Write an 32-bit float in ieee format to a MSB-ordered (Motorola, SUN) location */
void inline putf32msb(void *where,F32 what)
{
        const uint8_t *raw_ptr = static_cast<const uint8_t*>(static_cast<const void*>(&what));
        putu32lsb(where, getu32msb(raw_ptr));
}

/** Write an 64-bit float in ieee format to a MSB-ordered (Motorola, SUN) location */
void inline putf64msb(void *where,F64 what)
{
        const uint8_t *raw_ptr = static_cast<const uint8_t*>(static_cast<const void*>(&what));
        putu32lsb(where, getu32msb(raw_ptr+4));
        putu32lsb(static_cast<uint8_t*>(where)+4, getu32msb(raw_ptr));
}

/** Get an unsigned 32-bit word from a LSB-ordered (Intel, Alpha) location */
F32 inline getf32lsb(const void *where)
{
        return *static_cast<const F32*>(where);
}

/** Get an unsigned 64-bit word from a LSB-ordered (Intel, Alpha) location */
F64 inline getf64lsb(const void *where)
{
        return *static_cast<const F64*>(where);
}

/** Write an 32-bit float in ieee format to a LSB-ordered (Intel) location */
void inline putf32lsb(void *where,F32 what)
{
        *static_cast<F32*>(where)=what;
}

/** Write an 64-bit float in ieee format to a LSB-ordered (Intel) location */
void inline putf64lsb(void *where,F64 what)
{
        *static_cast<F64*>(where)=what;
}

/** Generalized template to get data from a LSB-ordered location */
template <typename GetType> __attribute__((nonnull(1))) GetType GetLsb(const void *where);
template <> inline uint8_t  __attribute__((nonnull(1))) GetLsb<uint8_t>  (const void *where) { return getu8(where); }
template <> inline int8_t  __attribute__((nonnull(1))) GetLsb<int8_t>  (const void *where)   { return gets8(where); }
template <> inline uint16_t __attribute__((nonnull(1))) GetLsb<uint16_t> (const void *where)   { return getu16lsb(where); }
template <> inline int16_t __attribute__((nonnull(1))) GetLsb<int16_t> (const void *where)   { return gets16lsb(where); }
template <> inline uint32_t __attribute__((nonnull(1))) GetLsb<uint32_t> (const void *where)   { return getu32lsb(where); }
template <> inline int32_t __attribute__((nonnull(1))) GetLsb<int32_t> (const void *where)   { return gets32lsb(where); }
template <> inline uint64_t __attribute__((nonnull(1))) GetLsb<uint64_t> (const void *where)   { return getu64lsb(where); }
template <> inline int64_t __attribute__((nonnull(1))) GetLsb<int64_t> (const void *where)   { return gets64lsb(where); }
template <> inline F64 __attribute__((nonnull(1))) GetLsb<F64> (const void *where)   { return getf64lsb(where); }

/** Generalized template to get data from a MSB-ordered location */
template <typename GetType> GetType __attribute__((nonnull(1))) GetMsb(const void *where);
template <> inline uint8_t  __attribute__((nonnull(1))) GetMsb<uint8_t>  (const void *where) __attribute__((nonnull(1)));
template <> inline int8_t  __attribute__((nonnull(1))) GetMsb<int8_t>  (const void *where) __attribute__((nonnull(1)));
template <> inline uint16_t __attribute__((nonnull(1))) GetMsb<uint16_t> (const void *where) __attribute__((nonnull(1)));
template <> inline int16_t __attribute__((nonnull(1))) GetMsb<int16_t> (const void *where) __attribute__((nonnull(1)));
template <> inline uint32_t __attribute__((nonnull(1))) GetMsb<uint32_t> (const void *where) __attribute__((nonnull(1)));
template <> inline int32_t __attribute__((nonnull(1))) GetMsb<int32_t> (const void *where) __attribute__((nonnull(1)));
template <> inline uint64_t __attribute__((nonnull(1))) GetMsb<uint64_t> (const void *where) __attribute__((nonnull(1)));
template <> inline int64_t __attribute__((nonnull(1))) GetMsb<int64_t> (const void *where) __attribute__((nonnull(1)));
template <> inline F64 GetMsb<F64> (const void *where) __attribute__((nonnull(1)));
template <> inline uint8_t  __attribute__((nonnull(1))) GetMsb<uint8_t>  (const void *where)   { return getu8(where); }
template <> inline int8_t  __attribute__((nonnull(1))) GetMsb<int8_t>  (const void *where)   { return gets8(where); }
template <> inline uint16_t __attribute__((nonnull(1))) GetMsb<uint16_t> (const void *where)   { return getu16msb(where); }
template <> inline int16_t __attribute__((nonnull(1))) GetMsb<int16_t> (const void *where)   { return gets16msb(where); }
template <> inline uint32_t __attribute__((nonnull(1))) GetMsb<uint32_t> (const void *where)   { return getu32msb(where); }
template <> inline int32_t __attribute__((nonnull(1))) GetMsb<int32_t> (const void *where)   { return gets32msb(where); }
template <> inline uint64_t __attribute__((nonnull(1))) GetMsb<uint64_t> (const void *where)   { return getu64msb(where); }
template <> inline int64_t __attribute__((nonnull(1))) GetMsb<int64_t> (const void *where)   { return gets64msb(where); }
template <> inline F64 __attribute__((nonnull(1))) GetMsb<F64> (const void *where)   { return getf64msb(where); }

/** Generalized template to store data to a LSB-ordered location */
template <typename PutType> void __attribute__((nonnull(1))) PutLsb(void *where, PutType const &data);
template <> inline void __attribute__((nonnull(1))) PutLsb<uint8_t>  (void *where, uint8_t const &data)    { putu8(where,data); }
template <> inline void __attribute__((nonnull(1))) PutLsb<int8_t>  (void *where, int8_t const &data)    { puts8(where,data); }
template <> inline void __attribute__((nonnull(1))) PutLsb<uint16_t> (void *where, uint16_t const &data)   { putu16lsb(where,data); }
template <> inline void __attribute__((nonnull(1))) PutLsb<int16_t> (void *where, int16_t const &data)   { puts16lsb(where,data); }
template <> inline void __attribute__((nonnull(1))) PutLsb<uint32_t> (void *where, uint32_t const &data)   { putu32lsb(where,data); }
template <> inline void __attribute__((nonnull(1))) PutLsb<int32_t> (void *where, int32_t const &data)   { puts32lsb(where,data); }
template <> inline void __attribute__((nonnull(1))) PutLsb<uint64_t> (void *where, uint64_t const &data)   { putu64lsb(where,data); }
template <> inline void __attribute__((nonnull(1))) PutLsb<int64_t> (void *where, int64_t const &data)   { puts64lsb(where,data); }
template <> inline void __attribute__((nonnull(1))) PutLsb<F64> (void *where, F64 const &data)   { putf64lsb(where,data); }

/** Generalized template to store data to a MSB-ordered location */
template <typename PutType> void __attribute__((nonnull(1))) PutMsb(void *where, PutType const &data);
template <> inline void __attribute__((nonnull(1))) PutMsb<uint8_t>  (void *where, uint8_t const &data)    { putu8(where,data); }
template <> inline void __attribute__((nonnull(1))) PutMsb<int8_t>  (void *where, int8_t const &data)    { puts8(where,data); }
template <> inline void __attribute__((nonnull(1))) PutMsb<uint16_t> (void *where, uint16_t const &data)   { putu16msb(where,data); }
template <> inline void __attribute__((nonnull(1))) PutMsb<int16_t> (void *where, int16_t const &data)   { puts16msb(where,data); }
template <> inline void __attribute__((nonnull(1))) PutMsb<uint32_t> (void *where, uint32_t const &data)   { putu32msb(where,data); }
template <> inline void __attribute__((nonnull(1))) PutMsb<int32_t> (void *where, int32_t const &data)   { puts32msb(where,data); }
template <> inline void __attribute__((nonnull(1))) PutMsb<uint64_t> (void *where, uint64_t const &data)   { putu64msb(where,data); }
template <> inline void __attribute__((nonnull(1))) PutMsb<int64_t> (void *where, int64_t const &data)   { puts64msb(where,data); }
template <> inline void __attribute__((nonnull(1))) PutMsb<F64> (void *where, F64 const &data)   { putf64msb(where,data); }

/** Attempt to invoke a debugger, if it is available. Either way,
    abort the current program */
BLEXLIB_PUBLIC void FatalAbort() FUNCTION_NORETURN;
/** Safely print an error to stderr. This function does a direct system call
    and cannot run into user-mode deadlock problems (is async signal safe)*/
BLEXLIB_PUBLIC void SafeErrorPrint(const char *errormessage)  __attribute__((nonnull(1)));

//@}

//stringmanip.h - EVERYBODY needs it, so just include it ourselves

/** String pair structure, holds an input begin and end operator for string.
    Some functions which require high speed string passing, and transparent
    handling of C-String, Blex-Strings and STL-strings, require this.

    A string pair only holds the reference, not the actual data, so often
    restrictions will apply as to how long a string pair's contents are
    valid. */
struct StringPair
{
        typedef const char value_type;
        typedef value_type *const_iterator;
        typedef value_type *iterator;

        /** Construct an unassigned stringpair */
        StringPair() = default;

        /** Construct string_pair from a specified range */
        template <class Iterator> StringPair(Iterator _begin, Iterator _end)
        : begin(&*_begin), end(&*_end) { }

        /** Construct an empty stringpair */
        static inline StringPair ConstructEmpty()
        {
                return StringPair(static_cast< iterator >(0), static_cast< iterator >(0));
        }

        /** Construct a stringpair from a nul-terminated constant string */
        static inline StringPair FromStringConstant(const char *str) { return StringPair(str, str + std::strlen(str)); }

        /** Convert string_pair to string */
        std::string stl_str() const
        {
                if (begin==end)
                    return std::string();
                else
                    return std::string(begin,end);
        }

        /** Get the length of the string */
        std::size_t size() const
        { return end-begin; }

        /** Returns whether a string is empty (size() == 0) */
        bool empty() const { return begin == end; }

        /** Start iterator */
        const_iterator begin;

        /** (Past the) end iterator */
        const_iterator end;
};

inline bool operator==(Blex::StringPair const &lhs, Blex::StringPair const &rhs)
{ return lhs.size()==rhs.size() && std::equal(lhs.begin, lhs.end, rhs.begin); }
inline bool operator==(Blex::StringPair const &lhs, std::string const &rhs)
{ return lhs.size()==rhs.size() && std::equal(lhs.begin, lhs.end, &rhs[0]); }
inline bool operator==(std::string const &lhs, Blex::StringPair const &rhs)
{ return rhs==lhs; }

BLEXLIB_PUBLIC std::ostream& operator <<(std::ostream &out, Blex::StringPair const &rhs);

/** Less<> compare function for case-insensitive characters comparison
    @parma charT char type to compare
    @param lhs character that is expected to be 'less'
    @param rhs character that is expected to be 'more'
    @return true if lhs < rhs */
template <class charT> bool CharCaseLess(charT lhs, charT rhs);

/** Equal<> compare function for case-insensitive characters comparison
    @parma charT char type to compare
    @param lhs character that is expected to be 'equal'
    @param rhs character that is expected to be 'equal'
    @return true if lhs = rhs */
template <class charT> bool CharCaseLess(charT lhs, charT rhs);

/** Range pattern matching */
template <class Iterator>
  bool StringGlob(Iterator mask_begin,Iterator mask_end,Iterator check_begin,Iterator check_end,bool case_insensitive);

/** Case insensitive string compare */
template <class Itr> int StrCaseCompare(Itr lhs_begin, Itr lhs_end, Itr rhs_begin, Itr rhs_end);

/** Case insensitive memory compare */
inline int MemCaseCompare(const void *lhs_begin, const void *rhs_begin, std::size_t length);

/** Case insensitive C string compare */
inline int CStrCaseCompare(const char* lhs_str, const char* rhs_str);

/** Case insensitive string compare, with range limitations */
template <class Itr> int StrCaseCompare(Itr lhs_begin, Itr lhs_end,Itr rhs_begin, Itr rhs_end,std::size_t maxsize);

/** Case insensitive string compare, with range limitations */
inline int CStrCaseCompare(const char* lhs_str, const char *rhs_str, std::size_t maxsize);

/** Case insensitive string glob pattern matching */
template <class Itr> bool StrCaseLike(Itr lhs_begin, Itr lhs_end, Itr rhs_begin, Itr rhs_end);

/** Case sensitive string compare */
template <class Itr> int StrCompare(Itr lhs_begin, Itr lhs_end,Itr rhs_begin, Itr rhs_end);

/** Case sensitive C string compare */
inline int CStrCompare(const char* lhs_str, const char* rhs_str);

/** Case sensitive string compare, with range limitations */
template <class Itr> int StrCompare(Itr lhs_begin, Itr lhs_end,Itr rhs_begin, Itr rhs_end,std::size_t maxsize);

/** Case sensitive C string compare, with range limitations */
inline int CStrCompare(const char* lhs_str, const char *rhs_str, std::size_t maxsize);

/** Case sensitive string glob pattern matching */
template <class Itr> bool StrLike(Itr lhs_begin, Itr lhs_end,Itr rhs_begin, Itr rhs_end)
  { return StringGlob(rhs_begin, rhs_end, lhs_begin, lhs_end, true); }

/** Returns if string starts with a prefix */
inline bool StrStartsWith(std::string const &str, const char *prefix)
  { std::size_t len = strlen(prefix); return str.size() >= len && std::equal(str.begin(), str.begin() + len, prefix); }

/** Case-sensitive less operator for strings, supporting std::pairs and Blex::StringPair strings*/
template <class stringT> class StrLess;
/** Case-insensitive less operator for strings, supporting std::pairs and Blex::StringPair strings */
template <class stringT> class StrCaseLess;

/** BASE16 uppercase encode
    @param begin Input iterator pointing to start of range to encode
    @param end Input iterator pointing to limit of range to encode
    @param output output iterator receiving encoded data */
template <class InputIterator, class OutputIterator> OutputIterator EncodeBase16(InputIterator begin,InputIterator end, OutputIterator output);

/** BASE16 lowercase encode
    @param begin Input iterator pointing to start of range to encode
    @param end Input iterator pointing to limit of range to encode
    @param output output iterator receiving encoded data */
template <class InputIterator, class OutputIterator> OutputIterator EncodeBase16_LC(InputIterator begin,InputIterator end, OutputIterator output);

/** BASE64 encode
    @param begin Input iterator pointing to start of range to encode
    @param end Input iterator pointing to limit of range to encode
    @param output output iterator receiving encoded data */
template <class InputIterator, class OutputIterator> OutputIterator EncodeBase64(InputIterator begin,InputIterator end, OutputIterator output);

/** UFS encode
    @param begin Input iterator pointing to start of range to encode
    @param end Input iterator pointing to limit of range to encode
    @param output output iterator receiving encoded data */
template <class InputIterator, class OutputIterator> OutputIterator EncodeUFS(InputIterator begin,InputIterator end, OutputIterator output);

/** VALUE encode
    @param begin Input iterator pointing to start of range to encode
    @param end Input iterator pointing to limit of range to encode
    @param output output iterator receiving encoded data */
template <class InputIterator, class OutputIterator> OutputIterator EncodeValue(InputIterator begin,InputIterator end, OutputIterator output);

/** URL encode
    @param begin Input iterator pointing to start of range to encode
    @param end Input iterator pointing to limit of range to encode
    @param output output iterator receiving encoded data */
template <class InputIterator, class OutputIterator> OutputIterator EncodeUrl(InputIterator begin,InputIterator end, OutputIterator output);

/** JAVA encode
    @param begin Input iterator pointing to start of range to encode
    @param end Input iterator pointing to limit of range to encode
    @param output output iterator receiving encoded data */
template <class InputIterator, class OutputIterator> OutputIterator EncodeJava(InputIterator begin,InputIterator end, OutputIterator output);

/** HTML encode
    @param begin Input iterator pointing to start of range to encode
    @param end Input iterator pointing to limit of range to encode
    @param output output iterator receiving encoded data */
template <class InputIterator, class OutputIterator> OutputIterator EncodeHtml(InputIterator begin,InputIterator end, OutputIterator output);


/** BASE16 decode
    @param begin Input iterator pointing to start of range to decode
    @param end Input iterator pointing to limit of range to decode
    @param output output iterator receiving decoded data */
template <class InputIterator, class OutputIterator> OutputIterator DecodeBase16(InputIterator begin,InputIterator end, OutputIterator output);

/** BASE64 decode
    @param begin Input iterator pointing to start of range to decode
    @param end Input iterator pointing to limit of range to decode
    @param output output iterator receiving decoded data */
template <class InputIterator, class OutputIterator> OutputIterator DecodeBase64(InputIterator begin,InputIterator end, OutputIterator output);

/** UFS decode
    @param begin Input iterator pointing to start of range to decode
    @param end Input iterator pointing to limit of range to decode
    @param output output iterator receiving decoded data */
template <class InputIterator, class OutputIterator> OutputIterator DecodeUFS(InputIterator begin,InputIterator end, OutputIterator output);


/** URL decode
    @param begin Input iterator pointing to start of range to decode
    @param end Input iterator pointing to limit of range to decode
    @param output output iterator receiving decoded data */
template <class InputIterator, class OutputIterator> OutputIterator DecodeUrl(InputIterator begin,InputIterator end, OutputIterator output);

/** JAVA decode
    @param begin Input iterator pointing to start of range to decode
    @param end Input iterator pointing to limit of range to decode
    @param output output iterator receiving decoded data */
template <class InputIterator, class OutputIterator> OutputIterator DecodeJava(InputIterator begin,InputIterator end, OutputIterator output);

/** Encode a number to any radix 2-36 (decimal, binary, hexadecimal etc) format
    @param num Number to convert
    @param radix Radix for conversion (2 to 36)
    @param output Output that receives the encoded number
    @return New output iteration position */
template <typename NumberType, class OutputIterator>
  OutputIterator EncodeNumber(NumberType num, unsigned radix, OutputIterator output);

/** Encode a number to roman
    @param num Number to convert
    @param uppercase True to use uppercase roman (XIV vs xiv)
    @param output Output that receives the encoded number
    @return New output iteration position */

template <typename NumberType, class OutputIterator>
  OutputIterator EncodeNumberRoman(NumberType num, bool uppercase, OutputIterator output);

/** Encode a number to alphabetic characters (1=A, 2=B, 26=Z, 27=AA, 28=BB, etc)
    @param num Number to convert
    @param uppercase True to use uppercase characters
    @param output Output that receives the encoded number
    @return New output iteration position */
template <typename NumberType, class OutputIterator>
  OutputIterator EncodeNumberAlpha(NumberType num, bool uppercase, OutputIterator output);

/** Decode an unsigned number in a string, consisting of arabic digits
    @param NumberType Requested storage type for the number
    @param InputIterator Input iterator type
    @param begin Begin of data to parse the number from
    @param end End of data to parse the number from
    @return A pair, where first is the parsed number, and second is the iterator
            where parsing stopped - if the return iterator==end, then the number
            was valid, otherwise the returned iterator points to the first invalid
            character. */
template <typename NumberType, class InputIterator>
  std::pair<NumberType,InputIterator> DecodeUnsignedNumber(InputIterator begin, InputIterator end, unsigned radix=10);

template <typename NumberType>
  inline NumberType DecodeUnsignedNumber(std::string const &in, unsigned radix=10)
{
        return DecodeUnsignedNumber<NumberType>(in.begin(), in.end(), radix).first;
}

/** Decode a signed number in a string, consisting of arabic digits
    @param NumberType Requested storage type for the number
    @param InputIterator Input iterator type
    @param begin Begin of data to parse the number from
    @param end End of data to parse the number from
    @return A pair, where first is the parsed number, and second is the iterator
            where parsing stopped - if the return iterator==end, then the number
            was valid, otherwise the returned iterator points to the first invalid
            character. */
template <typename NumberType, class InputIterator>
  std::pair<NumberType,InputIterator> DecodeSignedNumber(InputIterator begin, InputIterator end, unsigned radix=10);

template <typename NumberType>
  inline NumberType DecodeSignedNumber(std::string const &in, unsigned radix=10)
{
        return DecodeSignedNumber<NumberType>(in.begin(), in.end(), radix).first;
}

/** Is the character in the range A-Z or a-z? ASCII-only versions of isalpha */
template <typename CharType> inline bool IsAlpha(CharType ch) { ch|=0x20; return ch>='a' && ch<='z'; }
/** Is the character a digit? ASCII-only versions of isdigit */
template <typename CharType> inline bool IsDigit(CharType ch) { return ch>='0' && ch<='9'; }
/** Is the character in the range A-Z, a-z or 0-9? ASCII-only versions of isalnum*/
template <typename CharType> inline bool IsAlNum(CharType ch) { return IsDigit(ch) || IsAlpha(ch); }
/** Is the character in the ASCII character set? */
template <typename CharType> inline bool IsAscii(CharType ch) { return ch>=0 && ch<=127; }
/** Is the character whitespace? */
template <typename CharType> inline bool IsWhitespace(CharType ch) { return ch==' ' || ch=='\n' || ch=='\r' || ch=='\t'; }
/** Is the character in the range A-Z? ASCII-only versions of isupper*/
template <typename CharType> inline bool IsUpper(CharType ch) { return ch>='A' && ch<='Z'; }
/** Is the character in the range a-z? ASCII-only versions of islower */
template <typename CharType> inline bool IsLower(CharType ch) { return ch>='a' && ch<='z'; }
/** Convert the character to uppercase */
template <typename CharType> inline CharType ToUpper(CharType ch) { return ch>='a'&&ch<='z' ? (CharType)(ch^0x20) : ch; }
/** Convert the character to lowercase */
template <typename CharType> inline CharType ToLower(CharType ch) { return ch>='A'&&ch<='Z' ? (CharType)(ch^0x20) : ch; }

/** Convert all ASCII lowercase characters in the string to uppercase */
template <typename Itr>
  void ToUppercase(Itr begin, Itr end)
{
        for (;begin != end;++begin)
        {
                if (IsLower(*begin))
                    *begin &= 0xDF;
        }
}

/** See if a string does not contain any lowercase ASCII characters */
template <typename Itr>
  bool IsUppercase(Itr begin, Itr end)
{
        for (;begin != end;++begin)
          if (IsLower(*begin))
            return false;

        return true;
}

/** Convert all ASCII uppercase characters in the string to lowercase */
template <typename Itr>
  void ToLowercase(Itr begin, Itr end)
{
        for (;begin != end;++begin)
        {
                if (IsUpper (*begin))
                    *begin |= 0x20;
        }
}

/** See if a string does not contain any uppercase ASCII characters */
template <typename Itr>
  bool IsLowercase(Itr begin, Itr end)
{
        for (;begin != end;++begin)
          if (IsUpper(*begin))
            return false;

        return true;
}

/** Tokenize the specified text range and push_back it into the TokenContainer */
template <class TokenItr, class TokenSeparatorType, class TokenContainer>
  void Tokenize(TokenItr begin, TokenItr end, TokenSeparatorType const &separator, TokenContainer *container);

/** Tokenize the specified string and push_back it into the TokenContainer */
template <class TokenContainer>
  inline void TokenizeString(std::string const &str, char separator, TokenContainer *container)
{
        Tokenize(str.begin(),str.end(),separator,container);
}

/** Append any type to string */
template <typename T> void AppendAnyToString(T const &in, std::string *appended_string);
/** Convert any type to string */
template <typename T> std::string AnyToString(T const &in);

//overloaded versions for std::string
inline void ToUppercase(std::string &data) { ToUppercase(data.begin(), data.end()); }
inline void ToLowercase(std::string &data) { ToLowercase(data.begin(), data.end()); }
inline bool IsUppercase(std::string const &data) { return IsUppercase(data.begin(), data.end()); }
inline bool IsLowercase(std::string const &data) { return IsLowercase(data.begin(), data.end()); }

// Levenshtein distance between two strings
BLEXLIB_PUBLIC int LevenshteinDistance(std::string const &source, std::string const &target);

} //end namespace Blex

//compile the implementations
#include "detail/stringmanip.cc"

using Blex::Types::F32;
using Blex::Types::F64;

#if defined(USE_VALGRIND)
#include <valgrind/memcheck.h>
#define VALGRIND_ONLY(x) x
#else
#define VALGRIND_ONLY(x) void(0)
#define VALGRIND_MAKE_MEM_DEFINED(x,y) void(0)
#define VALGRIND_MAKE_MEM_UNDEFINED(x,y) void(0)
#define VALGRIND_MAKE_MEM_NOACCESS(x,y) void(0)
#define VALGRIND_DISCARD(x) void(0)
#define VALGRIND_CHECK_CHECK_MEM_IS_DEFINED(x,y) void(0)
#define VALGRIND_CHECK_MEM_IS_ADDRESSABLE(x,y) void(0)
#define VALGRIND_CHECK_VALUE_IS_DEFINED(x) void(0)
#endif

#include <limits>
#include <vector>

#endif
