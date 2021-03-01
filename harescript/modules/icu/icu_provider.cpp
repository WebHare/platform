//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

#include <blex/path.h>

#include <unicode/coll.h>
#include <unicode/decimfmt.h>
#include <unicode/dtfmtsym.h>
#include <unicode/dtptngen.h>
#include <unicode/locdspnm.h>
#include <unicode/numfmt.h>
#include <unicode/rbnf.h>
#include <unicode/smpdtfmt.h>
#include <unicode/timezone.h>
#include <unicode/translit.h>
#include <unicode/ucurr.h>
#include <unicode/uloc.h>
#include <unicode/utrans.h>
#include <unicode/uversion.h>
#include <cmath>

// For debugging purposes
//#include <iostream>

//---------------------------------------------------------------------------
#include "icu_provider.h"

// Epoch day (1970-01-01) is #719163
#define EPOCH_DAYCOUNT 719163


namespace HareScript
{
namespace ICU
{


// Country codes that exist in CLDR data, but not the the ISO country list, which we still want to have returned by GetCountryList
// AC, Ascension Island: Part of Saint Helena (SH-AC)
// CP, Clipperton Island: Minor territory of France
// DG, Diego Garcia: British Indian Ocean Territory
// EA, Ceuta & Melilla: Spanish autonomous cities in Africa
// EU, European Union: Not a country
// IC, Canary Islands: Spanish archipelago
// QO, Outlying Oceania: Multi-territory region
// TA, Tristan da Cunha: Part of Saint Helena (SH-TA)
// XK, Kosovo: The code XK is being used by the European Commission, Switzerland, the Deutsche Bundesbank, SWIFT, and other organizations as a temporary country code for Kosovo
static const char * const ADDITIONAL_COUNTRIES[] = {
    "XK",
NULL
};

//---------------------------------------------------------------------------
// Read and write Unicode values from and to the HareScript VM
//

// Read a DATETIME value into a UDate variable, returns UDateDefault if a DEFAULT DATETIME was read
UDate HSVM_DateTimeGetUnicode(HSVM *hsvm, HSVM_VariableId id)
{
        int days, msecs;
        HSVM_DateTimeGet(hsvm, id, &days, &msecs);

        if (days == 0)
            return UDateDefault;

        return ((UDate)days - EPOCH_DAYCOUNT) * U_MILLIS_PER_DAY + (UDate)msecs;
}

// Write a UDate value into a DATETIME variable
void HSVM_DateTimeSetUnicode(HSVM *hsvm, HSVM_VariableId id, UDate value)
{
        if (value == UDateDefault)
        {
                HSVM_SetDefault(hsvm, id, HSVM_VAR_DateTime);
                return;
        }

        int64_t rounded = round(value);
        int msecs = rounded % U_MILLIS_PER_DAY;
        if (msecs < 0)
        {
                msecs += U_MILLIS_PER_DAY;
        }
        int days = ((rounded - msecs) / U_MILLIS_PER_DAY) + EPOCH_DAYCOUNT;

        HSVM_DateTimeSet(hsvm, id, days, msecs);
}

// Read a STRING value into a UnicodeString
UnicodeString HSVM_StringGetUnicode(HSVM *hsvm, HSVM_VariableId id)
{
        std::string str = HSVM_StringGetSTD(hsvm, id);
        return UnicodeString::fromUTF8(str);
}

// Write a UnicodeString into a STRING variable
void HSVM_StringSetUnicode(HSVM *hsvm, HSVM_VariableId id, UnicodeString const &value)
{
        std::string str; // toUTF8String writes into a variable and returns it
        HSVM_StringSetSTD(hsvm, id, value.toUTF8String(str));
}


// -----------------------------------------------------------------------------
//
// ICUContextData
//

// Cached locale names
typedef std::map<std::string, std::string> LocaleNameCache;

// Cached locale data
struct LocaleData
{
        // The locale data
        Locale locale;
        // If the locale uses 12 hour notation by default
        bool hour12;
        // A date formatter for this locale
        std::shared_ptr<SimpleDateFormat> dateformat;
        // A pattern generator for this locale
        std::shared_ptr<DateTimePatternGenerator> generator;

