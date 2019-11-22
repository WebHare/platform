#include <ap/libwebhare/allincludes.h>


#include <blex/unicode.h>
#include <iostream>
#include <iomanip>
#include "biff.h"
#include "biff_analysis.h"
#include "word_debug.h"
#include "word_pic.h"
#include "wordstyles.h"
#include <sstream>

using namespace Blex;

#define TIMERS          //Time stuff!

#define DEBUGPARAS   //Dump the paragraph table
#define DEBUGCHARS   //Dump the characters table
#define DEBUGLISTS   //Dump all lists and their overrides
#define DEBUGPIECES  //Dump complex pieces

namespace Parsers {
namespace Office {
namespace Word {

bool Stringtable::Read(RandomStream &source,FileOffset startpos,uint32_t length)
{
        /* Word97 normal stringtable header:
           <Number of strtable:int16_t> <Size of extended data:int16_t>
           Word97 extended stringtable header:
           <0xFFFF:uint16_t> <Number of strtable:int16_t> <Size of extended data:int16_t> */
        if (length<2)
            return true;

        std::vector<uint8_t> data(length);
        if (source.DirectRead(startpos,&data[0],length)!=length)
            return false;

        //Stringsize: the bytesize of the actual strtable
        unsigned stringsize;
        //Pos: current data read position
        unsigned pos;
        //Number of entries in string table
        unsigned numentries;

        if (getu16lsb(&data[0])==0xFFFF) //extended!
        {
                stringsize=2;
                pos=6; //header size
                numentries=getu16lsb(&data[2]);
                extradata=getu16lsb(&data[4]);
        }
        else
        {
                stringsize=1;
                pos=4; //header size
                numentries=getu16lsb(&data[0]);
                extradata=getu16lsb(&data[2]);
        }

        strings.resize (numentries);
        extra.resize (extradata*numentries);

        /* We have all header data now, _and_ we know the number of extra
           bytes to expect. Start reading the header data.

           Table data format:
           <Stringlen:LSB uint8_t[stringsize]> <String:uint8_t[stringsize*stringlen]> <Extradata:uint8_t[extradata]> */

        DEBUGPRINT("Starting to read stringtable of " << numentries << " strings with charsize " << (stringsize*8));

        for (unsigned entry=0;entry<numentries;++entry)
        {
                if (pos+stringsize > length)
                {
                        DEBUGPRINT("Failed to read stringtable, cannot find length of entry " << entry);
                        return false;
                }
                //Read the string length (strings are preceeded by their length)
                unsigned stringlen = stringsize==2 ? getu16lsb(&data[pos]) : getu8(&data[pos]);
                if (pos+extradata+(stringlen+1)*stringsize > length)
                {
                        DEBUGPRINT("Failed to read stringtable, truncated data of entry " << entry
                                   << "(we want " << (extradata+(stringlen+1)*stringsize)
                                   << " bytes but only " << (length-pos) << " are available");
                        return false;
                }
                pos+=stringsize; //skip length

                //Now read the actual string
                strings[entry].reserve(stringlen);
                Blex::UTF8Encoder<std::back_insert_iterator<std::string> > utf8_encoder(std::back_inserter(strings[entry]));

                for (unsigned stringptr=0;stringptr<stringlen;++stringptr)
                {
                        //ADDME: UTF-16 to UTF-8 encoding
                        uint16_t ch = stringsize==2 ? getu16lsb(&data[pos]) : getu8(&data[pos]);
                        utf8_encoder(ch);
                        pos += stringsize;
                }

                //And copy associated extra data!
                if (extradata)
                {
                        memcpy(&extra[entry*extradata],&data[pos],extradata);
                        pos += extradata;
                }
        }
        DEBUGONLY(if (pos < length) DEBUGPRINT("Stringtable has " << (length-pos) << " superfluous bytes"));
        return true; //succes!
}

void Stringtable::Dump(std::ostream &output) const
{
        output << "Stringtable with " << strings.size() << " entries, each with " << extradata << " additional bytes\n";
        for (unsigned int i=0;i<strings.size();++i)
            output << "String " << i << " = [" << strings[i] << "]\n";
}

Plcf::Plcf(RandomStream &tablefile, Fc data_fc, unsigned data_lcb, unsigned structsize, bool readfirst /* defaulted to false */)
  : tablefile(tablefile), entries(0), structsize(structsize)
{
        if (!data_lcb)
            return;

        if ( (data_lcb-4)%structsize)
        {
                DEBUGPRINT("Corrupted Word document: PLCF broken structure size");
                return;
        }

        entries=(data_lcb-4)/structsize;
        if (entries==0) //Empty PLCF
            return;

        //we'll read it all at once!
        buffer.resize(data_lcb-4); //not loading first 4 bytes - we'll trust lcb

        if (readfirst)
        {
                tablefile.DirectRead(data_fc,&buffer[0],entries*4);
                tablefile.DirectRead(data_fc+4+entries*4,&buffer[entries*4],entries*(structsize-4));
        }
        else
        {
                tablefile.DirectRead(data_fc+4,&buffer[0],data_lcb-4);
        }
}

uint32_t Plcf::GetEntryOffset(unsigned entry) const
{
        return Blex::getu32lsb(&buffer[entry*4]);
}
const uint8_t *Plcf::GetEntryData(unsigned entry) const
{
        return &buffer[entries*4 + entry*(structsize-4)];
}

void BiffDoc::ReadLists()
{
        std::map<uint32_t, ListDataPtr> abstract_nums;

        if (header.LengthListFormatInfo())
            {
                std::vector<uint8_t> buffer(header.LengthListFormatInfo());
                tablefile->DirectRead(header.OffsetListFormatInfo(),&buffer[0],header.LengthListFormatInfo());

                unsigned int size=Blex::getu16lsb(&buffer[0]);

                if (size!=header.LengthListFormatInfo()/28)
                {
                        DEBUGPRINT("Corrupted Word document: Mismatch between reported ("
                                    << size << ") and actual number ("
                                    << (header.LengthListFormatInfo()/28) << ") of lists.");
                        size=std::min<unsigned>(size,header.LengthListFormatInfo()/28);
                }


                LimitedStream limited_str(header.OffsetListFormatInfo()+2+28*size, tablefile->GetFileLength(), *tablefile);
                BufferedStream listdatastream(limited_str, 4096);

                for (unsigned int i=0;i<size;++i)
                {
                        ListDataPtr abstract(new ListData);

                        bool simplelist; //ADDME DocX spec dictates to ignore this property

                        abstract->unique_list_id=Blex::getu32lsb(&buffer[2+28*i + 0]);
                        abstract->unique_template_code=Blex::getu32lsb(&buffer[2+28*i + 4]);
                        for (int a=0;a<9;++a)
                            abstract->styles[a] = Blex::getu16lsb(&buffer[2+28*i + 8 + 2*a]);
                        abstract->simplelist = simplelist = Blex::getu8(&buffer[2+28*i + 26]) & 1 ? true : false;
                        abstract->restart_heading = Blex::getu8(&buffer[2+28*i + 26]) & 2 ? true : false;

                        for (int a=0;a<(simplelist?1:9);++a)
                        {
                                std::shared_ptr<BiffListLevel> bll;
                                bll.reset(new BiffListLevel(*this, a));

                                abstract->levels[a] = bll;
                                if (bll->Read(listdatastream) == 0)
                                {
                                        DEBUGPRINT("Corrupted Word document: Error reading list level data for list " << i << " entry " << a);
                                }
                        }

                        abstract_nums[abstract->unique_list_id] = abstract;

#ifdef DEBUGLISTS
                        DumpAbstractNumbering(*abstract);
#endif
                }
        }
        if (header.LengthListFormatOverrides())
        {
                std::vector<uint8_t> buffer(header.LengthListFormatOverrides());
                tablefile->DirectRead(header.OffsetListFormatOverrides(),
                                      &buffer[0],
                                      header.LengthListFormatOverrides());

                unsigned int size=Blex::getu32lsb(&buffer[0]);

                unsigned ptr=4+size*16;

                for (unsigned int i=0; i<size; ++i)
                {
                        ListOverridePtr listnum(new ListOverride);

                        uint32_t unique_id=Blex::getu32lsb(&buffer[4+i*16]);
                        listnum->abstract = abstract_nums[unique_id];

#ifdef DEBUGLISTS
                        if (Blex::getu32lsb(&buffer[8+i*16]))
                            DEBUGPRINT("List i junk 1 " << std::hex << Blex::getu32lsb(&buffer[8+i*16]) << std::dec);
                        if (Blex::getu32lsb(&buffer[12+i*16]))
                            DEBUGPRINT("List i junk 2 " << std::hex << Blex::getu32lsb(&buffer[12+i*16]) << std::dec);
                        if (Blex::getu32lsb(&buffer[16+i*16])&0xFFFFFF00)
                            DEBUGPRINT("List i junk 3 " << std::hex << (Blex::getu32lsb(&buffer[16+i*16]) & 0xFFFFFF00) << std::dec);
#endif

                        if (ptr+4 > header.LengthListFormatOverrides())
                            throw std::runtime_error("Corrupted Word document: List data truncated");

                        //Hypothesis: Word always inserts 0xFF 0xFF 0xFF 0xFF in the LFOLVL
                        //space for every LFO seen. (well, not always :-( )
                        if (Blex::gets32lsb(&buffer[ptr])!=-1)
                            DEBUGPRINT("Weird formatting " << i << " got odd seperator " << std::hex << Blex::gets32lsb(&buffer[ptr]) << std::dec);

                        ptr+=4;

                        for (unsigned ovr=0;ovr<unsigned(Blex::getu8(&buffer[4+i*16+12]));++ovr)
                        {
                                if ((ptr+8)>header.LengthListFormatOverrides())
                                    throw std::runtime_error("Corrupted Word document: List data truncated");

                                listnum->overrides.push_back(LevelOverride());
                                LevelOverride *newone=&listnum->overrides.back();

                                newone->level=static_cast<uint8_t>(Blex::getu8(&buffer[ptr+4]) & 0xf);
                                bool override_formatting = Blex::getu8(&buffer[ptr+4])&0x20;
                                bool override_startat = Blex::getu8(&buffer[ptr+4])&0x10;

                                if (override_formatting) //formatting
                                {
                                        if (override_startat)
                                            DEBUGPRINT("Unexpected startat override combined with formatting override for " << i);

                                        Fc level_ptr = ptr+8+header.OffsetListFormatOverrides();
                                        LimitedStream limited_str(level_ptr, tablefile->GetFileLength(), *tablefile);

                                        std::shared_ptr<BiffListLevel> bll;
                                        bll.reset(new BiffListLevel(*this, newone->level));

                                        newone->new_level = bll;
                                        ptr+=bll->Read(limited_str);
                                        newone->formatting=true;

                                        //Upgrade the 'start at' options
                                        newone->startat=true;
                                        newone->new_startat = newone->new_level->startat;
                                }
                                else
                                {
                                        //No formatting
                                        if (override_startat) //overriding StartAt value
                                        {
                                                newone->startat=true;
                                                newone->new_startat=Blex::gets32lsb(&buffer[ptr]);
                                        }

                                        newone->formatting=false;
                                }
                                ptr+=8; //skip over LFOLVL
#ifdef DEBUGLISTS
                                DEBUGPRINT("List ovr level " << (unsigned)newone->level << " ovr formatting: " << newone->formatting << " ovr startat: " << newone->startat << "  new_startat: " << newone->new_startat);
#endif
                        }

                        if(!listnum->abstract)
                        {
                                DEBUGPRINT("BIFF: Skipping numbering #" << i << " because it has no abstract");
                        }
                        else
                        {
                                numberings[i+1] = listnum;
                        }
                }


                DEBUGONLY (if (ptr!=header.LengthListFormatOverrides()) DEBUGPRINT("Bug in LFO parser ? " << (header.LengthListFormatOverrides()-ptr) << " excess bytes"));
        }
}

void DocBase::SetupFontInfo(Font *newfont)
{
        if(newfont->charset == 0 || newfont->charset==128/*unicode MS?*/)  //only add families for plain fonts
        {
                unsigned family = newfont->fontfamily;

                //ADDME docx has exceptions for Verdana too, centralize this..
                if(newfont->formatted.font_face == "Verdana")
                      family = 2;

                if (family == 0 || family == 1) //Serif
                {
                        newfont->formatted.font_face.append(", Serif");
                }
                else if (family == 2) //Sans serif
                {
                        newfont->formatted.font_face.append(", Sans-Serif");
                }
                else if (family == 3) //Monotype
                {
                        newfont->formatted.font_face.append(", Monotype");
                }
                else if (family == 4) //Cursive...
                {
                        newfont->formatted.font_face.append(", Cursive");
                }
                else if (family == 5) //Fantasy...
                {
                        newfont->formatted.font_face.append(", Fantasy");
                }
                else
                {
                        DEBUGPRINT("Unrecognized font family " << newfont->fontfamily);
                }
                newfont->charactermap = Blex::GetCharsetConversiontable(Blex::Charsets::CP1252);
        }
        else if (newfont->charset == 1) //MacWord
        {
                newfont->charactermap = Blex::GetCharsetConversiontable(Blex::Charsets::CPMacWord);
        }
        else if(newfont->charset == 2) //Exotic MS fonts (Symbol, Wingdings)
        {
                /*
                if (newfont->formatted.font_face == "Symbol")
                        {
                                newfont->charactermap = Blex::GetCharsetConversiontable(Blex::Charsets::CPSymbol);
                                newfont->formatted.font_face = "Times New Roman, Serif";
                                newfont->msfonttype = Font::Symbol;
                        }
                        else if (newfont->formatted.font_face == "Wingdings")
                        {
                                newfont->charactermap = wingdings_to_unicode;
                                newfont->formatted.font_face = "Times New Roman, Serif";
                                newfont->msfonttype = Font::Wingdings;
                        }
                }   */

                //Make sure noone overwrites this font, it messes up bullets etc
                newfont->formatted.neveroverride=true;
        }
        else
        {
                //Make sure noone overwrites this font, we don't know its charset
                newfont->formatted.neveroverride=true;
                DEBUGPRINT("Can't figure out charset " << newfont->charset);
        }
}

void BiffDoc::ReadFonts()
{
        //read the font names
        if (!header.OffsetFontSttbf() || !header.LengthFontSttbf())
            DEBUGPRINT("Corrupted Word document: No font information");

        std::vector<uint8_t> buffer(header.LengthFontSttbf());
        tablefile->DirectRead(header.OffsetFontSttbf(),
                              &buffer[0],
                              header.LengthFontSttbf());

        unsigned ptr=4;
        fonts.reserve(Blex::getu32lsb(&buffer[0]));
        while (ptr<header.LengthFontSttbf() && (ptr+buffer[ptr])<header.LengthFontSttbf())
        {
                if (fonts.size()==Blex::getu32lsb(&buffer[0]))
                {
                        DEBUGPRINT("Garbage after font table");
                        break;
                }

                Font new_font;
                new_font.prq=uint8_t(buffer[ptr+1] & 0x3);
                new_font.truetype=buffer[ptr+1] & 0x4 ? true : false;
                new_font.fontfamily=uint8_t((buffer[ptr+1] & 0x70) >> 4);
                new_font.baseweight=Blex::getu16lsb(&buffer[ptr+2]);
                new_font.charset=buffer[ptr+4];
                new_font.alternative=buffer[ptr+5];
                new_font.charactermap=NULL;
                new_font.msfonttype = Font::Plain;

                if (new_font.charset>2) /* Word once generated a character set '77' for Futura,confusing all other code. No clue why */
                {
                        DEBUGPRINT("\aFont character set is out of the valid range: " << (int)new_font.charset);
                        new_font.charset = 0;
                }

                unsigned strsize = (buffer[ptr]-40)/2;

                for (unsigned i=0; i<strsize; ++i)
                {
                        uint16_t ch = Blex::getu16lsb(&buffer[ptr+40+i*2]);
                        if(ch==0) //starts an alternative font
                            new_font.formatted.font_face += ", ";
                        else
                            Blex::UTF8Encode(&ch,&ch+1,std::back_inserter(new_font.formatted.font_face));
                }
                ptr+=buffer[ptr]+1;
                SetupFontInfo(&new_font);
                fonts.push_back(new_font);
        }
        DEBUGONLY(if (ptr!=header.LengthFontSttbf()) DEBUGPRINT("Missed some fonts"));

        //Ensure that we always have _a_ font, because we refer to font[0] if a font doesn't exist
        //(ADDME: this should prolly be done in the constructor)
        if (fonts.empty())
        {
                DEBUGPRINT("No fonts in font table, making one up");
                Font single_font;
                //FIXME: How to set up the fonts?
                fonts.push_back(single_font);
        }

        //Fixup font for default chp
        if(fonts.size()>=1)
            document_default_chp.SetFont(&fonts[0]); //might also be 4 according to biffspec
}

/** Read an 'xstz' string (preceeded by a length byte, followed by a null-terminator)
    @param start Start of the data to read (must point to length byte)
    @param limit Limit of the data to read (upper bound, but we will read up to the NULL terminator or the end of the length)
    @param str Receiving UTF16String. NULL if you don't really want to read the string, but just know how many bytes to skip
    @return If succesful, number of bytes (not characters!) processed (always >0).
            If we hit 'limit' before reading the string, 0 */
unsigned ReadXstzString (uint8_t const *start, uint8_t const *limit, std::string *str)
{
        if(str)
            str->clear();

        //Get the length in characters
        if (start+2 > limit)
            return 0; //Bound check - don't read over the limit!

        //Add 1 for NULL-terminating byte
        unsigned charlen = 1 + Blex::getu16lsb(start);

        if (start+(charlen+1)*2 > limit)
            return 0; //String out of bounds

        if(str)
        {
                str->reserve(charlen); //don't reserve the inital NULL
                Blex::UTF8Encoder<std::back_insert_iterator<std::string> > utf8_encoder(std::back_inserter(*str));

                //Start reading the actual characters
                for (unsigned charpos = 0; charpos<charlen; ++charpos)
                {
                        uint16_t ch = Blex::getu16lsb(start+(charpos+1)*2);
                        if (ch==0)
                        {
                                if (charpos == charlen-1) //correct!
                                    return (charlen+1)*2;

                                DEBUGPRINT("Unexpected NULL byte in string!");
                                str->clear(); //prevent people from using the result
                                return 0;
                        }
                        utf8_encoder(ch); //append it!
                }

        }
        else
        {
                //Start reading the actual characters
                for (unsigned charpos = 0; charpos<charlen; ++charpos)
                {
                        uint16_t ch = Blex::getu16lsb(start+(charpos+1)*2);
                        if (ch==0)
                        {
                                if (charpos == charlen-1) //correct!
                                    return (charlen+1)*2;

                                DEBUGPRINT("Unexpected NULL byte in string!");
                                return 0;
                        }
                }
        }

        DEBUGPRINT("Missing NULL byte in string!");
        if(str)
            str->clear(); //prevent people from using the result
        return 0;
}

void BiffDoc::ReadStyleSheet()
{
        ///how many bytes do we really NEED from the STSHI header?
        const unsigned MinimumSTSHIHeaderSize = 6;
        ///how many bytes do we really NEED from the STD header?
        const unsigned MinimumSTDHeaderSize = 6;
        ///Total length of the stylesheet
        const unsigned TotalSize = header.LengthStylesheet();

        if (TotalSize < MinimumSTSHIHeaderSize)
            throw std::runtime_error("Corrupted Word document: The stylesheet is corrupted (too short for stylesheet header)");

        std::vector<uint8_t> buffer(TotalSize);
        tablefile->DirectRead(header.OffsetStylesheet(), &buffer[0], TotalSize);

        //Read the stylesheet header (STSHI)
        unsigned headersize = Blex::getu16lsb(&buffer[0]) + 2; //add 2 bytes for the sizeof the STSHI header
        if (headersize < MinimumSTSHIHeaderSize)
            throw std::runtime_error("Corrupted Word document: The stylesheet is corrupted (too short for stylesheet header)");
        if (headersize > TotalSize)
            throw std::runtime_error("Corrupted Word document: The stylesheet header is longer than the stylesheet iself");

        unsigned numstyles = Blex::getu16lsb(&buffer[2]);
        unsigned std_header_size = Blex::getu16lsb(&buffer[4]) + 2; //add 2 bytes for the cbSize

        if (std_header_size < MinimumSTDHeaderSize)
            throw std::runtime_error("Corrupted Word document: The stylesheet is corrupted (style headers too short to understand)");

        unsigned readptr = headersize;
        unsigned endptr;

        /* STSHI header
            0-1: header size:
            2-3: ushort  cstd;                          // Count of styles in stylesheet
            4-5: ushort  cbSTDBaseInFile;               // Length of STD Base as stored in a file
            6-7: BF      fStdStylenamesWritten : 1;     // Are built-in stylenames stored?
                BF   :  15;                            // Spare flags
            8-9: ushort  stiMaxWhenSaved;               // Max sti known when this file was written
           10-11: ushort  istdMaxFixedWhenSaved;         // How many fixed-index istds are there?
           12-13: ushort  nVerBuiltInNamesWhenSaved;     // Current version of built-in stylenames
           14-19: FTC     rgftcStandardChpStsh[3];       // ftc used by StandardChpStsh for this document: ascii, far east, on-nfareast
        */

        if(headersize >= 20)
        {
                uint16_t ftc_ascii = Blex::getu16lsb(&buffer[14]);
                DEBUGPRINT("defaults! ftc_ascii: " << ftc_ascii << ", fareast: " << Blex::getu16lsb(&buffer[16]) << ", nonfareast: " << Blex::getu16lsb(&buffer[16]));

                document_default_chp.SetFont(&GetFont(ftc_ascii));
        }

        ///Record all the base style numbers
        styles.reserve(numstyles);
        for (unsigned stylenum=0;stylenum<numstyles;++stylenum,readptr=endptr)
        {
                //Make sure the length bytes fit here..
                if (readptr + 2 > TotalSize)
                {
                        DEBUGPRINT("Corrupted Word document: The stylesheet is corrupted (truncated length bytes)");
                        break;
                }

                endptr = Blex::getu16lsb(&buffer[readptr]) + readptr + 2;
                if (readptr+2 == endptr) //empty style slot: skip
                {
                        styles.push_back(StylePtr());
                        continue;
                }
                if (endptr > TotalSize)
                {
                        DEBUGPRINT("Corrupted Word document: The stylesheet is corrupted (truncated static part)");
                        break;
                }

                StylePtr style;
                BiffParaCharStyle *paracharstyle=0;

                //Process the style type code (1=para, 2=char)
                unsigned type = buffer[readptr+4]&15;
                unsigned baseid = Blex::getu16lsb(&buffer[readptr+4]) >> 4;
                unsigned wordid = Blex::getu16lsb(&buffer[readptr+2]) & uint16_t(0xFFF);

                if(type==1) //para
                {
                        style.reset(new BiffParaCharStyle(*this, wordid));
                        paracharstyle = static_cast<BiffParaCharStyle*>(style.get());
                        style->type = ParaCharStyle::ParagraphStyle;
                }
                else if (type==2) //character
                {
                        style.reset(new BiffParaCharStyle(*this, wordid));
                        paracharstyle = static_cast<BiffParaCharStyle*>(style.get());
                        style->type = ParaCharStyle::CharacterStyle;
                }
                else
                {
                        DEBUGPRINT("Unrecognized style type " << (buffer[readptr+4]&15));
                }

                //Read the fixed-size part of the STD
                unsigned num_upx=buffer[readptr+6]&15; //actual number of UPXes

                //Note:we ignore the following fields: istdNext (readptr+6/7), bchUpe(readptr+8/9), UIstuff(readptr+10/11)

                //Re-align: variable parts always start at even-numbered bytes
                unsigned namestart=readptr+std_header_size;
                if (namestart%2==1)
                {
                        DEBUGPRINT("Had to re-align the readpointer to read the name of style " << stylenum);
                        ++namestart;
                }

                //ADDME: If this is a known style, don't bother reading the string, but we still need the pointer updates!
                unsigned bytesread = ReadXstzString(&buffer[namestart],
                                                    &buffer[endptr],
                                                    style.get() ? &style->stylename : NULL); //word95 stores 8bit
                if (bytesread==0)
                    throw std::runtime_error("Corrupted Word document: The stylesheet is corrupted (failure reading stylename)");

                readptr += bytesread + std_header_size;

                //Is this a known style?
                if(style.get())
                {
                        Styles::Iterator knownstyle = Styles::Find(wordid);
                        if (knownstyle != Styles::End()) //Known style - read the stylename
                        {
                                //Use standard style names (eg, use "Heading 1" instead of "Kop 1")
                                style->stylename.clear();
                                std::copy(knownstyle->name,
                                          knownstyle->name+strlen(knownstyle->name),
                                          std::back_inserter(style->stylename));
                        }
                }

                for (unsigned i=0;i<num_upx;++i) //Loop for every UPX
                {
                        //Re-align the read pointer
                        if (readptr % 2)
                        {
                                DEBUGPRINT("Had to re-align the readpointer to read UPX " << i << " of style " << stylenum);
                                ++readptr; //it always starts at an even byte
                        }

                        //Get the length of the UPX
                        if ( (readptr + 2) > endptr)
                            throw std::runtime_error("Corrupted Word document: The stylesheet is corrupted (failure reading stylename)");

                        unsigned upx_length=Blex::getu16lsb(&buffer[readptr]);

                        //Check if this UPX is expected
                        if ( i>= (type == 1 ? 2u : 1u) )
                        {
                                //UPX 2 is Table formatting for Word XP..
                                DEBUGPRINT("Unexpected UPX " << i << " for style " << stylenum);
                                break;
                        }

                        bool skip_istd = type == 1/*para*/ && i==0; //The first UPX of stylenum parastyle has an istd

                        if ( readptr + upx_length + 2 > endptr || (skip_istd && upx_length<2))
                        {
                                //This error is caused by soomething called "Omnipage"
                                DEBUGPRINT("Corrupted Word document: The stylesheet is corrupted (truncated UPX)");
                                continue;
                        }

                        /* FIXME
                        stylegrpprls[stylenum*2+i].assign(&buffer[readptr+(skip_istd?4:2)],
                                                   &buffer[readptr+2+length]); */
                        if(style.get())
                        {
                                paracharstyle->grpprls[i] = grpprlcache.Store(skip_istd ? upx_length-2 : upx_length - 0,
                                                                                &buffer[readptr+(skip_istd ? 4 : 2)]);
                        }
                        readptr += upx_length+2;
                }

                if(style.get())
                    style->styleid = "doc-" + Blex::AnyToString(stylenum);

                if(baseid != stylenum && baseid != 4095 && style.get())
                    style->basestyleid = "doc-" + Blex::AnyToString(baseid);

                styles.push_back(style);
        }
}

StyleBase const* DocBase::GetStyleByDocXId(std::string const &styleid) const
{
        for (unsigned i=0;i<styles.size();++i)
          if(styles[i].get() && styles[i]->styleid == styleid)
            return styles[i].get();

        return NULL;
}

void DocBase::LinkStyleHistories()
{
        //For every style, calculate its bases
        for (unsigned i=0;i<styles.size();++i)
          if(styles[i].get())
        {
                StyleBase &curstyle = *styles[i];
                if(curstyle.styleid.empty())
                {
                        DEBUGPRINT("Unused style slipped into LinkStyleHistories\a");//we should stop doing this..
                        continue; //unused
                }
                DEBUGPRINT("Linking style " << curstyle.styleid << ":" << curstyle.stylename);

                StyleBase *currentbase = styles[i].get();
                while(true)
                {
                        //Make sure that we haven't referred to this base yet
                        if (std::find(curstyle.stylehistory.begin(), curstyle.stylehistory.end(), currentbase) != curstyle.stylehistory.end())
                            throw std::runtime_error("Corrupted Word document: The stylesheet contains circulair references");

                        //Put this base in the front of the current style history
                        curstyle.stylehistory.insert(curstyle.stylehistory.begin(), currentbase);

                        //Valid style to refer to?
                        if (curstyle.type != currentbase->type)
                        {
                                DEBUGPRINT("Corrupted Word document: The stylesheet merges incompatible style types");
                                DEBUGPRINT("Style " << curstyle.styleid << ":" << curstyle.stylename << " tries to base itself on " << currentbase->styleid << ":" << currentbase->stylename);
                                //throw PublicationException(3117,"Corrupted Word document: The stylesheet merges incompatible style types");
                        }

                        StyleBase *prevbase = GetStyleByDocXId(currentbase->basestyleid);
                        if (!prevbase)
                        {
                                DEBUGPRINT("Based on non-existing style " << currentbase->basestyleid);
                                break; //terminates the style loop, i guess (we used to accepted references to non-existing styles)
                        }
                        currentbase = prevbase;
                        DEBUGPRINT("Based on style " << currentbase->basestyleid << ":" << currentbase->stylename);
                }
        }
}

void DocBase::CacheParagaphStyles()
{
        //Now that we know the history for every style, cache all styles
        for (unsigned i=0;i<styles.size();++i)
          if(styles[i].get() && styles[i]->type==StyleBase::ParagraphStyle)
        {
                DEBUGPRINT("Render " << styles[i]->stylename);
                ParaCharStyle *curstyle = static_cast<ParaCharStyle *>(styles[i].get());

                //Reset to document base properties
                curstyle->cached_stylepap = document_default_pap;
                curstyle->cached_stylechp = document_default_chp;

                //Run through the base SPRMs
                for (std::vector<StyleBase const*>::const_iterator itr= styles[i]->stylehistory.begin();itr!=styles[i]->stylehistory.end();++itr)
                {
                        ParaCharStyle const* base = static_cast<ParaCharStyle const*>(*itr);

                        base->ApplyStyle(&curstyle->cached_stylepap, &curstyle->cached_stylechp);
                        curstyle->cached_stylepap.istd_style = base;
                        curstyle->cached_stylechp.pod.istd_style = base;
                }
        }
        DEBUGPRINT("styles cached...");
}

void BiffDoc::ReadStyles ()
{
        ReadLists();
        ReadFonts();

        ReadStyleSheet();

        LinkStyleHistories();

        //Render the default paragraph font style
        if(styles.size()>10)
        {
                ParaCharStyle const* default_charstyle = static_cast<ParaCharStyle const*>(styles[10].get());
                if(default_charstyle)
                {
                        default_charstyle->ApplyStyle(NULL, &document_default_chp);
                }
        }

        CacheParagaphStyles();

        if(styles.empty() || !styles[0].get())
            throw std::runtime_error("Document lacks style information");
}

void BiffDoc::ReadTableStream ()
{
        /* FIXME: Check against I/O errors */
        std::vector<uint8_t> buffer;

        //the piece tablefile->...
        piecetable.Parse(header.OffsetComplexTable(),
                         header.OffsetComplexTable()+header.LengthComplexTable(),
                         *tablefile,
                         *this);
#if defined(DEBUGPIECES) && defined(DEBUG)
        DEBUGPRINT("* Complex pieces table");
        DEBUGPRINT("Piece [CP Range]  Val [FC Range]  BPC Size  SPRM");
        for (unsigned a=0;a<piecetable.piecetable.size();++a)
        {
                std::ostringstream line;
                line << std::right << std::setw(5) << a << " "
                           << std::setw(5) << std::setfill('0') << piecetable.piecetable[a].startcp << "-"
                           << std::setw(5) << std::setfill('0') << piecetable.piecetable[a].limitcp << " "
                           << std::setw(3) << std::setfill(' ') << piecetable.piecetable[a].val << " "
                           << std::hex
                           << std::setw(5) << std::setfill('0') << piecetable.piecetable[a].startfc << "-"
                           << std::setw(5) << std::setfill('0') << piecetable.piecetable[a].limitfc << " "
                           << std::dec
                           << std::setw(3) << std::setfill(' ') << piecetable.piecetable[a].bytespc << " "
                           << std::setw(5) << std::setfill(' ') << (piecetable.piecetable[a].limitcp-piecetable.piecetable[a].startcp);
                if (piecetable.piecetable[a].sprm)
                    line << std::hex << " " << std::setw(5) << std::setfill(' ') << piecetable.piecetable[a].sprm;
                DEBUGPRINT(line.str());
        }
#endif

        //static int read_plcf(uint32_t data_lcb,uint32_t data_fc,int structsize,uint32_t *entries,void **data)
        //returns -3 on memerror, -2 on readerror, -1 on weird datasize
        CharactersRead();
#if defined(DEBUGCHARS) && defined(DEBUG)
        std::clog << "Character exception runs (all numbers are FC limits in decimal)\n";
        std::clog << header.OffsetFirstCharacter();
        for (unsigned i=0;i<chars.size();++i)
            std::clog << '-' << chars[i].limitfc;
        std::clog << std::endl;
#endif

        //now process the paragraphs (pieces must be read before paragraphs)
        {
                BiffParaAnalyzer analyze(*this);
                analyze.ParagraphsRead();
        }

        //the sections...
        SectionsRead();

        {//******** Read FSPA fun stuff
                Plcf fspas_plcf(*tablefile,header.OffsetFspaPlcMainDoc(),header.LengthFspaPlcMainDoc(),30,true);

                fileshapes.resize(fspas_plcf.GetNumEntries());
                for (unsigned i=0;i<fspas_plcf.GetNumEntries();++i)
                {
                        const uint8_t *dataptr=static_cast<const uint8_t*>(fspas_plcf.GetEntryData(i));
                        fileshapes[i].cp=            fspas_plcf.GetEntryOffset(i);
                        fileshapes[i].spid=          gets32lsb(dataptr+0);
                        fileshapes[i].xa_left=       gets32lsb(dataptr+4);
                        fileshapes[i].ya_top=        gets32lsb(dataptr+8);
                        fileshapes[i].xa_right=      gets32lsb(dataptr+12);
                        fileshapes[i].ya_bottom=     gets32lsb(dataptr+16);
                        fileshapes[i].relative_x=    (getu16lsb(dataptr+20) & 0x06)  >>1;
                        fileshapes[i].relative_y=    (getu16lsb(dataptr+20) & 0x18)  >>3;
                        fileshapes[i].wrapping=      (getu16lsb(dataptr+20) & 0x1E0) >>5;
                        fileshapes[i].wrappingtype=  (getu16lsb(dataptr+20) & 0x1E00)>>9;
                        fileshapes[i].rcasimple=     (getu16lsb(dataptr+20) & 0x2000)>>13;
                        fileshapes[i].belowtext=     (getu16lsb(dataptr+20) & 0x4000)>>14;
                        fileshapes[i].anchorlock=    (getu16lsb(dataptr+20) & 0x8000)>>15;
                }
        }//FSPA reader

        if (header.LengthDggInfo())
        {
                escherdatastore.reset(new EscherDataStore(tablefile,wordfile));
                escherdatastore->ScanEscherData(header.OffsetDggInfo(),header.LengthDggInfo());
        }

        ReadTextBoxes();
}


void BiffDoc::ReadTextBoxes()
{
        Plcf textboxes_plcf(*tablefile,header.OffsetPlcfTextboxes(),header.LengthPlcfTextboxes(),26,true);
        for (unsigned i=0;i<textboxes_plcf.GetNumEntries();++i)
        {
                //Get PLCF data
                const uint8_t *dataptr=static_cast<const uint8_t*>(textboxes_plcf.GetEntryData(i));
                Cp cp = textboxes_plcf.GetEntryOffset(i);

                //Build the textbox
                TextBoxInfo newbox;
                newbox.startcp = cp;
                newbox.limitcp = i+1 < textboxes_plcf.GetNumEntries() ? textboxes_plcf.GetEntryOffset(i+1) : GetHeader().TextboxDocLength();

                std::memcpy(newbox.oddbytes, dataptr, sizeof newbox.oddbytes);
                textboxes.push_back(newbox);

                //Debug the textbox
#ifdef DEBUG
                std::ostringstream debugdata;
                debugdata << "Textbox " << i << " cp " << newbox.startcp << '-' << newbox.limitcp << std::hex;
                for (unsigned i=0; i < sizeof newbox.oddbytes;++i)
                    debugdata << ' ' << std::setw(2) << uint16_t(uint8_t(newbox.oddbytes[i]));
                DEBUGPRINT(debugdata.str());
#endif
        }

        Plcf textboxfields_plcf(*tablefile,header.OffsetPlcfTextboxFields(),header.LengthPlcfTextboxFields(),4,true);
        for (unsigned i=0;i<textboxfields_plcf.GetNumEntries();++i)
        {
                //const uint8_t *dataptr=static_cast<const uint8_t*>(textboxfields_plcf.GetEntryData(i));
                DEBUGPRINT("textboxfield " << i << " cp " << textboxfields_plcf.GetEntryOffset(i));
        }

}

const FileShape * BiffDoc::GetShapeCp(uint32_t cp) const
{
        for (int a=fileshapes.size()-1;a>=0;--a)
          if (fileshapes[a].cp==cp)
            return &fileshapes[a];
        return 0;
}

#ifdef DEBUG
void BiffDoc::DumpTableStream (void)
{
        DEBUGPRINT("\n*****************************\n*   Document table stream   *\n*****************************\n");

        for (unsigned a=0;a<styles.size();++a)
            {
                if (!styles[a].get())
                    continue;

                DEBUGPRINT(a << ": Id " << styles[a]->styleid
                           << ' ' << styles[a]->stylename
                           << " type " << ((int)styles[a]->type));
            }

        for (unsigned a=0;a<fonts.size();++a)
        {
                DEBUGPRINT((int)fonts[a].prq << " " << fonts[a].truetype << " "
                           << (int)fonts[a].fontfamily << " " << fonts[a].baseweight << " " <<
                           (int)fonts[a].charset << " " << (int)fonts[a].alternative << " " << fonts[a].formatted.font_face);
            }

        for (unsigned a=0;a<fileshapes.size();++a)
            DEBUGPRINT(fileshapes[a]);

#ifdef DEBUGPARAS
        std::clog << "Paragraph exception runs (all numbers are CP limits in decimal)\n";
        std::clog << "0";
        for (unsigned i=0;i<pars.size();++i)
            std::clog << '-' << static_cast<BiffParagraph*>(pars[i])->limitcp;
        std::clog << std::endl;
#endif

}
#endif

std::ostream& operator << (std::ostream &str, FileShape const &fs)
{
        str << "FileShape(cp=" << fs.cp << ",spid=" << fs.spid;
        str << ",rect=(" << fs.xa_left << "," << fs.ya_top << "-" << fs.xa_right << "," << fs.ya_bottom << ")";
        str << ",relative_x=";
        switch(fs.relative_x)
        {
                case 0: str << "page margin"; break;
                case 1: str << "left of page"; break;
                case 2: str << "text"; break;
                default: str << "unknown #" << fs.relative_x; break;
        }
        str << ",relative_y=";
        switch(fs.relative_y)
        {
                case 0: str << "page margin"; break;
                case 1: str << "top of page"; break;
                case 2: str << "text"; break;
                default: str << "unknown #" << fs.relative_y; break;
        }
        str << ",wrapping=";
        switch(fs.wrapping)
        {
                case 0: str << "wrap around"; break;
                case 1: str << "no text"; break;
                case 2: str << "wrap around absolute"; break;
                case 3: str << "wrap as if no object"; break;
                case 4: str << "wrap tightly"; break;
                case 5: str << "wrap tightly allow holes"; break;
                default: str << "unknown #" << fs.wrapping; break;
        }
        str << ",wrappingtype=";
        switch(fs.wrappingtype)
        {
                case 0: str << "both sides"; break;
                case 1: str << "left only"; break;
                case 2: str << "right only"; break;
                case 3: str << "largest side only"; break;
                default: str << "unknown #" << fs.wrappingtype; break;
        }
        str << ",rcasimple=" << (fs.rcasimple ? "yes" : "no");
        str << ",belowtext=" << (fs.belowtext ? "below" : "above");
        str << ",anchorlock=" << (fs.belowtext ? "locked" : "unlocked");
        return str;
}


} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
