//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <blex/logfile.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../unicode.h"

unsigned CountInvalidChars(std::string const &str, bool xmlchar)
{
        Blex::UTF8DecodeMachine decoder;
        unsigned countbad=0;
        for (std::string::const_iterator itr=str.begin();itr!=str.end();++itr)
        {
                uint32_t decoded = decoder(*itr);
                if (decoded == 0
                    || decoded == Blex::UTF8DecodeMachine::InvalidChar
                    || (xmlchar && decoded != Blex::UTF8DecodeMachine::NoChar && !Blex::IsValidXMLChar(decoded)))
                    ++countbad;
        }
        if (decoder.InsideCharacter())
            ++countbad;

        BLEX_TEST_CHECKEQUAL(countbad == 0, Blex::IsValidUTF8(str.begin(),str.end(), xmlchar));
        return countbad;
}

BLEX_TEST_FUNCTION(TestTokenize)
{
        std::string source;
        std::vector<std::string> results;
        Blex::Tokenize(source.begin(), source.end(),',',&results);
        BLEX_TEST_CHECKEQUAL(1, results.size());

        source="a,b";
        results.clear();
        Blex::Tokenize(source.begin(), source.end(),',',&results);
        BLEX_TEST_CHECKEQUAL(2, results.size());
        BLEX_TEST_CHECKEQUAL("a", results[0]);
        BLEX_TEST_CHECKEQUAL("b", results[1]);

        source=",,b";
        results.clear();
        Blex::Tokenize(source.begin(), source.end(),',',&results);
        BLEX_TEST_CHECKEQUAL(3, results.size());
        BLEX_TEST_CHECKEQUAL("", results[0]);
        BLEX_TEST_CHECKEQUAL("", results[1]);
        BLEX_TEST_CHECKEQUAL("b", results[2]);

        source=",,";
        results.clear();
        Blex::Tokenize(source.begin(), source.end(),',',&results);
        BLEX_TEST_CHECKEQUAL(3, results.size());
        BLEX_TEST_CHECKEQUAL("", results[0]);
        BLEX_TEST_CHECKEQUAL("", results[1]);
        BLEX_TEST_CHECKEQUAL("", results[2]);

        results.clear();
        Blex::TokenizeString(",,", ',',&results);
        BLEX_TEST_CHECKEQUAL(3, results.size());
        BLEX_TEST_CHECKEQUAL("", results[0]);
        BLEX_TEST_CHECKEQUAL("", results[1]);
        BLEX_TEST_CHECKEQUAL("", results[2]);
}

BLEX_TEST_FUNCTION(TestUTF8_Ansi)
{
        std::string utf8_output, ansi_output;

        //first a simple test..
        char poundsign[1] = {(char)163};
        char poundsign_utf8[2] = {(char)194, (char)163};
        Blex::UTF8Encode(poundsign, poundsign+1, std::back_inserter(utf8_output));
        BLEX_TEST_CHECKEQUAL(2,utf8_output.size());
        BLEX_TEST_CHECK(std::equal(utf8_output.begin(), utf8_output.end(), poundsign_utf8));

        Blex::UTF8Decode(reinterpret_cast<uint8_t*>(poundsign_utf8),
                         reinterpret_cast<uint8_t*>(poundsign_utf8 + 2),
                         std::back_inserter(ansi_output));
        BLEX_TEST_CHECKEQUAL(1, ansi_output.size());
        BLEX_TEST_CHECKEQUAL(poundsign[0], ansi_output[0]);

        char outbuf[16];
        char *outptr = Blex::UTF8Encode(poundsign, poundsign+1, &outbuf[0]);
        BLEX_TEST_CHECKEQUAL(outbuf+2, outptr);
}