        LocaleData(std::string const &localename);
};
typedef std::map<std::string, LocaleData> LocaleCache;

LocaleData::LocaleData(std::string const &localename)
: hour12(false)
{
        locale = Locale::createFromName(localename.c_str());

        UErrorCode status = U_ZERO_ERROR;
        dateformat.reset(new SimpleDateFormat("", locale, status));
        generator.reset(DateTimePatternGenerator::createInstance(locale, status));

        // The "j" pattern generates hour display in either 12- or 24-hour clock, depending on the locale. The locale uses
        // 12-hour clock if the hour is specified by 'h' or 'K'. We have to be careful, as the pattern may be something like
        // "HH 'Uhr'" (the 'h' within Uhr should be ignored as it's literal text).
        UnicodeString pattern = generator.get()->getBestPattern("j", status);
        bool quoted = false;
        for (int32_t i = 0; i < pattern.length(); ++i)
        {
                UChar c = pattern.charAt(i);
                if (c == '\'')
                    quoted = !quoted;
                else if (!quoted && (c == 'h' || c == 'K'))
                {
                        hour12 = true;
                        break;
                }
        }
}

// Cached time zone data
struct TimeZoneData
{
        // The time zone data
        std::shared_ptr<TimeZone> timezone;
};
typedef std::map<UnicodeString, TimeZoneData> TimeZoneCache;

// ICU module context data
struct ICUContextData
{
        // Local caches
        LocaleNameCache localenames;
        LocaleCache locales;
        TimeZoneCache timezones;
};


//---------------------------------------------------------------------------
// Cached locale names
//

// Get the unicode locale for the given language tag
std::string const &getLocaleName(ICUContextData &context, std::string const &langtag)
{
        LocaleNameCache::const_iterator it = context.localenames.find(langtag);
        if (it != context.localenames.end())
            return it->second;

        std::string name = "en"; // fallback
        if (Blex::CStrCaseCompare(langtag.c_str(), "debug") != 0)
        {
                char localeid[256];
                int32_t parsed;
                UErrorCode status = U_ZERO_ERROR;
                int32_t localesize = uloc_forLanguageTag(langtag.c_str(), &localeid[0], 256, &parsed, &status);

                if (!U_FAILURE(status) && localesize > 0)
                    name = std::string(localeid, localeid + localesize);
        }

        std::pair<LocaleNameCache::iterator, bool> res = context.localenames.insert(std::make_pair(langtag, name));
        return res.first->second;
}


//---------------------------------------------------------------------------
// Cached locale information
//

// Read locale data from cache or create new locale
LocaleData const &getLocaleData(ICUContextData &context, std::string const &name)
{
        LocaleCache::iterator it = context.locales.find(name);
        if (it != context.locales.end())
            return it->second;

        LocaleData data = LocaleData(name);

        std::pair<LocaleCache::iterator, bool> res = context.locales.insert(std::make_pair(name, data));
        return res.first->second;
}

// Get the locale with the given name
Locale const &getLocale(ICUContextData &context, std::string const &name)
{
        return getLocaleData(context, name).locale;
}

// Get if the locale with the given name uses 12 hour notation by default
bool getLocaleHour12(ICUContextData &context, std::string const &name)
{
        return getLocaleData(context, name).hour12;
}

// Get a date formatter for the locale with the given name
SimpleDateFormat *getLocaleDateFormat(ICUContextData &context, std::string const &name)
{
        return getLocaleData(context, name).dateformat.get();
}

// Get a pattern generator for the locale with the given name
DateTimePatternGenerator *getLocalePatternGenerator(ICUContextData &context, std::string const &name)
{
        return getLocaleData(context, name).generator.get();
}


//---------------------------------------------------------------------------
// Cached time zone information
//

// Read time zone data from cache or create new time zone
TimeZoneData const &getTimeZoneData(ICUContextData &context, UnicodeString const &id)
{
        TimeZoneCache::const_iterator it = context.timezones.find(id);
        if (it != context.timezones.end())
            return it->second;

        TimeZoneData data;
        data.timezone.reset(TimeZone::createTimeZone(id));

        std::pair<TimeZoneCache::iterator, bool> res = context.timezones.insert(std::make_pair(id, data));
        return res.first->second;
}

// Get the time zone with the given id
TimeZone const *getTimeZone(ICUContextData &context, UnicodeString const &id)
{
        return getTimeZoneData(context, id).timezone.get();
}


//---------------------------------------------------------------------------
// Helper functions
//

// Get the total time zone offset for a given time
int32_t getDateTimeOffset(ICUContextData &context, UDate value, UnicodeString zoneid, UBool local)
{
        TimeZone const *zone = getTimeZone(context, zoneid);

        // The return value is guaranteed to be non-NULL, check id to see if the unknown zone is returned
        if (zone->getID(zoneid) == UCAL_UNKNOWN_ZONE_ID) // getID writes into a variable and returns it, re-use zoneid for this purpose
            return 0;

        int32_t rawOffset, dstOffset;
        UErrorCode status = U_ZERO_ERROR;
        zone->getOffset(value, local, rawOffset, dstOffset, status);

        if (U_FAILURE(status))
            return 0;

        return rawOffset + dstOffset;
}


//---------------------------------------------------------------------------
// Internal HareScript functions
//

// Format a number using a RuleBasedNumberFormat
void doFormatNumber(HSVM *hsvm, HSVM_VariableId id_set, URBNFRuleSetTag rules)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);

        int64_t value = HSVM_Integer64Get(hsvm, HSVM_Arg(0));
        std::string locale = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));

        Locale locid = getLocale(context, locale);

        UErrorCode status = U_ZERO_ERROR;
        std::unique_ptr<RuleBasedNumberFormat> formatter(new RuleBasedNumberFormat(rules, locid, status));
        if (U_FAILURE(status))
            return;

        if (rules == URBNF_ORDINAL)
        {
                UBool grouping = HSVM_BooleanGet(hsvm, HSVM_Arg(2));
                formatter->setGroupingUsed(grouping);
        }

        UnicodeString str;
        status = U_ZERO_ERROR;
        formatter->format(value, str, status);
        if (U_FAILURE(status))
            return;

        HSVM_StringSetUnicode(hsvm, id_set, str);
}

