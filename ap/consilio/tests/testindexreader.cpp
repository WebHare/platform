#include <ap/libwebhare/allincludes.h>


#include <blex/testing.h>

#include "../consilio.h"
#include "../fieldinfo.h"
#include "../fieldsreader.h"
#include "../indexreader.h"
#include "../cache.h"
#include "../ctokenstream.h"

using namespace Lucene;

extern std::string test_data;

// The segments in this index
const std::string segments[] =
{ "_1"
, "_2"
};

// All of the terms in the test index
const std::string all_terms[] =
{ ":"
, "body:1", "body:13", "body:14", "body:15", "body:3", "body:35", "body:47", "body:a"
, "body:about", "body:access", "body:accessibility", "body:action", "body:actions"
, "body:allow", "body:allowing", "body:alreadi", "body:already", "body:an", "body:and"
, "body:ani", "body:any", "body:applic", "body:application", "body:as", "body:awar"
, "body:aware", "body:be", "body:being", "body:beyond", "body:bodi", "body:body"
, "body:built", "body:by", "body:cach", "body:cache", "body:cacheabl", "body:cacheable"
, "body:cached", "body:caching", "body:can", "body:care", "body:careful", "body:chang"
, "body:change", "body:circumst", "body:circumstances", "body:client", "body:code"
, "body:codes", "body:collabor", "body:collaborative", "body:complet", "body:completed"
, "body:condit", "body:conditional", "body:consider", "body:considerations", "body:contain"
, "body:contained", "body:content", "body:current", "body:data", "body:describ"
, "body:described", "body:differ", "body:differs", "body:distribut", "body:distributed"
, "body:entiti", "body:entities", "body:entity", "body:entri", "body:entry", "body:error"
, "body:etag", "body:except", "body:extens", "body:extension", "body:featur", "body:feature"
, "body:field", "body:for", "body:form", "body:forms", "body:from", "body:generic"
, "body:get", "body:happen", "body:happens", "body:have", "body:head", "body:header"
, "body:headers", "body:held", "body:http", "body:hypermedia", "body:hypertext"
, "body:ident", "body:identical", "body:identifi", "body:identified", "body:if"
, "body:implementor", "body:implementors", "body:impli", "body:implied", "body:in"
, "body:includ", "body:includes", "body:independ", "body:independently", "body:indic"
, "body:indicate", "body:indicated", "body:inform", "body:information", "body:intend"
, "body:intended", "body:interact", "body:interactions", "body:internet", "body:is"
, "body:it", "body:its", "body:itself", "body:last", "body:length", "body:level"
, "body:link", "body:links", "body:manag", "body:management", "body:mani", "body:many"
, "body:match", "body:may", "body:md5", "body:mean", "body:means", "body:meet"
, "body:meets", "body:messag", "body:message", "body:metainform", "body:metainformation"
, "body:method", "body:methods", "body:might", "body:modif", "body:modifi", "body:modification"
, "body:modified", "body:multipl", "body:multiple", "body:must", "body:name", "body:negoti"
, "body:negotiation", "body:network", "body:new", "body:none", "body:not", "body:object"
, "body:obtain", "body:obtaining", "body:of", "body:often", "body:onli", "body:only"
, "body:or", "body:other", "body:others", "body:output", "body:over", "body:part"
, "body:partial", "body:partially", "body:previous", "body:previously", "body:process"
, "body:produc", "body:produced", "body:producing", "body:protocol", "body:rang"
, "body:range", "body:recent", "body:reduc", "body:reduce", "body:refer", "body:refers"
, "body:refresh", "body:refreshed", "body:repres", "body:represent", "body:representation"
, "body:represents", "body:request", "body:requests", "body:requir", "body:requirements"
, "body:requiring", "body:resourc", "body:resource", "body:respons", "body:response"
, "body:retriev", "body:retrieve", "body:retrieved", "body:return", "body:returned"
, "body:s", "body:section", "body:secur", "body:security", "body:see", "body:semant"
, "body:semantics", "body:sens", "body:sense", "body:sent", "body:server", "body:servers"
, "body:shall", "body:should", "body:signific", "body:significance", "body:sinc"
, "body:since", "body:softwar", "body:software", "body:sourc", "body:source", "body:stale"
, "body:stateless", "body:such", "body:system", "body:systems", "body:take", "body:task"
, "body:tasks", "body:test", "body:testing", "body:text", "body:that", "body:the"
, "body:their", "body:themselv", "body:themselves", "body:then", "body:they", "body:this"
, "body:through", "body:to", "body:transfer", "body:transferred", "body:transferring"
, "body:treat", "body:type", "body:typing", "body:under", "body:unexpect", "body:unexpected"
, "body:unless", "body:unmodifi", "body:unmodified", "body:unnecessari", "body:unnecessary"
, "body:updat", "body:update", "body:uri", "body:usag", "body:usage", "body:use"
, "body:used", "body:user", "body:valid", "body:validity", "body:valu", "body:values"
, "body:whatev", "body:whatever", "body:when", "body:which", "body:without", "body:would"
, "id:8af86dfb074464ed8bef944188442ca3", "id:aee602a79c233139b4f269a535a8b965"
, "id:b82d9882abdf0112ce3cec7089851b9b"
, "modificationdate:d000B2BE002B32980"
, "size:2538"
, "title:1", "title:3", "title:4", "title:9", "title:get", "title:head", "title:http"
, "title:hypertext", "title:method", "title:methods", "title:protocol", "title:safe"
, "title:transfer"
, "url:http://test/dir1/file1.txt", "url:http://test/dir2/file2.txt", "url:http://test/dir2/file3.txt"
};