BLEX_TEST_FUNCTION(TestUTF8_UCS4)
{
        std::string utf8_output;
        Blex::UnicodeString ucs4_output;

        uint32_t HiddenTextkorper_ucs4[] = {'H','i','d','d','e','n',' ','T','e','x','t','k',710/* o-umlaut*/,'r','p','e','r' };
        unsigned HiddenTextkorper_ucs4_size = sizeof(HiddenTextkorper_ucs4)/sizeof(*HiddenTextkorper_ucs4);
        char HiddenTextkorper_utf8[18] = {'H','i','d','d','e','n',' ','T','e','x','t','k',(char)203,(char)134,'r','p','e','r' };

        Blex::UTF8Encode(HiddenTextkorper_ucs4, HiddenTextkorper_ucs4 + HiddenTextkorper_ucs4_size, std::back_inserter(utf8_output));
        BLEX_TEST_CHECK(utf8_output.size() == 18);
        BLEX_TEST_CHECK(std::equal(HiddenTextkorper_utf8 ,
                                 HiddenTextkorper_utf8 + 18,
                                 &utf8_output[0]));

        Blex::UTF8Decode(reinterpret_cast<uint8_t*>(HiddenTextkorper_utf8),
                         reinterpret_cast<uint8_t*>(HiddenTextkorper_utf8 + 18),
                         std::back_inserter(ucs4_output));

        BLEX_TEST_CHECK(ucs4_output.size() == HiddenTextkorper_ucs4_size);
        BLEX_TEST_CHECK(std::equal(HiddenTextkorper_ucs4 ,
                                 HiddenTextkorper_ucs4 + HiddenTextkorper_ucs4_size,
                                 &ucs4_output[0]));
}

BLEX_TEST_FUNCTION(TestValidUTF8)
{
        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("abc",false));
        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("",false));
        BLEX_TEST_CHECKEQUAL(1, CountInvalidChars("\x80",false));
        BLEX_TEST_CHECKEQUAL(1, CountInvalidChars("\xFD",false));
        BLEX_TEST_CHECKEQUAL(1, CountInvalidChars("\xFF",false));
        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("\b",false));
        BLEX_TEST_CHECKEQUAL(1, CountInvalidChars(std::string("\0",1),false));

        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("abc",true));
        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("",true));
        BLEX_TEST_CHECKEQUAL(1, CountInvalidChars("\x80",true));
        BLEX_TEST_CHECKEQUAL(1, CountInvalidChars("\xFD",true));
        BLEX_TEST_CHECKEQUAL(1, CountInvalidChars("\xFF",true));
        BLEX_TEST_CHECKEQUAL(1, CountInvalidChars("\b",true));
        BLEX_TEST_CHECKEQUAL(1, CountInvalidChars(std::string("\0",1),true));

        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("\xCE\xBA\xE1\xBD\xB9\xCF\x83\xCE\xBC\xCE\xB5",false));

        //Boundary conditions: first character of every valid range
        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("\x00",false));
        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("\xC2\x80",false));
        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("\xE0\xA0\x80",false));
        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("\xF0\x90\x80\x80",false));

        //Boundary conditions: last character of every valid range
        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("\x7F",false));
        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("\xDF\xBF",false));
        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("\xEF\xBF\xBF",false));
        BLEX_TEST_CHECKEQUAL(0, CountInvalidChars("\xF4\x8F\xBF\xBF",false)); // UCS stops at 0x10FF,falseFF!

        //Boundary conditions: incomplete character of every valid range
        BLEX_TEST_CHECKEQUAL(1, CountInvalidChars("\xDF",false));
        BLEX_TEST_CHECKEQUAL(1, CountInvalidChars("\xEF\xBF",false));
        BLEX_TEST_CHECKEQUAL(1, CountInvalidChars("\xF7\xBF\xBF",false));

        //Boundary conditions: unexpected continuation characters
        BLEX_TEST_CHECKEQUAL(1, CountInvalidChars("\x80",false));
        BLEX_TEST_CHECKEQUAL(2, CountInvalidChars("\x80\xBF",false));
        BLEX_TEST_CHECKEQUAL(3, CountInvalidChars("\x80\xBF\x80",false));
        BLEX_TEST_CHECKEQUAL(4, CountInvalidChars("\x80\xBF\x80\xBF",false));
}