// Transliterate input using the given transliteration id
void doTransliterate(HSVM *hsvm, HSVM_VariableId id_set, UnicodeString trans_id)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);

        UnicodeString value = HSVM_StringGetUnicode(hsvm, HSVM_Arg(0));

        std::string locale = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        Locale locid = getLocale(context, locale);

        // Save current locale and switch to requested locale
        Locale curid = Locale::getDefault();
        UErrorCode status = U_ZERO_ERROR;
        Locale::setDefault(locid, status);
        if (U_FAILURE(status))
            return;

        status = U_ZERO_ERROR;
        std::unique_ptr<Transliterator> trans(Transliterator::createInstance(trans_id, UTRANS_FORWARD, status));
        if (U_FAILURE(status))
            return;

        trans->transliterate(value);
        HSVM_StringSetUnicode(hsvm, id_set, value);

        // Switch back to default locale
        status = U_ZERO_ERROR;
        Locale::setDefault(curid, status);
}

// Convert a DATETIME value from or to UTC
void doConvertDateTime(HSVM *hsvm, HSVM_VariableId id_set, UBool local)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_DateTime);

        UDate value = HSVM_DateTimeGetUnicode(hsvm, HSVM_Arg(0));
        if (value == UDateDefault)
            return;
        UnicodeString zoneid = HSVM_StringGetUnicode(hsvm, HSVM_Arg(1));

        int32_t offset = getDateTimeOffset(context, value, zoneid, local);

        if (local)
            value -= offset;
        else
            value += offset;

        HSVM_DateTimeSetUnicode(hsvm, id_set, value);
}

//---------------------------------------------------------------------------
// HareScript functions
//

void GetICUVersion(HSVM *hsvm, HSVM_VariableId id_set)
{
        UVersionInfo version;
        char str[U_MAX_VERSION_STRING_LENGTH];

        u_getVersion(version);
        u_versionToString(version, str);

        HSVM_StringSetSTD(hsvm, id_set, str);
}

void GetTZDataVersion(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);

        UErrorCode status = U_ZERO_ERROR;
        std::string version = TimeZone::getTZDataVersion(status);
        if (U_FAILURE(status))
            return;

        HSVM_StringSetSTD(hsvm, id_set, version);
}

void GetLocaleForLangTag(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);

        // Read the arguments
        std::string langtag = HSVM_StringGetSTD(hsvm, HSVM_Arg(0));

        HSVM_StringSetSTD(hsvm, id_set, getLocaleName(context, langtag));
}

void GetLocaleHour12(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Boolean);

        // Read the arguments
        std::string locale = HSVM_StringGetSTD(hsvm, HSVM_Arg(0));

        HSVM_BooleanSet(hsvm, id_set, getLocaleHour12(context, locale));
}

void GetBestPattern(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);

        // Read the arguments
        UnicodeString skeleton = HSVM_StringGetUnicode(hsvm, HSVM_Arg(0));
        std::string locale = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));

        // Initialize the locale and a DateTimePatternGenerator
        DateTimePatternGenerator *generator = getLocalePatternGenerator(context, locale);
        if (!generator)
            return;

        // Get the best pattern for the given skeleton
        UErrorCode status = U_ZERO_ERROR;
        UnicodeString pattern = generator->getBestPattern(skeleton, UDATPG_MATCH_HOUR_FIELD_LENGTH, status);
        if (U_FAILURE(status))
            return;

        HSVM_StringSetUnicode(hsvm, id_set, pattern);
}

void FormatDateTime(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);

        // Read the arguments
        UnicodeString format = HSVM_StringGetUnicode(hsvm, HSVM_Arg(0));
        UDate date = HSVM_DateTimeGetUnicode(hsvm, HSVM_Arg(1));
        if (date == UDateDefault)
            return;
        std::string locale = HSVM_StringGetSTD(hsvm, HSVM_Arg(2));
        UnicodeString timezone = HSVM_StringGetUnicode(hsvm, HSVM_Arg(3));

        // Initialize the date formatter and timezone
        SimpleDateFormat *dateformat = getLocaleDateFormat(context, locale);
        if (!dateformat)
            return;

        UErrorCode status = U_ZERO_ERROR;
        dateformat->applyLocalizedPattern(format, status);
        if (U_FAILURE(status))
            return;

        TimeZone const *tz = getTimeZone(context, timezone);
        dateformat->setTimeZone(*tz);

        UnicodeString str; // The format function expects a string to append to
        status = U_ZERO_ERROR;
        HSVM_StringSetUnicode(hsvm, id_set, dateformat->format(date, str, status));
}

void GetFormatDateTimeString(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_StringArray);

        std::string locale = HSVM_StringGetSTD(hsvm, HSVM_Arg(0));
        Locale locid = getLocale(context, locale);

        UErrorCode status = U_ZERO_ERROR;
        DateFormatSymbols dfs(locid, status);
        if (U_FAILURE(status))
            return;

        int32_t count = 0;
        UnicodeString const *strings;

        // AM/PM
        strings = dfs.getAmPmStrings(count);
        if (!count)
            return; // No am/pm symbols
        for (int32_t i = 0; i < count; ++i)
            HSVM_StringSetUnicode(hsvm, HSVM_ArrayAppend(hsvm, id_set), strings[i]);

        // Month names, full
        strings = dfs.getMonths(count);
        if (!count)
            return; // No months
        for (int32_t i = 0; i < count; ++i)
            HSVM_StringSetUnicode(hsvm, HSVM_ArrayAppend(hsvm, id_set), strings[i]);

        // Day names, full, starting with Monday
        strings = dfs.getWeekdays(count);
        if (!count)
            return; // No days
        for (int32_t i = 2; i < count; ++i) // Skip empty and Sunday
            HSVM_StringSetUnicode(hsvm, HSVM_ArrayAppend(hsvm, id_set), strings[i]);
        HSVM_StringSetUnicode(hsvm, HSVM_ArrayAppend(hsvm, id_set), strings[1]); // Add Sunday last

        // Month names, abbreviated
        strings = dfs.getShortMonths(count);
        if (!count)
            return; // No months
        for (int32_t i = 0; i < count; ++i)
            HSVM_StringSetUnicode(hsvm, HSVM_ArrayAppend(hsvm, id_set), strings[i]);

        // Day names, abbreviated, starting with Monday
        strings = dfs.getShortWeekdays(count);
        if (!count)
            return; // No days
        for (int32_t i = 2; i < count; ++i) // Skip empty and Sunday
            HSVM_StringSetUnicode(hsvm, HSVM_ArrayAppend(hsvm, id_set), strings[i]);
        HSVM_StringSetUnicode(hsvm, HSVM_ArrayAppend(hsvm, id_set), strings[1]); // Add Sunday last
}

