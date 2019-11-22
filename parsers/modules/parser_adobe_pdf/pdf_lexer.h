#ifndef blex_harescript_modules_pdf_lexer
#define blex_harescript_modules_pdf_lexer

#include "pdf_objects.h"

using namespace std::rel_ops;

namespace Parsers
{

namespace Adobe
{

namespace PDF
{

typedef std::pair<uint32_t, uint32_t> ObjectNumGen; //first = num, second = gen
typedef std::pair<uint32_t, Blex::FileOffset> ObjectLocation; //first = stored in (0 for raw), second = file offset or inside-objectstream position, 0,0 = unused

typedef std::map<ObjectNumGen, ObjectLocation> CrossRefIndex;

class Lexer
{
public:
        Lexer(Blex::RandomStream &_stream);

        void SetVersion(Version const &version) { this->version = version; }

        /** Determine the version of this PDF file */
        Version ParseVersion();

        /** Determine the last cross reference */
        Blex::FileOffset GetLastCrossRef();

        /** Read and parse objects */
        ObjectPtr ResolveIndirect(std::pair<uint32_t, uint32_t> indirectobject);
        ObjectPtr GetNextObject(unsigned objnum, unsigned objgen);

        /** Extend the cross reference map with the data found at offset, return trailer */
        ObjectPtr ParseCrossRef(Blex::FileOffset offset);

        ObjectPtr ParseCrossRefStream(Blex::FileOffset offset);

        /** Set the encryption key */
        void SetFileKey(std::string const &key) { filekey = key; }

        unsigned GetKey(uint8_t *output_key, unsigned objnum, unsigned objgen);

private:
        struct ParserContext
        {
        public:
                explicit ParserContext()
                {
                        offset = 0;
                        buf = 0;
                        stream = NULL;
                }
                /*explicit ParserContext(Blex::FileOffset setoffset)
                {
                        offset = setoffset;
                        buf = 0;
                }
*/
                Blex::FileOffset offset;
                char buf;
                Blex::RandomStream *stream;
        };

        ParserContext current_parser_ctxt;
        std::vector<ParserContext> parser_context;

        void SetupParserContext(Blex::RandomStream *randomstream, Blex::FileOffset offset)
        {
                current_parser_ctxt.stream = randomstream;
                current_parser_ctxt.offset = offset;
                current_parser_ctxt.buf = 0;
        }
        void PushParserContext()
        {
                parser_context.push_back(current_parser_ctxt);
        }

        void RestoreParserContext()
        {
                current_parser_ctxt = parser_context.back();
        }

        void PopParserContext()
        {
                parser_context.pop_back();
        }

        char PeekChar()
        {
                if (Eof())
                    PastEofException();
                if (current_parser_ctxt.buf == 0)
                    current_parser_ctxt.stream->DirectRead(current_parser_ctxt.offset, &current_parser_ctxt.buf, 1);
                return current_parser_ctxt.buf;
        }

        char GetChar()
        {
                if (Eof())
                    PastEofException();
                if (current_parser_ctxt.buf == 0)
                    PeekChar();
                char c = current_parser_ctxt.buf;
                MoveNext();
                return c;
        }

        void MoveNext()
        {
                ++current_parser_ctxt.offset;
                current_parser_ctxt.buf = 0;
        }

        void MoveBack()
        {
                if (current_parser_ctxt.offset > 0)
                    --current_parser_ctxt.offset;
                current_parser_ctxt.buf = 0;
        }

        void SetOffset(Blex::FileOffset newoffset)
        {
                current_parser_ctxt.offset = newoffset;
                current_parser_ctxt.buf = 0;
        }

        bool Eof()
        {
                return current_parser_ctxt.offset >= current_parser_ctxt.stream->GetFileLength();
        }


        CrossRefIndex crossrefs;

        // When positioned at the start of a line, return this line
        std::string GetNextLine();

        enum char_type
        {
                char_normal = 0,
                char_whitespace,
                char_delimiter,
                char_number
        };

        char_type char_type_lookup[256];

        bool isWhiteSpace(unsigned char thischar) { return char_type_lookup[thischar] == char_whitespace; }
        bool isDelimiter(unsigned char thischar) { return char_type_lookup[thischar] == char_delimiter; }
        bool isNumber(unsigned char thischar) { return char_type_lookup[thischar] == char_number; }

        typedef std::pair<unsigned, unsigned> IndirectObjectKey;
        typedef std::map<IndirectObjectKey, IndirectObjectPtr> IndirectObjectCache;

        IndirectObjectCache indobjcache;

        void SkipWhite();

        NumObjectPtr ParseNumeric();
        StringObjectPtr ParseLowlevelString();
        std::string ParsePlainString();

        StringObjectPtr ParseString(unsigned obj, unsigned gen);
        NameObjectPtr ParseName(unsigned obj, unsigned gen);
        ArrayObjectPtr ParseArray(unsigned obj, unsigned gen);
        DictObjectPtr ParseDictionary(unsigned obj, unsigned gen);
        StreamObjectPtr ParseStream(DictObjectPtr const &dict, unsigned obj, unsigned gen);

        void PastEofException();

        std::string filekey;
        Version version;
};

}

}

}

#endif
