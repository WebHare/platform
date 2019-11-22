#ifndef blex_datetime
#define blex_datetime

#ifndef blex_blexlib
#include "blexlib.h"
#endif
#include <ctime>
#include <ostream>

namespace Blex {

class BLEXLIB_PUBLIC DateTime;

template<> inline DateTime __attribute__((nonnull(1))) GetLsb<DateTime> (void const *where);
template<> inline DateTime __attribute__((nonnull(1))) GetMsb<DateTime> (void const *where);
template<> inline void __attribute__((nonnull(1))) PutLsb<DateTime> (void *where, DateTime const &datetime);
template<> inline void __attribute__((nonnull(1))) PutMsb<DateTime> (void *where, DateTime const &datetime);

/** A WebHare date/time storage class, with microsecond precision and a range of 1/1/1 through very much. */
class BLEXLIB_PUBLIC DateTime
{
        public:
        /** Create an unitialized datetime */
        DateTime()
        {
        }

        /** Construct a datetime using the given day and msec count
            @param days Day counter, where day 1 = 1/1/1
            @param msecs Number of milliseconds since the start of the day */
        DateTime(unsigned long days, unsigned long msecs)
        : datetime( days > 0x7FFFFFFF || msecs > 24*60*60*1000 - 1 ? 0 : ((static_cast<uint64_t>(days) << 32) | msecs))
        {
        }

        /** Construct a datetime from a full date/time
            @param year Year (1-....)
            @param month Month (1-12)
            @param day Day (1-31)
            @param hour Hours (0-23)
            @param minute Minutes (0-60)
            @param second Seconds (0-60) */
        static DateTime FromDateTime(int year, int month, int day, int hour, int minute, int second, int msecs=0);

        /** Construct a datetime from a time (days is set to 0)
            @param hour Hours (0-23)
            @param minute Minutes (0-60)
            @param second Seconds (0-60) */
        static DateTime FromTime(int hour, int minute, int second, int msecs=0);

        /** Construct a datetime from a date (mseconds is set to 0)
            @param year Year (1-....)
            @param month Month (1-12)
            @param day Day (1-31) */
        static DateTime FromDate(int year, int month, int day);

        /** Construct a datetime from a C time_t
            @param sourcetime Time, eg. as returned by time(0). If the
                   time cannot be represented in a time_t, it is rounded
                   to the nearest representable value
            @param msecs Milliseconds to add */
        static DateTime FromTimeT(std::time_t sourcetime, unsigned msecs = 0);

        /** Construct a datetime from a C tm structure
            @param tm Time structure, eg as returned by localtime */
        static DateTime FromTM(struct std::tm const &tm);

        /** Construct a datetime from a text string */
        static DateTime FromText(char const* begin, char const* end);
        static DateTime FromText(std::string const &date)
        { return FromText(&date[0],&date[date.size()]); }

        /** Return the current time as a datime structure */
        static DateTime Now();

        /** Convert a number of milliseconds to a datetime */
        static DateTime Msecs(unsigned mseconds)
        {
                return DateTime(mseconds/(24*60*60*1000),mseconds%(24*60*60*1000));
        }
        /** Convert a number of seconds to a datetime */
        static DateTime Seconds(unsigned seconds)
        {
                return DateTime(seconds/(24*60*60),(seconds%(24*60*60))*1000);
        }
        /** Convert a number of minutes to a datetime */
        static DateTime Minutes(unsigned minutes)
        {
                return DateTime(minutes/(24*60),(minutes%(24*60))*60*1000);
        }
        /** Convert a number of hours to a datetime */
        static DateTime Hours(unsigned hours)
        {
                return DateTime(hours/(24),(hours%24)*60*60*1000);
        }
        /** Convert a number of days ta datetime */
        static DateTime Days(unsigned days)
        {
                return DateTime(days,0);
        }

        /** Miminum datetime. USeful for 0-second waits*/
        static DateTime Min()
        {
                return DateTime(1,0);
        }

        /** Invalid datetime. Is smaller than all non-invalid datetimes */
        static DateTime Invalid()
        {
                return DateTime(0,0);
        }