void GetCurrencyFractionDigits(HSVM *hsvm, HSVM_VariableId id_set)
{
        // When the number of decimals is unknown, use 2
        HSVM_IntegerSet(hsvm, id_set, 2);

        // Read the arguments
        std::string currency = HSVM_StringGetSTD(hsvm, HSVM_Arg(0));

        // invariant-character conversion to UChars (see utypes.h and putil.h)
        UChar uCurrency[4];
        u_charsToUChars(currency.c_str(), uCurrency, 4);

        UErrorCode status = U_ZERO_ERROR;
        int32_t digits = ucurr_getDefaultFractionDigits(uCurrency, &status);
        if (U_FAILURE(status))
            return;

        HSVM_IntegerSet(hsvm, id_set, digits);
}

void FormatNumber(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);

        // Read the arguments
        int style = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        std::string currency = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        UBool grouping = HSVM_BooleanGet(hsvm, HSVM_Arg(2));
        int minintdigits = HSVM_IntegerGet(hsvm, HSVM_Arg(3));
        int minfracdigits = HSVM_IntegerGet(hsvm, HSVM_Arg(4));
        int maxfracdigits = HSVM_IntegerGet(hsvm, HSVM_Arg(5));
        UBool significant = HSVM_BooleanGet(hsvm, HSVM_Arg(6));
        HSVM_VariableType valuetype = HSVM_GetType(hsvm, HSVM_Arg(7));
        std::string locale = HSVM_StringGetSTD(hsvm, HSVM_Arg(8));

        // invariant-character conversion to UChars (see utypes.h and putil.h)
        UChar uCurrency[4];
        u_charsToUChars(currency.c_str(), uCurrency, 4);

        // Initialize the locale and number formatter
        Locale locid = getLocale(context, locale);
        UErrorCode status = U_ZERO_ERROR;
        std::unique_ptr<NumberFormat> nf;
        if (style == 0) // Number
        {
                nf.reset(DecimalFormat::createInstance(locid, status));
        }
        else if (style == 1) // Currency
        {
                nf.reset(DecimalFormat::createCurrencyInstance(locid, status));
                // Set the supplied currency
                if (U_SUCCESS(status))
                    nf->setCurrency(uCurrency, status);
        }
        else if (style == 2) // Percentage
        {
                nf.reset(DecimalFormat::createPercentInstance(locid, status));
        }
        if (U_FAILURE(status) || !nf.get())
            return;

        // Set formatter options
        nf->setGroupingUsed(grouping);
        if (significant)
        {
                ((DecimalFormat *)nf.get())->setSignificantDigitsUsed(true);
                ((DecimalFormat *)nf.get())->setMinimumSignificantDigits(minfracdigits);
                ((DecimalFormat *)nf.get())->setMaximumSignificantDigits(maxfracdigits);
        }
        else
        {
                nf->setMinimumIntegerDigits(minintdigits);
                nf->setMinimumFractionDigits(minfracdigits);
                nf->setMaximumFractionDigits(maxfracdigits);
        }

        UnicodeString str;
        switch (valuetype)
        {
                case HSVM_VAR_Integer:
                {
                    int value = HSVM_IntegerGet(hsvm, HSVM_Arg(7));
                    nf->format(value, str, status);
                } break;

                case HSVM_VAR_Integer64:
                {
                    int64_t value = HSVM_Integer64Get(hsvm, HSVM_Arg(7));
                    nf->format(value, str, status);
                } break;

                case HSVM_VAR_Money:
                {
                    //ADDME: Is there a way to format a MONEY variable without lossy conversion to double?
                    long long int value = HSVM_MoneyGet(hsvm, HSVM_Arg(7));
                    nf->format((double)value / 100000, str, status);
                } break;

                case HSVM_VAR_Float:
                {
                    double value = HSVM_FloatGet(hsvm, HSVM_Arg(7));
                    nf->format(value, str, status);
                } break;

                //ADDME: Throw some sort of unsupported type exception?
        }
        if (U_FAILURE(status))
            return;

        HSVM_StringSetUnicode(hsvm, id_set, str);
}

void FormatDuration(HSVM *hsvm, HSVM_VariableId id_set)
{
        //ADDME: Durations don't seem to be provided for "nl" locale, so it's pretty useless. Also, it doesn't seem to provide
        //       localizations for stuff like "3 days, 2 hours en 24 seconds"...
        doFormatNumber(hsvm, id_set, URBNF_DURATION);
}