// Document#, frequency and positions for "body:of"
const uint32_t of_positions[] =
{ 0                             // doc
, 4                             // freq (#positions)
, 45, 56, 63, 72                // positions
, 2                             // doc
, 6                             // freq (#positions)
, 10, 49, 60, 65, 149, 174      // positions
};

// Document# and #stored_fields
/*ADDME: Unused?
const uint32_t stored_docs[] =
{ 0                             // doc
, 2                             // #stored_fields
, 1                             // doc
, 2                             // #stored_fields
, 2                             // doc
, 4                             // #stored_fields
};

// Stored fields
const std::string stored_fields[] =
{ "title:Hypertext Transfer Protocol -- HTTP/1.1"
, "url:http://test/dir1/file1.txt"
, "title:9.1.1 Safe Methods"
, "url:http://test/dir2/file2.txt"
, "title:9.3 GET 9.4 HEAD"
, "url:http://test/dir2/file3.txt"
, "size:2538"
, "modificationdate:d000B2BE002B32980"
};
*/

// Text to be tokenized (it is split in multiple strings, to test the chunked read
// ability of the token streams)
const std::string tokenize_texts[] = {
"\xEF\xBB\xBF"          // utf-8 byte order mark, doesn't return token
"\x1E""EN""\x1E"        // language switch
"first"                 // word & normalized word
" "                     // whitespace
"\x1E"                  // invalid language switch, doesn't return token
"line"                  // word & normalized word
" "                     // whitespace
";"                     // punct, comment
"comment"               // word & normalized word, comment
"\r\n"                  // whitespace
,
"\x1F"                  // start of link, doesn't return token
"MORE"                  // word & normalized word, linktext
" "                     // whitespace, linktext
"LINES"                 // word & normalized word, linktext
"\x1F"                  // end of link, doesn't return token
" "                     // whitespace
"#"                     // punct, comment
"ANOTHER"               // word & normalized word, comment
" \t "                  // whitespace, comment
// the length of the next word exceeds the maximum length of 15 bytes, so first
// 14 and then the 8 bytes will be returned as word & normalized word, comment
"COMMENTWORDIST\xC3\x96\xC3\x96LONG"
"\r\n"                  // whitespace
,
"\xC3\x9F\xC5\xBF"      // word & normalized word (eszett, long s)
"\xC2\xA9"              // punct (copyright sign)
" "                     // whitespace
"\xC3\xA6\xC3\xA9\xC3\xB8\xC3\xB1\xC3\xAF\xC3\xB9" // word & normalized word (lowercase accented characters)
"\xC2\xA0"              // whitespace (non-breaking space)
"\xC3\x86\xC3\x89\xC3\x98\xC3\x91\xC3\x8F\xC3\x99" // word & normalized word (uppercase accented characters)
};

