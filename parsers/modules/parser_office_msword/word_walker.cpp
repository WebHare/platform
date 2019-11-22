#include <ap/libwebhare/allincludes.h>


#include "biff.h"
#include "word_walker.h"

//FIXME: Find aw ay to recycle ParagraphWalkers - might improve performance!

namespace Parsers {
namespace Office {
namespace Word {

RawCharacterParser::RawCharacterParser(BiffDoc const &doc)
: doc(doc)
, cache(doc.paragraphwalkercache)
, char_piece(NULL)
{
}

RawCharacterParser::~RawCharacterParser()
{
}

Fc RawCharacterParser::GoTo(Cp cp)
{
        char_piece=doc.piecetable.FindPiece(cp);
        if (!char_piece)
            throw std::runtime_error("Problem interpreting Word Document: Cursor position "
                                     + Blex::AnyToString(cp)
                                     + " has no corresponding complex piece");
        return char_piece->Cp2Fc(cp);

}

uint16_t RawCharacterParser::GetRawChar(Cp cp)
{
        //Cursor position must be inside current piece
        if (!char_piece || cp < char_piece->startcp || cp >= char_piece->limitcp)
            GoTo(cp);

        Fc char_fc=SetupCharacters(cp);

        uint8_t const *char_ptr = &cache.char_buffer[char_fc-cache.buffer_start];

        return char_piece->bytespc==2 ? Blex::getu16lsb(char_ptr) : *char_ptr;
}

///Update character FC and recalculate direct pointers
Fc RawCharacterParser::SetupCharacters(Cp cp)
{
        //Still in range?
        Fc this_fc = char_piece->Cp2Fc(cp);
        if (!cache.char_buffer.empty()
            && this_fc >= cache.buffer_start
            && this_fc+(char_piece->bytespc) <= cache.buffer_start + cache.char_buffer.size())
        {
                return this_fc;
        }


        //Calculate start and end positions for the range. read up to 8KB
        cache.buffer_start=this_fc;
        unsigned bytes_to_read = std::min<unsigned>(char_piece->limitfc - cache.buffer_start, 8192ul);

        cache.char_buffer.resize(bytes_to_read);
        if (doc.GetWordFileStream()->DirectRead(cache.buffer_start, &cache.char_buffer[0],bytes_to_read) != bytes_to_read)
            throw std::runtime_error("I/O error reading document text");

        return this_fc;
}


ParagraphWalker::ParagraphWalker(BiffDoc const &doc)
: doc(doc)
, curpara(NULL)
, para_pap(doc)
, style_chp(doc)
, char_chp(doc)
, rawparser(doc)
{
}

ParagraphWalker::~ParagraphWalker()
{
}

void ParagraphWalker::SetCharProperties(Cp cp, Fc fc)
{
        char_chardata=&doc.GetCharData(fc); //never returns NULL

        char_chp = para_pap.istd_style->cached_stylechp;         //Get from style first
        style_chp = char_chp;

        SprmIterator sprmitr(doc, char_chardata->grpprlptr);

        //Apply exceptions from CHPX FKPs
        doc.ApplyChpSprms(&sprmitr, para_pap.istd_style->cached_stylechp, &style_chp, &char_chp);

        uint16_t piecesprm=rawparser.GetCurrentPiece().sprm;
        if (piecesprm)
        {
                SprmIterator sprmitr(doc, piecesprm);
                doc.ApplyChpSprms(&sprmitr, para_pap.istd_style->cached_stylechp, &style_chp, &char_chp);
        }

        //Now: calculate where the character properties will change
        //     Switch at end of piece or end of paragraph, whatever comes first
        char_switch_cp=std::min(rawparser.GetCurrentPiece().limitcp,GetParaLimitCp());

        //Is the end of this character run inside the current piece?
        if (char_chardata->limitfc <= rawparser.GetCurrentPiece().limitfc)
        {
                //Yes! Switch at end of CHPX or previous switch, whichever comes firs
                char_switch_cp=std::min(char_switch_cp,rawparser.GetCurrentPiece().Fc2Cp(char_chardata->limitfc-1)+1);
                if (char_switch_cp<=cp)
                {
                        DEBUGPRINT("\aForcing char_switch_cp forward progress (blindly run off the end of the current CHPX - OpenOffice?)");
                        char_switch_cp = cp+1;
                }
        }
}

/* List of mutations.
   - To get 'deze bullets gaan ook fout' to work,
     * 'ApplyCHPX from the list level' was before 'CHPX associated with the current paragraph end',
       their ordering has been swapped
*/
Chp ParagraphWalker::GetListBulletChp() const
{
        assert(para_pap.listovr);
        Chp retval(doc);
        doc.LoadParagraphMarkProperties(curpara, para_pap, &retval);
        return retval;
}

void BiffDoc::LoadParagraphMarkProperties(BiffParagraph const* para, Pap const &para_pap, Chp *chp) const
{
        //Get from style first
        *chp = para_pap.istd_style->cached_stylechp;

        //Find the CHPX associated with the current paragraph end
        Fc paraendfc=para->endpiece->Cp2Fc(para->limitcp-1);
        CharData const &paraendchar = GetCharData(paraendfc);

        if (paraendchar.grpprlptr.Length())
        {
                SprmIterator sprmitr(*this, paraendchar.grpprlptr);
                ApplyChpSprms(&sprmitr, para_pap.istd_style->cached_stylechp, chp, chp);
        }

        // ADDME? WebHare 1 code applied the character properties from the piece containing the paragraph end character
        uint16_t piecesprm=para->endpiece->sprm;
        if (piecesprm)
        {
                SprmIterator sprmitr(*this, piecesprm);
                ApplyChpSprms(&sprmitr, para_pap.istd_style->cached_stylechp, chp, chp);
        }

        //Apply CHPX from the list level (ADDME or should this move to GetListBulletChP?)
        if(para_pap.listovr)
        {
                ListLevel const *lvl = para_pap.listovr->GetLevel(para_pap.listlevel); //current level data
                if(lvl)
                {
                        lvl->ApplyChp(&para_pap, chp);
                }
        }

        // ADDME? Word 2000 sometimes clears underlining on lists. Word 97 never does this.
        chp->formatted.underlining=Parsers::Character::NoUnderline;

        // ADDME? WebHare 1 code resetted bold and italic (and feared much more) if nfc was 23.
}


void BiffDoc::LoadParagraphProperties(BiffParagraph const* para, Pap *pap, Tap *tap) const
{
        //Set up our pap and tap for this paragraph, and fill in the initial chp
        *pap = para->basestyle->cached_stylepap;
        if(tap)
            *tap = Tap();

        //Apply paragraph's grpprl
        SprmIterator itr(*this, para->grpprlptr);
        ApplySprms(&itr, pap, 0, tap);

        /* "The process thus far has created a PAP that describes what the
            properties of the paragraph were at the last full save. Now it
            is necessary to apply any paragraph sprms that were linked to
            the piece that contains the paragraph's paragraph mark." */

        //ADDME: Perhaps we need to ignore any character SPRMs here?
        uint16_t piecesprm = para->endpiece->sprm;
        if (piecesprm)
        {
                SprmIterator itr(*this, piecesprm);
                ApplySprms(&itr,pap,0,tap);
        }

        pap->Fixup();

        //ADDME: Attempet to fix suddent_indent.cpp, delay ApplyIlfo until all props are read
        //para_pap.ApplyIlfo(doc,para_pap.ilfo);
}

void ParagraphWalker::SetParagraph(BiffParagraph const* newpara)
{
        //Initialize our pointers to the beginning of the selected paragraph
        curpara = newpara;
        doc.LoadParagraphProperties(curpara, &para_pap, &para_tap);

        Cp para_startcp = curpara->startcp;

        //look up our current piece
        rawparser.GoTo(para_startcp);

        //Locate the formatting data for the current location.
        para_sectiondata=doc.FindSection(para_startcp);

        if (para_sectiondata==doc.sections.end())
            throw std::runtime_error("Problem interpreting Word Document: Cursor position "
                                     + Blex::AnyToString(para_startcp)
                                     + " has no corresponding section");
}

void ParagraphWalker::SetCharacter(Cp new_cp)
{
        //Move to the right paragraph if necessary
        if (!curpara || new_cp < GetParaBeginCp() || new_cp >= GetParaLimitCp())
        {
                BiffParagraph const* para = doc.FindParagraph(new_cp);
                if (!para)
                     throw std::runtime_error("SetCharacter to non-existing paragraph (cp " + Blex::AnyToString(new_cp) + ")");
                SetParagraph(para);
        }

        Fc new_fc = rawparser.GoTo(new_cp);
        SetCharProperties(new_cp,new_fc);
}

uint16_t MapCharThroughFont(uint16_t ch, const Font &font)
{
        if (font.charactermap && ch<=255)
            return font.charactermap[unsigned(ch&0xFF)];
        else if (font.charset == 2) //private range..
            return unsigned(ch&0xFF);

        return ch;
}

uint16_t ParagraphWalker::GetChar(Cp cp, bool ignoremarkup)
{
        uint16_t ch = rawparser.GetRawChar(cp);
        if (GetCurChp().font)
            ch = MapCharThroughFont(ch,*GetCurChp().font);

        if (!ignoremarkup && GetCurChp().pod.internal_bits & Chp::Caps && Blex::IsLower(ch) && !doc.ignore_allcaps)
            ch = Blex::ToUpper(ch);
        if (ch==30) //Nonbreaking hyphen
            ch = 0x2011;
        if (ch==31) //Optional hyphen
            ch = 0x00AD;

        return ch;
}

Parsers::StyleSettings const *ParagraphWalker::GetFilter(Parsers::PublicationProfile const &pubprof) const
{
        ParaCharStyle const *style = GetParaPap().istd_style;
        if (style->mswordid >= 0xffe)
            return &pubprof.GetFilter_WordCustomStyle(style->stylename);
        else
            return &pubprof.GetFilter_WordStyle(style->mswordid);
}

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers


