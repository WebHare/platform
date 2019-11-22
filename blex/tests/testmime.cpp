//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../mime.h"
#include "../crypto.h"
#include <vector>
#include <stack>
#include <blex/stream.h>


struct MimePart;

typedef std::shared_ptr<MimePart> MimePartPtr;

struct MimePart
{
        std::string contenttype;
        std::string description;
        std::string encoding;
        std::string disposition;
        std::string contentid;
        std::vector<char> data;

        std::vector<MimePartPtr> parts;

        std::string HexHash();
};

struct SimpleMimeReceiver : public Blex::Mime::DecodeReceiver
{
        MimePartPtr toppart;
        std::stack<MimePartPtr> current;

        void StartPart(std::string const &contenttype, std::string const &encoding, std::string const &description, std::string const &desposition, std::string const &content_id, std::string const &original_charset, Blex::FileOffset part_start, Blex::FileOffset body_start);
        void EndPart(Blex::FileOffset body_end, Blex::FileOffset part_end, unsigned linecount);
        void ReceiveData(const void *databuffer, unsigned buflen);
        void CheckFinished();
};

std::string MimePart::HexHash()
{
        std::string axx(data.begin(), data.end());
//        std::cout << "<DATA>" << axx << "</DATA>" << std::endl;

        Blex::MemoryReadStream temp(&data[0],data.size());
        return Blex::Test::MD5Stream(temp);
}

void SimpleMimeReceiver::StartPart(std::string const &contenttype, std::string const &encoding, std::string const &description, std::string const &disposition, std::string const &content_id, std::string const &,Blex::FileOffset, Blex::FileOffset)
{
        //FIXME: add content_id to test
        //std::cerr << "Open part " << contenttype << ':' << description << "\n";

        if (current.empty() && toppart.get())
            throw std::runtime_error("Got duplicate top mime piece");

        MimePartPtr newpart(new MimePart);
        newpart->contenttype = contenttype;
        newpart->description = description;
        newpart->disposition = disposition;
        newpart->encoding = encoding;
        newpart->contentid = content_id;

        if (current.empty())
            toppart = newpart;
        else
            current.top()->parts.push_back(newpart);

        current.push(newpart);
}

void SimpleMimeReceiver::EndPart(Blex::FileOffset, Blex::FileOffset, unsigned)
{
        //std::cerr << "Close part" << "\n";

        if (current.empty())
            throw std::runtime_error("There is no piece to close");
        current.pop();
}

void SimpleMimeReceiver::ReceiveData(const void *databuffer, unsigned buflen)
{
        //std::cerr<<"Data"<<"\n";

        if (current.empty())
            throw std::runtime_error("There is no piece to receive data");
        current.top()->data.insert(current.top()->data.end(),
                                   static_cast<const uint8_t*>(databuffer),
                                   static_cast<const uint8_t*>(databuffer)+buflen);
}

void SimpleMimeReceiver::CheckFinished()
{
        if (!current.empty())
            throw std::runtime_error("There are still unopened parts");
}