const ConsilioToken tokenize_tokens[] =
{ ConsilioToken(true, "EN",                   "en",              4,   6,  ConsilioToken::Lang,           false, false, false, false)
, ConsilioToken(true, "first",                "first",           7,  12,  ConsilioToken::Word,           false, false, false, false)
, ConsilioToken(true, " ",                    "",               12,  13,  ConsilioToken::Whitespace,     false, false, false, false)
, ConsilioToken(true, "line",                 "line",           14,  18,  ConsilioToken::Word,           false, false, false, false)
, ConsilioToken(true, " ",                    "",               18,  19,  ConsilioToken::Whitespace,     false, false, false, false)
, ConsilioToken(true, ";",                    "",               19,  20,  ConsilioToken::Punct,          false, true,  false, false)
, ConsilioToken(true, "comment",              "comment",        20,  27,  ConsilioToken::Word,           false, true,  false, false)
, ConsilioToken(true, "\r\n",                 "",               27,  29,  ConsilioToken::Whitespace,     false, false, false, false)
, ConsilioToken(true, "MORE",                 "more",           30,  34,  ConsilioToken::Word,           true,  false, false, false)
, ConsilioToken(true, " ",                    "",               34,  35,  ConsilioToken::Whitespace,     true,  false, false, false)
, ConsilioToken(true, "LINES",                "lines",          35,  40,  ConsilioToken::Word,           true,  false, false, false)
, ConsilioToken(true, " ",                    "",               41,  42,  ConsilioToken::Whitespace,     false, false, false, false)
, ConsilioToken(true, "#",                    "",               42,  43,  ConsilioToken::Punct,          false, true,  false, false)
, ConsilioToken(true, "ANOTHER",              "another",        43,  50,  ConsilioToken::Word,           false, true,  false, false)
, ConsilioToken(true, " \t ",                 "",               50,  53,  ConsilioToken::Whitespace,     false, true,  false, false)
, ConsilioToken(true, "COMMENTWORDIST",       "commentwordist", 53,  67,  ConsilioToken::Word,           false, true,  false, false)
, ConsilioToken(true, "\xC3\x96\xC3\x96LONG", "oolong",         67,  75,  ConsilioToken::Word,           false, true,  false, false)
, ConsilioToken(true, "\r\n",                 "",               75,  77,  ConsilioToken::Whitespace,     false, false, false, false)
, ConsilioToken(true, "\xC3\x9F\xC5\xBF",     "sss",            77,  81,  ConsilioToken::Word,           false, false, false, false)
, ConsilioToken(true, "\xC2\xA9",             "",               81,  83,  ConsilioToken::Punct,          false, false, false, false)
, ConsilioToken(true, " ",                    "",               83,  84,  ConsilioToken::Whitespace,     false, false, false, false)
, ConsilioToken(true, "\xC3\xA6\xC3\xA9\xC3\xB8\xC3\xB1\xC3\xAF\xC3\xB9",
                                              "aeeoniu",        84,  96,  ConsilioToken::Word,           false, false, false, false)
, ConsilioToken(true, "\xC2\xA0",             "",               96,  98,  ConsilioToken::Whitespace,     false, false, false, false)
, ConsilioToken(true, "\xC3\x86\xC3\x89\xC3\x98\xC3\x91\xC3\x8F\xC3\x99",
                                              "aeeoniu",        98,  110, ConsilioToken::Word,           false, false, false, false)
// Invalid token marks end-of-stream
, ConsilioToken()
};

