#ifndef blex_harescript_modules_font
#define blex_harescript_modules_font

#include <blex/unicode.h>

namespace Parsers
{

namespace Adobe
{

namespace PDF
{

struct Object;
class Font;
class PDFfile;

typedef std::shared_ptr<Font> FontPtr;
typedef std::map<Object const*, FontPtr> FontDescriptors;
typedef std::map<std::string, FontDescriptors::const_iterator> FontRefs;

class CMap
{
        struct CommandLine
        {
                std::vector<ObjectPtr> arguments;
                ObjectPtr keyword;
        };

        CommandLine ReadCommandLine(Lexer &lexer) const;

        struct CharacterConversion
        {
                CharacterConversion(std::string start_, std::string end_, std::string offset_) :
                  start(start_), end(end_), offset(offset_)
                { }

                std::string start;
                std::string end;

                std::string offset;
        };

        struct UnicodeConversion
        {
                UnicodeConversion(std::string begin_codespace_range_, std::string end_codespace_range_) :
                  begin_codespace_range(begin_codespace_range_), end_codespace_range(end_codespace_range_)
                { }

                Blex::UTF16String GetUnicode(std::string const &thisstring) const;

                std::string begin_codespace_range;
                std::string end_codespace_range;

                std::vector<CharacterConversion> char_conversion;
        };

        UnicodeConversion *GetUnicodeConversion(std::string const &thisstring);
        std::vector<UnicodeConversion> unicode_conversion;

public:
        CMap(PDFfile *file, StreamObject const &object);

        bool ConvertCharacter(std::string const &input, Blex::UTF16String *output);
};

class Font
{
public:
        Font(PDFfile *file, ObjectPtr object, Lexer &lexer, std::map<std::string, std::vector<uint16_t> > const &encodings);

        static Font *LoadFont(PDFfile *file, ObjectPtr object, Lexer &lexer, std::map<std::string, std::vector<uint16_t> > const &encodings);

        std::string ConvertText(std::string const &input) const;

        // Lookup table used for simple encodings
        uint16_t lookup_table[256];

        /** Constructor, initializes font based on PDF object */
   //     Font(ObjectPtr object, std::map<std::string, std::vector<uint16_t> > const &encodings, Lexer &lexer);

        /** Convert text to UTF 8 text, based on encoding of this font */
   //     std::string ConvertText(std::string const &input);
        /** Determine number of characters in and the total width of this string */
    //    std::pair<unsigned, unsigned> GetWidth(std::string const &input);

protected:
        std::unique_ptr<CMap> cmap;

        /** Information about the encoding */
        enum {
                ToUnicodeCMap,
                LookupTable,
                IdentityUnicode,
                None
        } encoding;

        /** Font type */
      /*  enum Type {
                Type0,
                Type1,
                MMType1,
                Type3,
                TrueType,
                CIDFontType0,
                CIDFontType2
        } type; */

        /** Character width information */

        // Used for simple fonts (each character code is directly mapped to a width)
//        unsigned simple_widths[256];

        // Used in complex fonts (each CID is mapped to a width)
     /*   std::map<unsigned, unsigned> complex_widths;
        unsigned default_width;    */


   /*     void ParseUnicode(Blex::RandomStream *stream);

        Blex::UTF16String GetNextUnicode(std::string::const_iterator &str_it, unsigned &chars_left);
        Blex::UTF16String ConvertToUnicode(std::string const &thisstring);

        UnicodeConversion &GetUnicodeConversion(std::string const &thisstring);
        std::vector<UnicodeConversion> unicode_conversion;

        uint16_t lookup_table[256];     */
};

class Font_Type0
        : public Font
{
public:
        Font_Type0(PDFfile *file, ObjectPtr object, Lexer &lexer, std::map<std::string, std::vector<uint16_t> > const &encodings);
};

class Font_Type1
        : public Font
{
public:
        Font_Type1(PDFfile *file, ObjectPtr object, Lexer &lexer, std::map<std::string, std::vector<uint16_t> > const &encodings);
};

class Font_TrueType
        : public Font
{
public:
        Font_TrueType(PDFfile *file, ObjectPtr object, Lexer &lexer, std::map<std::string, std::vector<uint16_t> > const &encodings);
};

}

}

}

#endif