BLEX_TEST_FUNCTION(TestEnsureValidUTF8)
{
        std::string baddata;

        baddata = "\xDF";
        Blex::EnsureValidUTF8(&baddata, false);
        BLEX_TEST_CHECKEQUAL("", baddata);

        baddata = "\xDF";
        Blex::EnsureValidUTF8(&baddata, true);
        BLEX_TEST_CHECKEQUAL("", baddata);

        baddata = "Hallo";
        Blex::EnsureValidUTF8(&baddata, false);
        BLEX_TEST_CHECKEQUAL("Hallo", baddata);

        baddata = "Hallo";
        Blex::EnsureValidUTF8(&baddata, true);
        BLEX_TEST_CHECKEQUAL("Hallo", baddata);

        baddata = "Hal\xDFlo";
        Blex::EnsureValidUTF8(&baddata, false);
        BLEX_TEST_CHECKEQUAL("Hallo", baddata);

        baddata = "Hal\xDFlo";
        Blex::EnsureValidUTF8(&baddata, true);
        BLEX_TEST_CHECKEQUAL("Hallo", baddata);

        baddata = "Hal\xDF\blo"; //sneak in an invalid char after an invalid sequence start
        Blex::EnsureValidUTF8(&baddata, true);
        BLEX_TEST_CHECKEQUAL("Hallo", baddata);

        baddata = std::string("H\bal\xDFl\0o",8);
        Blex::EnsureValidUTF8(&baddata, false);
        BLEX_TEST_CHECKEQUAL(std::string("H\ball\0o",7), baddata);

        baddata = std::string("H\bal\xDFl\0o",8);
        Blex::EnsureValidUTF8(&baddata, true);
        BLEX_TEST_CHECKEQUAL("Hallo", baddata);
}