namespace TestIndexReader
{

Blex::Mutex commit_lock;
std::unique_ptr<Blex::ComplexFileSystem> directory;
std::unique_ptr<IndexReader> reader;
SegmentsCache cache;

BLEX_TEST_FUNCTION(TestIndexReader)
{
        try
        {
                directory.reset(new Blex::ComplexFileSystem( test_data + "searchindex"
                                                           , false
                                                           , Blex::ComplexFileSystem::BufferAll));
        }
        catch(std::runtime_error &e)
        {
                BLEX_TEST_FAIL("Opening ComplexFileSystem " + test_data + "searchindex failed");
        }
        try
        {
                reader.reset(IndexReader::Open(commit_lock, *directory, cache));
        }
        catch(LuceneException &e)
        {
                BLEX_TEST_FAIL("Opening IndexReader " + test_data + "searchindex failed");
        }

        // Test deleted documents
        BLEX_TEST_CHECK(reader->HasDeletions());
        BLEX_TEST_CHECK(!reader->IsDeleted(0));
        BLEX_TEST_CHECK(reader->IsDeleted(1));
        BLEX_TEST_CHECK(!reader->IsDeleted(2));
}

BLEX_TEST_FUNCTION(TestTermsReader)
{
        // Test enumerator
        std::unique_ptr<TermEnum> te(reader->Terms());
        BLEX_TEST_CHECK(te.get());

        // Test if we can enumerate through the entire index
        for (unsigned i = 0; i < sizeof(all_terms)/sizeof(all_terms[0]); ++i)
        {
                BLEX_TEST_CHECK(te->Next());
                Term t = te->GetTerm();
                BLEX_TEST_CHECKEQUAL(all_terms[i], t.ToString());
        }

        // Test if we can skip to a certain term
        te.reset(reader->Terms(Term("",""))); // first term
        Term t = te->GetTerm();
        BLEX_TEST_CHECKEQUAL(":", t.ToString());
        te.reset(reader->Terms(Term("body","text"))); // last before index term
        t = te->GetTerm();
        BLEX_TEST_CHECKEQUAL("body:text", t.ToString());
        te.reset(reader->Terms(Term("body","that"))); // first after index term
        t = te->GetTerm();
        BLEX_TEST_CHECKEQUAL("body:that", t.ToString());
        te.reset(reader->Terms(Term("url","http://test/dir2/file3.txt"))); // last term
        t = te->GetTerm();
        BLEX_TEST_CHECKEQUAL("url:http://test/dir2/file3.txt", t.ToString());
        te.reset(reader->Terms(Term("body","objects"))); // non-existing term, should skip to first term after it
        t = te->GetTerm();
        BLEX_TEST_CHECKEQUAL("body:obtain", t.ToString());

        // Test number of documents for search terms
        BLEX_TEST_CHECKEQUAL(1, reader->DocFreq(Term("body","47"))); // doc 0
        BLEX_TEST_CHECKEQUAL(1, reader->DocFreq(Term("body","actions"))); // doc 1
        BLEX_TEST_CHECKEQUAL(1, reader->DocFreq(Term("body","body"))); // doc 2
        BLEX_TEST_CHECKEQUAL(2, reader->DocFreq(Term("body","a"))); // doc 0, 2
        BLEX_TEST_CHECKEQUAL(3, reader->DocFreq(Term("body","to"))); // doc 0, 1, 2
        BLEX_TEST_CHECKEQUAL(0, reader->DocFreq(Term("",""))); // no docs
        BLEX_TEST_CHECKEQUAL(0, reader->DocFreq(Term("Body","to"))); // no docs
        BLEX_TEST_CHECKEQUAL(0, reader->DocFreq(Term("body","To"))); // no docs
        BLEX_TEST_CHECKEQUAL(0, reader->DocFreq(Term("body","input"))); // no docs
        BLEX_TEST_CHECKEQUAL(0, reader->DocFreq(Term("text","to"))); // no docs
        BLEX_TEST_CHECKEQUAL(0, reader->DocFreq(Term("zzzzz","zzzzz"))); // no docs

        // Test document# and frequency for search term
        std::shared_ptr<TermDocs> tp = reader->GetTermPositionsPtr(Term("body","to"));
        BLEX_TEST_CHECK(tp->Next()); // skip to doc 0
        BLEX_TEST_CHECKEQUAL(0, tp->Doc());
        BLEX_TEST_CHECKEQUAL(1, tp->Freq());
        BLEX_TEST_CHECK(tp->Next()); // skip to doc 2 (doc 1 is deleted)
        BLEX_TEST_CHECKEQUAL(2, tp->Doc());
        BLEX_TEST_CHECKEQUAL(15, tp->Freq());

        // Test positions for search term
        tp = reader->GetTermPositionsPtr(Term("body","of"));
        unsigned i = 0;
        while (i < (sizeof(of_positions)/sizeof(of_positions[0])))
        {
                BLEX_TEST_CHECK(tp->Next());
                uint32_t doc = of_positions[i++];
                BLEX_TEST_CHECKEQUAL(doc, tp->Doc());
                uint32_t freq = of_positions[i++];
                BLEX_TEST_CHECKEQUAL(freq, tp->Freq());
                for (unsigned j = 0; j < freq; ++j)
                {
                        uint32_t pos = 0;
                        try {
                                pos = tp->NextPosition();
                        } catch (LuceneException &e) {
                                BLEX_TEST_FAIL("Getting position "+Blex::AnyToString(j)+" for document "+Blex::AnyToString(doc)+" failed");
                        }
                        BLEX_TEST_CHECKEQUAL(of_positions[i++], pos);
                }
                BLEX_TEST_CHECKTHROW(tp->NextPosition(), LuceneException);
        }
}

BLEX_TEST_FUNCTION(TestFieldsReader)
{
        for (unsigned i = 0; i < sizeof(segments)/sizeof(segments[0]); ++i)
        {
                const std::unique_ptr<FieldInfos> fi(new FieldInfos(*directory, segments[i]+".fnm"));
                BLEX_TEST_CHECK(fi.get());

                const std::unique_ptr<FieldsReader> fr(new FieldsReader(directory.get(), segments[i], *fi));
                BLEX_TEST_CHECK(fr.get());

                //ADDME: Actually test reading stored fields!
        }
}

BLEX_TEST_FUNCTION(TestTokenStreams)
{
        std::string alltext;
        for (unsigned i = 0; i < sizeof(tokenize_texts)/sizeof(tokenize_texts[0]); ++i)
            alltext += tokenize_texts[i];

        const std::unique_ptr<NormalizedTokenStream> tokenizer(new NormalizedTokenStream(alltext));
        tokenizer->SetMaxWordLength(15);

        for (unsigned i = 0; i < sizeof(tokenize_tokens)/sizeof(tokenize_tokens[0]); ++i)
        {
                ConsilioToken t = tokenizer->Next();
                BLEX_TEST_CHECKEQUAL(tokenize_tokens[i].valid, t.valid);
                if (!t.valid)
                    break; // This was the last token
                BLEX_TEST_CHECKEQUAL(tokenize_tokens[i].term, t.term);
                BLEX_TEST_CHECKEQUAL(tokenize_tokens[i].normalizedterm, t.normalizedterm);
                BLEX_TEST_CHECKEQUAL(tokenize_tokens[i].startoffset, t.startoffset);
                BLEX_TEST_CHECKEQUAL(tokenize_tokens[i].endoffset, t.endoffset);
                BLEX_TEST_CHECKEQUAL(tokenize_tokens[i].type, t.type);
                BLEX_TEST_CHECKEQUAL(tokenize_tokens[i].linktext, t.linktext);
                BLEX_TEST_CHECKEQUAL(tokenize_tokens[i].comment, t.comment);
                BLEX_TEST_CHECKEQUAL(tokenize_tokens[i].stopword, t.stopword);
        }
}

BLEX_TEST_FUNCTION(TestIndexReaderCleanup)
{
        cache.Clear();
        reader.reset();
        directory.reset();
}

}

