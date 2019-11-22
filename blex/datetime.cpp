#include <blex/blexlib.h>


#include <sys/time.h>

#include "datetime.h"
#include "logfile.h"

namespace Blex
{

namespace
{
//Fun resource for date functions: http://www.tondering.dk/claus/calendar.html
inline bool ScalarYearIsLeap (unsigned yr)
{
        return yr % 400 == 0 || (yr % 4 == 0 && yr % 100 != 0);
}

inline unsigned MonthsToDays(unsigned month, unsigned yr)
{
        static const unsigned monthdays [12] = {  0,  31,  59,
                                                 90, 120, 151,
                                                181, 212, 243,
                                                273, 304, 334 };
        if(month < 1 || month > 12)
            return 0;//broken month, don't crash!
        else if (month >= 3 && ScalarYearIsLeap(yr))
            return monthdays[month-1]+1;
        else
            return monthdays[month-1];
}

inline unsigned DaysToMonth(unsigned days, unsigned yr)
{
        //Make februari 30 days long, to simplify lookup
        if (days > (31+28)) // adjust if past February
        {
                if (ScalarYearIsLeap(yr))
                {
                        if (days > (31+29))
                            ++days;
                }
                else
                {
                        days+=2;
                }
        }

        return (days*100 + 3007)/3057;
}

inline uint32_t ScalarYearsToDays (unsigned yr)
{
        return yr * 365L + yr / 4 - yr / 100 + yr / 400;
}
}

//Convert haredates to and from time_t and tm structures
std::time_t DateTime::GetTimeT() const
{
        //Calculate the daycount for 1970
        static const uint32_t epoch_time_t = ScalarYearsToDays(1970-1);

        //Calculate the daycount for start and end of time_t range
        //ADDME: Use correct start/end dates
        static const uint32_t start_of_time_t = ScalarYearsToDays(1902-1);
        static const uint32_t end_of_time_t = ScalarYearsToDays(2038-1);

        unsigned long days = GetDays()-1;

        if (days < start_of_time_t)
            days = start_of_time_t;//return std::time_t(0x80000000 + 1);
        if (days > end_of_time_t)
            days = end_of_time_t;//return std::time_t(0x7FFFFFFF);

        return (days - epoch_time_t) * 86400 + (GetMsecs() / 1000);
}

timespec DateTime::GetTimeSpec() const
{
        //Calculate the daycount for 1970
        static const uint32_t epoch_time_t = ScalarYearsToDays(1970-1);

        //Calculate the daycount for start and end of time_t range
        //ADDME: Use correct start/end dates
        static const uint32_t start_of_time_t = ScalarYearsToDays(1902-1);
        static const uint32_t end_of_time_t = ScalarYearsToDays(2038-1);

        unsigned long days = GetDays()-1;

        if (days < start_of_time_t)
            days = start_of_time_t;//return std::time_t(0x80000000 + 1);
        if (days > end_of_time_t)
            days = end_of_time_t;//return std::time_t(0x7FFFFFFF);

        timespec val;
        val.tv_sec = (days - epoch_time_t) * 86400 + (GetMsecs() / 1000);
        val.tv_nsec = (GetMsecs() % 1000) * 1000000;
        return val;
}

std::tm DateTime::GetTM() const
{
        unsigned days=GetDays(),msecs=GetMsecs();
        unsigned n;                /* compute inverse of years_to_days() */
        std::tm retval;

        if (!days) //avoid bogus calculations
            days=1;

        for ( n = static_cast<unsigned>((uint64_t(days) * 400L) / 146097L); ScalarYearsToDays(n) < days;)
            n++;                          /* 146097 == years_to_days(400) */

        retval.tm_year = n-1900;

        n = static_cast<unsigned>(days - ScalarYearsToDays(n-1));
        retval.tm_yday = n-1;

        retval.tm_mon = DaysToMonth(n, retval.tm_year+1900)-1;
        retval.tm_mday = n - MonthsToDays(retval.tm_mon+1, retval.tm_year+1900);

        retval.tm_wday = days % 7;
        retval.tm_isdst = 0; //just set it to 0, it's rarely used anyway
        retval.tm_hour=msecs / (60*60*1000);
        retval.tm_min=(msecs % (60*60*1000)) / (60*1000);
        retval.tm_sec=(msecs % (60*1000)) / (1000);

        return retval;
}

DateTime DateTime::Now()
{
        struct timespec now;
        clock_gettime(CLOCK_REALTIME, &now);
        return FromTimeT(now.tv_sec, now.tv_nsec / 1000000);
}

DateTime DateTime::FromTimeT(std::time_t const toset, unsigned add_msecs)
{
        /* a time_t is defined as follows:
           The number of seconds since 1 1 1970, considering every
           year that is divisible by 4 to be a leap year */

        bool neg = toset < 0;

        //Epoch is at day# 719163
        uint32_t daycount = 719163 + toset/(60*60*24);
        uint32_t secs = neg ? (-toset)%(60*60*24) : toset%(60*60*24);
        if (neg && secs > 0)
        {
                secs = (60*60*24) - secs;
                --daycount;
        }
        uint32_t msecs = secs*1000 + add_msecs;

        return DateTime(daycount,msecs);
}

DateTime DateTime::FromTime(int hour, int minute, int second, int msecs)
{
        if(hour == 24 && minute == 0 && second == 0 && msecs == 0)
            return DateTime(1,0);
        if(hour<0 || minute<0 || second <0 || msecs<0 || hour>=24 || minute >= 60 || second >= 60 || msecs > 1000)
            return DateTime(0,0);
        return DateTime(0,hour*(60*60*1000) + minute * (60*1000) + second * 1000 + msecs);
}
DateTime DateTime::FromDateTime(int year, int month, int day, int hour, int minute, int second, int msecs)
{
        if(year<=0 || month <1 || month>12 || day<1 || day > 31
           || hour<0 || minute<0 || second <0 || msecs<0 || hour>=24 || minute >= 60 || second >= 60 || msecs > 1000)
            return DateTime(0,0);

        return DateTime(day + MonthsToDays(month, year) + ScalarYearsToDays(year-1)
                       ,hour*(60*60*1000) + minute * (60*1000) + second * 1000 + msecs
                       );
}
DateTime DateTime::FromDate(int year, int month, int day)
{
        if(year<=0 || month <1 || month>12 || day<1 || day > 31)
             return DateTime(0,0);

        return DateTime(day + MonthsToDays(month, year) + ScalarYearsToDays(year-1), 0);
}

DateTime DateTime::FromTM(std::tm const &tm)
{
        return (tm.tm_mday<=0) || (tm.tm_year<=-1900) || (tm.tm_mon<=-1)
                 ? FromTime(tm.tm_hour,tm.tm_min,tm.tm_sec)
                 : FromDateTime(tm.tm_year+1900, tm.tm_mon+1, tm.tm_mday, tm.tm_hour,tm.tm_min,tm.tm_sec);
}

/** Add datetimes together */
DateTime& DateTime::operator+= (DateTime const &rhs)
{
        datetime += rhs.datetime;

        if ( (datetime & 0xFFFFFFFF) >= (1000*60*60*24) )
        {
                //The msecs part has overflown, so normalize the results
                datetime += (static_cast<uint64_t>(1)<<32) - (1000*60*60*24);
        }
        return *this;
}

/** Subtract datetimes */
DateTime& DateTime::operator-= (DateTime const &rhs)
{
        if (datetime < rhs.datetime)
        {
                datetime = 0; //overflow!
                return *this;
        }

        uint32_t lhs_days = GetDays();
        uint32_t rhs_days = rhs.GetDays();

        uint32_t lhs_msecs = GetMsecs();
        uint32_t rhs_msecs = rhs.GetMsecs();

        if (rhs_msecs>lhs_msecs)
        {
                lhs_days-- ;
                lhs_msecs += (1000*60*60*24);
        }

        datetime = (uint64_t(lhs_days - rhs_days)<<32) | uint64_t(lhs_msecs-rhs_msecs);
        return *this;
}