BLEX_TEST_FUNCTION(TestCompare)
{
        std::vector<std::string> lowercase_strings;
        lowercase_strings.push_back("aap");
        lowercase_strings.push_back("noot");
        lowercase_strings.push_back("mies");
        lowercase_strings.push_back("nootmuskaat");

        std::vector<std::string> mixedcase_strings;
        mixedcase_strings.push_back("aAp");
        mixedcase_strings.push_back("noOT");
        mixedcase_strings.push_back("mIeS");
        mixedcase_strings.push_back("NOOtmUskAAt");

        std::vector<std::string> uppercase_strings;
        uppercase_strings.push_back("AAP");
        uppercase_strings.push_back("NOOT");
        uppercase_strings.push_back("MIES");
        uppercase_strings.push_back("NOOTMUSKAAT");

        std::vector<std::string> utf8_strings;
        std::string temp1;
        std::string temp2;
        utf8_strings.push_back("AAP");

        temp1 = "INBOX/\\uCD91\\u0A4E\\u954E\\u8851\\u715C";
        Blex::DecodeJava(temp1.begin(), temp1.end(), std::back_inserter(temp2));
        utf8_strings.push_back(temp2);

        temp1 = "INBOX/\\uCD92\\u0A4E\\u954E\\u8851\\u715C";
        temp2.clear();
        Blex::DecodeJava(temp1.begin(), temp1.end(), std::back_inserter(temp2));
        utf8_strings.push_back(temp2);

        //ADDME: Test against uppercase_strings. Test with StrCaseCompare. Test with limited (3-parameter/5-parameter) compares
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(lowercase_strings[0],lowercase_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(lowercase_strings[1],lowercase_strings[3]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(lowercase_strings[2],lowercase_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(lowercase_strings[3],lowercase_strings[3]),0);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(lowercase_strings[1],lowercase_strings[0]),1);

 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(mixedcase_strings[0],lowercase_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(mixedcase_strings[1],lowercase_strings[3]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(mixedcase_strings[2],lowercase_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(mixedcase_strings[3],lowercase_strings[3]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(mixedcase_strings[1],lowercase_strings[0]),1);

 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(uppercase_strings[0],mixedcase_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(uppercase_strings[1],mixedcase_strings[3]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(uppercase_strings[2],mixedcase_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(uppercase_strings[3],mixedcase_strings[3]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(uppercase_strings[1],mixedcase_strings[0]),-1);

 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(lowercase_strings[0],lowercase_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(lowercase_strings[1],lowercase_strings[3]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(lowercase_strings[2],lowercase_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(lowercase_strings[3],lowercase_strings[3]),0);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(lowercase_strings[1],lowercase_strings[0]),1);

 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(mixedcase_strings[0],lowercase_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(mixedcase_strings[1],lowercase_strings[3]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(mixedcase_strings[2],lowercase_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(mixedcase_strings[3],lowercase_strings[3]),0);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(mixedcase_strings[1],lowercase_strings[0]),1);

 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(uppercase_strings[0],mixedcase_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(uppercase_strings[1],mixedcase_strings[3]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(uppercase_strings[2],mixedcase_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(uppercase_strings[3],mixedcase_strings[3]),0);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(uppercase_strings[1],mixedcase_strings[0]),1);

 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(mixedcase_strings[1],lowercase_strings[1],10),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(mixedcase_strings[1],lowercase_strings[1],3),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(mixedcase_strings[1],lowercase_strings[1],2),0);

 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(utf8_strings[0],utf8_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(utf8_strings[0],utf8_strings[2]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCompare(utf8_strings[1],utf8_strings[2]),-1);

 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(utf8_strings[0],utf8_strings[1]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(utf8_strings[0],utf8_strings[2]),-1);
 BLEX_TEST_CHECKEQUAL(Blex::StrCaseCompare(utf8_strings[1],utf8_strings[2]),-1);
}

void TestBase16(std::string const &in, std::string const &out)
{
        std::string to;
        Blex::EncodeBase16(in.begin(),in.end(),std::back_inserter(to));
        BLEX_TEST_CHECKEQUAL(out,to);

        std::string from;
        Blex::DecodeBase16(out.begin(),out.end(),std::back_inserter(from));
        BLEX_TEST_CHECKEQUAL(in,from);

        const char *inbuf = "31";
        char outbuf[2] = { 0, 0 };

        BLEX_TEST_CHECKEQUAL(outbuf + 1, Blex::DecodeBase16(inbuf, inbuf + 2, outbuf));
        BLEX_TEST_CHECKEQUAL('1', outbuf[0]);
}

void TestBase64(std::string const &in, std::string const &out)
{
        std::string to;
        Blex::EncodeBase64(in.begin(),in.end(),std::back_inserter(to));
        BLEX_TEST_CHECKEQUAL(out,to);

        std::string from;
        Blex::DecodeBase64(out.begin(),out.end(),std::back_inserter(from));
        BLEX_TEST_CHECKEQUAL(in,from);

        const char *inbuf = "MQ==";
        char outbuf[2] = { 0, 0 };

        BLEX_TEST_CHECKEQUAL(outbuf + 1, Blex::DecodeBase64(inbuf, inbuf + 4, outbuf));
        BLEX_TEST_CHECKEQUAL('1', outbuf[0]);
}

void TestUFS(std::string const &in, std::string const &out)
{
        std::string to;
        Blex::EncodeUFS(in.begin(),in.end(),std::back_inserter(to));
        BLEX_TEST_CHECKEQUAL(out,to);

        std::string from;
        Blex::DecodeUFS(out.begin(),out.end(),std::back_inserter(from));
        BLEX_TEST_CHECKEQUAL(in,from);

        const char *inbuf = "MQ";
        char outbuf[2] = { 0, 0 };

        BLEX_TEST_CHECKEQUAL(outbuf + 1, Blex::DecodeUFS(inbuf, inbuf + 2, outbuf));
        BLEX_TEST_CHECKEQUAL('1', outbuf[0]);
}

void TestJava(std::string const &in, std::string const &out)
{
        std::string to;
        Blex::EncodeJava(in.begin(),in.end(),std::back_inserter(to));
        BLEX_TEST_CHECKEQUAL(out,to);

        std::string from;
        Blex::DecodeJava(out.begin(),out.end(),std::back_inserter(from));
        BLEX_TEST_CHECKEQUAL(in,from);

        const char *inbuf = "\\n";
        char outbuf[3] = { 0, 0, 0 };

        BLEX_TEST_CHECKEQUAL(outbuf + 1, Blex::DecodeJava(inbuf, inbuf + 2, outbuf));
        BLEX_TEST_CHECKEQUAL('\n', outbuf[0]);
}

void TestHSON(std::string const &in, std::string const &out)
{
        std::string to;
        Blex::EncodeHSON(in.begin(),in.end(),std::back_inserter(to));
        BLEX_TEST_CHECKEQUAL(out,to);

        std::string from;
        Blex::DecodeJava(out.begin(),out.end(),std::back_inserter(from));
        BLEX_TEST_CHECKEQUAL(in,from);

        const char *inbuf = "\\n";
        char outbuf[3] = { 0, 0, 0 };

        BLEX_TEST_CHECKEQUAL(outbuf + 1, Blex::DecodeJava(inbuf, inbuf + 2, outbuf));
        BLEX_TEST_CHECKEQUAL('\n', outbuf[0]);
}


void TestUrl(std::string const &in, std::string const &out)
{
        std::string to;
        Blex::EncodeUrl(in.begin(),in.end(),std::back_inserter(to));
        BLEX_TEST_CHECKEQUAL(out,to);

        std::string from;
        Blex::DecodeUrl(out.begin(),out.end(),std::back_inserter(from));
        BLEX_TEST_CHECKEQUAL(in,from);

        const char *inbuf = "%20";
        char outbuf[2] = { 0, 0 };

        BLEX_TEST_CHECKEQUAL(outbuf + 1, Blex::DecodeUrl(inbuf, inbuf + 3, outbuf));
        BLEX_TEST_CHECKEQUAL(' ', outbuf[0]);
}

BLEX_TEST_FUNCTION(TestCoding)
{
        /*  1 */ TestJava("blabla", "blabla");
        /*  3 */ TestJava("\r\nd\t", "\\r\\nd\\t");
        /*  5 */ TestJava("\004hey\005", "\\u0004hey\\u0005");
        /*  7 */ TestJava("", "");
        /*  9 */ TestJava("hey\blaat", "hey\\blaat");
        /* 11 */ TestJava("</script>", "<\\/script>");
        /*    */ TestJava("\x7F\xC2\x80\xDF\xBF\xE0\xA0\x80\xEF\xBF\xBF", "\\u007F\\u0080\\u07FF\\u0800\\uFFFF");

        /*  1 */ TestUrl("blabla", "blabla");
        /*  3 */ TestUrl("\nd\t", "%0Ad%09");
        /*  5 */ TestUrl("\004hey\005", "%04hey%05");
        /*  7 */ TestUrl("", "");
        /*  9 */ TestUrl("hey\blaat", "hey%08laat");
        /* 11 */ TestUrl("\xC7\xA5\xF9\xFB\xE6\x80\xFF", "%C7%A5%F9%FB%E6%80%FF");
        /* 13 */ TestUrl("{}|\\^~[]`","%7B%7D%7C%5C%5E%7E%5B%5D%60"); //RFC1738 Unsafe set
        /* 15 */ TestUrl(";/?:@=&","%3B/%3F%3A%40%3D%26"); //RFC 1738 Reserved set. Strictly, / and @ should be encoded too, but this breaks too many assumptions in other apps
                  //307 modified @ and : to be encoded too... not encoding them breaks urls with : and @ in password space

        /* Encoding / breaks WebHare, : breaks WebHare Lite (it puts diskpaths in URLs), @ might break mailto urls (not taking any chances) */

        /*  1 */ TestBase16("blabla", "626C61626C61");
        /*  3 */ TestBase16("\nd\t", "0A6409");
        /*  5 */ TestBase16("\004hey\005", "0468657905");
        /*  7 */ TestBase16("", "");
        /*  9 */ TestBase16("hey\blaat", "686579086C616174");
        /* 11 */ TestBase16("\xC7\xA5", "C7A5");

        /*  1 */ TestBase64("Aladdin:open sesame", "QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
        /*  3 */ TestBase64("sysop:secret", "c3lzb3A6c2VjcmV0");
        /*  5 */ TestBase64("", "");
        /*  7 */ TestBase64("\x3F\x3F\x3F", "Pz8/");
        /*  9 */ TestBase64("\x3E\x3E\x3E", "Pj4+");
        /* 11 */ TestBase64("\x3E\x3E", "Pj4=");

        /*  1 */ TestUFS("Aladdin:open sesame", "QWxhZGRpbjpvcGVuIHNlc2FtZQ");
        /*  3 */ TestUFS("sysop:secret", "c3lzb3A6c2VjcmV0");
        /*  5 */ TestUFS("", "");
        /*  7 */ TestUFS("\x3F\x3F\x3F", "Pz8_");
        /*  9 */ TestUFS("\x3E\x3E\x3E", "Pj4-");
        /* 11 */ TestUFS("\x3E\x3E", "Pj4");

        /*  1 */ TestHSON("blabla", "blabla");
        /*  3 */ TestHSON("\xFF\xFF\r\nd\t\x80\x80", "\\xFF\\xFF\\r\\nd\\t\\x80\\x80"); // invalid UTF-8 is preserved
        /*  5 */ TestHSON("\004hey\005", "\\u0004hey\\u0005");
        /*  7 */ TestHSON("", "");
        /*  9 */ TestHSON("hey\blaat", "hey\\blaat");
        /* 11 */ TestHSON("</script>", "<\\/script>");
}

std::string TestHTMLEncode(std::string const &in)
{
        std::string to;
        Blex::EncodeHtml(in.begin(),in.end(),std::back_inserter(to));
        return to;
}

std::string TestTextNodeEncode(std::string const &in)
{
        std::string to;
        Blex::EncodeTextNode(in.begin(),in.end(),std::back_inserter(to));
        return to;
}

BLEX_TEST_FUNCTION(TestHTML)
{
        BLEX_TEST_CHECKEQUAL("a&#38;b", TestHTMLEncode("a&b"));
        BLEX_TEST_CHECKEQUAL("a&#60;b", TestHTMLEncode("a<b"));
        BLEX_TEST_CHECKEQUAL("a'b", TestHTMLEncode("a'b"));
        BLEX_TEST_CHECKEQUAL("a&#8364;!", TestHTMLEncode("a\xE2\x82\xAC!"));
        BLEX_TEST_CHECKEQUAL("ab", TestHTMLEncode("a\xC2\x9D" "b"));

        //encodetextnode: Similar to %EncodeValue, but only encodes '<', '>' and '&'. This suffices for text nodes UTF-8 XML documents
        BLEX_TEST_CHECKEQUAL("a&amp;b", TestTextNodeEncode("a&b"));
        BLEX_TEST_CHECKEQUAL("a&lt;b", TestTextNodeEncode("a<b"));
        BLEX_TEST_CHECKEQUAL("a'b", TestTextNodeEncode("a'b"));
        BLEX_TEST_CHECKEQUAL("ab", TestTextNodeEncode("a\xC2\x9D" "b"));
        BLEX_TEST_CHECKEQUAL("a\u20AC!", TestTextNodeEncode("a\xE2\x82\xAC!"));
}


std::string TestJavaEncode(std::string const &in)
{
        std::string to;
        Blex::EncodeJava(in.begin(),in.end(),std::back_inserter(to));
        return to;
}

std::string TestJavaDecode(std::string const &in)
{
        std::string to;
        Blex::DecodeJava(in.begin(),in.end(),std::back_inserter(to));
        return to;
}

BLEX_TEST_FUNCTION(TestMoreJava)
{
        //these functions only work one-way..
        BLEX_TEST_CHECKEQUAL("abc. \377",TestJavaDecode("\\x61bc\\x2e\\x20\\xff"));
        BLEX_TEST_CHECKEQUAL("abc. \377",TestJavaDecode("\\x61bc\\x2E\\x20\\xfF"));
        BLEX_TEST_CHECKEQUAL("abc. \377",TestJavaDecode("\\x61bc\\x2E\\x20\\xFf"));
        BLEX_TEST_CHECKEQUAL("abc. \377",TestJavaDecode("\\x61bc\\x2E\\x20\\xFF"));
        BLEX_TEST_CHECKEQUAL("ABC\xC7\xA5",TestJavaDecode("\\u0041\\u0042\\u0043\\u01E5"));

        BLEX_TEST_CHECKEQUAL("x\1",      TestJavaDecode("x\\1"));
        BLEX_TEST_CHECKEQUAL("x\1a",     TestJavaDecode("x\\1a"));
        BLEX_TEST_CHECKEQUAL("x\12",     TestJavaDecode("x\\12"));
        BLEX_TEST_CHECKEQUAL("x\12a",    TestJavaDecode("x\\12a"));
        BLEX_TEST_CHECKEQUAL("x\0128",   TestJavaDecode("x\\128"));
        BLEX_TEST_CHECKEQUAL("x4",       TestJavaDecode("x\\4"));
        BLEX_TEST_CHECKEQUAL("x4d",      TestJavaDecode("x\\4d"));
        BLEX_TEST_CHECKEQUAL("x\4",      TestJavaDecode("x\\x4"));
        BLEX_TEST_CHECKEQUAL("x\4g",     TestJavaDecode("x\\x4g"));

        BLEX_TEST_CHECKEQUAL("Joshee",         TestJavaEncode("\x4A\x6F\x73\xE9\x20\x68\x65\x65"));

        //test error conditions
        BLEX_TEST_CHECKEQUAL("\6gbc. \377",TestJavaDecode("\\x6gbc\\x2E\\x20\\xFF"));
        BLEX_TEST_CHECKEQUAL("\6gbc. \17",    TestJavaDecode("\\x6gbc\\x2E\\x20\\xF"));
        BLEX_TEST_CHECKEQUAL("gbc. \17",    TestJavaDecode("\\xgbc\\x2E\\x20\\xF"));
}

BLEX_TEST_FUNCTION(TestCodepage)
{
        //test the euro!
        BLEX_TEST_CHECKEQUAL(uint32_t(0x20AC), Blex::GetCharsetConversiontable(Blex::Charsets::CP1252)[0x80]);
        //test the Alpha
        BLEX_TEST_CHECKEQUAL(uint32_t(913), Blex::GetCharsetConversiontable(Blex::Charsets::CPSymbol)['A']);

        BLEX_TEST_CHECKEQUAL(false, Blex::IsPrivateRangeUnicode(0x20AC)); //euro
        BLEX_TEST_CHECKEQUAL(true,  Blex::IsPrivateRangeUnicode(0xF041)); //MS symbol Alpha
}

BLEX_TEST_FUNCTION(TestNumbers)
{
        //ADDME: Check error conditions

        std::string fifteen = "15";
        BLEX_TEST_CHECKEQUAL(   15, Blex::DecodeSignedNumber<int>(fifteen.begin(),fifteen.end()).first);
        BLEX_TEST_CHECKEQUAL(  015, Blex::DecodeSignedNumber<int>(fifteen.begin(),fifteen.end(),8).first);
        BLEX_TEST_CHECKEQUAL( 0x15, Blex::DecodeSignedNumber<int>(fifteen.begin(),fifteen.end(),16).first);

        std::string hex1a = "1a";
        BLEX_TEST_CHECKEQUAL(    1, Blex::DecodeSignedNumber<int>(hex1a.begin(),hex1a.end()).first);
        BLEX_TEST_CHECKEQUAL( 0x1a, Blex::DecodeSignedNumber<int>(hex1a.begin(),hex1a.end(),16).first);

        std::string fifteen_negative = "-15";
        BLEX_TEST_CHECKEQUAL( -  15, Blex::DecodeSignedNumber<int>(fifteen_negative.begin(),fifteen_negative.end()).first);
        BLEX_TEST_CHECKEQUAL( - 015, Blex::DecodeSignedNumber<int>(fifteen_negative.begin(),fifteen_negative.end(),8).first);
        BLEX_TEST_CHECKEQUAL( -0x15, Blex::DecodeSignedNumber<int>(fifteen_negative.begin(),fifteen_negative.end(),16).first);

        std::string hex1a_negative = "-1a";
        BLEX_TEST_CHECKEQUAL( -   1, Blex::DecodeSignedNumber<int>(hex1a_negative.begin(),hex1a_negative.end()).first);
        BLEX_TEST_CHECKEQUAL( -0x1a, Blex::DecodeSignedNumber<int>(hex1a_negative.begin(),hex1a_negative.end(),16).first);

        BLEX_TEST_CHECKEQUAL(   15, Blex::DecodeUnsignedNumber<int>(fifteen.begin(),fifteen.end()).first);
        BLEX_TEST_CHECKEQUAL(  015, Blex::DecodeUnsignedNumber<int>(fifteen.begin(),fifteen.end(),8).first);
        BLEX_TEST_CHECKEQUAL( 0x15, Blex::DecodeUnsignedNumber<int>(fifteen.begin(),fifteen.end(),16).first);

        BLEX_TEST_CHECKEQUAL(    1, Blex::DecodeUnsignedNumber<int>(hex1a.begin(),hex1a.end()).first);
        BLEX_TEST_CHECKEQUAL( 0x1a, Blex::DecodeUnsignedNumber<int>(hex1a.begin(),hex1a.end(),16).first);
}

BLEX_TEST_FUNCTION(TestGlob)
{
        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("",""));
        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("A","A"));
        BLEX_TEST_CHECKEQUAL(false, Blex::CStrCaseLike("A",""));
        BLEX_TEST_CHECKEQUAL(false, Blex::CStrCaseLike("","A"));

        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("","*"));
        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("A","A*"));
        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("A","*"));
        BLEX_TEST_CHECKEQUAL(false, Blex::CStrCaseLike("","A*"));

        BLEX_TEST_CHECKEQUAL(false, Blex::CStrCaseLike("","?"));
        BLEX_TEST_CHECKEQUAL(false, Blex::CStrCaseLike("A","A?"));
        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("A","?"));
        BLEX_TEST_CHECKEQUAL(false, Blex::CStrCaseLike("","A?"));

        BLEX_TEST_CHECKEQUAL(false, Blex::CStrCaseLike("Perdeck","* "));
        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("Perdeck ","* "));
        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("Perdeck  ","* "));

        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("testje", "test*"));
        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("testje", "test??"));
        BLEX_TEST_CHECKEQUAL(false, Blex::CStrCaseLike("testje", "tess*"));
        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("testje", "*je"));
        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("testje", "****"));
        BLEX_TEST_CHECKEQUAL(false, Blex::CStrCaseLike("testj",  "t?stj?"));
        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("testj",  "t?stj*"));
        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("testj",  "t?stj"));
        BLEX_TEST_CHECKEQUAL(true,  Blex::CStrCaseLike("a",      "?*"));
        BLEX_TEST_CHECKEQUAL(false, Blex::CStrCaseLike("",       "?*"));
}

