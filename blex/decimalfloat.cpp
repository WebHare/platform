#include <blex/blexlib.h>

#include "decimalfloat.h"
#include "logfile.h"
#include <cmath>
#include <limits>
#include <float.h>

namespace Blex
{

int64_t MoneyMultiply(int64_t val1, int64_t val2)
{
/*  As lossless as possible multiplication of two unsigned MONEYs
    =============================================================

        uint32_t a  =  M(val1) with M = Most Significant DWord (first 32 bits)
        uint32_t b  =  L(val1)      L = Least Significant DWord (last 32 bits)
        uint32_t c  =  M(val2)
        uint32_t d  =  L(val2)

        uint32_t e  =  L(b*d)
        uint64_t f  =  M(b*d) + L(a*d) + L(b*c)
        uint64_t g  =  M(a*d) + M(b*c) + L(a*c) + M(e)
        uint64_t h  =  M(a*c) + M(f)

    We now have (one |........| block represents 32 bits):

                                   |e.......|
                          |L(f)....|        |
                 |L(g)....|        |        |
        |L(h)....|        |        |        |
       --------------------------------------- +
        |U128 result........................|

    Now we must convert to MONEY by dividing by 100000.
    We can see that calculating the temp result h isn't needed,
    because we are only interested in the 64 least significant bits
    of the 128bit result: ((L(h) << 96) / 100000) > 2^64

    fg  =  (L(g) << 32) + L(f)
    r1  =  fg / 100000
    r2  =  (((fg % 100000) << 32) + e) / 100000 (Round to nearest integer!)

    The MONEY result is now:
        uint64_t result  =  (L(r1) << 32) + r2 */

        /* The result of multiplication is negative when one and only one of
           the operands is negative. */
        bool neg = (val1 < 0) ^ (val2 < 0);
        uint64_t v1 = (val1 < 0) ? -val1 : val1;
        uint64_t v2 = (val2 < 0) ? -val2 : val2;


        uint32_t a = static_cast<uint32_t>(v1 >> 32);
        uint32_t b = static_cast<uint32_t>(v1 & 0xFFFFFFFF);
        uint32_t c = static_cast<uint32_t>(v2 >> 32);
        uint32_t d = static_cast<uint32_t>(v2 & 0xFFFFFFFF);

        uint64_t bd = static_cast<uint64_t>(b)*static_cast<uint64_t>(d);
        uint64_t ad = static_cast<uint64_t>(a)*static_cast<uint64_t>(d);
        uint64_t bc = static_cast<uint64_t>(b)*static_cast<uint64_t>(c);
        uint64_t ac = static_cast<uint64_t>(a)*static_cast<uint64_t>(c);

        uint32_t e = static_cast<uint32_t>((bd) & 0xFFFFFFFF);
        uint64_t f = (bd >> 32) + (ad & 0xFFFFFFFF) + (bc & 0xFFFFFFFF);
        uint64_t g = (ad >> 32) + (bc >> 32) + (ac & 0xFFFFFFFF) + (f >> 32);

        uint64_t fg = ((g & 0xFFFFFFFF) << 32) + (f & 0xFFFFFFFF);

        uint64_t r1 = fg / 100000;
        uint64_t ef = (((fg % 100000) << 32) + e);
        uint64_t r2 = ef / 100000;

        // Round to nearest integer (when fraction >= .5 add 1)
        if (((ef / 10000) - (r2 * 10)) >= 5)
            r2 += 1;

        int64_t retval = (neg ? -1 : 1) * ((r1 << 32) + r2);
        return retval;
}

int64_t MoneyDivide(int64_t val1, int64_t val2)
{
/*  As lossless as possible division of two unsigned MONEYs
    =======================================================

    The straightforward result
        result = 100000 * (val1 / val2)
    gives a possible loss of precision at the division, but the
    calculation
        result = (100000 * val1) / val2
    should be more accurate.

        uint32_t a  =  M(val1) with M = Most Significant DWord (first 32 bits)
        uint32_t b  =  L(val1)      L = Least Significant DWord (last 32 bits)

    Multiply by 100000
        uint64_t a  =  100000 * a
        uint64_t b  =  100000 * b
    and add M(b) to a and make b = L(b).

    We now have (one |........| block represents 32 bits):

                          |b.......|
        |a................|
       ------------------------------ +
        |val1*100000...............|

    The division can now be calculated by doing:

       r1  =  a / val2
       c  =  a % val2
       r2  =  (b + (c << 32)) / val2 (Round to nearest integer!)

    The MONEY result is now:
        uint64_t result  =  (L(r1) << 32) + r2

    Note: This is only reliable if c < 2^32 (it's shifted 32 bits to
          the left), so we have to fall back on a basic long devision
          if c >= 2^32. */

        int64_t retval;

        /* The result of division is negative when one and only one of
           the operands is negative. */
        bool neg = (val1 < 0) ^ (val2 < 0);
        uint64_t v1 = (val1 < 0) ? -val1 : val1;
        uint64_t v2 = (val2 < 0) ? -val2 : val2;

        /* Split 100000*v1 into a and b parts. */
        uint64_t a = (v1 >> 32) * 100000;
        uint64_t b = (v1 & 0xFFFFFFFF) * 100000;
        a = a + (b >> 32);
        b = b & 0xFFFFFFFF;

        uint64_t r1 = a / v2;
        uint64_t c1 = a % v2;

        if ((c1 >> 32) == 0)
        {
                // can never overflow, because b < 1<<32.
                b += (c1 << 32);

                uint64_t r2 = b / v2;
                uint64_t c2 = b % v2;

                retval = (r1 << 32) + r2;

                // Round away from zero when c2 >= 0.5 * v2.
                if (c2 > ((v2 - 1) >> 1))
                    ++retval;
        }
        else
        {
                retval = 0;
                for (int bits = 0; bits <= 32; ++bits) // The number of bits we have shifted from b into a
                {
                        retval = retval << 1;
                        if (a >= v2)
                        {
                                a -= v2;
                                ++retval;
                        }
                        a = (a << 1) | ((b >> (31-bits)) & 0x1);
                }
                // Round to nearest integer (when fraction >= .5 add 1)
                if (a >= v2)
                    ++retval;
        }
        return (neg ? -1 : 1) * retval;
}

int64_t IntToMoney(int32_t intval)
{
        return (static_cast<int64_t>(intval)) * 100000;
}

int64_t Int64ToMoney(int64_t intval)
{
        return intval * 100000;
}

F64 MoneyToFloat(int64_t moneyval)
{
        // float division of integers isn't always exact here, test on whole numbers first
        if ((moneyval % 100000LL) == 0)
            return moneyval / 100000LL;
        return (static_cast<F64>(moneyval)) / 100000;
}

bool DecimalFloat::ConvertableToS32() const
{
        if (inaccurate)
            return false;

        if (digits == 0)
            return true;

        uint64_t my_digits = digits;
        short my_exponent = exponent;

        // Normalize
        while (my_exponent < 0 && (my_digits % 10) == 0)
        {
              my_digits /= 10;
              ++my_exponent;
        }

        // Non-0 fraction?
        if (my_exponent < 0)
            return false;

        if (my_exponent == 0)
            return my_digits <= static_cast< uint64_t >(std::numeric_limits< int32_t >::max()) + negate;

        uint32_t max_value = std::numeric_limits< int32_t >::max() / 10; // (MAX int32_t) /10

        for (short idx = 1; max_value && idx < my_exponent; ++idx)
            max_value = max_value / 10;

        return max_value >= my_digits;
}

bool DecimalFloat::ConvertableToMoney(bool mayround) const
{
        if (inaccurate)
            return false;

        if (digits == 0)
            return true;

        uint64_t my_digits = digits;
        short my_exponent = exponent;

        // Normalize
        while (my_exponent < -5 && (my_digits % 10) == 0)
        {
              my_digits /= 10;
              ++my_exponent;
        }

        // Exponent lower than -5 (more than 5 digits after '.' : no money (except when roundable)
        if (my_exponent < -5)
            return mayround;

        // Exponent equal to -5: all digit values are valid
        if (my_exponent == -5)
            return my_digits <= BIGU64NUM(9223372036854775807) + negate;

        uint64_t max_value = BIGU64NUM(922337203685477580); // (MAX int64_t) /10

        for (short idx = -4; max_value && idx != my_exponent; ++idx)
            max_value = max_value / 10;

        return max_value >= my_digits;
}

bool DecimalFloat::ConvertableToFloat() const
{
        // std::isinf(inf) doesn't seem to work, but std::log(inf) == inf
        double val = ToFloat();
        if (fabs(val) > DBL_MAX)
            return false;
        return true;
}

bool DecimalFloat::ConvertableToS64() const
{
        if (inaccurate)
            return false;

        if (digits == 0)
            return true;

        uint64_t my_digits = digits;
        short my_exponent = exponent;

        while (my_exponent < 0 && (my_digits % 10) == 0)
        {
              my_digits /= 10;
              ++my_exponent;
        }

        if (my_exponent < 0)
            return false;

        if (my_exponent == 0)
            return my_digits <= BIGU64NUM(9223372036854775807) + negate;

        uint64_t max_value = BIGU64NUM(922337203685477580); // (MAX int64_t) /10

        for (short idx = 1; max_value && idx != my_exponent; ++idx)
            max_value = max_value / 10;

        return max_value >= my_digits;
}

int32_t DecimalFloat::ToS32() const
{
        return static_cast< int32_t >(ToS64());
}

int64_t DecimalFloat::ToMoney() const
{
        short my_exponent = exponent;
        uint64_t my_digits = digits;

        if (my_digits == 0)
            return 0;

        while (my_exponent > -5)
            --my_exponent, my_digits *= 10;

        if (my_exponent <= -5-19)
            my_digits = 0;
        else
            if (my_exponent < -5)
            {
                    int64_t factor = 1;
                    for (;my_exponent != -5; ++my_exponent)
                        factor *= 10;

                    my_digits = (my_digits + (factor >> 1) - negate) / factor;
            }

        if (my_digits == BIGU64NUM(9223372036854775808))
            return std::numeric_limits< int64_t >::min();

        if (negate)
            return -static_cast< int64_t >(my_digits);

        return my_digits;
}

int64_t DecimalFloat::ToS64() const
{
        uint64_t my_digits = digits;
        short my_exponent = exponent;

        while (my_exponent > 0)
            --my_exponent, my_digits *= 10;

        while (my_exponent < 0)
            ++my_exponent, my_digits /= 10;

        if (my_digits == BIGU64NUM(9223372036854775808))
            return std::numeric_limits< int64_t >::min();

        if (negate)
            return -static_cast< int64_t >(my_digits);

        return my_digits;
}

F64 DecimalFloat::ToFloat() const
{
        // FloatPow10 returns inexact numbers with negative exponents, so divide by negative exponent to stay exact when possible
        F64 res = exponent > 0
            ? digits * FloatPow10(exponent)
            : digits / FloatPow10(-exponent);

        if (negate)
            res = -res;

        return res;
}

DecimalFloat::ParseResult DecimalFloat::ParseNumberString(char const *ptr, char const *limit, char *postfix, const char **finish)
{
        DecimalFloat value;
        uint64_t digits=0;
        short exp=0;
        bool dot=false;
        unsigned tokenlen = limit - ptr;

        if (ptr != limit && *ptr == '0')
        {
                ++ptr;
                if (ptr != limit && (*ptr & 0xDF) == 'X')
                {
                        ++ptr;
                        while (ptr != limit && ((*ptr >= '0' && *ptr <= '9')
                                || ((*ptr & 0xDF) >= 'A' && (*ptr & 0xDF) <= 'F')))
                        {
                                uint64_t newdigits;

                                if (*ptr >= '0' && *ptr <= '9')
                                    newdigits = digits * 16 + (*ptr - '0');
                                else
                                    newdigits = digits * 16 + ((*ptr &0xDF) - 'A') + 10;
                                ++ptr;

                                if (newdigits / 16 != static_cast< uint64_t >(digits)) //overflow?
                                {
                                        digits = BIGU64NUM(0x100000000);
                                        break;
                                }
                                digits = newdigits;
                        }
                        if (digits >= 0x80000000 && digits <= 0xFFFFFFFF) //in signed 32-bit range
                        {
                                value.digits = BIGU64NUM(0x100000000) - digits;
                                value.negate = true;
                        }
                        else
                            value.digits = digits;

                        *this = value;
                        if (postfix)
                            *postfix = 'I';
                        if (finish)
                            *finish = ptr;

                        return PR_Integer;
                }
                if (ptr != limit && (*ptr & 0xDF) == 'B')
                {
                        ++ptr;
                        while (ptr != limit && (*ptr >= '0' && *ptr <= '1'))
                        {
                                uint64_t newdigits = digits * 2 + (*ptr++ - '0');
                                if (newdigits / 2 != static_cast< uint64_t >(digits)) //overflow?
                                {
                                        digits=BIGU64NUM(0x100000000);
                                        break;
                                }
                                digits = newdigits;
                        }

                        if (digits >= 0x80000000 && digits <= 0xFFFFFFFF) //in signed 32-bit range
                        {
                                value.digits = BIGU64NUM(0x100000000) - digits;
                                value.negate = true;
                        }
                        else
                            value.digits = digits;

                        *this = value;
                        if (postfix)
                            *postfix = 'I';
                        if (finish)
                            *finish = ptr;
                        return PR_Integer;
                }
        }

        bool inaccurate=false;
        short zeroes=0;
        short predotzeroes=0;
        uint64_t s64cutoff = BIGU64NUM(1)<<63;
        while (ptr != limit && ((*ptr>='0' && *ptr<='9') || *ptr=='.'))
        {
                if (*ptr != '0' && zeroes)
                {
                        while (zeroes)
                        {
                                uint64_t newdigits = digits * 10;

                                if ((newdigits / 10 != static_cast< uint64_t >(digits)) || (newdigits > s64cutoff) || inaccurate)
                                {
                                        inaccurate = true;
                                        exp += predotzeroes ? 1 : 0;
                                }
                                else
                                {
                                        exp += predotzeroes ? 0 : -1;
                                        digits = newdigits;
                                }
                                --zeroes;
                                if (predotzeroes)
                                    --predotzeroes;
                        }
                }

                if (*ptr=='.')
                {
                        if (!dot)
                        {
                                dot=true;
                        }
                        else
                        {
                                value.digits=0;
                                value.exponent=0;
                                return PR_Error_ExpectedReal;
                        }
                }
                else if (!inaccurate)
                {
                        if (*ptr == '0')
                        {
                                ++zeroes;
                                if (!dot)
                                    ++predotzeroes;
                        }
                        else
                        {
                                uint64_t newdigits = digits * 10 + unsigned(*ptr-'0');

                                if ((newdigits / 10 != static_cast< uint64_t >(digits)) || (newdigits > s64cutoff) || inaccurate)
                                {
                                        inaccurate = true;
                                        exp += dot ? 0 : 1;
                                }
                                else
                                {
                                        exp += dot ? -1 : 0;
                                        digits = newdigits;
                                }
                        }
                }
                else
                    exp += dot ? 0 : 1;
                ++ptr;
        }

        exp += predotzeroes;
        if (dot && tokenlen == 1)
            return PR_Error_ExpectedReal;

        value.digits = digits;
        value.exponent = exp;
        value.inaccurate = inaccurate;

        if (ptr != limit)
        {
                char first_postfix_char = *ptr & 0xDF;
                if (first_postfix_char == 'E' || postfix)
                {
                        switch (first_postfix_char)
                        {
                        case 'E':
                                {
                                        bool negative = false;
                                        if (ptr + 1 == limit)
                                            return PR_Error_IllegalExponent;

                                        ++ptr;
                                        if (*ptr == '+' || *ptr == '-')
                                        {
                                               negative = *ptr == '-';
                                               ++ptr;
                                        }

                                        signed evalue = 0;
                                        bool have_digit = false;

                                        while (ptr != limit && *ptr >= '0' && *ptr <= '9')
                                        {
                                                evalue = evalue * 10 + signed(*ptr - '0');
                                                have_digit = true;
                                                ++ptr;
                                        }

                                        if (!have_digit)
                                            return PR_Error_IllegalExponent;

                                        value.exponent += negative ? -evalue : evalue;
                                        value.inaccurate = true;
                                        first_postfix_char = 'F';
                                } break;
                        case 'I':
                                if (ptr + 1 != limit && ptr + 2 != limit && *(ptr + 1) == '6' && *(ptr + 2) == '4')
                                {
                                        first_postfix_char = '6';
                                        ptr += 2;
                                }
                                if (dot)
                                {
                                        return PR_Error_IllegalIntegerConstant;
                                }
                                break;
                        default: ;
                        }

                        if (postfix)
                            *postfix = first_postfix_char;
                }
        }
        else if (postfix)
            *postfix = ' ';

        *this = value;
        if (finish)
            *finish = ptr;

        return dot ? PR_FloatingPoint : PR_Integer;
}

static F64 powersof10[] =
        { 1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15
        , 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22, 1e23, 1e24, 1e25, 1e26, 1e27, 1e28, 1e29, 1e30, 1e31
        , 1e32, 1e33, 1e34, 1e35, 1e36, 1e37, 1e38, 1e39, 1e40, 1e41, 1e42, 1e43, 1e44, 1e45, 1e46, 1e47
        , 1e48, 1e49, 1e50, 1e51, 1e52, 1e53, 1e54, 1e55, 1e56, 1e57, 1e58, 1e59, 1e60, 1e61, 1e62, 1e63
        , 1e64, 1e65, 1e66, 1e67, 1e68, 1e69, 1e70, 1e71, 1e72, 1e73, 1e74, 1e75, 1e76, 1e77, 1e78, 1e79
        , 1e80, 1e81, 1e82, 1e83, 1e84, 1e85, 1e86, 1e87, 1e88, 1e89, 1e90, 1e91, 1e92, 1e93, 1e94, 1e95
        , 1e96, 1e97, 1e98, 1e99, 1e100, 1e101, 1e102, 1e103, 1e104, 1e105, 1e106, 1e107, 1e108, 1e109, 1e110, 1e111
        , 1e112, 1e113, 1e114, 1e115, 1e116, 1e117, 1e118, 1e119, 1e120, 1e121, 1e122, 1e123, 1e124, 1e125, 1e126, 1e127
        , 1e128, 1e129, 1e130, 1e131, 1e132, 1e133, 1e134, 1e135, 1e136, 1e137, 1e138, 1e139, 1e140, 1e141, 1e142, 1e143
        , 1e144, 1e145, 1e146, 1e147, 1e148, 1e149, 1e150, 1e151, 1e152, 1e153, 1e154, 1e155, 1e156, 1e157, 1e158, 1e159
        , 1e160, 1e161, 1e162, 1e163, 1e164, 1e165, 1e166, 1e167, 1e168, 1e169, 1e170, 1e171, 1e172, 1e173, 1e174, 1e175
        , 1e176, 1e177, 1e178, 1e179, 1e180, 1e181, 1e182, 1e183, 1e184, 1e185, 1e186, 1e187, 1e188, 1e189, 1e190, 1e191
        , 1e192, 1e193, 1e194, 1e195, 1e196, 1e197, 1e198, 1e199, 1e200, 1e201, 1e202, 1e203, 1e204, 1e205, 1e206, 1e207
        , 1e208, 1e209, 1e210, 1e211, 1e212, 1e213, 1e214, 1e215, 1e216, 1e217, 1e218, 1e219, 1e220, 1e221, 1e222, 1e223
        , 1e224, 1e225, 1e226, 1e227, 1e228, 1e229, 1e230, 1e231, 1e232, 1e233, 1e234, 1e235, 1e236, 1e237, 1e238, 1e239
        , 1e240, 1e241, 1e242, 1e243, 1e244, 1e245, 1e246, 1e247, 1e248, 1e249, 1e250, 1e251, 1e252, 1e253, 1e254, 1e255
        , 1e256, 1e257, 1e258, 1e259, 1e260, 1e261, 1e262, 1e263, 1e264, 1e265, 1e266, 1e267, 1e268, 1e269, 1e270, 1e271
        , 1e272, 1e273, 1e274, 1e275, 1e276, 1e277, 1e278, 1e279, 1e280, 1e281, 1e282, 1e283, 1e284, 1e285, 1e286, 1e287
        , 1e288, 1e289, 1e290, 1e291, 1e292, 1e293, 1e294, 1e295, 1e296, 1e297, 1e298, 1e299, 1e300, 1e301, 1e302, 1e303
        , 1e304, 1e305, 1e306, 1e307, 1e308, 0
        };

F64 FloatPow10(int exponent)
{
        if (exponent < -308 || exponent > 308)
            return std::pow(double(10), exponent);

        if (exponent < 0)
            return 1 / powersof10[-exponent];
        return powersof10[exponent];
}

} //end namespace Blex