        /** Maximum possible datetime. USeful for infinite waits */
        static DateTime Max()
        {
                return DateTime(0x7FFFFFFF,24*60*60*1000 - 1);
        }

        /** Convert a datetime to a time_t structure */
        std::time_t GetTimeT() const;

        /** Convert a datetime to a timeval structure */
        timespec GetTimeSpec() const;

        /** Convert a datetime to a tm structure */
        std::tm GetTM() const;

        /** Get the day counter */
        unsigned long GetDays() const
        {
                return static_cast<uint32_t>( (datetime >> 32) & 0xFFFFFFFFL);
        }

        /** Get the msecs counter */
        unsigned long GetMsecs() const
        {
                return static_cast<uint32_t>( (datetime) & 0xFFFFFFFFL);
        }

        /** Add datetimes together */
        DateTime& operator+= (DateTime const &rhs);

        /** Subtract datetimes */
        DateTime& operator-= (DateTime const &rhs);

        /** Add datetimes together */
        DateTime operator+ (DateTime const &rhs) const
        { return DateTime(*this) += rhs; }

        /** Subtract datetimes */
        DateTime operator- (DateTime const &rhs) const
        {
                return DateTime(*this) -= rhs;
        }

        /** Date time compare function
            @param rhs Datetime to compare with
            @return >0 if *this > rhs, <0 if *this < rhs, 0 if *this == rhs */
        int Compare(DateTime const &rhs) const
        {
                return datetime<rhs.datetime ? -1 : (datetime==rhs.datetime ? 0 : 1);
        }

        bool operator== (DateTime const &rhs) const { return Compare(rhs)==0; }
        bool operator<  (DateTime const &rhs) const { return Compare(rhs)<0;  }
        bool operator!= (DateTime const &rhs) const { return Compare(rhs)!=0; }
        bool operator<= (DateTime const &rhs) const { return Compare(rhs)<=0; }
        bool operator>  (DateTime const &rhs) const { return Compare(rhs)>0;  }
        bool operator>= (DateTime const &rhs) const { return Compare(rhs)>=0; }

// GCC ignores the nonnull attributes here, and issues a 'may be missng an attribute' warning.
// Older GCC's also give an error for missing 'missing-attributes' warning
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpragmas"
#pragma GCC diagnostic ignored "-Wmissing-attributes"

        friend DateTime GetLsb<DateTime> (const void *where) __attribute__((nonnull(1)));
        friend DateTime GetMsb<DateTime> (const void *where) __attribute__((nonnull(1)));
        friend void PutLsb<DateTime> (void *where, DateTime const &datetime) __attribute__((nonnull(1)));
        friend void PutMsb<DateTime> (void *where, DateTime const &datetime) __attribute__((nonnull(1)));

#pragma GCC diagnostic pop

        private:
        ///The internal time representation
        uint64_t datetime;
};

template <> inline DateTime __attribute__((nonnull(1))) GetLsb<DateTime> (void const *where)
{
        DateTime newdate;
        newdate.datetime = getu64lsb(where);
        return newdate;
}
template <> inline DateTime __attribute__((nonnull(1))) GetMsb<DateTime> (void const *where)
{
        DateTime newdate;
        newdate.datetime = getu64msb(where);
        return newdate;
}
template<> inline void __attribute__((nonnull(1))) PutLsb<DateTime> (void *where, DateTime const &datetime)
{
        putu64lsb(where,datetime.datetime);
}
template<> inline void __attribute__((nonnull(1))) PutMsb<DateTime> (void *where, DateTime const &datetime)
{
        putu64msb(where,datetime.datetime);
}

BLEXLIB_PUBLIC unsigned CreateHttpDate(Blex::DateTime date, char *out);
BLEXLIB_PUBLIC void CreateHttpDate(Blex::DateTime date, std::string *out);

BLEXLIB_PUBLIC std::ostream& operator<<(std::ostream &lhs, Blex::DateTime towrite);
template <> BLEXLIB_PUBLIC void AppendAnyToString(Blex::DateTime const &in, std::string *appended_string);


} //end namespace Blex

#endif /* sentry */