        //Calculation of leap days. Will fail in 2100. (but unixdate fails before that anyway)
        //Leap days so far: (year+1)/4 (0 for 1970-2. 1 for 1973-6, 2 for 1977-1980 etc)
        //Leap days this year: if (year+2)%4==0 and month>=2 then 1 else 0
#define TWODIGIT(x)  ( ((unsigned)begin[(x)]-(unsigned)'0')*10 + (unsigned)begin[(x)+1]-(unsigned)'0' )
#define FOURDIGIT(x) ( TWODIGIT(x)*100 + TWODIGIT((x)+2) )
#define DAYS(x)      ( (x)*24*60*60 )
#define TIMEFIELD(x) ( TWODIGIT((x))*60*60 + TWODIGIT((x)+3)*60 + TWODIGIT((x)+6) )

#define THISYEARLEAP(yr,mn) ( ((((yr)+2)%4)==0 && (mn)>=2) ? 1 : 0)
#define LEAPDAYS(yr) ( ((yr)+1)/4 )

inline unsigned PromoteYear(unsigned year)
{
        if(year<70)
            return year+2000;
        else if(year<100)
            return year+1900;
        else
            return year;
}

//lookup timezone distance in minutes
std::pair<int, char const*> LookupTimezone(const char *begin, const char *end)
{
        while(begin!=end&&*begin==' ')
            ++begin;
        if(begin==end)
            return std::make_pair(0,begin);

        if( (*begin=='+'||*begin=='-') && end-begin>=2) //format [+/-]hh[[:]mm]]
        {
                int sign = *begin=='+'?1:-1;
                ++begin;

                //decode hour
                std::pair<unsigned, char const *> hour = Blex::DecodeUnsignedNumber<unsigned>(begin,begin+2);
                if(hour.second != begin + 2 || hour.first >= 24)
                    return std::make_pair(0,begin); //not decoded a timezone

                begin+=2;
                if(begin!=end&&*begin==':')
                    ++begin; //skip over colon

                if(end-begin<2) //done
                    return std::make_pair(sign * hour.first * 60, begin);

                std::pair<unsigned, char const *> minute = Blex::DecodeUnsignedNumber<unsigned>(begin,begin+2);
                if(minute.second != begin+2 || minute.first>=60)
                    return std::make_pair(sign * hour.first * 60, begin);

                return std::make_pair(sign * (hour.first*60 + minute.first), begin+2);
        }

        //Read text
        const char *endtext = begin;
        while(endtext!=end && Blex::IsAlpha(*endtext))
            ++endtext;

        //ADDME: Make a table lookup..
        if(endtext-begin == 3) //text timezone ?
        {
                if (Blex::MemCaseCompare(begin,"UTC",3)==0 || Blex::MemCaseCompare(begin,"UCT",3)==0 || Blex::MemCaseCompare(begin,"GMT",3)==0)
                    return std::make_pair(0,begin+3);
                if (Blex::MemCaseCompare(begin,"EST",3)==0)
                    return std::make_pair(-5*60,begin+3);
                if (Blex::MemCaseCompare(begin,"EDT",3)==0)
                    return std::make_pair(-4*60,begin+3);
                if (Blex::MemCaseCompare(begin,"CST",3)==0)
                    return std::make_pair(-6*60,begin+3);
                if (Blex::MemCaseCompare(begin,"CDT",3)==0)
                    return std::make_pair(-5*60,begin+3);
                if (Blex::MemCaseCompare(begin,"MST",3)==0)
                    return std::make_pair(-7*60,begin+3);
                if (Blex::MemCaseCompare(begin,"MDT",3)==0)
                    return std::make_pair(-6*60,begin+3);
                if (Blex::MemCaseCompare(begin,"PST",3)==0)
                    return std::make_pair(-8*60,begin+3);
                if (Blex::MemCaseCompare(begin,"PDT",3)==0)
                    return std::make_pair(-7*60,begin+3);
        }
        if(endtext-begin == 1) //text timezone ?
        {
                if (Blex::MemCaseCompare(begin,"Z",1)==0)
                    return std::make_pair(0,begin+1);
        }
        return std::make_pair(0,begin);
}

unsigned LookupMonth(const char *mon)
{
        //We use the getu32lsb() function (optimizers: get your own MSB table)
        //to quickly get the date. Datenames in u32 LSB format have been
        //pregenerated. getu32lsb is pretty fast on x86 platforms
        static const unsigned datehashes[13]=
            { 'J'|('A'<<8)|('N'<<16), 'F'|('E'<<8)|('B'<<16), 'M'|('A'<<8)|('R'<<16),
              'A'|('P'<<8)|('R'<<16), 'M'|('A'<<8)|('Y'<<16), 'J'|('U'<<8)|('N'<<16),
              'J'|('U'<<8)|('L'<<16), 'A'|('U'<<8)|('G'<<16), 'S'|('E'<<8)|('P'<<16),
              'O'|('C'<<8)|('T'<<16), 'N'|('O'<<8)|('V'<<16), 'D'|('E'<<8)|('C'<<16), 0 };

        unsigned monthscan=Blex::getu32lsb(mon)&0xdfdfdf;      //Strip the last byte, touppercase
        unsigned whichmon=std::find(datehashes, datehashes+12, monthscan) - datehashes;
        return whichmon==12 ? 0 : whichmon+1;
}

std::pair<DateTime, char const *> FromText_Time(char const* begin, char const* end)
{
        /* valid (iso 8601 extended with millisecond precision) formats are
           hh:mm:ss[.ms]
           hh:mm[.ms]
           hh[.ms]
           hhmmss[.ms]
           hhmm[.ms]

           hh may be '24' if the other fields are 0 to denote midnight at the end of the day

           return Max to indicate error;
        */

        //Parse hh
        if(end-begin<2) //not even 2 bytes?
            return std::make_pair(Blex::DateTime::Max(), begin);

        std::pair<unsigned, char const*> hour = DecodeUnsignedNumber<unsigned>(begin,begin+2,10);
        if(hour.second != begin+2 || hour.first>24)
            return std::make_pair(Blex::DateTime::Max(), begin);

        begin += 2; //skip hour
        if(end!=begin && *begin==':') //skip colon
            ++begin;

        if(end-begin<2 || !IsDigit(*begin)) //it ends here
            return std::make_pair(Blex::DateTime::FromTime(hour.first, 0, 0), begin);

        //Parse mm
        std::pair<unsigned, char const*> minute = DecodeUnsignedNumber<unsigned>(begin,begin+2,10);
        if(minute.second != begin+2 || minute.first>=60 || (hour.first == 24 && minute.first != 0))
            return std::make_pair(Blex::DateTime::Max(), begin);

        begin += 2; //skip minute
        if(end!=begin && *begin==':') //skip colon
            ++begin;

        if(end-begin<2 || !IsDigit(*begin)) //it ends here
            return std::make_pair(Blex::DateTime::FromTime(hour.first, minute.first, 0), begin);


        //Parse ss
        std::pair<unsigned, char const*> second = DecodeUnsignedNumber<unsigned>(begin,begin+2,10);
        if(second.second != begin+2 || second.first>=60 || (hour.first == 24 && second.first != 0))
            return std::make_pair(Blex::DateTime::Max(), begin);

        begin += 2; //skip second
        if(end-begin<2 || *begin!='.') //it ends here
            return std::make_pair(Blex::DateTime::FromTime(hour.first, minute.first, second.first), begin);

        // find all digits of the seconds fraction
        const char *fractionstart = second.second + 1;
        const char *fractionend = fractionstart;
        while (fractionend < end && *fractionend >= '0' && *fractionend <= '9')
            ++fractionend;

        // Parse the first 3 digits of the fraction, ignore the rest
        unsigned parsecount = std::min< unsigned >(3, std::distance(fractionstart, fractionend));
        if (parsecount != 0)
        {
                // require 1 digit after the '.'
                unsigned msecs = DecodeUnsignedNumber<unsigned>(fractionstart, fractionstart + parsecount, 10).first;
                if (parsecount == 1)
                    msecs *= 100;
                else if (parsecount == 2)
                    msecs *= 10;

                if (hour.first != 24 || msecs == 0)
                    return std::make_pair(Blex::DateTime::FromTime(hour.first, minute.first, second.first, msecs), fractionend);
        }

        return std::make_pair(Blex::DateTime::Max(), begin);
}

DateTime FromText_HTTPLog(char const* begin, char const* end)
{
/*
  weekday "/" month "/" year ":" time SP offset
*/
        std::pair<unsigned, char const*> day = DecodeUnsignedNumber<unsigned>(begin,end,10);
        if (day.second==end || *day.second!='/')
            return Blex::DateTime::Invalid();

        char const *month_begin = day.second + 1;
        char const *month_end = month_begin;
        while(month_end != end && Blex::IsAlpha(*month_end))
            ++month_end;

        if(month_end == end || month_end-month_begin!=3)
            return Blex::DateTime::Invalid();

        unsigned month = LookupMonth(month_begin);
        if (month == 0)
            return Blex::DateTime::Invalid();

        std::pair<unsigned, char const*> year = DecodeUnsignedNumber<unsigned>(month_end+1,end,10);
        if (year.second==end || *year.second!=':')
            return Blex::DateTime::Invalid();

        std::pair<Blex::DateTime, char const*> retval = FromText_Time(year.second+1,end);
        if(retval.first == Blex::DateTime::Max())
            return Blex::DateTime::Invalid();

        retval.first += Blex::DateTime::FromDate(PromoteYear(year.first), month, day.first);

        std::pair<int, char const*> tzres = LookupTimezone(retval.second,end);

        int timezone = tzres.first;

        if(timezone>0) //if the timezone is positive, move the reported time backwards!
             retval.first -= Blex::DateTime::Minutes(timezone);
        else
             retval.first += Blex::DateTime::Minutes(-timezone);

        return retval.first;
}

/* precondition: begin < end
*/
DateTime ApplyISO8601TimeAndZone(DateTime date, char const* begin, char const* end)
{
        if(*begin == 'T' || *begin == ' ') //we accept T (ISO) and a space as separator between date&time
        {
                std::pair<Blex::DateTime, char const*> timeval = FromText_Time(begin+1,end);
                if(timeval.first == DateTime::Max())
                    return DateTime::Invalid();

                date += timeval.first;
                begin = timeval.second;
        }

        if(begin != end) //timezone ?
        {
                std::pair<int, char const*> tzres = LookupTimezone(begin,end);
                if(tzres.second != end) //corrupted data in datetime
                        return DateTime::Invalid();

                int timezone = tzres.first;

                if(timezone>0) //if the timezone is positive, move the reported time backwards!
                    date -= DateTime::Minutes(timezone);
                else
                    date += DateTime::Minutes(-timezone);
        }
        return date;
}

/* precondition:
   begin <= date_end - 8  (date_end - begin >= 8)
   begin <= date_end <= end
   */
DateTime FromText_ISO8601_Noseparator(char const* begin, char const* end, char const* date_end)
{
        //Implement YYYY(yyy)MMDD formats. No separators and no support for shortened formats

        //Work backwards from the 'T' or date end
        char const* day_begin = date_end - 2;
        char const* month_end = day_begin;
        char const* month_begin = month_end - 2;
        char const* year_end = month_begin;

        //Parse the date parts
        std::pair<unsigned, char const*> year, month, day;
        year =  DecodeUnsignedNumber<unsigned>(begin, year_end, 10);
        month = DecodeUnsignedNumber<unsigned>(month_begin, month_end ,10);
        day =   DecodeUnsignedNumber<unsigned>(day_begin, date_end, 10);

        if(year.second != year_end || month.second != month_end || day.second != date_end)
            return DateTime::Invalid(); //non-digits in the YMD parts

        DateTime retval = DateTime::FromDate(year.first, month.first, day.first);
        if(retval == DateTime::Invalid())
            return DateTime::Invalid();

        if (date_end != end)
                retval = ApplyISO8601TimeAndZone(retval, date_end, end);

        return retval;
}

DateTime FromText_ISO8601_Separated(char const* begin, char const* end)
{
        /* ISO8601/RFC3339: https://www.ietf.org/rfc/rfc3339.txt

           Supporting the subset of ISO 8601 as defined in http://www.w3.org/TR/NOTE-datetime
           Year:
             YYYY (eg 1997)
           Year and month:
             YYYY-MM (eg 1997-07)
           Complete date:
             YYYY-MM-DD (eg 1997-07-16)
           Complete date plus hours, minutes and seconds:
             YYYY-MM-DDThh:mm:ssTZD (eg 1997-07-16T19:20:30+01:00)
           Complete date plus hours, minutes, seconds and a decimal fraction of a second
             YYYY-MM-DDThh:mm:ss.sTZD (eg 1997-07-16T19:20:30.45+01:00)

           All the above without the separators
           Extension: using a space instead of 'T'

          Not yet implemented:
          Complete date plus hours and minutes:
            YYYY-MM-DDThh:mmTZD (eg 1997-07-16T19:20+01:00)
*/

        //year ends at the first separator
        auto yeardata = DecodeUnsignedNumber<unsigned>(begin, end, 10);
        if(yeardata.second == end)
        { //Handle special case YYYY. Note that we already know these 4 positions are digits
                return DateTime::FromDate(yeardata.first, 1, 1);
        }
        if(*yeardata.second != '-')
                return DateTime::Invalid();

        auto monthdata = DecodeUnsignedNumber<unsigned>(yeardata.second + 1, end, 10);
        if(monthdata.second == end)
        { //Handle special case YYYY-MM. Note that we already know the 4 positions are digit, but we're not sure yet about -MM
                return DateTime::FromDate(yeardata.first, monthdata.first, 1);
        }
        if(*monthdata.second != '-')
                return DateTime::Invalid();

        auto daydata = DecodeUnsignedNumber<unsigned>(monthdata.second + 1, end, 10);

        DateTime retval = DateTime::FromDate(yeardata.first, monthdata.first, daydata.first);
        if(retval == DateTime::Invalid())
            return DateTime::Invalid();

        if (daydata.second != end)
                retval = ApplyISO8601TimeAndZone(retval, daydata.second, end);

        return retval;
}

DateTime FromText_RFC850_1123(char const* begin, char const* end)
{
/*
       rfc1123-date = wkday "," SP date1 SP time SP "GMT"               (len=29  (3+2+11+1+8+1+3))
       date1        = 2DIGIT SP month SP 4DIGIT                         (len=11)
                      ; day month year (e.g., 02 Jun 1982)

       rfc850-date  = weekday "," SP date2 SP time SP "GMT"             (len=30..33  (6..9+2+9+1+8+1+3))
       date2        = 2DIGIT "-" month "-" 2DIGIT                       (len=9)
                      ; day-month-year (e.g., 02-Jun-82)

       rfc2822-date-time
                    = [ day-of-week "," ] date3 FWS time [CFWS]
       date3        = day month year
       day          = ([FWS] 1*2DIGIT) / (obsolete: [CFWS] 1*2DIGIT [CFWS])
       month        = (FWS month-name FWS) / (obsolete: CFWS month-name CFWS)
       year         = 4*DIGIT / (obsolete: [CFWS] 2*DIGIT [CFWS])
       FWS          = ([*WSP CRLF] 1*WSP)
       CWFS         = *([FWS] comment) (([FWS] comment) / FWS) (ADDME: not implemented, do that?)
*/

        std::pair<unsigned, char const*> day = DecodeUnsignedNumber<unsigned>(begin,end,10);
        if (day.second==end)
            return Blex::DateTime::Invalid();

        char const *month_begin = day.second;
        while (month_begin != end && (Blex::IsWhitespace(*month_begin) || *month_begin == '-'))
            ++month_begin;

        char const *month_end = month_begin;
        while(month_end != end && Blex::IsAlpha(*month_end))
            ++month_end;

        if(month_end == end || month_end-month_begin!=3)
            return Blex::DateTime::Invalid();

        unsigned month = LookupMonth(month_begin);
        if (month == 0)
            return Blex::DateTime::Invalid();

        char const *year_begin = month_end;
        while (year_begin != end && (Blex::IsWhitespace(*year_begin) || *year_begin == '-'))
            ++year_begin;

        std::pair<unsigned, char const*> year = DecodeUnsignedNumber<unsigned>(year_begin,end,10);
        if (year.second==end || (!Blex::IsWhitespace(*year.second) && *year.second != ','))
            return Blex::DateTime::Invalid();

        char const *time_begin = year.second;
        ++time_begin; // Skip first whitespace or ','
        while (time_begin != end && Blex::IsWhitespace(*time_begin))
            ++time_begin;

        std::pair<Blex::DateTime, char const*> retval = FromText_Time(time_begin,end);
        if(retval.first == Blex::DateTime::Max())
            return DateTime::Invalid();

        retval.first += Blex::DateTime::FromDate(PromoteYear(year.first), month, day.first);

        std::pair<int, char const*> tzres = LookupTimezone(retval.second,end);

        int timezone = tzres.first;

        if(timezone>0) //if the timezone is positive, move the reported time backwards!
            retval.first -= Blex::DateTime::Minutes(timezone);
        else
            retval.first += Blex::DateTime::Minutes(-timezone);
        return retval.first;
}

DateTime FromText_Asctime(char const* begin, char const* end)
{
/*
       asctime-date = wkday SP date3 SP time SP 4DIGIT                  (len=24   (3+1+6+1+8+1+4))
       date3        = month SP ( 2DIGIT | ( SP 1DIGIT ))                (len=6)
                      ; month day (e.g., Jun  2)
*/
        char const *month_end = begin;
        while(month_end != end && Blex::IsAlpha(*month_end))
            ++month_end;

        if(month_end == end || month_end-begin!=3)
            return Blex::DateTime::Invalid();

        unsigned month = LookupMonth(begin);
        if (month == 0)
            return Blex::DateTime::Invalid();

        //skip spaces
        ++month_end;
        while(month_end!=end&&*month_end==' ')
            ++month_end;

        std::pair<unsigned, char const*> day = DecodeUnsignedNumber<unsigned>(month_end,end,10);
        if (day.second==end)
            return Blex::DateTime::Invalid();

        std::pair<Blex::DateTime, char const*> retval = FromText_Time(day.second+1,end);
        if(retval.first == Blex::DateTime::Max())
            return DateTime::Invalid();

        begin = retval.second;
        while(begin!=end&&*begin==' ')
            ++begin;

        std::pair<unsigned, char const*> year = DecodeUnsignedNumber<unsigned>(begin,end,10);
        retval.first += Blex::DateTime::FromDate(PromoteYear(year.first), month, day.first);
        return retval.first;
}

DateTime DateTime::FromText(char const* begin, char const* end)
{
/*
       HTTP-date    = rfc1123-date | rfc850-date | asctime-date
       time         = 2DIGIT ":" 2DIGIT ":" 2DIGIT                      (len=8)
                      ; 00:00:00 - 23:59:59
       wkday        = "Mon" | "Tue" | "Wed"                             (len=3)
                    | "Thu" | "Fri" | "Sat" | "Sun"
       weekday      = "Monday" | "Tuesday" | "Wednesday"                (len=6..9)
                    | "Thursday" | "Friday" | "Saturday" | "Sunday"
       month        = "Jan" | "Feb" | "Mar" | "Apr"                     (len=3)
                    | "May" | "Jun" | "Jul" | "Aug"
                    | "Sep" | "Oct" | "Nov" | "Dec"
*/
        //Skip inital spaces
        while(begin!=end&&Blex::IsWhitespace(*begin))
            ++begin;

        if(begin==end)
            return Blex::DateTime::Invalid();

        //Start with a number?
        if(Blex::IsDigit(*begin))
        {
                char const *first_non_digit = begin+1;
                while(first_non_digit!=end && Blex::IsDigit(*first_non_digit))
                    ++first_non_digit;

                if(first_non_digit-begin >= 8) //if it looks like unseparated YYYYMMDD, we force interpret it as XMLRPC (otherwise it's ambiguous with overlong years)
                    return FromText_ISO8601_Noseparator(begin, end, first_non_digit);
                if(first_non_digit-begin >= 4)
                    return FromText_ISO8601_Separated(begin, end);

                if(first_non_digit==end)
                    return Blex::DateTime::Invalid();

                if(first_non_digit-begin==1 || first_non_digit-begin==2)
                {
                    if (*first_non_digit == '/')
                        return FromText_HTTPLog(begin,end);
                    else
                        return FromText_RFC850_1123(begin,end);
                }

                return Blex::DateTime::Invalid(); //can't figure it out
        }

        if(begin!=end && Blex::IsAlpha(*begin))
        {
                /* The date starts with text. Is a day-of-the-week in all our known formats */
                while(begin!=end && Blex::IsAlpha(*begin))
                    ++begin;

                //Skip comma, if any
                if(begin!=end && *begin==',')
                    ++begin;

                //Skip inital spaces
                while(begin!=end && *begin==' ')
                    ++begin;

                //The remainder is either RFC1123/850 or asctime
                if(begin==end)
                    return Blex::DateTime::Invalid();

                if (Blex::IsAlpha(*begin))
                    return FromText_Asctime(begin,end);
                else
                    return FromText_RFC850_1123(begin,end);
        }
        return Blex::DateTime::Invalid();
}

template <> void AppendAnyToString(Blex::DateTime const &in, std::string *appended_string)
{
        // Any-to-string may have a way cooler manner to represent a datetime than operator<<

        char out[80]; // Is a lot more than the 26 characters needed
        struct std::tm time = in.GetTM();
        std::sprintf(out ,"[%04d-%02d-%02dT%02d:%02d:%02d.%03dZ]",
                time.tm_year+1900,
                time.tm_mon + 1,
                time.tm_mday,
                time.tm_hour,
                time.tm_min,
                time.tm_sec,
                int(in.GetMsecs() % 1000));

        *appended_string += out;
}

std::ostream& operator<<(std::ostream &lhs, Blex::DateTime towrite)
{
        std::string str;
        AppendAnyToString(towrite, &str);
#ifdef DEBUG
        // Also display format shown in GDB
        str += " (";
        AppendAnyToString( (uint64_t(towrite.GetDays()) << 32) + towrite.GetMsecs(), &str);
        str += ")";
#endif
        return lhs << str;
}

const char * const wkdays[]={"Sun","Mon","Tue","Wed","Thu","Fri","Sat"};
const char * const months[]={"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"};

unsigned CreateHttpDate(Blex::DateTime date, char *out)
{
        struct std::tm time = date.GetTM();
        return std::sprintf(out ,"%s, %02d %s %04d %02d:%02d:%02d GMT",wkdays[time.tm_wday],
                           time.tm_mday,months[time.tm_mon],time.tm_year+1900,time.tm_hour,
                           time.tm_min,time.tm_sec);
}

void CreateHttpDate(Blex::DateTime date, std::string *out)
{
        char ret[40];
        out->insert(out->end(), ret, ret + CreateHttpDate(date,ret));
}

} //end namespace Blex

