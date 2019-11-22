#ifndef blex_decimalfloat
#define blex_decimalfloat

#ifndef blex_blexlib
#include "blexlib.h"
#endif

namespace Blex {

/** Internal float type
    double = digits * (10 ^ exponent) */
struct BLEXLIB_PUBLIC DecimalFloat
{
        inline DecimalFloat() : digits(0), negate(false), exponent(0), inaccurate(false) { }

        /** Converts an internal DecimalFloat value to a int32_t integer value. */
        int32_t ToS32() const;

        /** Converts an internal DecimalFloat value to a int64_t integer value. */
        int64_t ToS64() const;

        /** Converts an internal DecimalFloat value to a MONEY integer value. */
        int64_t ToMoney() const;

        /** Converts an internal DecimalFloat value to a 64bit float value. */
        F64 ToFloat() const;

        /** Returns whether this DecimalFloat value can be converted lossless (optionally rounded) to a MONEY value
            @param mayround Whether rounding is allowed
        */
        bool ConvertableToMoney(bool mayround) const;

        /** Returns whether this DecimalFloat value can be converted to a MONEY integer value (with rounding) */
        //bool RoundableToMoney() const;

        /** Returns whether this DecimalFloat value can be converted to a FLOAT value */
        bool ConvertableToFloat() const;

        /** Returns whether this DecimalFloat value can be converted to a int32_t integer value */
        bool ConvertableToS32() const;

        /** Returns whether this DecimalFloat value can be converted to a int64_t integer value */
        bool ConvertableToS64() const;

        /// Negate the value
        void Negate() { negate = !negate; }

        enum ParseResult
        {
        PR_Integer,
        PR_FloatingPoint,
        PR_Error_ExpectedReal,
        PR_Error_IllegalIntegerConstant,
        PR_Error_IllegalExponent
        };

        /** Parse a token
            @param start
            @param limit
            @param postfix If set, put the postfix at this location (if 0, don't parse the postfix)
            @param finish Filled with end of token
            @return Parse result
        */
        ParseResult ParseNumberString(char const *ptr, char const *limit, char *postfix, const char **finish);

        ///Digits of the real value
        uint64_t digits;
        ///Whether the value needs to be negated
        bool negate;
        ///Exponent of the real value
        short exponent;
        ///Inaccurate?
        bool inaccurate;
};

/** Multiplies two MONEY integer values val1 and val2 and returns the MONEY integer
    result. We can't just multiply the two values and hope for the best, because
    there is a possible loss of significance when we multiply two int64_t values and
    store the result in an int64_t. */
int64_t BLEXLIB_PUBLIC MoneyMultiply(int64_t val1, int64_t val2);

/** Divides two MONEY integer values val1 and val2 and returns the MONEY integer
    result. We can't just divide the two values and hope for the best, because
    there is a possible loss of significance when we divide two int64_t values and
    store the result in an int64_t. */
int64_t BLEXLIB_PUBLIC MoneyDivide(int64_t val1, int64_t val2);

/** Converts an INTEGER value to a MONEY integer value. */
int64_t BLEXLIB_PUBLIC IntToMoney(int32_t intval);

/** Converts an INTEGER64 value to a MONEY integer value. */
int64_t BLEXLIB_PUBLIC Int64ToMoney(int64_t intval);

/** Converts a MONEY value to a FLOAT value. */
F64 BLEXLIB_PUBLIC MoneyToFloat(int64_t moneyval);

/** Get a power of 10 (exact if possible) */
F64 BLEXLIB_PUBLIC FloatPow10(int exponent);

} //end namespace Blex

#endif /* sentry */
