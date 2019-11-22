#include <ap/libwebhare/allincludes.h>


#include "xmlformats.h"

namespace Parsers
{


inline char HexDigit(unsigned value)
{
        return (value&0xf) < 10 ? char((value&0xf) + '0') : char((value&0xf) - 10 + 'A');
}

void CreateHTMLColor(std::string &str, DrawLib::Pixel32 color)
{
        char tempbuf[7];
        tempbuf[0]='#';
        tempbuf[1]=HexDigit(color.GetR() >> 4);
        tempbuf[2]=HexDigit(color.GetR());
        tempbuf[3]=HexDigit(color.GetG() >> 4);
        tempbuf[4]=HexDigit(color.GetG());
        tempbuf[5]=HexDigit(color.GetB() >> 4);
        tempbuf[6]=HexDigit(color.GetB());
        str.insert(str.end(),tempbuf,tempbuf+7);
}
void EncodeNumber(std::string &str, int32_t val)
{
        char buf[32];
        unsigned numbytes = Blex::EncodeNumber(val,10,buf) - buf;
        str.insert(str.end(),buf,buf+numbytes);
}
void EncodeNumberAttribute(std::string &str, const char *attrname, int32_t val)
{
        str += " ";
        str += attrname;
        str += "=\"";
        EncodeNumber(str,val);
        str += "\"";
}
void EncodePercentageAttribute(std::string &str, const char *attrname, int32_t val)
{
        str += " ";
        str += attrname;
        str += "=\"";
        EncodeNumber(str,val);
        str += "%\"";
}
void EncodeColorAttribute(std::string &str, const char *attrname, DrawLib::Pixel32 color)
{
        str += " ";
        str += attrname;
        str += "=\"";
        CreateHTMLColor(str,color);
        str += "\"";
}
void EncodeValueAttribute(std::string &str, const char *attrname, std::string const &invalue)
{
        str += " ";
        str += attrname;
        str += "=\"";
        Blex::EncodeValue(invalue.begin(), invalue.end(), std::back_inserter(str));
        str += "\"";
}
void EncodePercentageStyle(std::string &str, const char *attrname, int32_t val)
{
        str += attrname;
        str += ":";
        EncodeNumber(str,val);
        str += "%;";
}
void EncodePixelsStyle(std::string &str, const char *attrname, int32_t val)
{
        str += attrname;
        if (val==0)
        {
                str+=":0;";
                return;
        }
        str += ":";
        EncodeNumber(str,val);
        str += "px;";
}
void EncodePoints100(std::string &str, int val)
{
        if(val==0)
        {
                str += "0";
                return;
        }

        if((val/100)!=0)
            Blex::EncodeNumber(val/100, 10, std::back_inserter(str));
        val %= 100;
        if(val)
        {
                if(val<0)
                        val=-val;

                str += ".";
                str += char('0' + (val/10));
                if(val%10 != 0)
                   str += char('0' + (val%10));
        }
        str += "pt";
}
void EncodePoints100Style(std::string &str, const char *attrname, int val)
{
        str += attrname;
        str += ":";
        EncodePoints100(str, val);
        str+=";";
}
void EncodeColorStyle(std::string &str, const char *attrname, DrawLib::Pixel32 color)
{
        str += attrname;
        str += ":";
        CreateHTMLColor(str,color);
        str += ";";
}
void EncodeValueStyle(std::string &str, const char *attrname, std::string const &invalue)
{
        str += attrname;
        str += ":";
        Blex::EncodeValue(invalue.begin(), invalue.end(), std::back_inserter(str));
        str += ";";
}


} //end namespace Parsers
