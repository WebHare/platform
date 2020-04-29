#ifndef blex_unicode
#include "../unicode.h"
#endif

#include <iterator>
#include <limits>
#include <cstring>

namespace Blex
{

namespace Detail
{
        extern const uint8_t BLEXLIB_PUBLIC Base64DecoderConversionMap[256];
        extern const uint8_t BLEXLIB_PUBLIC Base64EncoderConversionMap[65];
        extern const uint8_t BLEXLIB_PUBLIC UFSDecoderConversionMap[256];
        extern const uint8_t BLEXLIB_PUBLIC UFSEncoderConversionMap[65];
}

void BLEXLIB_PUBLIC CreateEntity(uint32_t entitycode, std::string *entity);

//--------------------------------------------------------------------------
//
// String to number encodings
//
//--------------------------------------------------------------------------

/* This is the actual encoder class - two versions will be generated, one which
   supports signed types, and one which supports unsigned types */
template <typename NumberType, class OutputIterator, bool Signed>
  class blex_Encoder
{
        public:
        static OutputIterator EncodeNumber(NumberType value, signed radix, OutputIterator output);
};

template <typename NumberType, class OutputIterator>
  class blex_Encoder<NumberType,OutputIterator,false>
{
        public:
        static OutputIterator EncodeNumber(NumberType value, signed radix, OutputIterator output);
};

template <typename NumberType, class OutputIterator>
  class blex_Encoder<NumberType,OutputIterator,true>
{
        public:
        static OutputIterator EncodeNumber(NumberType value, signed radix, OutputIterator output);
};

template <typename NumberType, class OutputIterator>
  OutputIterator blex_Encoder <NumberType,OutputIterator,false>::EncodeNumber(NumberType value, signed radix, OutputIterator output)
{
        //temp conversion buffer
        char buf[128];

        if (radix<2||radix>36) //out of range?
            return output;

        //store the number into buf, reversed
        char *bufptr=buf;

        //always loop at least once
        do
        {
                //Get this number
                uint8_t num = uint8_t(value % radix);
                //Convert to the correct ASCII character, and store it
                *bufptr=char(num >= 10 ? ('A' + num - 10) : ('0' + num));
                ++bufptr;
                //Remove the parsed digit
                value = static_cast<NumberType>(value / radix);
        }
        while (value > 0);

        //now store the result, but in reversed order
        while (bufptr>buf)
        {
                --bufptr;
                *output=*bufptr;
                ++output;
        }
        return output;
}

template <typename NumberType, class OutputIterator>
  inline OutputIterator blex_Encoder<NumberType,OutputIterator,true>::EncodeNumber(NumberType value, signed radix, OutputIterator output)
{
        //temp conversion buffer
        char buf[128];

        if (radix<2||radix>36) //out of range?
            return output;

        //store the number into buf, reversed
        char *bufptr=buf;

        //always loop at least once. First loop has support for negative stuff
        bool is_neg = value < 0;
        if (is_neg)
        {
                *output++='-';

                // Difficult route, to avoid problems with minvalues (-128, -32768, etc), which can't be negated
                signed num = value < -radix ? (-(value + radix)) % radix : (-value) % radix;
                value = static_cast<NumberType>((-(value + num)) / radix);
                *bufptr=char(num >= 10 ? ('A' + num - 10) : ('0' + num));
                ++bufptr;
        }
        if (!is_neg || value != 0)
        {
                        do
                        {
                                //Get this number
                                uint8_t num = uint8_t(value % radix);
                                //Convert to the correct ASCII character, and store it
                                *bufptr=char(num >= 10 ? ('A' + num - 10) : ('0' + num));
                                ++bufptr;
                                //Remove the parsed digit
                                value = static_cast<NumberType>(value / radix);
                        }
                        while (value > 0);
        }

        //now store the result, but in reversed order
        while (bufptr>buf)
        {
                --bufptr;
                *output=*bufptr;
                ++output;
        }
        return output;
}

/* This is the externally called functions - we use the numeric_limits to pick
   the proper decoder (signed or unsigned) at compile-time */
template <typename NumberType, class OutputIterator>
  OutputIterator EncodeNumber(NumberType value, unsigned radix, OutputIterator output)
{
        return blex_Encoder<NumberType, OutputIterator, std::numeric_limits<NumberType>::is_signed> ::EncodeNumber (value,radix,output);
}
template <class OutputIterator>
  OutputIterator EncodeNumber(uint64_t value, unsigned radix, OutputIterator output)
{
        return blex_Encoder<uint64_t, OutputIterator, false> ::EncodeNumber (value,radix,output);
}
template <class OutputIterator>
  OutputIterator EncodeNumber(int64_t value, unsigned radix, OutputIterator output)
{
        return blex_Encoder<int64_t, OutputIterator, true> ::EncodeNumber (value,radix,output);
}

template <typename NumberType, class OutputIterator>
  OutputIterator EncodeNumberRoman(NumberType num, bool uppercase, OutputIterator output)
{
        for (;num>=900;num-=1000) //Anything larger than 2000 can only be done in Ms
        {
                if (num < 1000)
                {
                        *output=uppercase ? 'C' : 'c';
                        ++output;
                        num+=100;
                }
                *output=uppercase ? 'M' : 'm';
                ++output;
        }

        if (num >= 400)
        {
                if (num < 500)
                {
                        *output=uppercase ? 'C' : 'c';
                        ++output;
                        num+=100;
                }
                *output=uppercase ? 'D' : 'd';
                ++output;
                num-=500;
        }

        for (;num>=90;num-=100)
        {
                if (num < 100)
                {
                        *output=uppercase ? 'X' : 'x';
                        ++output;
                        num+=10;
                }
                *output=uppercase ? 'C': 'c';
                ++output;
        }

        if (num >= 40)
        {
                if (num < 50)
                {
                        *output=uppercase ? 'X' : 'x';
                        ++output;
                        num+=10;
                }
                *output=uppercase ? 'L' : 'l';
                ++output;
                num-=50;
        }

        for (;num>=9;num-=10)
        {
                if (num < 10)
                {
                        *output=uppercase ? 'I' : 'i';
                        ++output;
                        num+=1;
                }
                *output=uppercase ? 'X' : 'x';
                ++output;
        }

        if (num >= 4)
        {
                if (num < 5)
                {
                        *output=uppercase ? 'I' : 'i';
                        ++output;
                        num+=1;
                }
                *output=uppercase ? 'V' : 'v';
                ++output;
                num-=5;
        }

        while (num-- > 0)
        {
                *output = uppercase ? 'I' : 'i';
                ++output;
        }
        return output;
}

template <typename NumberType, class OutputIterator>
  OutputIterator EncodeNumberAlpha(NumberType num, bool uppercase, OutputIterator output)
{
        if (num<1)
            return output;

        char whichletter = char((num-1)%26 + (uppercase ? 'A' : 'a'));
        unsigned count = (num+25)/26;

        while (count-- > 0)
        {
                *output=whichletter;
                ++output;
        }
        return output;
}

//ADDME: radix support, overflow detection
template <typename NumberType, class InputIterator>
  std::pair<NumberType,InputIterator> DecodeUnsignedNumber(InputIterator begin, InputIterator end, unsigned radix)
{
        NumberType num=0;
        char max_digit = radix>=10 ? char('9') : char('0'+radix-1);
        char max_char = radix<=10 ? char('A'-1) : char('A'+radix-11);

        for (;begin!=end;++begin)
        {
                if (*begin >= '0' && *begin <= max_digit) //it's a digit
                    num = static_cast<NumberType>(num * radix + *begin-'0');
                else if ((*begin & 0xdf) >= 'A' && (*begin & 0xdf) <= max_char)
                    num = static_cast<NumberType>(num * radix + (*begin&0xdf)-'A' + 10);
                else
                    break;
        }
        return std::make_pair(num,begin);
}

template <typename NumberType, class InputIterator>
  std::pair<NumberType,InputIterator> DecodeSignedNumber(InputIterator begin, InputIterator end, unsigned radix)
{
        char max_digit = radix>=10 ? char('9') : char('0'+radix-1);
        char max_char = radix<=10 ? char('A'-1) : char('A'+radix-11);

        bool sign=false;
        if (end-begin>=2 && (*begin=='-' || *begin=='+')) //check if the number starts with a '+' or '-', followed by 'something'
        {
                if ( (begin[1] >= '0' && begin[1] <= max_digit)
                     || ((begin[1] & 0xdf) >= 'A' && (begin[1] & 0xdf) <= max_char) )
                {
                        if (*begin=='-')
                            sign=true;
                        ++begin;
                }
                else
                {
                        //don't interpret the sign if nothing else follows it!
                        return std::make_pair(0,begin);
                }
        }

        std::pair<NumberType,InputIterator> uns_retval = DecodeUnsignedNumber<NumberType,InputIterator>(begin,end,radix);
        if (sign)
            uns_retval.first=-uns_retval.first;

        return uns_retval;
}

//--------------------------------------------------------------------------
//
// String to string conversions and comparisons: generic implementations
//
//--------------------------------------------------------------------------

template <class charT> inline bool CharCaseLess(charT lhs, charT rhs)
{
        if (lhs>='a' && lhs<='z') lhs&=~(charT)0x20;
        if (rhs>='a' && rhs<='z') rhs&=~(charT)0x20;
        return int(lhs)<int(rhs);
}


template <class Itr> int StrCaseCompare(Itr lhs_begin, Itr lhs_end,
                                        Itr rhs_begin, Itr rhs_end)
{
        while (lhs_begin != lhs_end)
        {
                if (rhs_begin == rhs_end)
                    return 1; //if rhs is longer than lhs, lhs < rhs

                uint8_t lhs = uint8_t(*lhs_begin);
                uint8_t rhs = uint8_t(*rhs_begin);
                if (lhs>='a' && lhs<='z') lhs &= 0xDF; //uppercase converison
                if (rhs>='a' && rhs<='z') rhs &= 0xDF; //uppercase converison

                int difference = int(lhs) - int(rhs);
                if (difference)
                    return difference > 0 ? 1 : -1;

                ++lhs_begin;
                ++rhs_begin;
        }
        return rhs_begin==rhs_end ? 0 : -1;
}

template <class Itr> int StrCaseCompare(Itr lhs_begin, Itr lhs_end,
                                             Itr rhs_begin, Itr rhs_end,
                                             std::size_t maxsize)
{
        while (maxsize>0 && lhs_begin != lhs_end)
        {
                if (rhs_begin == rhs_end)
                    return 1; //if rhs is longer than lhs, lhs < rhs

                uint8_t lhs = uint8_t(*lhs_begin);
                uint8_t rhs = uint8_t(*rhs_begin);
                if (lhs>='a' && lhs<='z') lhs &= 0xDF; //uppercase converison
                if (rhs>='a' && rhs<='z') rhs &= 0xDF; //uppercase converison

                int difference = int(lhs) - int(rhs);
                if (difference)
                    return difference > 0 ? 1 : -1;

                ++lhs_begin;
                ++rhs_begin;
                --maxsize;
        }
        return maxsize==0 || rhs_begin==rhs_end ? 0 : -1;
}

template <class Itr> int StrCompare(Itr lhs_begin, Itr lhs_end,
                                    Itr rhs_begin, Itr rhs_end)
{
        while (lhs_begin != lhs_end)
        {
                if (rhs_begin == rhs_end)
                    return 1; //if rhs is longer than lhs, lhs < rhs

                uint8_t lhs = uint8_t(*lhs_begin);
                uint8_t rhs = uint8_t(*rhs_begin);
                int difference = int(lhs) - int(rhs);
                if (difference)
                    return difference>0 ? 1 : -1;

                ++lhs_begin;
                ++rhs_begin;
        }
        return rhs_begin==rhs_end ? 0 : -1;
}

template <class Itr> int StrCompare(Itr lhs_begin, Itr lhs_end,
                                         Itr rhs_begin, Itr rhs_end,
                                         std::size_t maxsize)
{
        while (maxsize > 0 && lhs_begin != lhs_end)
        {
                if (rhs_begin == rhs_end)
                    return 1; //if rhs is longer than lhs, lhs < rhs
                int difference = int(*lhs_begin) - int(*rhs_begin);
                if (difference)
                    return difference>0 ? 1 : -1;

                ++lhs_begin;
                ++rhs_begin;
                --maxsize;
        }
        return maxsize==0 || rhs_begin==rhs_end ? 0 : -1;
}

template <class LeftC, class RightC> inline int StrCaseCompare(const LeftC &lhs, const RightC &rhs)
{ return StrCaseCompare(lhs.begin(),lhs.end(),rhs.begin(),rhs.end()); }
template <class LeftC, class RightC> inline int StrCaseCompare(const LeftC &lhs, const RightC &rhs,std::size_t maxsize)
{ return StrCaseCompare(lhs.begin(),lhs.end(),rhs.begin(),rhs.end(),maxsize); }
template <class LeftC, class RightC> inline bool StrCaseLike(const LeftC &lhs, const RightC &rhs)
{ return StrCaseLike(lhs.begin(),lhs.end(),rhs.begin(),rhs.end()); }
template <class LeftC, class RightC> inline int StrCompare(const LeftC &lhs, const RightC &rhs)
{ return StrCompare(lhs.begin(),lhs.end(),rhs.begin(),rhs.end()); }
template <class LeftC, class RightC> inline int StrCompare(const LeftC &lhs, const RightC &rhs,std::size_t maxsize)
{ return StrCompare(lhs.begin(),lhs.end(),rhs.begin(),rhs.end(),maxsize); }
template <class LeftC, class RightC> inline bool StrLike(const LeftC &lhs, const RightC &rhs)
{ return StrLike(lhs.begin(),lhs.end(),rhs.begin(),rhs.end()); }
template <class Itr> bool StrCaseLike(Itr lhs_begin, Itr lhs_end,Itr rhs_begin, Itr rhs_end)
  { return StringGlob(rhs_begin, rhs_end, lhs_begin, lhs_end, false); }

template <class stringT> class StrLess
{
        public:
        bool operator() (stringT const &lhs,
                         stringT const &rhs) const
        { return StrCompare(lhs.begin(),lhs.end(),rhs.begin(),rhs.end())<0; }
        template <class pairT>
          bool operator() (std::pair<pairT,pairT> const &lhs,
                           stringT const &rhs) const
          { return StrCompare(lhs.first,lhs.second,&*rhs.begin(),&*rhs.end())<0; }
        bool operator() (Blex::StringPair const &lhs,
                         stringT const &rhs) const
          { return StrCompare(lhs.begin,lhs.end,&*rhs.begin(),&*rhs.end())<0; }
        template <class pairT>
          bool operator() (stringT const &lhs,
                           std::pair<pairT,pairT> const &rhs) const
          { return StrCompare(&*lhs.begin(),&*lhs.end(),rhs.first,rhs.second)<0; }
        bool operator() (stringT const &lhs,
                         Blex::StringPair const &rhs) const
          { return StrCompare(&*lhs.begin(),&*lhs.end(),rhs.begin,rhs.end)<0; }
};

template <> class StrLess< Blex::StringPair >
{
        public:
        bool operator() (Blex::StringPair const &lhs,
                         Blex::StringPair const &rhs) const
        { return StrCompare(lhs.begin,lhs.end,rhs.begin,rhs.end)<0; }
};

template <class stringT> class StrCaseLess
{
        public:
        bool operator() (stringT const &lhs,
                         stringT const &rhs) const
        { return StrCaseCompare(lhs.begin(),lhs.end(),rhs.begin(),rhs.end())<0; }
        template <class pairT>
          bool operator() (std::pair<pairT,pairT> const &lhs,
                           stringT const &rhs) const
          { return StrCaseCompare(lhs.first,lhs.second,&*rhs.begin(),&*rhs.end())<0; }
        bool operator() (Blex::StringPair const &lhs,
                         stringT const &rhs) const
          { return StrCaseCompare(lhs.begin,lhs.end,&*rhs.begin(),&*rhs.end())<0; }
        template <class pairT>
          bool operator() (stringT const &lhs,
                           std::pair<pairT,pairT> const &rhs) const
          { return StrCaseCompare(&*lhs.begin(),&*lhs.end(),rhs.first,rhs.second)<0; }
        bool operator() (stringT const &lhs,
                         Blex::StringPair const &rhs) const
          { return StrCaseCompare(&*lhs.begin(),&*lhs.end(),rhs.begin,rhs.end)<0; }
};

template <> class StrCaseLess< Blex::StringPair >
{
        public:
        bool operator() (Blex::StringPair const &lhs,
                         Blex::StringPair const &rhs) const
        { return StrCaseCompare(lhs.begin,lhs.end,rhs.begin,rhs.end)<0; }
};


//--------------------------------------------------------------------------
//
// Encoders
//
//--------------------------------------------------------------------------
inline char blex_stringmanip_SingleByteToHex(int byte)
{
        return byte>=10 ? char(byte-10+'A') : char(byte+'0');
}

template <class InputIterator, class OutputIterator> OutputIterator EncodeBase16(InputIterator begin, InputIterator end, OutputIterator output)
{
        for (;begin!=end;++begin)
        {
                *output++=blex_stringmanip_SingleByteToHex(uint8_t(*begin)>>4);
                *output++=blex_stringmanip_SingleByteToHex(uint8_t(*begin)&0xf);
        }
        return output;
}

inline char blex_stringmanip_SingleByteToHex_LC(int byte)
{
        return byte>=10 ? char(byte-10+'a') : char(byte+'0');
}

template <class InputIterator, class OutputIterator> OutputIterator EncodeBase16_LC(InputIterator begin, InputIterator end, OutputIterator output)
{
        for (;begin!=end;++begin)
        {
                *output++=blex_stringmanip_SingleByteToHex_LC(uint8_t(*begin)>>4);
                *output++=blex_stringmanip_SingleByteToHex_LC(uint8_t(*begin)&0xf);
        }
        return output;
}

template <class InputIterator, class OutputIterator> OutputIterator EncodeBase64(InputIterator begin,InputIterator end, OutputIterator output)
{
        unsigned loc=0,bits=0;
        while(begin!=end)
        {
                uint8_t input=*begin;

                switch(loc)
                {
                case 0: //output bits 7-2 of byte 0, store bits 1-0
                        *output++ = Detail::Base64EncoderConversionMap[uint8_t(input>>2)];
                        bits=input&0x3;
                        loc=1;
                        break;
                case 1: //output bits 1-0 of byte 0, bits 7-4 of byte 1, store bits 3-0
                        *output++ = Detail::Base64EncoderConversionMap[uint8_t( (bits<<4) | (input>>4) )];
                        bits=input&0xF;
                        loc=2;
                        break;
                case 2: //output bits 3-0 of byte 1, bits 7-6 of byte 2
                        *output++ = Detail::Base64EncoderConversionMap[uint8_t( (bits<<2) | (input>>6) )];
                        //output bits 5-0 of byte 2
                        *output++ = Detail::Base64EncoderConversionMap[uint8_t( input&0x3F )];
                        loc=0;
                        break;
                }
                ++begin;
        }
        //pad mime bytes, if necessary
        switch (loc)
        {
                case 1: //output bits 6-7 of byte 0
                        *output++ = Detail::Base64EncoderConversionMap[uint8_t(bits<<4)];
                        //pad 2 bytes
                        *output++ = '=';
                        *output++ = '=';
                        break;
                case 2: //output bits 4-7 of bytes 1,
                        *output++ = Detail::Base64EncoderConversionMap[uint8_t(bits<<2)];
                        //pad 1 byte
                        *output++ = '=';
                        break;
        }
        return output;
}

template <class InputIterator, class OutputIterator> OutputIterator EncodeUFS(InputIterator begin,InputIterator end, OutputIterator output)
{
        unsigned loc=0,bits=0;
        while(begin!=end)
        {
                uint8_t input=*begin;

                switch(loc)
                {
                case 0: //output bits 7-2 of byte 0, store bits 1-0
                        *output++ = Detail::UFSEncoderConversionMap[uint8_t(input>>2)];
                        bits=input&0x3;
                        loc=1;
                        break;
                case 1: //output bits 1-0 of byte 0, bits 7-4 of byte 1, store bits 3-0
                        *output++ = Detail::UFSEncoderConversionMap[uint8_t( (bits<<4) | (input>>4) )];
                        bits=input&0xF;
                        loc=2;
                        break;
                case 2: //output bits 3-0 of byte 1, bits 7-6 of byte 2
                        *output++ = Detail::UFSEncoderConversionMap[uint8_t( (bits<<2) | (input>>6) )];
                        //output bits 5-0 of byte 2
                        *output++ = Detail::UFSEncoderConversionMap[uint8_t( input&0x3F )];
                        loc=0;
                        break;
                }
                ++begin;
        }
        switch (loc)
        {
                case 1: //output bits 6-7 of byte 0
                        *output++ = Detail::UFSEncoderConversionMap[uint8_t(bits<<4)];
                        break;
                case 2: //output bits 4-7 of bytes 1,
                        *output++ = Detail::UFSEncoderConversionMap[uint8_t(bits<<2)];
                        break;
        }
        return output;
}

template <class InputIterator, class OutputIterator> OutputIterator EncodeValue(InputIterator begin,InputIterator end, OutputIterator output)
{
        UTF8DecodeMachine decoder;

        for (;begin!=end;++begin)
        {
                uint32_t curch = decoder(*begin);
                if (curch == UTF8DecodeMachine::NoChar || curch==UTF8DecodeMachine::InvalidChar || (curch<32 && curch!=9 && curch!=10 && curch!=13)) //non-space control chars can't be represented in X/HTML
                    continue;

                if (curch>=32 && curch<128 && curch!='"' && curch!='\'' && curch!='&' && curch!='<' && curch!='>')
                {
                        *output++=static_cast<char>(curch);
                        continue;
                }

                *output++='&';
                *output++='#';
                output = EncodeNumber(curch,10,output);
                *output++=';';
        }
        return output;
}

inline bool IsHTMLUnrepresentableChar(uint32_t curch)
{
        return curch == UTF8DecodeMachine::NoChar
            || curch == UTF8DecodeMachine::InvalidChar
            || (curch < 32 && curch != 9 && curch != 10 && curch != 13)  //non-space control chars can't be represented in X/HTML
            || (curch >= 128 && curch <= 159); //C1 control characters are useless too
}

template <class InputIterator, class OutputIterator> OutputIterator EncodeHtml(InputIterator begin,InputIterator end, OutputIterator output)
{
        UTF8DecodeMachine decoder;

        for (;begin!=end;++begin)
        {
                uint32_t curch = decoder(*begin);
                if (IsHTMLUnrepresentableChar(curch))
                    continue;

                if (curch >= 32 && curch < 128 && curch != '&' && curch != '<' && curch != '>')
                {
                        *output ++= char(curch);
                        continue;
                }

                if (curch=='\r')
                    continue;

                if (curch=='\n')
                {
                        static const char br_tag[]="<br />";
                        output = std::copy(br_tag, br_tag + 6, output);
                        continue;
                }

                *output ++= '&';
                *output ++= '#';
                output = EncodeNumber(curch,10,output);
                *output ++= ';';
        }
        return output;
}

template <class InputIterator, class OutputIterator> OutputIterator EncodeTextNode(InputIterator begin,InputIterator end, OutputIterator output)
{
        UTF8DecodeMachine decoder;

        for (; begin!=end; ++begin)
        {
                uint32_t curch = decoder(*begin);
                if (IsHTMLUnrepresentableChar(curch))
                    continue;

                if (curch == '&')
                {
                        static const char amp[] = "&amp;";
                        output = std::copy(amp, amp + 5,output);
                        continue;
                }
                if (curch == '<')
                {
                        static const char lt[] = "&lt;";
                        output = std::copy(lt, lt + 4,output);
                        continue;
                }
                if (curch == '>')
                {
                        static const char gt[] = "&gt;";
                        output = std::copy(gt, gt + 4,output);
                        continue;
                }

                if (curch < 128)
                {
                        *output ++= char(curch);
                }
                else
                {
                        UTF8Encoder encoder(output);
                        encoder(curch);
                        continue;
                }
        }
        return output;
}

inline char blex_stringmanip_SafeURLChar(int character)
{
        return ( (character>='A'&&character<='Z') || (character>='a'&&character<='z') || (character>='0' && character<='9')
                 || character=='-' || character=='(' || character==')' || character=='.'
                 || character=='_' || character=='$' || character=='!' || character=='/'
                 || character>=256);
}

template <class InputIterator, class OutputIterator> OutputIterator EncodeUrl(InputIterator begin,InputIterator end, OutputIterator output)
{
        for (;begin!=end;++begin)
        {
                if (blex_stringmanip_SafeURLChar(*begin))
                {
                        *output++=*begin;
                }
                else
                {
                        *output++='%';
                        output=EncodeBase16(begin,begin+1,output);
                }
        }
        return output;
}

namespace Detail
{
template <class InputIterator, class OutputIterator, bool encode_invalid_utf8> OutputIterator EncodeJavaInternal(InputIterator begin,InputIterator end, OutputIterator output, bool json_compatible)
{
        UTF8DecodeMachine decoder;

        // The UTF-8 decoders handles sequences of up to 6 bytes, so need a buffer of that size
        uint8_t char_buf[6];
        unsigned char_buf_cnt = 0;

        for (;begin!=end;++begin)
        {
        retry_parse:
                uint32_t curch = decoder(*begin);
                if (encode_invalid_utf8)
                {
                        char_buf[char_buf_cnt++] = *begin;
                        if (curch == UTF8DecodeMachine::NoChar)
                            continue;
                        if (curch == UTF8DecodeMachine::InvalidChar || curch == 0)
                        {
                                // Retry parsing the character we just added if it is the 2+ char, and can start a valid character
                                bool retry_last_char = char_buf_cnt > 1 && (*begin < 128 || *begin >= 192);
                                if (retry_last_char)
                                    --char_buf_cnt;
                                for (auto itr = char_buf; itr < char_buf + char_buf_cnt; ++itr)
                                {
                                        *output++ = '\\'; //insert it as /tXX
                                        *output++ = 'x';
                                        *output++ = blex_stringmanip_SingleByteToHex( (*itr>>4)&0xF );
                                        *output++ = blex_stringmanip_SingleByteToHex( (*itr)&0xF );
                                }
                                char_buf_cnt = 0;

                                if (retry_last_char)
                                    goto retry_parse;
                                continue;
                        }
                        char_buf_cnt = 0;
                }
                else
                {
                        if (curch == UTF8DecodeMachine::NoChar || curch == UTF8DecodeMachine::InvalidChar || curch==0)
                            continue;
                }

                switch(curch)
                {
                case 8:    /* \b */ *output++='\\'; *output++='b'; break;
                case 12:   /* \f */ *output++='\\'; *output++='f'; break;
                case 10:   /* \n */ *output++='\\'; *output++='n'; break;
                case 13:   /* \r */ *output++='\\'; *output++='r'; break;
                case 9:    /* \t */ *output++='\\'; *output++='t'; break;
                case '<':
                        if(begin+1 != end && begin[1]=='/') //escape </ as <\/
                        {
                                *output++='<';
                                *output++='\\';
                                *output++='/';
                                ++begin;
                                break;
                        }
                        else
                        {
                                *output++='<';
                                break;
                        }
                case '\\': /* \\ */ *output++='\\'; *output++='\\'; break;
                case '\"': /* \" */ *output++='\\'; *output++='\"'; break;
                case '\'': /* \' */
                        {
                                if (!json_compatible)
                                    *output++='\\';
                                *output++='\'';
                        } break;
                default:
                        if (curch < 32 || curch>=0x7F) //unacceptable character ? ADDME: chars >2^16?
                        {
                                if (curch < 65536)
                                {
                                        *output++ = '\\'; //insert it as /uXXXX
                                        *output++ = 'u';
                                        *output++ = blex_stringmanip_SingleByteToHex( (curch>>12)&0xF );
                                        *output++ = blex_stringmanip_SingleByteToHex( (curch>>8)&0xF );
                                        *output++ = blex_stringmanip_SingleByteToHex( (curch>>4)&0xF );
                                        *output++ = blex_stringmanip_SingleByteToHex( (curch)&0xF );
                                }
                                else
                                {
                                        // use UTF-16 encoding, see http://tools.ietf.org/html/rfc2781#section-2.1
                                        curch -= 0x10000;

                                        unsigned w1 = (curch >> 10) + 0xD800;
                                        unsigned w2 = (curch & 1023) + 0xDC00;

                                        *output++ = '\\'; //insert it as /uXXXX/uYYYY
                                        *output++ = 'u';
                                        *output++ = blex_stringmanip_SingleByteToHex( (w1>>12)&0xF );
                                        *output++ = blex_stringmanip_SingleByteToHex( (w1>>8)&0xF );
                                        *output++ = blex_stringmanip_SingleByteToHex( (w1>>4)&0xF );
                                        *output++ = blex_stringmanip_SingleByteToHex( (w1)&0xF );
                                        *output++ = '\\'; //insert it as /uXXXX/uYYYY
                                        *output++ = 'u';
                                        *output++ = blex_stringmanip_SingleByteToHex( (w2>>12)&0xF );
                                        *output++ = blex_stringmanip_SingleByteToHex( (w2>>8)&0xF );
                                        *output++ = blex_stringmanip_SingleByteToHex( (w2>>4)&0xF );
                                        *output++ = blex_stringmanip_SingleByteToHex( (w2)&0xF );
                                }
                        }
                        else
                        {
                                *output++ = curch;
                        }
                }
        }

        if (encode_invalid_utf8)
        {
                for (auto itr = char_buf; itr < char_buf + char_buf_cnt; ++itr)
                {
                        *output++ = '\\'; //insert it as /tXX
                        *output++ = 'x';
                        *output++ = blex_stringmanip_SingleByteToHex( (*itr>>4)&0xF );
                        *output++ = blex_stringmanip_SingleByteToHex( (*itr)&0xF );
                }
        }

        return output;
}
}//end namespace Detail

template <class InputIterator, class OutputIterator> OutputIterator EncodeJava(InputIterator begin,InputIterator end, OutputIterator output)
{
        return Detail::EncodeJavaInternal< InputIterator, OutputIterator, false>(begin, end, output, false);
}

template <class InputIterator, class OutputIterator> OutputIterator EncodeHarescript(InputIterator begin,InputIterator end, OutputIterator output)
{
        return Detail::EncodeJavaInternal< InputIterator, OutputIterator, true>(begin, end, output, false);
}

template <class InputIterator, class OutputIterator> OutputIterator EncodeJSON(InputIterator begin,InputIterator end, OutputIterator output)
{
        return Detail::EncodeJavaInternal< InputIterator, OutputIterator, false>(begin, end, output, true);
}

template <class InputIterator, class OutputIterator> OutputIterator EncodeHSON(InputIterator begin,InputIterator end, OutputIterator output)
{
        return Detail::EncodeJavaInternal< InputIterator, OutputIterator, true>(begin, end, output, true);
}

//--------------------------------------------------------------------------
//
// Decoders
//
//--------------------------------------------------------------------------

/// Base16 decoder object
template <class OutputIterator> class DecoderBase16
{
        int curval;

        public:
        /** Initialize the decoder, waiting for a byte */
        DecoderBase16(OutputIterator _output)
        : curval(-1)
        , output(_output)
        { }

        /** Convert a hexadecimal char to its true value */
        int HexToInt(char inputbyte)
        {
                if (inputbyte>='0' && inputbyte<='9') return uint8_t(inputbyte - '0');
                if (inputbyte>='A' && inputbyte<='F') return uint8_t(inputbyte - 'A' + 10);
                if (inputbyte>='a' && inputbyte<='f') return uint8_t(inputbyte - 'a' + 10);
                return -1;
        }

        /** Decode a single byte. Return the byte, or -1 if we can't
            decode anything yet */
        void operator() (char inputbyte)
        {
                //Just record this byte
                if (curval==-1)
                {
                        curval=HexToInt(inputbyte) << 4;
                }
                else
                {
                        //Combine inputbyte and stored, and return this new value
                        *output++=uint8_t(HexToInt(inputbyte) | curval);
                        curval=-1;
                }
        }

        OutputIterator output;
};


template <class InputIterator, class OutputIterator> OutputIterator DecodeBase16(InputIterator begin,InputIterator end, OutputIterator output)
{
        DecoderBase16<OutputIterator &> out(output);
        std::for_each(begin,end,out);
        return out.output;
}

/// Url decoder object
template <class OutputIterator> class DecoderUrl
{
        /** Convert a hexadecimal char to its true value */
        inline int HexToInt(char inputbyte)
        {
                if (inputbyte>='0' && inputbyte<='9')
                    return inputbyte-'0';
                inputbyte &= 0xdf;
                if (inputbyte>='A' && inputbyte<='F')
                    return inputbyte -'A' + 10;
                return 0;
        };

        int bytevalue;
        int special;

        public:
        DecoderUrl (OutputIterator _output)
        : bytevalue(0)
        , special(0)
        , output(_output)
        { }

        void operator() (char inputbyte)
        {
                if (special==0) //normal text
                {
                        if (inputbyte=='%')
                            special=1;
                        else
                            *output++=inputbyte;
                }
                else if (special==1) //first hex char
                {
                        bytevalue=HexToInt(inputbyte);
                        ++special;
                }
                else if (special==2) //second hex char
                {
                        *output++ = static_cast<char>((bytevalue<<4) | HexToInt(inputbyte));
                        special=0;
                }
        }

        OutputIterator output;
};
template <class InputIterator, class OutputIterator> OutputIterator DecodeUrl(InputIterator begin,InputIterator end, OutputIterator output)
{
        DecoderUrl<OutputIterator &> out(output);
        std::for_each(begin,end,out);
        return out.output;
}

/// Java decoder object
namespace Detail
{

template <class OutputIterator> class DecoderJava
{
        uint8_t special;
        uint32_t bytevalue;
        std::string entitytemp;

        /** Convert a hexadecimal char to its true value */
        uint8_t HexToInt(char inputbyte)
        {
                if (inputbyte>='0' && inputbyte<='9') return (uint8_t)(inputbyte - '0');
                if (inputbyte>='A' && inputbyte<='F') return (uint8_t)(inputbyte - 'A' + 10);
                if (inputbyte>='a' && inputbyte<='f') return (uint8_t)(inputbyte - 'a' + 10);
                return 255;
        }

        public:
        DecoderJava (OutputIterator _output)
        : special(0)
        , bytevalue(0)
        , output(_output)
        { }

        /** Flush any partial encoded character (required to properly deal with \0 etc characters) */
        void Flush()
        {
                if (special>1&&special!=4) //partial code
                    *output++ = bytevalue;
                special=0;
        }

        void operator() (char inputbyte);

        OutputIterator output;
};

template <class OutputIterator>
  void DecoderJava<OutputIterator>::operator() (char inputbyte)
{
        uint8_t singlebyte;

        switch (special)
        {
        case_0:
        case 0: //normal text..
                if (inputbyte=='\\')
                    special=1;
                else
                    *output++=inputbyte;
                break;
        case 1: //after a backslash
                switch (inputbyte)
                {
                case 'a':  *output++='\a'; special = 0; return;
                case 'b':  *output++='\b'; special = 0; return;
                case 'f':  *output++='\f'; special = 0; return;
                case 'n':  *output++='\n'; special = 0; return;
                case 'r':  *output++='\r'; special = 0; return;
                case 't':  *output++='\t'; special = 0; return;
                case '\\': *output++='\\'; special = 0; return;
                case '\'': *output++='\''; special = 0; return;
                case '\"': *output++='\"'; special = 0; return;
                case 'x': special=4; return;
                case 'u': special=6; return;
                }

                if (inputbyte>='0' && inputbyte<='3')
                {
                        special=2;
                        bytevalue=uint8_t(inputbyte-'0');
                }
                else
                {
                        Flush();
                        goto case_0;
                }
                break;
        case 2: //second number of an octal code
                if (inputbyte>='0' && inputbyte<='7')
                {
                        special=3;
                        bytevalue=uint8_t(bytevalue * 8 + (inputbyte-'0'));
                        break;
                }
                Flush();
                goto case_0;
        case 3: //third number of an octal code
                if (inputbyte>='0' && inputbyte<='7')
                {
                        *output++ = char(bytevalue * 8 + (inputbyte-'0'));
                        special = 0;
                        break;
                }
                Flush();
                goto case_0;
        case 4: //first number of a hex code
                singlebyte = HexToInt(inputbyte);
                if(singlebyte==255)
                {
                        Flush();
                        goto case_0;
                }

                bytevalue = singlebyte;
                special=5;
                break;
        case 5: //second number of a hex code
                singlebyte = HexToInt(inputbyte);
                if(singlebyte==255)
                {
                        Flush();
                        goto case_0;
                }

                *output++=(bytevalue<<4) | singlebyte;
                special=0;
                break;
        case 6: //first number of \u hex code
                singlebyte = HexToInt(inputbyte);
                if(singlebyte==255)
                {
                        Flush();
                        goto case_0;
                }

                bytevalue = singlebyte<<12;
                special=7;
                break;
        case 7: //second number of \u hex code
                singlebyte = HexToInt(inputbyte);
                if(singlebyte==255)
                {
                        Flush();
                        goto case_0;
                }

                bytevalue |= singlebyte<<8;
                special=8;
                break;
        case 8: //third number of \u hex code
                singlebyte = HexToInt(inputbyte);
                if(singlebyte==255)
                {
                        Flush();
                        goto case_0;
                }

                bytevalue |= singlebyte<<4;
                special=9;
                break;
        case 9: //fourth number of \u hex code
                singlebyte = HexToInt(inputbyte);
                if(singlebyte==255)
                {
                        Flush();
                        goto case_0;
                }
                bytevalue |= singlebyte;
                if (bytevalue >= 0xD800 && bytevalue <= 0xDF00) // UTF-16 surrogate pair
                {
                        // http://tools.ietf.org/html/rfc2781#section-2.2
                        if (bytevalue >= 0xDC00)
                        {
                                Flush();
                                goto case_0;
                        }
                        bytevalue = ((bytevalue & 1023) << 10) + 0x10000;
                        special = 10;
                        break;
                }
                CreateEntity(bytevalue, &entitytemp);
                output=std::copy(entitytemp.begin(),entitytemp.end(),output);
                special=0;
                break;
        case 10: //second \ of UTF-16 surrugate pair \uD(8-B)XX\uD(C-F)YY
                if (inputbyte != '\\')
                {
                        Flush();
                        goto case_0;
                }
                special=11;
                break;
        case 11: //second u of UTF-16 surrugate pair \uD(8-B)XX\uD(C-F)YY
                if (inputbyte != 'u')
                {
                        Flush();
                        goto case_0;
                }
                special=12;
                break;
        case 12: //first nr of secord part of UTF-16 surrogate pair
                singlebyte = HexToInt(inputbyte);
                if (singlebyte != 0xD)
                {
                        Flush();
                        goto case_0;
                }
                special=13;
                break;
        case 13: //second nr of secord part of UTF-16 surrogate pair. Must be between C & F
                singlebyte = HexToInt(inputbyte);
                if (singlebyte < 0xC)
                {
                        Flush();
                        goto case_0;
                }
                bytevalue |= (singlebyte & 3) << 8;
                special=14;
                break;
        case 14: //third nr of secord part of UTF-16 surrogate pair.
                singlebyte = HexToInt(inputbyte);
                bytevalue |= singlebyte << 4;
                special=15;
                break;
        case 15: //fourth nr of secord part of UTF-16 surrogate pair.
                singlebyte = HexToInt(inputbyte);
                bytevalue |= singlebyte;
                CreateEntity(bytevalue, &entitytemp);
                output=std::copy(entitytemp.begin(),entitytemp.end(),output);
                special=0;
                break;
        }
}
}//end namespace Detail

template <class InputIterator, class OutputIterator> OutputIterator DecodeJava(InputIterator begin,InputIterator end, OutputIterator output)
{
        Detail::DecoderJava<OutputIterator> out(output);
        for (;begin!=end;++begin)
            out(*begin);
        out.Flush();
        return out.output;
}

/** Base-64 decoder class. Maps 4x6 bits to 3x8 bits */
template <class OutputIterator> class DecoderBase64
{
        int bytecount;
        int savebyte;

        public:
        /** Initialize the decoder, waiting for a byte */
        inline DecoderBase64(OutputIterator _output) : savebyte(0), output(_output)
        {
                bytecount=0;
        }

        /** Decode a single byte. Return the byte, or -1 if we can't
            decode anything yet */
        inline void operator() (char inputbyte)
        {
                if (inputbyte=='=') //just a filler byte
                    return;

                uint8_t truebyte=Detail::Base64DecoderConversionMap[uint8_t(inputbyte)];
                if (truebyte == 0xff)
                    return; //noise byte

                if (bytecount==0) //First byte, contains 6 high bits of byte 0
                {
                        savebyte=truebyte;
                        ++bytecount;
                }
                else if (bytecount==1) //Second byte, contains 2 low bits of byte 0, and 4 high bits of byte 1
                {
                        *output++=uint8_t(savebyte << 2) | uint8_t(truebyte >> 4);
                        savebyte=truebyte;
                        ++bytecount;
                }
                else if (bytecount==2) ////Third byte, contains 4 low bits of byte 1 and 2 high bits of byte 2
                {
                        *output++=uint8_t(savebyte<<4) | uint8_t(truebyte >> 2);
                        savebyte=truebyte;
                        ++bytecount;
                }
                else if (bytecount==3) //Fourth byte, contains the 6 low bits of byte 3;
                {
                        bytecount=0;
                        *output++=uint8_t(savebyte<<6) | truebyte;
                }
        }

        OutputIterator output;
};

template <class InputIterator, class OutputIterator> OutputIterator DecodeBase64(InputIterator begin,InputIterator end, OutputIterator output)
{
        DecoderBase64<OutputIterator &> out(output);
        std::for_each(begin,end,out);
        return out.output;
}

/** Base-64 decoder class. Maps 4x6 bits to 3x8 bits */
template <class OutputIterator> class DecoderUFS
{
        int bytecount;
        int savebyte;

        public:
        /** Initialize the decoder, waiting for a byte */
        inline DecoderUFS(OutputIterator _output) : savebyte(0), output(_output)
        {
                bytecount=0;
        }

        /** Decode a single byte. Return the byte, or -1 if we can't
            decode anything yet */
        inline void operator() (char inputbyte)
        {
                uint8_t truebyte=Detail::UFSDecoderConversionMap[uint8_t(inputbyte)];
                if (truebyte == 0xff)
                    return; //noise byte

                if (bytecount==0) //First byte, contains 6 high bits of byte 0
                {
                        savebyte=truebyte;
                        ++bytecount;
                }
                else if (bytecount==1) //Second byte, contains 2 low bits of byte 0, and 4 high bits of byte 1
                {
                        *output++=uint8_t(savebyte << 2) | uint8_t(truebyte >> 4);
                        savebyte=truebyte;
                        ++bytecount;
                }
                else if (bytecount==2) ////Third byte, contains 4 low bits of byte 1 and 2 high bits of byte 2
                {
                        *output++=uint8_t(savebyte<<4) | uint8_t(truebyte >> 2);
                        savebyte=truebyte;
                        ++bytecount;
                }
                else if (bytecount==3) //Fourth byte, contains the 6 low bits of byte 3;
                {
                        bytecount=0;
                        *output++=uint8_t(savebyte<<6) | truebyte;
                }
        }

        OutputIterator output;
};

template <class InputIterator, class OutputIterator> OutputIterator DecodeUFS(InputIterator begin,InputIterator end, OutputIterator output)
{
        DecoderUFS<OutputIterator &> out(output);
        std::for_each(begin,end,out);
        return out.output;
}

//--------------------------------------------------------------------------
//
// String to string conversions and comparisons: complex comparisons
//--------------------------------------------------------------------------
template <class Iterator>
   bool StringGlob(Iterator mask_ptr,Iterator mask_end,
                            Iterator check_ptr,Iterator check_end,
                            bool case_sensitive)
{
        Iterator mask_retry = Iterator();
        Iterator check_retry = Iterator();
        bool have_retry_point = false;

        while (true)
        {
                if (mask_ptr == mask_end) //end of pattern
                {
                        if (check_ptr != check_end) //not at end of text, retry
                        {
                                if (!have_retry_point)
                                    return false;

                                mask_ptr = mask_retry;
                                check_ptr = ++check_retry;
                                continue;
                        }
                        else //end of text too, match
                        {
                                return true;
                        }
                }

                if (*mask_ptr == '*') //forget all we parsed so far, always retry here..
                {
                        mask_retry = ++mask_ptr;
                        if(mask_retry == mask_end) //common case, mask ending with '*'
                           return true;//Then it's a definite match!

                        check_retry = check_ptr;
                        have_retry_point = true;
                        continue;
                }

                if (check_ptr == check_end)
                {
                        return false; //end of text, not end of pattern, failure
                }

                uint32_t curmask = *mask_ptr;
                uint32_t curchar = *check_ptr;
                if (!case_sensitive)
                {
                        if (curmask>='a'&&curmask<='z') curmask -= 32;
                        if (curchar>='a'&&curchar<='z') curchar -= 32;
                }

                if (curmask == '?' || curmask == curchar)
                {
                        //Match!
                        ++mask_ptr;
                        ++check_ptr;
                }
                else
                {
                        //Mismatch!
                        if (!have_retry_point)
                            return false;

                        mask_ptr = mask_retry;
                        check_ptr = ++check_retry;
                }
        }
}


template <class ContainerType> class TokenIterator
{
        typename ContainerType::const_iterator tokenstart, tokenend, limit;
        typename ContainerType::value_type const splitter;
        bool eot; //<end of text

        public:
        TokenIterator(typename ContainerType::const_iterator start,
                               typename ContainerType::const_iterator limit,
                               typename ContainerType::value_type const splitter)
        : tokenstart(start)
        , limit(limit)
        , splitter(splitter)
        , eot(false)
        {
                tokenend = std::find(tokenstart,limit,splitter);
        }

        operator bool() const
        {
                return !eot;
        }
        TokenIterator& operator ++()
        {
                if (tokenend == limit) //End of text
                {
                        eot=true;
                        return *this;
                }
                tokenstart = tokenend + 1;
                tokenend = std::find(tokenstart,limit,splitter);
                return *this;
        }
        typename ContainerType::const_iterator begin() const
        {
                return tokenstart;
        }
        typename ContainerType::const_iterator end() const
        {
                return tokenend;
        }
};

template <class TokenItr, class TokenSeparatorType, class TokenContainer>
  void Tokenize(TokenItr begin, TokenItr end, TokenSeparatorType const &separator, TokenContainer *container)
{
        typedef typename TokenContainer::value_type ContainerValueType;
        TokenIterator<ContainerValueType> tokenizer(begin,end,separator);

        for (;tokenizer;++tokenizer)
            container->push_back(ContainerValueType(tokenizer.begin(), tokenizer.end()));
}

//--------------------------------------------------------------------------
//
// String to string conversions and comparisons: specialisations
//
//--------------------------------------------------------------------------

inline int MemCaseCompare(const void *lhs_begin, const void *rhs_begin, std::size_t length)
{
        return StrCaseCompare<const char*>(reinterpret_cast<const char*>(lhs_begin)
                                          ,reinterpret_cast<const char*>(lhs_begin) + length
                                          ,reinterpret_cast<const char*>(rhs_begin)
                                          ,reinterpret_cast<const char*>(rhs_begin) + length);
}
//Specialize for const char* comparisons strings
inline int StrCaseCompare(const std::string& lhs, const char* rhs_str)
{ return StrCaseCompare<const char*>(&*lhs.begin(),&*lhs.end(),rhs_str,rhs_str+strlen(rhs_str)); }
inline int StrCaseCompare(const char* lhs_str, const std::string& rhs)
{ return StrCaseCompare(lhs_str,lhs_str+strlen(lhs_str),&*rhs.begin(),&*rhs.end()); }
inline int CStrCaseCompare(const char* lhs_str, const char* rhs_str)
{ return StrCaseCompare(lhs_str,lhs_str+strlen(lhs_str),rhs_str,rhs_str+strlen(rhs_str)); }

inline int StrCaseCompare(const std::string& lhs, const char* rhs_str, std::size_t maxsize)
{ return StrCaseCompare(&*lhs.begin(),&*lhs.end(),rhs_str,rhs_str+strlen(rhs_str),maxsize); }
inline int StrCaseCompare(const char* lhs_str, const std::string& rhs, std::size_t maxsize)
{ return StrCaseCompare(lhs_str,lhs_str+strlen(lhs_str),&*rhs.begin(),&*rhs.end(),maxsize); }
inline int CStrCaseCompare(const char* lhs_str, const char *rhs_str, std::size_t maxsize)
{ return StrCaseCompare(lhs_str,lhs_str+strlen(lhs_str),rhs_str,rhs_str+strlen(rhs_str),maxsize); }

inline int StrCompare(const std::string& lhs, const char* rhs_str)
{ return StrCompare(&*lhs.begin(),&*lhs.end(),rhs_str,rhs_str+strlen(rhs_str)); }
inline int StrCompare(const char* lhs_str, const std::string& rhs)
{ return StrCompare(lhs_str,lhs_str+strlen(lhs_str),&*rhs.begin(),&*rhs.end()); }
inline int CStrCompare(const char* lhs_str, const char* rhs_str)
{ return StrCompare(lhs_str,lhs_str+strlen(lhs_str),rhs_str,rhs_str+strlen(rhs_str)); }

inline int StrCompare(const std::string& lhs, const char* rhs_str, std::size_t maxsize)
{ return StrCompare(&*lhs.begin(),&*lhs.end(),rhs_str,rhs_str+strlen(rhs_str),maxsize); }
inline int StrCompare(const char* lhs_str, const std::string& rhs, std::size_t maxsize)
{ return StrCompare(lhs_str,lhs_str+strlen(lhs_str),&*rhs.begin(),&*rhs.end(),maxsize); }
inline int CStrCompare(const char* lhs_str, const char *rhs_str, std::size_t maxsize)
{ return StrCompare(lhs_str,lhs_str+strlen(lhs_str),rhs_str,rhs_str+strlen(rhs_str),maxsize); }

inline bool StrCaseLike(const std::string& lhs, const char* rhs_str)
{ return StrCaseLike<const char*>(&*lhs.begin(),&*lhs.end(),rhs_str,rhs_str+strlen(rhs_str)); }
inline bool StrCaseLike(const char* lhs_str, const std::string& rhs)
{ return StrCaseLike(lhs_str,lhs_str+strlen(lhs_str),&*rhs.begin(),&*rhs.end()); }
inline bool CStrCaseLike(const char* lhs_str, const char* rhs_str)
{ return StrCaseLike(lhs_str,lhs_str+strlen(lhs_str),rhs_str,rhs_str+strlen(rhs_str)); }

inline bool StrLike(const std::string& lhs, const char* rhs_str)
{ return StrLike<const char*>(&*lhs.begin(),&*lhs.end(),rhs_str,rhs_str+strlen(rhs_str)); }
inline bool StrLike(const char* lhs_str, const std::string& rhs)
{ return StrLike(lhs_str,lhs_str+strlen(lhs_str),&*rhs.begin(),&*rhs.end()); }
inline bool CStrLike(const char* lhs_str, const char* rhs_str)
{ return StrLike(lhs_str,lhs_str+strlen(lhs_str),rhs_str,rhs_str+strlen(rhs_str)); }

//--------------------------------------------------------------------------
//
// Any to string
//
//--------------------------------------------------------------------------

//inline template <typename T> void AppendAnyToString(T const &in, std::string *appended_string)
//{
//        appended_string += Blex::AnyToString(in);
//}

template <> inline void AppendAnyToString(unsigned int const &in, std::string *appended_string)
{
        EncodeNumber(in, 10, std::back_inserter(*appended_string));
}
template <> inline void AppendAnyToString(signed int const &in, std::string *appended_string)
{
        EncodeNumber(in, 10, std::back_inserter(*appended_string));
}
template <> inline void AppendAnyToString(unsigned long const &in, std::string *appended_string)
{
        EncodeNumber(in, 10, std::back_inserter(*appended_string));
}
template <> inline void AppendAnyToString(signed long const &in, std::string *appended_string)
{
        EncodeNumber(in, 10, std::back_inserter(*appended_string));
}
template <> inline void AppendAnyToString(F64 const &in, std::string *appended_string)
{
        char buf[128];
        std::sprintf(buf, "%.16g", in);
        *appended_string += buf;
}
template <> inline void AppendAnyToString(float const &in, std::string *appended_string)
{
        return AppendAnyToString<F64>(in,appended_string);
}
#ifdef PLATFORM_DARWIN //On Darwin, this conflicts with the unsigned long/signed long version above
template <> inline void AppendAnyToString(uint64_t const &in, std::string *appended_string)
{
        EncodeNumber(in, 10, std::back_inserter(*appended_string));
}
template <> inline void AppendAnyToString(int64_t const &in, std::string *appended_string)
{
        EncodeNumber(in, 10, std::back_inserter(*appended_string));
}
#endif
//uint32_t/int32_t will have been handled be either unsigned int or unsigned long APpendAnyToString above
template <> inline void AppendAnyToString(uint16_t const &in, std::string *appended_string)
{
        EncodeNumber(in, 10, std::back_inserter(*appended_string));
}
template <> inline void AppendAnyToString(int16_t const &in, std::string *appended_string)
{
        EncodeNumber(in, 10, std::back_inserter(*appended_string));
}
template <> inline void AppendAnyToString(uint8_t const &in, std::string *appended_string)
{
        EncodeNumber(in, 10, std::back_inserter(*appended_string));
}
template <> inline void AppendAnyToString(int8_t const &in, std::string *appended_string)
{
        EncodeNumber(in, 10, std::back_inserter(*appended_string));
}
template <class T> inline void AppendAnyToString(T* const &in, std::string *appended_string)
{
        char buf[128];
        std::sprintf(buf, "%p", (void*)in);
        *appended_string += buf;
//        AppendAnyToString(unsigned(in), appended_string);
}
template <> inline void AppendAnyToString(std::string const &in, std::string *appended_string)
{
        *appended_string += in;
}

template <typename T> std::string AnyToString(T const &in)
{
        std::string retval;
        AppendAnyToString(in, &retval);
        return retval;
}
inline std::string AnyToString(std::string const &in)
{
        return in; //if it makes you happy, it can't be that bad...
}

template <typename T> std::string AnyToJSON(T const &in);

inline std::string AnyToJSON(std::string const &in)
{
        std::string result = "\"";
        Blex::EncodeJSON(in.begin(), in.end(), std::back_inserter(result));
        return result + "\"";
}

inline std::string AnyToJSON(int64_t const &in)
{
        return Blex::AnyToString(in);
}

inline std::string AnyToJSON(uint64_t const &in)
{
        return Blex::AnyToString(in);
}

inline std::string AnyToJSON(unsigned int const &in)
{
        return Blex::AnyToString(in);
}

inline std::string AnyToJSON(int const &in)
{
        return Blex::AnyToString(in);
}

} //end namespace ::Blex