void TestTwoLevelMime_Mime2(unsigned stepsize, std::vector<char> const &srcdata)
{
        //Decode it!
        SimpleMimeReceiver receiver;
        Blex::Mime::Decoder decoder(receiver, "text/plain");
        decoder.Start("Multipart/Mixed; boundary=Message-Boundary-8915","","","","", 0, 0, 0);

        for (unsigned pos=0;pos < srcdata.size(); pos += stepsize)
            decoder.ProcessData(&srcdata[pos],std::min<std::size_t>(stepsize, srcdata.size() - pos));

        decoder.Finish();
        receiver.CheckFinished();

        //Test root entry
        BLEX_TEST_CHECK(receiver.toppart.get());
        BLEX_TEST_CHECKEQUAL("Multipart/Mixed; boundary=Message-Boundary-8915", receiver.toppart->contenttype);
//        BLEX_TEST_CHECKEQUAL(0, receiver.toppart->data.size());
        BLEX_TEST_CHECKEQUAL(2, receiver.toppart->parts.size());

        //Test first subentry (is an alternative, text/plain followed by text/html sections)
        BLEX_TEST_CHECK(receiver.toppart->parts[0].get());
        BLEX_TEST_CHECKEQUAL("Multipart/Alternative; boundary=\"Alt-Boundary-24421.8288312\"", receiver.toppart->parts[0]->contenttype);
//        BLEX_TEST_CHECKEQUAL(0, receiver.toppart->parts[0]->data.size());
        BLEX_TEST_CHECKEQUAL(2, receiver.toppart->parts[0]->parts.size());

        //Test first subentry tezt/plain version
        BLEX_TEST_CHECK(receiver.toppart->parts[0]->parts[0].get());
        BLEX_TEST_CHECKEQUAL("text/plain; charset=US-ASCII", receiver.toppart->parts[0]->parts[0]->contenttype);
        BLEX_TEST_CHECKEQUAL("Mail message body", receiver.toppart->parts[0]->parts[0]->description);
        BLEX_TEST_CHECKEQUAL("8F4B93F06A1887AB2A8180ABF243557D", receiver.toppart->parts[0]->parts[0]->HexHash());

        //The second subentry is a word document
        BLEX_TEST_CHECK(receiver.toppart->parts[1].get());
        BLEX_TEST_CHECKEQUAL("Application/Octet-stream; name=\"nothing.doc\"; type=Unknown", receiver.toppart->parts[1]->contenttype);
        BLEX_TEST_CHECKEQUAL("attachment; filename=\"nothing.doc\"", receiver.toppart->parts[1]->disposition);
        BLEX_TEST_CHECKEQUAL(100352, receiver.toppart->parts[1]->data.size());
        BLEX_TEST_CHECKEQUAL(0, receiver.toppart->parts[1]->parts.size());
        BLEX_TEST_CHECKEQUAL("650446DC8F1C8F293B54B97C4134CD32", receiver.toppart->parts[1]->HexHash());
}