void FormatSpellout(HSVM *hsvm, HSVM_VariableId id_set)
{
        doFormatNumber(hsvm, id_set, URBNF_SPELLOUT);
}

void FormatOrdinal(HSVM *hsvm, HSVM_VariableId id_set)
{
        doFormatNumber(hsvm, id_set, URBNF_ORDINAL);
}

void CollatedCompare(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Integer);

        // Read the arguments
        int sensitivity = HSVM_IntegerGet(hsvm, HSVM_Arg(0));
        bool punctuation = HSVM_BooleanGet(hsvm, HSVM_Arg(1));
        bool numeric = HSVM_BooleanGet(hsvm, HSVM_Arg(2));
        int casefirst = HSVM_IntegerGet(hsvm, HSVM_Arg(3));
        UnicodeString string1 = HSVM_StringGetUnicode(hsvm, HSVM_Arg(4));
        UnicodeString string2 = HSVM_StringGetUnicode(hsvm, HSVM_Arg(5));
        std::string locale = HSVM_StringGetSTD(hsvm, HSVM_Arg(6));

        // Initialize the locale and a collator
        Locale locid = getLocale(context, locale);
        UErrorCode status = U_ZERO_ERROR;
        std::unique_ptr<Collator> col(Collator::createInstance(locid, status));
        if (U_FAILURE(status))
            return;

        // Set collation strength
        status = U_ZERO_ERROR;
        switch (sensitivity)
        {
                case 1:
                {
                        // Base letter comparison
                        col->setAttribute(UCOL_STRENGTH, UCOL_PRIMARY, status);
                } break;
                case 2:
                {
                        // Letter accent comparison
                        col->setAttribute(UCOL_STRENGTH, UCOL_SECONDARY, status);
                } break;
                case 3:
                {
                        // Letter case comparison
                        col->setAttribute(UCOL_STRENGTH, UCOL_TERTIARY, status);
                } break;
        }
        if (U_FAILURE(status))
            return;

        // Ignore punctuation?
        if (punctuation)
        {
                // Shifted handling of symbols and punctuation
                status = U_ZERO_ERROR;
                col->setAttribute(UCOL_ALTERNATE_HANDLING, UCOL_SHIFTED, status);
                if (U_FAILURE(status))
                    return;
        }

        // Numeric sort
        if (numeric)
        {
                status = U_ZERO_ERROR;
                col->setAttribute(UCOL_NUMERIC_COLLATION, UCOL_ON, status);
                if (U_FAILURE(status))
                    return;
        }

        // Set case first sorting
        status = U_ZERO_ERROR;
        switch (casefirst)
        {
                case 1:
                {
                        col->setAttribute(UCOL_CASE_FIRST, UCOL_UPPER_FIRST, status);
                } break;
                case 2:
                {
                        col->setAttribute(UCOL_CASE_FIRST, UCOL_LOWER_FIRST, status);
                } break;
        }
        if (U_FAILURE(status))
            return;

        // Do the comparison
        status = U_ZERO_ERROR;
        UCollationResult result = col->compare(string1, string2, status);
        if (U_FAILURE(status))
            return;

        HSVM_IntegerSet(hsvm, id_set, result == UCOL_GREATER ? 1 : result == UCOL_LESS ? -1 : 0);
}

void GetCountryList(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_RecordArray);

        if (!HSVM_ArrayLength(hsvm, HSVM_Arg(0)))
            return;

        HSVM_VariableId code = HSVM_GetColumnId(hsvm, "CODE");

        // Create a record for each country
        static const char * const *countries = icu::Locale::getISOCountries();
        for (unsigned j = 0; (countries + j) && *(countries + j); ++j)
        {
                HSVM_VariableId country = HSVM_ArrayAppend(hsvm, id_set);
                HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, country, code), std::string(*(countries + j)));
        }
        for (unsigned j = 0; (ADDITIONAL_COUNTRIES + j) && *(ADDITIONAL_COUNTRIES + j); ++j)
        {
                HSVM_VariableId country = HSVM_ArrayAppend(hsvm, id_set);
                HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, country, code), std::string(*(ADDITIONAL_COUNTRIES + j)));
        }

        UnicodeString str;
        std::unique_ptr<LocaleDisplayNames> display;
        unsigned num = HSVM_ArrayLength(hsvm, HSVM_Arg(0));
        for (unsigned i = 0; i < num; ++i)
        {
                std::string langtag = HSVM_StringGetSTD(hsvm, HSVM_ArrayGetRef(hsvm, HSVM_Arg(0), i));
                std::string locale = getLocaleName(context, langtag);

                HSVM_VariableId locale_col = HSVM_GetColumnId(hsvm, langtag.c_str());
                display.reset(LocaleDisplayNames::createInstance(Locale(locale.c_str())));

                unsigned j = 0;
                for (; (countries + j) && *(countries + j); ++j)
                {
                        HSVM_VariableId country = HSVM_ArrayGetRef(hsvm, id_set, j);
                        HSVM_VariableId name = HSVM_RecordCreate(hsvm, country, locale_col);

                        if (locale.empty())
                            HSVM_SetDefault(hsvm, name, HSVM_VAR_String);
                        else
                            HSVM_StringSetUnicode(hsvm, name, display->regionDisplayName(*(countries + j), str));
                }
                unsigned n = j;
                for (; (ADDITIONAL_COUNTRIES + j - n) && *(ADDITIONAL_COUNTRIES + j - n); ++j)
                {
                        HSVM_VariableId country = HSVM_ArrayGetRef(hsvm, id_set, j);
                        HSVM_VariableId name = HSVM_RecordCreate(hsvm, country, locale_col);

                        if (locale.empty())
                            HSVM_SetDefault(hsvm, name, HSVM_VAR_String);
                        else
                            HSVM_StringSetUnicode(hsvm, name, display->regionDisplayName(*(ADDITIONAL_COUNTRIES + j - n), str));
                }
        }
}