BLEX_TEST_FUNCTION(TestAnyToString)
{
        BLEX_TEST_CHECKEQUAL("77",Blex::AnyToString(unsigned(77)));
        BLEX_TEST_CHECKEQUAL("4294967295",Blex::AnyToString(unsigned(4294967295u)));
        BLEX_TEST_CHECKEQUAL("2147483647",Blex::AnyToString(signed(2147483647)));
        BLEX_TEST_CHECKEQUAL("-2147483648",Blex::AnyToString(signed(-2147483648)));
        uint64_t u64_a = 1;
        u64_a <<= 63;
        BLEX_TEST_CHECKEQUAL("9223372036854775808",Blex::AnyToString(u64_a));
        BLEX_TEST_CHECKEQUAL("18446744073709551615", Blex::AnyToString(uint64_t(0)-1));
        int64_t s64_a = -1;
        s64_a <<= 63;
        BLEX_TEST_CHECKEQUAL("-9223372036854775808",Blex::AnyToString(s64_a));
        BLEX_TEST_CHECKEQUAL("255",Blex::AnyToString(uint8_t(255)));
        BLEX_TEST_CHECKEQUAL("-128",Blex::AnyToString(int8_t(-128)));
//        BLEX_TEST_CHECKEQUAL("00000000",Blex::AnyToString((uint8_t*)0)); // FIXME: Fails on linux, gives back "(nil)" there + not 64-bit portable
//        BLEX_TEST_CHECKEQUAL("158AB2DD",Blex::AnyToString((uint8_t*)0x158AB2DD)); // Not really C++ standard compatible do to pointer pointing to nowhere; should work on most common hardware // FIXME: not 64-bit portable
        BLEX_TEST_CHECKEQUAL("VALUE",Blex::AnyToString(std::string("VALUE")));
//        BLEX_TEST_CHECKEQUAL("VALUE",Blex::AnyToString("VALUE")); // FIXME: FAILS

        BLEX_TEST_CHECKEQUAL("[2011-03-07T12:55:13.111Z]",Blex::AnyToString(Blex::DateTime::FromText("2011-03-07T12:55:13.111Z")));
}

BLEX_TEST_FUNCTION(TestStringPair)
{
        Blex::StringPair p_123 = Blex::StringPair::FromStringConstant("123");
        Blex::StringPair p_124 = Blex::StringPair::FromStringConstant("124");

        BLEX_TEST_CHECKEQUAL(3, p_123.size());
        BLEX_TEST_CHECKEQUAL("123", p_123.stl_str());

        std::string s_124 = "124";
        std::string s_123 = "123";

        BLEX_TEST_CHECKEQUAL(true, Blex::StrLess< std::string >()(p_123, s_124));
        BLEX_TEST_CHECKEQUAL(false, Blex::StrLess< std::string >()(p_123, s_123));
        BLEX_TEST_CHECKEQUAL(false, Blex::StrLess< std::string >()(p_124, s_123));

        BLEX_TEST_CHECKEQUAL(true, Blex::StrLess< Blex::StringPair >()(p_123, p_124));
        BLEX_TEST_CHECKEQUAL(false, Blex::StrLess< Blex::StringPair >()(p_123, p_123));
        BLEX_TEST_CHECKEQUAL(false, Blex::StrLess< Blex::StringPair >()(p_124, p_123));
}