void TestTwoLevelMime_Scan(unsigned stepsize, std::vector<char> const &srcdata)
{
        //Decode it!
        SimpleMimeReceiver receiver;
        Blex::Mime::Decoder decoder(receiver, "text/plain");
        decoder.Start("multipart/alternative;boundary=\"=_-_TWVzc2FnZS1Cb3VuZGFyeS0tNzM3MzI4LTY4NjYwODg1LTU-b_\"","","","","", 0, 0, 0);

        for (unsigned pos=0;pos < srcdata.size(); pos += stepsize)
            decoder.ProcessData(&srcdata[pos],std::min<std::size_t>(stepsize, srcdata.size() - pos));

        decoder.Finish();
        receiver.CheckFinished();

        //Test root entry
        BLEX_TEST_CHECK(receiver.toppart.get());
        BLEX_TEST_CHECKEQUAL("multipart/alternative;boundary=\"=_-_TWVzc2FnZS1Cb3VuZGFyeS0tNzM3MzI4LTY4NjYwODg1LTU-b_\"", receiver.toppart->contenttype);
        BLEX_TEST_CHECKEQUAL(2, receiver.toppart->parts.size());

        //Test first subentry is a text/plain
        BLEX_TEST_CHECK(receiver.toppart->parts[0].get());
        BLEX_TEST_CHECKEQUAL("text/plain; charset=UTF-8; format=flowed", receiver.toppart->parts[0]->contenttype);
        BLEX_TEST_CHECKEQUAL(2668, receiver.toppart->parts[0]->data.size());

        //Test second subentry is a multipart/related
        BLEX_TEST_CHECK(receiver.toppart->parts[1].get());
        BLEX_TEST_CHECKEQUAL("multipart/related;boundary=\"=_-_TWVzc2FnZS1Cb3VuZGFyeS0tNzM3MzI4LTY4NjYwODg2LTQ-b_\"", receiver.toppart->parts[1]->contenttype);
        BLEX_TEST_CHECKEQUAL(17, receiver.toppart->parts[1]->parts.size());
        BLEX_TEST_CHECKEQUAL(0, receiver.toppart->parts[1]->data.size());

        // First part in the multipart/related is a text/html
        BLEX_TEST_CHECK(receiver.toppart->parts[1]->parts[0].get());
        BLEX_TEST_CHECKEQUAL("text/html; charset=UTF-8", receiver.toppart->parts[1]->parts[0]->contenttype);

        // Last entry is an image with a contentid
        BLEX_TEST_CHECK(receiver.toppart->parts[1]->parts[16].get());
        BLEX_TEST_CHECKEQUAL("<EF4CE8E3EEE2013F744F2B6EA81BE258>", receiver.toppart->parts[1]->parts[16]->contentid);

        // Test sizes
        BLEX_TEST_CHECKEQUAL(17848, receiver.toppart->parts[1]->parts[0].get() ? receiver.toppart->parts[1]->parts[0]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(837, receiver.toppart->parts[1]->parts[1].get() ? receiver.toppart->parts[1]->parts[1]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(1017, receiver.toppart->parts[1]->parts[2].get() ? receiver.toppart->parts[1]->parts[2]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(39409, receiver.toppart->parts[1]->parts[3].get() ? receiver.toppart->parts[1]->parts[3]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(827, receiver.toppart->parts[1]->parts[4].get() ? receiver.toppart->parts[1]->parts[4]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(807, receiver.toppart->parts[1]->parts[5].get() ? receiver.toppart->parts[1]->parts[5]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(6126, receiver.toppart->parts[1]->parts[6].get() ? receiver.toppart->parts[1]->parts[6]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(819, receiver.toppart->parts[1]->parts[7].get() ? receiver.toppart->parts[1]->parts[7]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(799, receiver.toppart->parts[1]->parts[8].get() ? receiver.toppart->parts[1]->parts[8]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(5900, receiver.toppart->parts[1]->parts[9].get() ? receiver.toppart->parts[1]->parts[9]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(46254, receiver.toppart->parts[1]->parts[10].get() ? receiver.toppart->parts[1]->parts[10]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(841, receiver.toppart->parts[1]->parts[11].get() ? receiver.toppart->parts[1]->parts[11]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(826, receiver.toppart->parts[1]->parts[12].get() ? receiver.toppart->parts[1]->parts[12]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(46933, receiver.toppart->parts[1]->parts[13].get() ? receiver.toppart->parts[1]->parts[13]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(17475, receiver.toppart->parts[1]->parts[14].get() ? receiver.toppart->parts[1]->parts[14]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(14631, receiver.toppart->parts[1]->parts[15].get() ? receiver.toppart->parts[1]->parts[15]->data.size() : 0);
        BLEX_TEST_CHECKEQUAL(30519, receiver.toppart->parts[1]->parts[16].get() ? receiver.toppart->parts[1]->parts[16]->data.size() : 0);
}


std::string TestRemove(std::string const &header, std::string const &param)
{
        std::string retval(header);
        Blex::Mime::HeaderParam todel = Blex::Mime::FindHeaderParameter(retval.begin(),retval.end(),param);
        Blex::Mime::RemoveHeaderParameter(&retval,todel);
        return retval;
}

BLEX_TEST_FUNCTION(MimeSupportFuncTest)
{
        using Blex::Mime::ExtractHeaderParameter;

        BLEX_TEST_CHECKEQUAL("us-ascii", ExtractHeaderParameter("text-html; charset=us-ascii","charset"));
        BLEX_TEST_CHECKEQUAL("us-ascii", ExtractHeaderParameter("text-html;CHarset=us-ascii","charset"));
        BLEX_TEST_CHECKEQUAL("us-ascii", ExtractHeaderParameter("text-html;CHarset=us-ascii;","charset"));
        BLEX_TEST_CHECKEQUAL("us-ascii", ExtractHeaderParameter("text-html;charSET=\"us-ascii\"","charset"));
        BLEX_TEST_CHECKEQUAL("us-ascii", ExtractHeaderParameter("text-html;charset=\"us-ascii\";","CharseT"));
        BLEX_TEST_CHECKEQUAL("us-\"ascii", ExtractHeaderParameter("text-html;charset=\"us-\\\"ascii\";","CharseT"));
        //note: the header below is illegal, so us-ascii\ is just 'a' possible response
        BLEX_TEST_CHECKEQUAL("us-ascii\\", ExtractHeaderParameter("text-html;charset=\"us-ascii\\\"","CharseT"));
        BLEX_TEST_CHECKEQUAL("", ExtractHeaderParameter("text-html;charset=\"us-ascii\";","type"));
        BLEX_TEST_CHECKEQUAL("", ExtractHeaderParameter("text-html","type"));
        BLEX_TEST_CHECKEQUAL("", ExtractHeaderParameter("","type"));

        BLEX_TEST_CHECKEQUAL("us-ascii", ExtractHeaderParameter("text-html; charset=us-ascii","charset"));
        BLEX_TEST_CHECKEQUAL("us-ascii", ExtractHeaderParameter("text-html; charset=us-ascii; type=data","charset"));
        BLEX_TEST_CHECKEQUAL("data", ExtractHeaderParameter("text-html; charset=us-ascii; type=data","type"));
        BLEX_TEST_CHECKEQUAL("us-ascii", ExtractHeaderParameter("text-html; noise=\"charset=latin-1\"; charset=us-ascii; type=data","charset"));
        BLEX_TEST_CHECKEQUAL("us-ascii", ExtractHeaderParameter("text-html; noise=\"charset=\\\"latin-1\"; charset=us-ascii; type=data","charset"));

        BLEX_TEST_CHECKEQUAL("&amp;;%20", ExtractHeaderParameter("text-html; charset=\"&amp;;%20\"","charset"));

        BLEX_TEST_CHECKEQUAL("text-html", TestRemove("text-html; charset=us-ascii","charset"));
        BLEX_TEST_CHECKEQUAL("text-html; type=data", TestRemove("text-html; charset=us-ascii; type=data","charset"));
        BLEX_TEST_CHECKEQUAL("text-html; charset=us-ascii", TestRemove("text-html; charset=us-ascii; type=data","type"));

        BLEX_TEST_CHECKEQUAL("text-html; noise=\"charset=latin-1\"; type=data", TestRemove("text-html; noise=\"charset=latin-1\"; charset=us-ascii; type=data","charset"));
        BLEX_TEST_CHECKEQUAL("text-html; noise=\"charset=\\\"latin-1\"; type=data", TestRemove("text-html; noise=\"charset=\\\"latin-1\"; charset=us-ascii; type=data","charset"));
        BLEX_TEST_CHECKEQUAL("text-html;charset=\"us-ascii\";", TestRemove("text-html;charset=\"us-ascii\";","type"));
        BLEX_TEST_CHECKEQUAL("text-html", TestRemove("text-html","type"));
        BLEX_TEST_CHECKEQUAL("", TestRemove("","type"));
}

BLEX_TEST_FUNCTION(TwoLevelMimeTest)
{
        {
                std::unique_ptr<Blex::RandomStream> srcfile(Blex::Test::OpenTestFile("mime2.txt"));

                //set it all up inside a memory buffer
                std::vector<char> srcdata;
                Blex::ReadStreamIntoVector(*srcfile,&srcdata);

                //Feed it in different stepsizes!
                unsigned stepsizes[] = { 10000000, 1, 3, 16, 1024, 16384, 1000000 };  // FIXME: test 1024 once
                for (unsigned i=0;i<sizeof stepsizes/sizeof *stepsizes;++i)
                    TestTwoLevelMime_Mime2(stepsizes[i],srcdata);
        }

        {
                std::unique_ptr<Blex::RandomStream> srcfile(Blex::Test::OpenTestFile("scan.eml"));

                //set it all up inside a memory buffer
                std::vector<char> srcdata;
                Blex::ReadStreamIntoVector(*srcfile,&srcdata);

                //Feed it in different stepsizes!
                unsigned stepsizes[] = { 10000000, 1, 3, 16, 1024, 16384, 1000000 };  // FIXME: test 1024 once
                for (unsigned i=0;i<sizeof stepsizes/sizeof *stepsizes;++i)
                    TestTwoLevelMime_Scan(stepsizes[i],srcdata);
        }
}

BLEX_TEST_FUNCTION(TestCRRegression)
{
        //Decode it!
        SimpleMimeReceiver receiver;
        Blex::Mime::Decoder decoder(receiver, "text/plain");

        std::string srcdata = "A\r\rA\r\n";
        decoder.Start("Multipart/Mixed; boundary=Message-Boundary-8915","","","","", 0, 0, 0);

        int stepsize = 1;
        for (unsigned pos=0;pos < srcdata.size(); pos += stepsize)
            decoder.ProcessData(&srcdata[pos],std::min<std::size_t>(stepsize, srcdata.size() - pos));

        BLEX_TEST_CHECKEQUAL(4, receiver.toppart->data.size());
}

BLEX_TEST_FUNCTION(CharsetMimeTest)
{
        std::unique_ptr<Blex::RandomStream> srcfile(Blex::Test::OpenTestFile("mime-simple8bit.txt"));
        BLEX_TEST_CHECK(srcfile.get()); //tests are useless without the source file..

        //set it all up inside a memory buffer
        std::vector<char> srcdata;
        Blex::ReadStreamIntoVector(*srcfile,&srcdata);

        //Decode it!
        SimpleMimeReceiver receiver;
        Blex::Mime::Decoder decoder(receiver, "text/plain");
        decoder.Start("text/plain; charset=ISO-8859-1","8bit","","","", 0, 0, 0);
        decoder.ProcessData(&srcdata[0],srcdata.size());
        decoder.Finish();

        //Now parse it..
        BLEX_TEST_CHECK(receiver.toppart.get());
        BLEX_TEST_CHECKEQUAL("text/plain; charset=utf-8", receiver.toppart->contenttype);
        BLEX_TEST_CHECKEQUAL(106, receiver.toppart->data.size());
        BLEX_TEST_CHECKEQUAL(0, receiver.toppart->parts.size());
        BLEX_TEST_CHECKEQUAL("4F0807C108FEFD12478BF709264D4B0B", receiver.toppart->HexHash());
}

BLEX_TEST_FUNCTION(QPMimeTest)
{
        std::unique_ptr<Blex::RandomStream> srcfile(Blex::Test::OpenTestFile("mime-qp.txt"));
        BLEX_TEST_CHECK(srcfile.get()); //tests are useless without the source file..

        //set it all up inside a memory buffer
        std::vector<char> srcdata;
        Blex::ReadStreamIntoVector(*srcfile,&srcdata);

        //Decode it!
        SimpleMimeReceiver receiver;
        Blex::Mime::Decoder decoder(receiver, "text/plain");
        decoder.Start("multipart/alternative; boundary=\"----=_NextPart_000_0000_01C3C625.70F10880\"","","","","", 0, 0, 0);
        decoder.ProcessData(&srcdata[0],srcdata.size());
        decoder.Finish();

        //Now parse it..
        BLEX_TEST_CHECK(receiver.toppart.get());
        BLEX_TEST_CHECKEQUAL("multipart/alternative; boundary=\"----=_NextPart_000_0000_01C3C625.70F10880\"", receiver.toppart->contenttype);
//        BLEX_TEST_CHECKEQUAL(0, receiver.toppart->data.size());
        BLEX_TEST_CHECKEQUAL(2, receiver.toppart->parts.size());

        //Test first subentry tezt/plain version
        BLEX_TEST_CHECK(receiver.toppart->parts[0].get());
        BLEX_TEST_CHECKEQUAL("text/plain; charset=utf-8", receiver.toppart->parts[0]->contenttype);
        BLEX_TEST_CHECKEQUAL("", receiver.toppart->parts[0]->description);
        BLEX_TEST_CHECKEQUAL("68809FBDCB0BAE7E822F3E853336C13B", receiver.toppart->parts[0]->HexHash());

        BLEX_TEST_CHECK(receiver.toppart->parts[1].get());
        BLEX_TEST_CHECKEQUAL("text/html; charset=utf-8", receiver.toppart->parts[1]->contenttype);
        BLEX_TEST_CHECKEQUAL("C5B156F34905F8A6AF8B3ABA2CD7C5AD", receiver.toppart->parts[1]->HexHash());
}

std::string DecodeMIMEEncodedWords(std::string const &input)
{
        std::string output;
        Blex::Mime::DecodeEncodedWords(input.size(),&input[0],&output);
        return output;
}

std::string EncodeMIMEWords(std::string const &input)
{
        std::string output;
        Blex::Mime::EncodeWords(input.size(),&input[0],&output);
        return output;
}

BLEX_TEST_FUNCTION(EncodedWordsTest)
{
        /* Test the decoder with corrupted data to make sure it doesn't cause HS errors. */
        BLEX_TEST_CHECKEQUAL("a",          DecodeMIMEEncodedWords("=?ISO-8859-1?Q?a?="));
        BLEX_TEST_CHECKEQUAL("abcd",       DecodeMIMEEncodedWords("=?ISO-8859-1?Q?a?= =?ISO-8859-1?Q?b?= =?ISO-8859-1?Q?c?= =?ISO-8859-1?Q?d?="));
        BLEX_TEST_CHECKEQUAL("a b",        DecodeMIMEEncodedWords("=?ISO-8859-1?Q?a?= b"));

        //White space between adjacent 'encoded-word's is not displayed.
        BLEX_TEST_CHECKEQUAL("ab",        DecodeMIMEEncodedWords("=?ISO-8859-1?Q?a?= =?ISO-8859-1?Q?b?="));
        BLEX_TEST_CHECKEQUAL("ab",        DecodeMIMEEncodedWords("=?ISO-8859-1?Q?a?=     =?ISO-8859-1?Q?b?="));

        //Space must be encoded..
        BLEX_TEST_CHECKEQUAL("a b",       DecodeMIMEEncodedWords("=?ISO-8859-1?Q?a_b?="));
        BLEX_TEST_CHECKEQUAL("a b",       DecodeMIMEEncodedWords("=?ISO-8859-1?Q?a?= =?ISO-8859-2?Q?_b?="));
        BLEX_TEST_CHECKEQUAL("a b",       DecodeMIMEEncodedWords("=?ISO-8859-1?Q?a=20b?="));

        //Base-64 encodings
        BLEX_TEST_CHECKEQUAL("If you can read this you understand the example.",
                        DecodeMIMEEncodedWords("=?ISO-8859-1?B?SWYgeW91IGNhbiByZWFkIHRoaXMgeW8=?=    =?ISO-8859-2?B?dSB1bmRlcnN0YW5kIHRoZSBleGFtcGxlLg==?="));

        //Simple word encoding

        BLEX_TEST_CHECKEQUAL("ABC?",EncodeMIMEWords("ABC?"));
        BLEX_TEST_CHECKEQUAL("=?US-ASCII?Q?ABC=3D=3F?=",EncodeMIMEWords("ABC=?"));

        //NOTE: When fixing the iso-8859-1 errors below, beware that the verification strings are pobably wrong
        BLEX_TEST_CHECKEQUAL("=?UTF-8?Q?=E2=82=ACuro?=",EncodeMIMEWords("\xE2\x82\xACuro"));
        BLEX_TEST_CHECKEQUAL("=?UTF-8?Q?=C3=BBh_x_=E2=82=ACuro?=",EncodeMIMEWords("\xC3\xBBh x \xE2\x82\xACuro"));
        BLEX_TEST_CHECKEQUAL("=?UTF-8?Q?=C3=BBhx=E2=82=ACuro?=",EncodeMIMEWords("\xC3\xBBhx\xE2\x82\xACuro"));
        BLEX_TEST_CHECKEQUAL("=?ISO-8859-1?Q?_=FBh?=",EncodeMIMEWords(" \xC3\xBBh"));
        BLEX_TEST_CHECKEQUAL("=?ISO-8859-1?Q?_=FBh_?=",EncodeMIMEWords(" \xC3\xBBh "));
        BLEX_TEST_CHECKEQUAL("=?ISO-8859-1?Q?=FBh_?=",EncodeMIMEWords("\xC3\xBBh "));
        BLEX_TEST_CHECKEQUAL("=?US-ASCII?Q?=0D=0A?=",EncodeMIMEWords("\r\n"));

        BLEX_TEST_CHECKEQUAL("\xC3\xBBh",        DecodeMIMEEncodedWords("=?isO-8859-1?Q?=FBh?="));
        BLEX_TEST_CHECKEQUAL("\xC3\xBBh",        DecodeMIMEEncodedWords("=?utf-8?Q?=C3=BBh?="));
        BLEX_TEST_CHECKEQUAL("\xE2\x82\xACuro",      DecodeMIMEEncodedWords("=?utf-8?Q?=E2=82=ACuro?="));
        BLEX_TEST_CHECKEQUAL("\xC3\xBBh x \xE2\x82\xACuro", DecodeMIMEEncodedWords("=?utf-8?Q?=C3=BBh?= x =?utf-8?Q?=E2=82=ACuro?="));
        BLEX_TEST_CHECKEQUAL("\xC3\xBBhx\xE2\x82\xACuro",   DecodeMIMEEncodedWords("=?utf-8?Q?=C3=BBhx=E2=82=ACuro?="));
        BLEX_TEST_CHECKEQUAL(" \xC3\xBBh",       DecodeMIMEEncodedWords(" =?utf-8?Q?=C3=BBh?="));
        BLEX_TEST_CHECKEQUAL(" \xC3\xBBh ",      DecodeMIMEEncodedWords(" =?utf-8?Q?=C3=BBh?= "));
        BLEX_TEST_CHECKEQUAL("\xC3\xBBh ",       DecodeMIMEEncodedWords("=?utf-8?Q?=C3=BBh?= "));
        BLEX_TEST_CHECKEQUAL("\xC3\xBBh ",       DecodeMIMEEncodedWords("=?utf-8?Q?=C3=BBh_?="));

        //Ensure proper escaping
        BLEX_TEST_CHECKEQUAL("=?ISO-8859-1?Q?=3D=5F=3F=FBh?=",EncodeMIMEWords("=_?\xC3\xBBh"));
        BLEX_TEST_CHECKEQUAL("=_?\xC3\xBBh", DecodeMIMEEncodedWords("=?iso-8859-1?Q?=3D=5F=3F=FBh?="));
        BLEX_TEST_CHECKEQUAL("=?ISO-8859-1?Q?=28=29=3C=3E=40=2C=3B=3A=5C=22=3C=2F=5B=5D=3F=2E=3D=FBh?=",EncodeMIMEWords("()<>@,;:\\\"</[]?.=\xC3\xBBh"));
}