void GetLanguageList(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_RecordArray);

        if (!HSVM_ArrayLength(hsvm, HSVM_Arg(0)))
            return;

        HSVM_VariableId code = HSVM_GetColumnId(hsvm, "CODE");

        // Create a record for each language
        static const char * const *ptr = icu::Locale::getISOLanguages();
        for (unsigned j = 0; (ptr + j) && *(ptr + j); ++j)
        {
                HSVM_VariableId language = HSVM_ArrayAppend(hsvm, id_set);

                HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, language, code), std::string(*(ptr + j)));
        }

        UnicodeString str;
        std::unique_ptr<LocaleDisplayNames> display;
        unsigned num = HSVM_ArrayLength(hsvm, HSVM_Arg(0));
        for (unsigned i = 0; i < num; ++i)
        {
                std::string langtag = HSVM_StringGetSTD(hsvm, HSVM_ArrayGetRef(hsvm, HSVM_Arg(0), i));
                std::string locale = getLocaleName(context, langtag);

                HSVM_VariableId locale_col = HSVM_GetColumnId(hsvm, langtag.c_str());
                display.reset(LocaleDisplayNames::createInstance(Locale(locale.c_str())));

                for (unsigned j = 0; (ptr + j) && *(ptr + j); ++j)
                {
                        HSVM_VariableId language = HSVM_ArrayGetRef(hsvm, id_set, j);
                        HSVM_VariableId name = HSVM_RecordCreate(hsvm, language, locale_col);

                        if (locale.empty())
                            HSVM_SetDefault(hsvm, name, HSVM_VAR_String);
                        else
                            HSVM_StringSetUnicode(hsvm, name, display->languageDisplayName(*(ptr + j), str));
                }
        }
}

void ToUppercase(HSVM *hsvm, HSVM_VariableId id_set)
{
        doTransliterate(hsvm, id_set, UnicodeString("Upper"));
}

void ToLowercase(HSVM *hsvm, HSVM_VariableId id_set)
{
        doTransliterate(hsvm, id_set, UnicodeString("Lower"));
}

void NormalizeText(HSVM *hsvm, HSVM_VariableId id_set)
{
        doTransliterate(hsvm, id_set, UnicodeString("Any-Latin; Latin-ASCII; Lower"));
}

void TransliterateText(HSVM *hsvm, HSVM_VariableId id_set)
{
        doTransliterate(hsvm, id_set, UnicodeString("Any-Latin"));
}

void GetTimeZoneIDs(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_StringArray);

        UErrorCode status = U_ZERO_ERROR;
        std::unique_ptr<StringEnumeration> itr(TimeZone::createTimeZoneIDEnumeration(UCAL_ZONE_TYPE_ANY, NULL, NULL, status));
        if (U_FAILURE(status))
            return;

        status = U_ZERO_ERROR;
        UnicodeString const *zoneid = itr->snext(status);
        while (!U_FAILURE(status) && zoneid != NULL)
        {
                HSVM_StringSetUnicode(hsvm, HSVM_ArrayAppend(hsvm, id_set), *zoneid);
                status = U_ZERO_ERROR;
                zoneid = itr->snext(status);
        }
}

void GetAllTimeZones(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_RecordArray);

        std::string locale = HSVM_StringGetSTD(hsvm, HSVM_Arg(0));
        Locale locid = getLocale(context, locale);

        UErrorCode status = U_ZERO_ERROR;
        std::unique_ptr<StringEnumeration> itr(TimeZone::createTimeZoneIDEnumeration(UCAL_ZONE_TYPE_CANONICAL_LOCATION, NULL, NULL, status));
        if (U_FAILURE(status))
            return;

        HSVM_ColumnId code = HSVM_GetColumnId(hsvm, "CODE");
        HSVM_ColumnId tz = HSVM_GetColumnId(hsvm, "TZ");
        HSVM_ColumnId comments = HSVM_GetColumnId(hsvm, "COMMENTS");

        std::unique_ptr<TimeZone> tzone;
        char region[5];
        int32_t rlen;
        UnicodeString str;
        status = U_ZERO_ERROR;
        UnicodeString const *zoneid = itr->snext(status);
        while (!U_FAILURE(status) && zoneid != NULL)
        {
                HSVM_VariableId zone = HSVM_ArrayAppend(hsvm, id_set);
                HSVM_StringSetUnicode(hsvm, HSVM_RecordCreate(hsvm, zone, tz), *zoneid);

                status = U_ZERO_ERROR;
                rlen = TimeZone::getRegion(*zoneid, region, 5, status);
                if (!U_FAILURE(status))
                    HSVM_StringSet(hsvm, HSVM_RecordCreate(hsvm, zone, code), region, region + rlen);

                tzone.reset(TimeZone::createTimeZone(*zoneid));
                HSVM_StringSetUnicode(hsvm, HSVM_RecordCreate(hsvm, zone, comments), tzone->getDisplayName(locid, str));

                status = U_ZERO_ERROR;
                zoneid = itr->snext(status);
        }
}

void GetCanonicalTimeZoneID(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);

        UnicodeString zoneid = HSVM_StringGetUnicode(hsvm, HSVM_Arg(0));
        UnicodeString canonicalid;

        UErrorCode status = U_ZERO_ERROR;
        TimeZone::getCanonicalID(zoneid, canonicalid, status);
        if (U_FAILURE(status))
            return;

        HSVM_StringSetUnicode(hsvm, id_set, canonicalid);
}

void GetTimeZoneDisplay(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);

        UnicodeString zoneid = HSVM_StringGetUnicode(hsvm, HSVM_Arg(0));
        TimeZone const *zone = getTimeZone(context, zoneid);
        // The return value is guaranteed to be non-NULL, check id to see if the unknown zone is returned
        if (zone->getID(zoneid) == UCAL_UNKNOWN_ZONE_ID)
            return;

        UBool isdst = HSVM_BooleanGet(hsvm, HSVM_Arg(1));

        int type = HSVM_IntegerGet(hsvm, HSVM_Arg(2));
        TimeZone::EDisplayType style;
        switch (type)
        {
                case 1: // Long, localized
                    style = TimeZone::LONG;
                    break;
                case 2: // GMT offset
                    style = TimeZone::SHORT_GMT;
                    break;
                default: // Short
                    style = TimeZone::SHORT;
                    break;
        }

        std::string locale = HSVM_StringGetSTD(hsvm, HSVM_Arg(3));
        Locale locid = getLocale(context, locale);

        UnicodeString str;
        HSVM_StringSetUnicode(hsvm, id_set, zone->getDisplayName(isdst, style, locid, str));
}

void UTCToLocal(HSVM *hsvm, HSVM_VariableId id_set)
{
        doConvertDateTime(hsvm, id_set, false);
}

void LocalToUTC(HSVM *hsvm, HSVM_VariableId id_set)
{
        doConvertDateTime(hsvm, id_set, true);
}

void GetUTCOffset(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Integer);

        UDate value = HSVM_DateTimeGetUnicode(hsvm, HSVM_Arg(0));
        if (value == UDateDefault)
            return;
        UnicodeString zoneid = HSVM_StringGetUnicode(hsvm, HSVM_Arg(1));

        int32_t offset = getDateTimeOffset(context, value, zoneid, true);

        HSVM_IntegerSet(hsvm, id_set, offset);
}

void TimeZoneUsesDST(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Boolean);

        UnicodeString zoneid = HSVM_StringGetUnicode(hsvm, HSVM_Arg(1));
        TimeZone const *zone = getTimeZone(context, zoneid);
        // The return value is guaranteed to be non-NULL, check id to see if the unknown zone is returned
        if (zone->getID(zoneid) == UCAL_UNKNOWN_ZONE_ID)
            return;

        HSVM_BooleanSet(hsvm, id_set, zone->useDaylightTime());
}

void IsLocalTimeDST(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Boolean);

        UDate value = HSVM_DateTimeGetUnicode(hsvm, HSVM_Arg(0));
        if (value == UDateDefault)
            return;

        UnicodeString zoneid = HSVM_StringGetUnicode(hsvm, HSVM_Arg(1));
        TimeZone const *zone = getTimeZone(context, zoneid);
        // The return value is guaranteed to be non-NULL, check id to see if the unknown zone is returned
        if (zone->getID(zoneid) == UCAL_UNKNOWN_ZONE_ID)
            return;

        UErrorCode status = U_ZERO_ERROR;
        UBool isdst = zone->inDaylightTime(value, status);

        if (U_FAILURE(status))
            return;

        HSVM_BooleanSet(hsvm, id_set, isdst);
}

void IsWeekend(HSVM *hsvm, HSVM_VariableId id_set)
{
        ICUContextData &context = *static_cast<ICUContextData *>(HSVM_GetContext(hsvm, ContextId, true));

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Boolean);

        UDate value = HSVM_DateTimeGetUnicode(hsvm, HSVM_Arg(0));
        if (value == UDateDefault)
            return;

        std::string locale = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        Locale locid = getLocale(context, locale);

        TimeZone const *zone = getTimeZone(context, "UTC");

        UErrorCode status = U_ZERO_ERROR;
        std::unique_ptr<Calendar> calendar(Calendar::createInstance(*zone, locid, status));
        if (U_FAILURE(status))
            return;

        UBool isweekend = calendar->isWeekend(value, status);
        if (U_FAILURE(status))
            return;

        HSVM_BooleanSet(hsvm, id_set, isweekend);
}

void GetSystemTimeZone(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);

        std::unique_ptr<TimeZone> timezone(TimeZone::createDefault());
        UnicodeString zoneid;
        timezone->getID(zoneid);
        HSVM_StringSetUnicode(hsvm, id_set, zoneid);
}

} // End of namespace ICU
} // End of namespace HareScript


//---------------------------------------------------------------------------
// Interface
//

extern "C" {

static void *CreateContext(void *)
{
        return new HareScript::ICU::ICUContextData;
}
static void DestroyContext(void *, void *context_ptr)
{
        delete static_cast<HareScript::ICU::ICUContextData *>(context_ptr);
}

BLEXLIB_PUBLIC int HSVM_ModuleEntryPoint(HSVM_RegData *regdata, void *)
{
        HSVM_RegisterFunction(regdata, "__ICU_GETICUVERSION:WH_ICU:S:", HareScript::ICU::GetICUVersion);
        HSVM_RegisterFunction(regdata, "__ICU_GETTZDATAVERSION:WH_ICU:S:", HareScript::ICU::GetTZDataVersion);

        HSVM_RegisterFunction(regdata, "__ICU_GETLOCALEFORLANGTAG:WH_ICU:S:S", HareScript::ICU::GetLocaleForLangTag);
        HSVM_RegisterFunction(regdata, "__ICU_GETLOCALEHOUR12:WH_ICU:B:S", HareScript::ICU::GetLocaleHour12);
        HSVM_RegisterFunction(regdata, "__ICU_GETBESTPATTERN:WH_ICU:S:SS", HareScript::ICU::GetBestPattern);
        HSVM_RegisterFunction(regdata, "__ICU_FORMATDATETIME:WH_ICU:S:SDSS", HareScript::ICU::FormatDateTime);
        HSVM_RegisterFunction(regdata, "__ICU_GETLANGUAGEDATETIMESTRINGS:WH_ICU:SA:S", HareScript::ICU::GetFormatDateTimeString);
        HSVM_RegisterFunction(regdata, "__ICU_FORMATDURATION:WH_ICU:S:6S", HareScript::ICU::FormatDuration);

        HSVM_RegisterFunction(regdata, "__ICU_GETCURRENCYFRACTIONDIGITS:WH_ICU:I:S", HareScript::ICU::GetCurrencyFractionDigits);
        HSVM_RegisterFunction(regdata, "__ICU_FORMATNUMBER:WH_ICU:S:ISBIIIBVS", HareScript::ICU::FormatNumber);
        HSVM_RegisterFunction(regdata, "__ICU_FORMATSPELLOUT:WH_ICU:S:6S", HareScript::ICU::FormatSpellout);
        HSVM_RegisterFunction(regdata, "__ICU_FORMATORDINAL:WH_ICU:S:6SB", HareScript::ICU::FormatOrdinal);

        HSVM_RegisterFunction(regdata, "__ICU_COLLATEDCOMPARE:WH_ICU:I:IBBISSS", HareScript::ICU::CollatedCompare);

        HSVM_RegisterFunction(regdata, "__ICU_GETCOUNTRYLIST:WH_ICU:RA:SA", HareScript::ICU::GetCountryList);
        HSVM_RegisterFunction(regdata, "__ICU_GETLANGUAGELIST:WH_ICU:RA:SA", HareScript::ICU::GetLanguageList);

        HSVM_RegisterFunction(regdata, "__ICU_TOUPPERCASE:WH_ICU:S:SS", HareScript::ICU::ToUppercase);
        HSVM_RegisterFunction(regdata, "__ICU_TOLOWERCASE:WH_ICU:S:SS", HareScript::ICU::ToLowercase);
        HSVM_RegisterFunction(regdata, "__ICU_NORMALIZETEXT:WH_ICU:S:SS", HareScript::ICU::NormalizeText);
        HSVM_RegisterFunction(regdata, "__ICU_TRANSLITERATETEXT:WH_ICU:S:SS", HareScript::ICU::TransliterateText);

        HSVM_RegisterFunction(regdata, "__ICU_GETTIMEZONEIDS:WH_ICU:SA:", HareScript::ICU::GetTimeZoneIDs);
        HSVM_RegisterFunction(regdata, "__ICU_GETALLTIMEZONES:WH_ICU:RA:S", HareScript::ICU::GetAllTimeZones);
        HSVM_RegisterFunction(regdata, "__ICU_GETCANONICALTIMEZONEID:WH_ICU:S:S", HareScript::ICU::GetCanonicalTimeZoneID);
        HSVM_RegisterFunction(regdata, "__ICU_GETTIMEZONEDISPLAY:WH_ICU:S:SBIS", HareScript::ICU::GetTimeZoneDisplay);
        HSVM_RegisterFunction(regdata, "__ICU_UTCTOLOCAL:WH_ICU:D:DS", HareScript::ICU::UTCToLocal);
        HSVM_RegisterFunction(regdata, "__ICU_LOCALTOUTC:WH_ICU:D:DS", HareScript::ICU::LocalToUTC);
        HSVM_RegisterFunction(regdata, "__ICU_GETUTCOFFSET:WH_ICU:I:DS", HareScript::ICU::GetUTCOffset);
        HSVM_RegisterFunction(regdata, "__ICU_TIMEZONEUSESDST:WH_ICU:B:DS", HareScript::ICU::TimeZoneUsesDST);
        HSVM_RegisterFunction(regdata, "__ICU_ISLOCALTIMEDST:WH_ICU:B:DS", HareScript::ICU::IsLocalTimeDST);
        HSVM_RegisterFunction(regdata, "__ICU_ISWEEKEND:WH_ICU:B:DS", HareScript::ICU::IsWeekend);
        HSVM_RegisterFunction(regdata, "__ICU_GETSYSTEMTIMEZONE:WH_ICU:S:", HareScript::ICU::GetSystemTimeZone);

        // Register contexts
        HSVM_RegisterContext (regdata, HareScript::ICU::ContextId, NULL, &CreateContext, &DestroyContext);

        return 1;
}

} // End of extern "C"
