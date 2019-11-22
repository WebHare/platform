//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>

//---------------------------------------------------------------------------

#include <iostream>
#include <harescript/vm/hsvm_dllinterface.h>
#include "powerpoint.h"

using Parsers::Office::Escher::ReadContainer;
using Parsers::Office::Escher::DebugContainerReader;

///////////////////////////////////////////////////////
//
// Some helper functions
//

std::string Indent(unsigned level)
{
        std::string s;
        for(unsigned i=0;i<level;++i)
            s += "  ";
        return s;
}

unsigned GetUTF8Length(std::string text)
{
        Blex::UTF8DecodeMachine decoder;
        unsigned len = 0;

        for (unsigned pos=0; pos<text.size(); ++pos)
                if (decoder(text[pos]) != Blex::UTF8DecodeMachine::NoChar)
                    ++len;

        return len;
}

void ReplaceUTF16Str(Blex::UTF16String &input, int pos, int len, Blex::UTF16String const &replacement)
{
        Blex::UTF16String afterstr = Blex::UTF16String(&input[pos+len], &input[input.size()]);
        input.resize(pos);
        for (Blex::UTF16String::const_iterator it = replacement.begin();
                it != replacement.end(); ++it)
                input.push_back(*it);
        input.insert(input.end(), afterstr.begin(), afterstr.end());
}

Blex::UTF16String ASCItoUTF16(std::string const &input)
{
        return Blex::UTF16String(input.begin(), input.end());
}

void ReadUTF16Str(Blex::UTF16String &dest, std::vector<uint8_t> buffer)
{
        dest.resize(0);
        for (unsigned i=0;i<buffer.size()/2;++i)
            dest.push_back(Blex::getu16lsb(&buffer[i*2]));
}

uint8_t *ReadStream(uint8_t *buffer, Blex::RandomStream &stream, uint32_t size)
{
        if (stream.Read(buffer, size) != size)
                throw std::runtime_error("Corrupt powerpoint file, unexpected end of stream");
        return buffer;
}

bool CheckField(uint32_t &field, uint32_t bitmask)
{
        if (field & bitmask)
        {
                field = field ^ (field & bitmask);
                return true;
        }
        return false;
}

bool CheckField(uint16_t &field, uint16_t bitmask)
{
        if (field & bitmask)
        {
                field = field ^ bitmask;
                return true;
        }
        return false;
}

namespace Parsers
{

namespace Office
{

namespace Powerpoint
{

Blex::UTF16String CreatePowerpointDate(uint8_t formatid, uint16_t languageid, Blex::DateTime datetime_)
{
        char formatted_date[100];
        formatted_date[0] = '\0';

        std::tm datetime = datetime_.GetTM();

        std::string dutch_months[12] = { "januari", "februari", "maart", "april", "mei", "juni",
                                        "juli", "augustus", "september", "oktober", "november", "december" };
        std::string dutch_short_months[12] = { "jan", "feb", "maa", "apr", "mei", "jun",
                                        "jul", "aug", "sep", "okt", "nov", "dec" };
        std::string dutch_days[7] = { "maandag", "dinsdag", "woensdag", "donderdag",
                                        "vrijdag", "zaterdag", "zondag" };

        std::string us_months[12] = { "January", "February", "March", "April", "May", "June",
                                        "July", "August", "September", "October", "November", "December" };
        std::string us_short_months[12] = { "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
        std::string us_days[7] = { "Monday", "Tuesday", "Wednesday", "Thursday",
                                        "Friday", "Saturday", "Sunday" };

        switch (languageid)
        {
            case LANGUAGE_DUTCH:
            case LANGUAGE_DUTCH_BELGIAN:
            switch (formatid)
            {
                case 0: /* 20-1-2004 */
                        std::sprintf(formatted_date, "%d-%d-%d", datetime.tm_mday,
                                datetime.tm_mon+1, datetime.tm_year+1900);
                break;
                case 1: /* maandag 20 januari 2004 */
                        std::sprintf(formatted_date, "%s %d %s %d", dutch_days[datetime.tm_wday].data(),
                                datetime.tm_mday, dutch_months[datetime.tm_mon].data(), datetime.tm_year+1900);
                break;
                case 2: /* 20/1/04 */
                        std::sprintf(formatted_date, "%d/%d/%02d", datetime.tm_mday,
                                datetime.tm_mon+1, datetime.tm_year%100);
                break;
                case 3: /* 20 januari 2004 */
                        std::sprintf(formatted_date, "%d %s %d", datetime.tm_mday,
                                dutch_months[datetime.tm_mon].data(), datetime.tm_year+1900);
                break;
                case 4: /* 20-jan-04 */
                        std::sprintf(formatted_date, "%d-%s-%02d", datetime.tm_mday,
                                dutch_short_months[datetime.tm_mon].data(), datetime.tm_year%100);
                break;
                case 5: /* januari '04 */
                        std::sprintf(formatted_date, "%s '%02d", dutch_months[datetime.tm_mon].data(),
                                datetime.tm_year%100);
                break;
                case 6: /* jan-04 */
                        std::sprintf(formatted_date, "%s-%02d", dutch_short_months[datetime.tm_mon].data(),
                                datetime.tm_year%100);
                break;
                case 7: /* 20-1-2004 18:23*/
                        std::sprintf(formatted_date, "%d-%d-%d %d:%02d", datetime.tm_mday, datetime.tm_mon+1,
                                datetime.tm_year+1900, datetime.tm_hour, datetime.tm_min);
                break;
                case 8: /* 20-1-2004 18:23:59*/
                        std::sprintf(formatted_date, "%d-%d-%d %d:%02d:%02d", datetime.tm_mday, datetime.tm_mon+1,
                                datetime.tm_year+1900, datetime.tm_hour, datetime.tm_min, datetime.tm_sec);
                break;
                case 9: /* 18:23 */
                        std::sprintf(formatted_date, "%d:%02d", datetime.tm_hour, datetime.tm_min);
                break;
                case 10: /* 18:23:53 */
                        std::sprintf(formatted_date, "%d:%02d:%02d", datetime.tm_hour, datetime.tm_min, datetime.tm_sec);
                break;
                case 11: /* 6:23 */
                        std::sprintf(formatted_date, "%d:%02d", datetime.tm_hour%12, datetime.tm_min);
                break;
                case 12: /* 6:23:53 */
                        std::sprintf(formatted_date, "%d:%02d:%02d", datetime.tm_hour%12, datetime.tm_min, datetime.tm_sec);
                break;
            }
            break;
            case LANGUAGE_ENGLISH_UK:
            switch (formatid)
            {
                case 0: /* 20/09/2004 */
                        std::sprintf(formatted_date, "%02d/%02d/%d", datetime.tm_mday,
                                datetime.tm_mon+1, datetime.tm_year+1900);
                break;
                case 1: /* Monday, 20 September, 2004 */
                        std::sprintf(formatted_date, "%s, %d %s, %d", us_days[datetime.tm_wday].data(),
                                datetime.tm_mday, us_months[datetime.tm_mon].data(), datetime.tm_year+1900);
                break;
                case 2: /* 20 September, 2004 */
                        std::sprintf(formatted_date, "%d %s, %d", datetime.tm_mday,
                                us_months[datetime.tm_mon].data(), datetime.tm_year+1900);
                break;
                case 3: /* 20 September 2004 */
                        std::sprintf(formatted_date, "%d %s %d", datetime.tm_mday,
                                us_months[datetime.tm_mon].data(), datetime.tm_year%100);
                break;
                case 4: /* 20-Sep-04 */
                        std::sprintf(formatted_date, "%d-%s-%02d", datetime.tm_mday,
                                us_short_months[datetime.tm_mon].data(), datetime.tm_year%100);
                break;
                case 5: /* September 04 */
                        std::sprintf(formatted_date, "%s %02d", us_months[datetime.tm_mon].data(),
                                datetime.tm_year%100);
                break;
                case 6: /* Sep-04 */
                        std::sprintf(formatted_date, "%s-%02d", us_short_months[datetime.tm_mon].data(),
                                datetime.tm_year%100);
                break;
                case 7: /* 20/09/2004 17:28 */
                        std::sprintf(formatted_date, "%02d/%02d/%d %d:%02d", datetime.tm_mday, datetime.tm_mon+1,
                                datetime.tm_year+1900, datetime.tm_hour, datetime.tm_min);
                break;
                case 8: /* 20/09/2004 17:28:59 */
                        std::sprintf(formatted_date, "%02d/%02d/%d %d:%02d:%02d", datetime.tm_mday, datetime.tm_mon+1,
                                datetime.tm_year+1900, datetime.tm_hour, datetime.tm_min, datetime.tm_sec);
                break;
                case 9: /* 18:23 */
                        std::sprintf(formatted_date, "%d:%02d", datetime.tm_hour, datetime.tm_min);
                break;
                case 10: /* 18:23:53 */
                        std::sprintf(formatted_date, "%d:%02d:%02d", datetime.tm_hour, datetime.tm_min, datetime.tm_sec);
                break;
                case 11: /* 6:23 PM */
                        std::sprintf(formatted_date, "%d:%02d %s", datetime.tm_hour%12, datetime.tm_min, datetime.tm_hour/12 ? "PM" : "AM");
                break;
                case 12: /* 6:23:53 PM */
                        std::sprintf(formatted_date, "%d:%02d:%02d %s", datetime.tm_hour%12, datetime.tm_min, datetime.tm_sec, datetime.tm_hour/12 ? "PM" : "AM");
                break;
            }
            break;
            case LANGUAGE_ENGLISH_US:
            default:
            switch (formatid)
            {
                case 0: /* 1/20/2004 */
                        std::sprintf(formatted_date, "%d/%d/%d", datetime.tm_mon+1,
                                datetime.tm_mday, datetime.tm_year+1900);
                break;
                case 1: /* Monday, September 20, 2004 */
                        std::sprintf(formatted_date, "%s, %s %d, %d", us_days[datetime.tm_wday].data(),
                                us_months[datetime.tm_mon].data(), datetime.tm_mday, datetime.tm_year+1900);
                break;
                case 2: /* 20 September 2004 */
                        std::sprintf(formatted_date, "%d %s %d", datetime.tm_mday,
                                us_months[datetime.tm_mon].data(), datetime.tm_year%100);
                break;
                case 3: /* September 20, 2004 */
                        std::sprintf(formatted_date, "%s %d, %d", us_months[datetime.tm_mon].data(),
                                datetime.tm_mday, datetime.tm_year+1900);
                break;
                case 4: /* 20-Sep-04 */
                        std::sprintf(formatted_date, "%d-%s-%02d", datetime.tm_mday,
                                us_short_months[datetime.tm_mon].data(), datetime.tm_year%100);
                break;
                case 5: /* September 04 */
                        std::sprintf(formatted_date, "%s %02d", us_months[datetime.tm_mon].data(),
                                datetime.tm_year%100);
                break;
                case 6: /* Sep-04 */
                        std::sprintf(formatted_date, "%s-%02d", us_short_months[datetime.tm_mon].data(),
                                datetime.tm_year%100);
                break;
                case 7: /* 9/20/2004 5:22 PM*/
                        std::sprintf(formatted_date, "%d/%d/%d %d:%02d %s", datetime.tm_mon+1, datetime.tm_mday,
                                datetime.tm_year+1900, datetime.tm_hour%12, datetime.tm_min, datetime.tm_hour/12 ? "PM" : "AM");
                break;
                case 8: /* 9/20/2004 5:22:59 PM*/
                        std::sprintf(formatted_date, "%d/%d/%d %d:%02d:%02d %s", datetime.tm_mon+1, datetime.tm_mday,
                                datetime.tm_year+1900, datetime.tm_hour%12, datetime.tm_min, datetime.tm_sec, datetime.tm_hour/12 ? "PM" : "AM");
                break;
                case 9: /* 18:23 */
                        std::sprintf(formatted_date, "%d:%02d", datetime.tm_hour, datetime.tm_min);
                break;
                case 10: /* 18:23:53 */
                        std::sprintf(formatted_date, "%d:%02d:%02d", datetime.tm_hour, datetime.tm_min, datetime.tm_sec);
                break;
                case 11: /* 6:23 PM */
                        std::sprintf(formatted_date, "%d:%02d %s", datetime.tm_hour%12, datetime.tm_min, datetime.tm_hour/12 ? "PM" : "AM");
                break;
                case 12: /* 6:23:53 PM */
                        std::sprintf(formatted_date, "%d:%02d:%02d %s", datetime.tm_hour%12, datetime.tm_min, datetime.tm_sec, datetime.tm_hour/12 ? "PM" : "AM");
                break;
            }
            break;
        }

        Blex::UTF16String result_date;

        Blex::UTF8Decoder<std::back_insert_iterator<Blex::UTF16String> > data_utf8_decoder(std::back_inserter(result_date));
        for (unsigned i=0;i<strlen(formatted_date);++i)
                data_utf8_decoder(formatted_date[i]);

        return result_date;
}


Blex::UTF16String ExtractUTF16Text(Blex::UTF16String const &input, unsigned start, unsigned len, std::map<uint32_t, TextExtension> const &text_extensions, std::vector<std::pair<uint32_t, SpecialInfo> > const &special_infos)
{
        Blex::UTF16String output;
        Blex::UTF8DecodeMachine decoder;

        for (unsigned pos=0; pos<input.size(); ++pos)
        {
                if (pos >= start && pos < start+len)
                {
                        if (text_extensions.find(pos) != text_extensions.end())
                        {
                                TextExtension text_extension = text_extensions.find(pos)->second;
                                if (text_extension.calculate_date)
                                {
                                        // Find the correct language
                                        for (std::vector<std::pair<uint32_t, SpecialInfo> >::const_iterator it=special_infos.begin();
                                                it!=special_infos.end(); ++it)
                                                if (pos >= it->first && ((it+1)==special_infos.end() || (pos < (it+1)->first)))
                                                {
                                                        Blex::UTF16String generated_date = CreatePowerpointDate(text_extension.formatid, it->second.language, Blex::DateTime::Now());
                                                        for (unsigned pos=0; pos<generated_date.size(); ++pos)
                                                                output.push_back(generated_date[pos]);
                                                        break;
                                                }
                                }
                                else
                                        for (unsigned pos=0; pos<text_extension.text.size(); ++pos)
                                                output.push_back(text_extension.text[pos]);
                        }
                        else
                                output.push_back(input[pos]);
                }
        }
        return output;
}
/*
void PowerpointTextExtracter(RecordData &record_data, std::vector<Text> *outtexts)
{
        if(record_data.version == 0xF)
        {
                PowerpointTextExtracter(record_data.data, std::bind(&PowerpointTextExtracter, std::placeholders::_1, outtexts));
        }
}
 */
void DebugPowerpointReader(RecordData &record_data, int indent_level)
{
        bool handled = false;

        if (record_data.type == PST_Document) { handled = true; DEBUGPRINT(Indent(indent_level) << "Document (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_DocumentAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "DocumentAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_Slide) { handled = true; DEBUGPRINT(Indent(indent_level) << "Slide (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_SlideAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "SlideAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_Notes) { handled = true; DEBUGPRINT(Indent(indent_level) << "Notes (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_NotesAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "NotesAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_Environment) { handled = true; DEBUGPRINT(Indent(indent_level) << "Environment (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_SlidePersistAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "SlidePersistAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_MainMaster) { handled = true; DEBUGPRINT(Indent(indent_level) << "MainMaster (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ExObjList) { handled = true; DEBUGPRINT(Indent(indent_level) << "ExObjList (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ExObjListAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "ExObjListAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_PPDrawingGroup) { handled = true; DEBUGPRINT(Indent(indent_level) << "PPDrawingGroup (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_PPDrawing) { handled = true; DEBUGPRINT(Indent(indent_level) << "PPDrawing (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_NamedShows) { handled = true; DEBUGPRINT(Indent(indent_level) << "NamedShows (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_NamedShow) { handled = true; DEBUGPRINT(Indent(indent_level) << "NamedShow (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_NamedShowSlides) { handled = true; DEBUGPRINT(Indent(indent_level) << "NamedShowSlides (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }

        if (record_data.type == PST_List) { handled = true; DEBUGPRINT(Indent(indent_level) << "List (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_FontCollection) { handled = true; DEBUGPRINT(Indent(indent_level) << "FontCollection (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ColorSchemeAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "ColorSchemeAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ExtendedBuGraContainer) { handled = true; DEBUGPRINT(Indent(indent_level) << "ExtendedBuGraContainer (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ExtendedBuGraAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "ExtendedBuGraAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }

        if (record_data.type == PST_OEPlaceholderAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "OEPlaceholderAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }

        if (record_data.type == PST_OutlineTextRefAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "OutlineTextRefAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_TextHeaderAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "TextHeaderAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_TextCharsAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "TextCharsAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_StyleTextPropAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "StyleTextPropAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_BaseTextPropAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "BaseTextPropAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_TxMasterStyleAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "TxMasterStyleAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_TextRulerAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "TextRulerAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_TextBytesAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "TextBytesAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_TxSIStyleAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "TxSIStyleAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_TextSpecInfoAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "TextSpecInfoAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ExtendedParagraphAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "ExtendedParagraphAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ExtendedParagraphMasterAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "ExtendedParagraphMasterAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ExtendedPresRuleContainer) { handled = true; DEBUGPRINT(Indent(indent_level) << "ExtendedPresRuleContainer (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ExtendedParagraphHeaderAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "ExtendedParagraphHeaderAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_FontEntityAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "FontEntityAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_CString) { handled = true; DEBUGPRINT(Indent(indent_level) << "CString (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ExHyperlinkAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "ExHyperlinkAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ExHyperlink) { handled = true; DEBUGPRINT(Indent(indent_level) << "ExHyperlink (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_SlideNumberMCAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "SlideNumberMCAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_HeadersFooters) { handled = true; DEBUGPRINT(Indent(indent_level) << "HeadersFooters (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_HeadersFootersAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "HeadersFootersAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_TxInteractiveInfoAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "TxInteractiveInfoAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_SlideListWithText) { handled = true; DEBUGPRINT(Indent(indent_level) << "SlideListWithText (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_InteractiveInfo) { handled = true; DEBUGPRINT(Indent(indent_level) << "InteractiveInfo (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_InteractiveInfoAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "InteractiveInfoAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_UserEditAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "UserEditAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_CurrentUserAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "CurrentUserAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_DateTimeMCAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "DateTimeMCAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_GenericDateMCAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "GenericDateMCAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_FooterMCAtom) { handled = true; DEBUGPRINT(Indent(indent_level) << "FooterMCAtom (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ProgTags) { handled = true; DEBUGPRINT(Indent(indent_level) << "ProgTags (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ProgStringTag) { handled = true; DEBUGPRINT(Indent(indent_level) << "ProgStringTag (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_ProgBinaryTag) { handled = true; DEBUGPRINT(Indent(indent_level) << "ProgBinaryTag (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }
        if (record_data.type == PST_BinaryTagData) { handled = true; DEBUGPRINT(Indent(indent_level) << "BinaryTagData (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }


        if (record_data.type == PST_PersistPtrIncrementalBlock) { handled = true; DEBUGPRINT(Indent(indent_level) << "PersistPtrIncrementalBlock (size="<<record_data.data.GetFileLength()<<"; instance="<<record_data.instance<<")"); }

        if (!handled)
        {
                DEBUGPRINT(Indent(indent_level) << "Unknown (type=" << std::hex << record_data.type << std::dec << "; size=" << record_data.data.GetFileLength() << "; instance="<<record_data.instance<<")");
                //DebugContainerReader(record_data, NULL, &std::clog, indent_level+1);
        }

        if(record_data.version == 0xF)
        {
                ReadContainer(record_data.data, std::bind(&DebugPowerpointReader, std::placeholders::_1, indent_level + 1));
        }
}

RecordHeader ReadRecord(uint8_t *buffer)
{
        RecordHeader record_header;
        record_header.version    = buffer[0] & 0xf;
        record_header.instance   =(Blex::getu16lsb(buffer)>>4)&0xfff;
        record_header.type       = Blex::getu16lsb(buffer+2);
        record_header.length     = Blex::getu32lsb(buffer+4);
        return record_header;
}

std::vector<uint32_t> Powerpointfile::GetSlideList()
{
        std::vector<uint32_t> slide_list;
        for (std::map<uint32_t, SlidePtr>::const_iterator it = slides.begin();
                it != slides.end(); ++it)
                slide_list.push_back(it->second->slideid);

        return slide_list;
}

std::vector<Text> Powerpointfile::GetSlideTexts(uint32_t slideid)
{
        std::map<uint32_t, SlidePtr>::const_iterator it;
        for (it = slides.begin();
                it != slides.end(); ++it)
                if (slideid == it->second->slideid)
                        break;

        if (it == slides.end())
                throw std::runtime_error("GetSlideTexts: Slide not found");

        std::vector<Text> retval = it->second->texts;
        //now add all shape and note texts
        RenderSlide(slideid, NULL, &retval);
        //RenderNotes(slideid, NULL, &retval); ADDME? untested though!
        return retval;
}

void Powerpointfile::ReadData(std::vector<uint8_t> * buffer, uint32_t offset, uint32_t length, Blex::RandomStream &record)
{
        buffer->resize(length);
        record.DirectRead (offset, &buffer->front(), length);
}

void Powerpointfile::DecodeFile()
{
        // Find the current user stream in the powerpoint OLE file and check if it was found
        const Blex::Docfile::File *currentuserfile = docfile.FindFile(docfile.GetRoot(), "Current User");
        if (currentuserfile == NULL)
                throw std::runtime_error("Corrupt powerpoint file, no current user stream was found");

        // Open and handle the current user stream
        currentuserstream.reset(docfile.OpenOleFile(currentuserfile));
        ReadContainer(*currentuserstream,
                       std::bind(&Powerpointfile::HandleCurrentUser, this, std::placeholders::_1));

        // Find the delay stream in the powerpoint OLE file and check if it was found
        const Blex::Docfile::File *picturesfile = docfile.FindFile(docfile.GetRoot(), "Pictures");
        if (picturesfile)
            // Open the delay stream
            delaystream.reset(docfile.OpenOleFile(picturesfile));

        // Find the document stream in the powerpoint OLE file and check if it was found
        const Blex::Docfile::File *documentfile = docfile.FindFile(docfile.GetRoot(), "PowerPoint Document");
        if (documentfile == NULL)
                throw std::runtime_error("Corrupt powerpoint file");

        // Open the document stream
        documentstream.reset(docfile.OpenOleFile(documentfile));

        // Restore the current edittable version of the powerpoint file
        DEBUGPRINT("Restoring current edit");
        documentRef = -1;
        RestoreCurrentEdit(currentUserAtom.offsetToCurrentEdit);

        // Start reading the document
        // ADDME: Clean this code up
        uint8_t buffer[8];
        RecordHeader record_header;
        DEBUGPRINT("Reading the document container");
        documentstream->DirectRead (ref_offsets[documentRef], buffer, 8);
        record_header = ReadRecord(buffer);
        if (record_header.type != PST_Document)
                throw std::runtime_error("Corrupt powerpoint file, incorrect document container");

#ifdef DEBUG
// Enable this section to view debug information about the document structure

        {
                Blex::LimitedStream str(0,
                                        documentstream->GetFileLength(),
                                        *documentstream);

                ReadContainer(str, std::bind(&DebugPowerpointReader, std::placeholders::_1, 0));
                std::clog.flush();
        }
#endif

        Blex::LimitedStream document_container_stream(ref_offsets[documentRef]+8,
                                                      ref_offsets[documentRef]+8+record_header.length, *documentstream);

        ReadContainer(document_container_stream,
                       std::bind(&Powerpointfile::HandleDocument, this, std::placeholders::_1));
}

void Powerpointfile::RestoreCurrentEdit(uint32_t offset)
{
        std::vector<uint8_t> buffer;
        buffer.resize(8);

        // Read this UserEditAtom
        documentstream->DirectRead (offset, &buffer[0], 8);
        RecordHeader record_header = ReadRecord(&buffer[0]);

        if (record_header.type != PST_UserEditAtom)
                throw std::runtime_error("Corrupt powerpoint file, incorrect atom type");

        UserEditAtom userEditAtom;
        buffer.resize(record_header.length);
        documentstream->DirectRead (offset+8, &buffer[0], record_header.length);
        userEditAtom.lastSlideID = Blex::gets32lsb(&buffer[0]);
        userEditAtom.version = Blex::getu32lsb(&buffer[4]);
        userEditAtom.offsetLastEdit = Blex::getu32lsb(&buffer[8]);
        userEditAtom.offsetPersistDirectory = Blex::getu32lsb(&buffer[12]);
        userEditAtom.documentRef = Blex::getu32lsb(&buffer[16]);
        userEditAtom.maxPersistWritten = Blex::getu32lsb(&buffer[20]);
        userEditAtom.lastViewType = Blex::gets16lsb(&buffer[24]);

        // Update the ref nr pointing to the Document Container
        documentRef = documentRef == -1 ? userEditAtom.documentRef : documentRef;

        // Read this PersistPtrIncrementalBlock
        documentstream->DirectRead (userEditAtom.offsetPersistDirectory, &buffer[0], 8);
        record_header = ReadRecord(&buffer[0]);

        if (record_header.type != PST_PersistPtrIncrementalBlock)
                throw std::runtime_error("Corrupt powerpoint file, incorrect atom type");

        buffer.resize(record_header.length);
        documentstream->DirectRead (userEditAtom.offsetPersistDirectory+8, &buffer[0], record_header.length);
        uint32_t ref_block_length = record_header.length;
        uint32_t buf_offset = 0;
        while (ref_block_length)
        {
                int nr_of_sequentials = (Blex::getu32lsb(&buffer[buf_offset]) & 0xFFF00000) >> 20;
                int ref_number = Blex::getu32lsb(&buffer[buf_offset]) & 0xFFFFF;
                ref_block_length -= 4*(1 + nr_of_sequentials);
                buf_offset += 4;

                while (nr_of_sequentials)
                {
                        // Only update the offset to this reference when not mentioned before
                        if (ref_offsets.find(ref_number) == ref_offsets.end())
                                ref_offsets[ref_number] = Blex::getu32lsb(&buffer[buf_offset]);
                        buf_offset += 4;
                        ref_number++;
                        nr_of_sequentials--;
                }
        }

        // Recursively go to next UserEditAtom, untill there is no next anymore
        if (userEditAtom.offsetLastEdit != 0)
                RestoreCurrentEdit(userEditAtom.offsetLastEdit);
}

void Powerpointfile::HandleDocument(RecordData &record_data)
{
        uint8_t buffer[8];
        SlidePtr curslide;

        switch (record_data.type)
        {
        case PST_SlideListWithText:
        {
                if (record_data.instance == INS_DocSlideList || record_data.instance == INS_DocMasterList || record_data.instance == INS_DocNotesList)
                {
                        DEBUGPRINT("Reading the slide list");
                        ReadContainer(record_data.data,
                                std::bind(&Powerpointfile::HandleSlideList, this, std::placeholders::_1, std::ref(curslide), record_data.instance));
                }
        }
        break;
        case PST_PPDrawingGroup:
        {
                escherinterface.ReadDggContainer(record_data.data, delaystream.get());
        }
        break;
        case PST_DocumentAtom:
        {
                documentAtom.slideWidth = Blex::gets32lsb(ReadStream(buffer, record_data.data, 4));
                documentAtom.slideHeight = Blex::gets32lsb(ReadStream(buffer, record_data.data, 4));
                documentAtom.notesWidth = Blex::gets32lsb(ReadStream(buffer, record_data.data, 4));
                documentAtom.notesHeight = Blex::gets32lsb(ReadStream(buffer, record_data.data, 4));
                documentAtom.zoomNumerator = Blex::gets32lsb(ReadStream(buffer, record_data.data, 4));
                documentAtom.zoomDenumerator = Blex::gets32lsb(ReadStream(buffer, record_data.data, 4));
                documentAtom.notesMaster = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                documentAtom.handoutMaster = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                documentAtom.firstSlideNum = Blex::getu16lsb(ReadStream(buffer, record_data.data, 2));
                documentAtom.slideSizeType = Blex::gets16lsb(ReadStream(buffer, record_data.data, 2));
                documentAtom.saveWithFonts = *ReadStream(buffer, record_data.data, 1);
                documentAtom.omitTitlePlace = *ReadStream(buffer, record_data.data, 1);
                documentAtom.rightToLeft = *ReadStream(buffer, record_data.data, 1);
                documentAtom.showComments = *ReadStream(buffer, record_data.data, 1);
        }
        break;
        case PST_Environment:
        {
                if (record_data.instance == INS_DocSlideList)
                {
                        DEBUGPRINT("Reading the environment");
                        ReadContainer(record_data.data,
                                std::bind(&Powerpointfile::HandleEnvironment, this, std::placeholders::_1));
                }
        }
        break;
        case PST_ExObjList:
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleExObjList, this, std::placeholders::_1));
        break;
        case PST_List:
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleList, this, std::placeholders::_1));
        break;
        case PST_NamedShows:
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleNamedShows, this, std::placeholders::_1));
        break;
        default:
                DEBUGPRINT("Unhandled in Document Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleCurrentUser(RecordData &record_data)
{
        uint8_t buffer[8];
        SlidePtr curslide;

        switch (record_data.type)
        {
        case PST_CurrentUserAtom:
        {
        // Read the CurrentUserAtom
        currentUserAtom.size = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
        currentUserAtom.magic = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
        currentUserAtom.offsetToCurrentEdit = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
        currentUserAtom.lenUserName = Blex::getu16lsb(ReadStream(buffer, record_data.data, 2));
        currentUserAtom.docFileVersion = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
        currentUserAtom.majorVersion = *ReadStream(buffer, record_data.data, 1);
        currentUserAtom.majorVersion = *ReadStream(buffer, record_data.data, 1);

        // Read the username
        std::vector<uint8_t> username_;
        username_.resize(currentUserAtom.lenUserName);
        ReadStream(&username_[0], record_data.data, currentUserAtom.lenUserName);
        username = std::string((const char *)&username_[0], currentUserAtom.lenUserName);
        }
        break;
        }
}

void Powerpointfile::HandleList(RecordData &record_data)
{
        std::vector<uint8_t> buffer;

        switch (record_data.type)
        {
        case PST_ProgTags:
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleProgTags, this, std::placeholders::_1));
        break;
        default:
                DEBUGPRINT("Unhandled in Document->List Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleNamedShows(RecordData &record_data)
{
        switch (record_data.type)
        {
        case PST_NamedShow:
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleNamedShow, this, std::placeholders::_1));
        break;
        default:
                DEBUGPRINT("Unhandled in Document->NamedShows Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleNamedShow(RecordData &record_data)
{
        uint8_t buffer[4];

        switch (record_data.type)
        {
        case PST_CString:
        {
                // Reserve another custom show in the vector
                custom_shows.resize(custom_shows.size()+1);

                // Read the name of this show
                Blex::UTF8Encoder<std::back_insert_iterator<std::string> > data_utf8_encoder(std::back_inserter(custom_shows.back().first));
                for (unsigned i=0;i<record_data.data.GetFileLength()/2;++i)
                    data_utf8_encoder(Blex::getu16lsb(ReadStream(buffer, record_data.data, 2)));
        }
        break;
        case PST_NamedShowSlides:
                for (unsigned pos=0; pos<record_data.data.GetFileLength(); pos+=4)
                        custom_shows.back().second.push_back(Blex::getu32lsb(ReadStream(buffer, record_data.data, 4)));
        break;
        default:
                DEBUGPRINT("Unhandled in Document->NamedShows Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleProgTags(RecordData &record_data)
{
        switch (record_data.type)
        {
        case PST_ProgBinaryTag:
        {
                std::string version;
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleProgBinaryTag, this, std::placeholders::_1, std::ref(version)));
        }
        break;
        default:
                DEBUGPRINT("Unhandled in Document->List->ProgTags Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleProgBinaryTag(RecordData &record_data, std::string &version)
{
        uint8_t buffer[4];
        switch (record_data.type)
        {
        case PST_CString:
        {
                Blex::UTF8Encoder<std::back_insert_iterator<std::string> > data_utf8_encoder(std::back_inserter(version));
                for (unsigned i=0;i<record_data.data.GetFileLength()/2;++i)
                    data_utf8_encoder(Blex::getu16lsb(ReadStream(buffer, record_data.data, 2)));
        }
        break;
        case PST_BinaryTagData:
                if (version == "___PPT9")
                        ReadContainer(record_data.data,
                                std::bind(&Powerpointfile::HandlePPT9TagData, this, std::placeholders::_1));
        break;
        default:
                DEBUGPRINT("Unhandled in Document->List->ProgTags->ProgBinaryTag Container" << record_data);
        break;
        }
}

void Powerpointfile::HandlePPT9TagData(RecordData &record_data)
{
        std::vector<uint8_t> buffer;

        switch (record_data.type)
        {
        case PST_ExtendedPresRuleContainer:
        {
                uint32_t slideid = 0;
                uint32_t tx_type = 0;
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleExtendedPresRuleContainer, this, std::placeholders::_1, std::ref(slideid), std::ref(tx_type)));
        }
        break;
        case PST_ExtendedParagraphMasterAtom:
        {
                ext_par_settings[0][record_data.instance].resize((unsigned)record_data.data.GetFileLength());
                ReadStream(&ext_par_settings[0][record_data.instance][0], record_data.data, (unsigned)record_data.data.GetFileLength());
        }
        break;
        case PST_ExtendedBuGraContainer:
        {
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleExtendedBuGraContainer, this, std::placeholders::_1, 0, 0));
        }
        break;
        default:
                DEBUGPRINT("Unhandled in Document->List->ProgTags->ProgBinaryTag->PPT9TagData Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleExtendedBuGraContainer(RecordData &record_data, uint32_t /*slideid*/, uint32_t /*tx_type*/)
{
        uint8_t buffer[4];

        switch (record_data.type)
        {
        case PST_ExtendedBuGraAtom:
        {
                // What do we do with the type?
                /*uint16_t type = */Blex::getu16lsb(ReadStream(buffer, record_data.data, 2));

                // Store the blip
                Blex::LimitedStream str(2, documentstream->GetFileLength()-2, record_data.data);
                graphical_bullet_blips[record_data.instance].reset(new Parsers::Office::Escher::BlipStoreEntry());
                ReadContainer(str, std::bind(&Parsers::Office::Escher::BlipStoreEntry::ContainerReader, graphical_bullet_blips[record_data.instance], std::placeholders::_1));
        }
        break;
        default:
                DEBUGPRINT("Unhandled in Document->List->ProgTags->ProgBinaryTag->PPT9TagData->ExtendedBuGraContainer Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleExtendedPresRuleContainer(RecordData &record_data, uint32_t &slideid, uint32_t &tx_type)
{
        uint8_t buffer[4];

        switch (record_data.type)
        {
        case PST_ExtendedParagraphAtom:
                ext_par_settings[slideid][tx_type].resize((unsigned)record_data.data.GetFileLength());
                ReadStream(&ext_par_settings[slideid][tx_type][0], record_data.data, (unsigned)record_data.data.GetFileLength());
        break;
        case PST_ExtendedParagraphHeaderAtom:
                slideid = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                tx_type = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
        break;
        default:
                DEBUGPRINT("Unhandled in Document->List->ProgTags->ProgBinaryTag->PPT9TagData->ExtendedPresRuleContainer Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleExObjList(RecordData &record_data)
{
        switch (record_data.type)
        {
        case PST_ExObjListAtom:
                /* This Atom contains no usefull information */
        break;
        case PST_ExHyperlink:
        {
                uint32_t objId = 0; // objId to reference the Hyperlink (get's filled in)
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleExHyperlink, this, std::placeholders::_1, &objId));
        }
        break;
        default:
                DEBUGPRINT("Unhandled in ExObjList Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleExHyperlink(RecordData &record_data, uint32_t *objId)
{
        uint8_t buffer[4];

        switch (record_data.type)
        {
        case PST_ExHyperlinkAtom:
                *objId = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
        break;
        case PST_CString:
                switch (record_data.instance)
                {
                case INS_FriendlyName:
                        Blex::UTF8Encoder<std::back_insert_iterator<std::string> > data_utf8_encoder(std::back_inserter(hyperlinks[*objId]));
                        for (unsigned i=0;i<record_data.data.GetFileLength()/2;++i)
                            data_utf8_encoder(Blex::getu16lsb(ReadStream(buffer, record_data.data, 2)));
                break;
                }
        break;
        default:
                DEBUGPRINT("Unhandled in ExObjList Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleSlideList(RecordData &record_data, SlidePtr &curslide, unsigned type)
{
        uint8_t buffer[8];

        DEBUGPRINT("Got slide " << record_data << " " << type);

        switch (record_data.type)
        {
        case PST_SlidePersistAtom:
        {
                // Read the slide persist atom
                SlidePersistAtom slidePersistAtom;
                slidePersistAtom.psrReference = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                slidePersistAtom.flags = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                slidePersistAtom.numberTexts = Blex::gets32lsb(ReadStream(buffer, record_data.data, 4));
                slidePersistAtom.slideid = Blex::gets32lsb(ReadStream(buffer, record_data.data, 4));
                slidePersistAtom.reserved = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));

                SlidePtr newslide(new Slide);
                newslide->type = type;
                newslide->slideid = slidePersistAtom.slideid;
                newslide->slidenr = slides.size()+1;

                // Read information about this slide using the reference nr
                documentstream->DirectRead (ref_offsets[slidePersistAtom.psrReference], &buffer[0], 8);
                RecordHeader container_record_header = ReadRecord(&buffer[0]);

                Blex::LimitedStream str(ref_offsets[slidePersistAtom.psrReference]+8,
                                        ref_offsets[slidePersistAtom.psrReference]+8+container_record_header.length,
                                        *documentstream);

                ReadContainer(str,
                        std::bind(&Powerpointfile::HandleSlide, this, std::placeholders::_1, newslide));

                // Assign the decoded slide to the correct category
                switch (type)
                {
                case INS_DocSlideList:
                        slides[slidePersistAtom.psrReference] = newslide;
                break;
                case INS_DocMasterList:
                        masterslides[slidePersistAtom.psrReference] = newslide;
                break;
                case INS_DocNotesList:
                        notesslides[slidePersistAtom.psrReference] = newslide;
                break;
                }
                curslide = newslide;
        }
        break;
        case PST_TextHeaderAtom:

                // Read the text header atom
                TextHeaderAtom textHeaderAtom;
                textHeaderAtom.txType = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));

                // Add this text to the current slide
                curslide->texts.push_back(textHeaderAtom.txType);

        break;
        case PST_TextCharsAtom:
        {
                // Read the text bytes atom (which is a stream of bytes with unicode data)
                std::vector<uint8_t> tmpbuffer;
                tmpbuffer.resize((unsigned)record_data.data.GetFileLength());
                ReadStream(&tmpbuffer[0], record_data.data, (unsigned)record_data.data.GetFileLength());
                ReadUTF16Str(curslide->texts.back().data, tmpbuffer);
        }
        break;
        case PST_TextBytesAtom:
        {
                // Read the text bytes atom (which is just a stream of bytes)
                std::vector<uint8_t> tmpbuffer;
                tmpbuffer.resize((unsigned)record_data.data.GetFileLength());
                ReadStream(&tmpbuffer[0], record_data.data, (unsigned)record_data.data.GetFileLength());
                curslide->texts.back().data.assign(tmpbuffer.begin(), tmpbuffer.end());
        }
        break;
        case PST_StyleTextPropAtom:
        {
                // Read the style text atom (which is just a stream of bytes)
                std::vector<uint8_t> tmpbuffer;
                tmpbuffer.resize((unsigned)record_data.data.GetFileLength());
                ReadStream(&tmpbuffer[0], record_data.data, (unsigned)record_data.data.GetFileLength());
                curslide->texts.back().style.assign(tmpbuffer.begin(), tmpbuffer.end());
        }
        break;
        case PST_TextSpecInfoAtom:

                /* The special info runs contained in this text.
                "Special infos" are character properties that don't follow
                styles, such as background spelling info or language ID.
                Special parsing code is needed to parse content of this atom. */

                // This is not usefull for us

        break;
        case PST_InteractiveInfo:
                curslide->texts.back().interactive_items.push_back(std::make_pair(TextMarker(), InteractiveInfoAtom()));
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleInteractiveInfo, this, std::placeholders::_1, std::ref(curslide->texts.back().interactive_items.back().second)));
        break;
        case PST_TxInteractiveInfoAtom:
                curslide->texts.back().interactive_items.back().first.start = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                curslide->texts.back().interactive_items.back().first.end = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
        break;
        default:
                DEBUGPRINT("Unhandled in SlideList Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleSlide(RecordData &record_data, SlidePtr curslide)
{
        uint8_t buffer[4];

        switch (record_data.type)
        {
        case PST_SlideAtom:
                // Read the SlideAtom
                curslide->slideatom.geom = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                for (int i = 0; i < MAX_OBJECTS_IN_LAYOUT; ++i)
                    curslide->slideatom.placeholderid[i] = *ReadStream(buffer, record_data.data, 1);
                curslide->slideatom.masterid = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                curslide->slideatom.notesid = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                curslide->slideatom.flags = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
        break;
        case PST_NotesAtom:
                // Read the NotesAtom (only on notes slides)
                curslide->notesatom.slideid = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                curslide->notesatom.flags = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
        break;
        case PST_PPDrawing:
        {
                // We have the escher drawing
                LoadEscherInterface(curslide, record_data.data);
        }
        break;
        case PST_ColorSchemeAtom:
        {
                if (record_data.instance == INS_SlideScheme)
                {
                        for (unsigned i=0; i<8; ++i)
                        {
                                ReadStream(buffer, record_data.data, 4);
                                curslide->schemecolors.AddColor(DrawLib::Pixel32(buffer[0], buffer[1], buffer[2]));
                        }
                }
        }
        break;
        case PST_HeadersFooters:
                // Read the HeadersFooters container
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleHeadersFooters, this, std::placeholders::_1, curslide));
        break;
        case PST_TxMasterStyleAtom:
        {
                // Handle the MasterStyle
                try
                {
                        DecodeMasterStyle(record_data.instance, record_data.data);
                }
                catch(std::exception &e)
                {
                        DEBUGPRINT("Exception " << e.what() << " decoding a master style");
                }
        }
        break;
        case PST_ProgTags:
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleProgTags, this, std::placeholders::_1));
        break;
        default:
                DEBUGPRINT("Unhandled in Slide Container\n" << record_data);
        break;
        }
}

void Powerpointfile::HandleHeadersFooters(RecordData &record_data, SlidePtr curslide)
{
        uint8_t buffer[4];

        switch (record_data.type)
        {
        case PST_HeadersFootersAtom:
                // Read the HeadersFootersAtom
                curslide->headersfooters.reset(new HeadersFootersAtom());
                curslide->headersfooters->formatid = Blex::gets16lsb(ReadStream(buffer, record_data.data, 2));
                curslide->headersfooters->flags = Blex::getu16lsb(ReadStream(buffer, record_data.data, 2));
        break;
        case PST_CString:
        {
                std::vector<uint8_t> tmpbuffer;
                tmpbuffer.resize((unsigned)record_data.data.GetFileLength());
                ReadStream(&tmpbuffer[0], record_data.data, (unsigned)record_data.data.GetFileLength());
                switch (record_data.instance)
                {
                        case INS_Footer:
                                curslide->footertext.assign(tmpbuffer.begin(), tmpbuffer.end());
                        break;
                        case INS_Header:
                                curslide->headertext.assign(tmpbuffer.begin(), tmpbuffer.end());
                        break;
                        case INS_UserDate:
                                curslide->userdatetext.assign(tmpbuffer.begin(), tmpbuffer.end());
                        break;
                }
        }
        break;
        default:
                DEBUGPRINT("Unhandled in HeadersFooters Container\n" << record_data);
        break;
        }
}

void Powerpointfile::HandleEnvironment(RecordData &record_data)
{
        switch (record_data.type)
        {
        case PST_FontCollection:
                // Read the FontCollection container
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleFontCollection, this, std::placeholders::_1));
        break;
        case PST_TxMasterStyleAtom:
        {
                // Handle the MasterStyle
                DecodeMasterStyle(record_data.instance, record_data.data);
        }
        break;
        case PST_TxSIStyleAtom:
        {
                DecodeSpecialInfo(&special_info, record_data.data);
        }
        break;
        default:
                DEBUGPRINT("Unhandled in Environment Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleFontCollection(RecordData &record_data)
{
        uint8_t buffer[4];

        switch (record_data.type)
        {
        case PST_FontEntityAtom:
        {
                // Read the FontEntityAtom
                // Format the fontname in utf8
                std::string fontstr;
                Blex::UTF8Encoder<std::back_insert_iterator<std::string> > data_utf8_encoder(std::back_inserter(fontstr));
                for (unsigned i=0;i<record_data.data.GetFileLength()/2;++i)
                    data_utf8_encoder(Blex::getu16lsb(ReadStream(buffer, record_data.data, 2)));
                // And add to the font list
                fontnames.push_back(fontstr);
        }
        break;
        default:
                DEBUGPRINT("Unhandled in FontCollection Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleInteractiveInfo(RecordData &record_data, InteractiveInfoAtom &interactiveinfoatom)
{
        uint8_t buffer[4];

        switch (record_data.type)
        {
        case PST_InteractiveInfoAtom:
                interactiveinfoatom.soundref = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                interactiveinfoatom.ex_hyperlink_id = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                interactiveinfoatom.action = *ReadStream(buffer, record_data.data, 1);
                interactiveinfoatom.oleverb = *ReadStream(buffer, record_data.data, 1);
                interactiveinfoatom.jump = *ReadStream(buffer, record_data.data, 1);
                interactiveinfoatom.flags = *ReadStream(buffer, record_data.data, 1);
                interactiveinfoatom.hyperlink_type = *ReadStream(buffer, record_data.data, 1);
        break;
        case PST_CString:
        {
                Blex::UTF8Encoder<std::back_insert_iterator<std::string> > data_utf8_encoder(std::back_inserter(interactiveinfoatom.name));
                for (unsigned i=0;i<record_data.data.GetFileLength()/2;++i)
                    data_utf8_encoder(Blex::getu16lsb(ReadStream(buffer, record_data.data, 2)));
        }
        break;
        default:
                DEBUGPRINT("Unhandled in InteractiveInfo Container" << record_data);
        break;
        }
}

uint32_t Powerpointfile::GetSlideRefById(uint32_t slideid)
{
        for (std::map<uint32_t, SlidePtr>::const_iterator it = slides.begin();
                it != slides.end(); ++it)
                if (it->second->slideid == slideid)
                        return it->first;

        return -1;
}

uint32_t Powerpointfile::GetNotesRefById(uint32_t slideid)
{
        for (std::map<uint32_t, SlidePtr>::const_iterator it = notesslides.begin();
                it != notesslides.end(); ++it)
                if (it->second->slideid == slideid)
                        return it->first;

        return -1;
}

uint32_t Powerpointfile::GetMasterRefById(uint32_t slideid)
{
        for (std::map<uint32_t, SlidePtr>::const_iterator it = masterslides.begin();
                it != masterslides.end(); ++it)
                if (it->second->slideid == slideid)
                        return it->first;

        return -1;
}

void Powerpointfile::RenderSlide(int32_t slideid, DrawLib::BitmapInterface *canvas, std::vector<Text> *extracted_texts)
{
        // Open the slide
        int32_t refnr = GetSlideRefById(slideid);
        if (refnr == -1)
                throw std::runtime_error("Slide not found in file");
        SlidePtr curslide = slides[refnr];

        // Open the masterslide
        int32_t masterref = GetMasterRefById(curslide->slideatom.masterid);
        if (masterref == -1)
                throw std::runtime_error("Corrupt powerpoint document, referenced master does not exist");
        SlidePtr masterslide = masterslides[masterref];

        // Render the background
        if (curslide->slideatom.flags & S_FOLLOW_MASTER_BACKGROUND)
            RenderShape(masterslide, masterslide->background_shape_id, canvas, curslide, extracted_texts);
        else
            RenderShape(curslide, curslide->background_shape_id, canvas, curslide, extracted_texts);

        // Now start rendering items from the master slide
        if (curslide->slideatom.flags & S_FOLLOW_MASTER_OBJECTS)
                for (std::vector<std::pair<int32_t, ShapeInfoPtr> >::const_iterator it = masterslide->shapes.begin();
                        it != masterslide->shapes.end(); ++it)
                {
                        // Check the type of this shape
                        if (it->second->oeplaceholderatom.get())
                        {
                                DEBUGPRINT("Found placeholder " << (int)it->second->oeplaceholderatom->placeholderid << " in masterslide");
                                switch (it->second->oeplaceholderatom->placeholderid)
                                {

                                // Slide Nr (default off)
                                case S_PLACEHOLDER_MASTER_SLIDENR:
                                if (curslide->headersfooters.get() && curslide->headersfooters->flags & S_HEADERFOOTER_SLIDENUMBER)
                                    RenderShape(masterslide, it->first, canvas, curslide, extracted_texts);
                                break;

                                // Date (default on)
                                case S_PLACEHOLDER_MASTER_DATE:
                                if (curslide->headersfooters.get() ? curslide->headersfooters->flags & S_HEADERFOOTER_DATE : true)
                                    RenderShape(masterslide, it->first, canvas, curslide, extracted_texts);
                                break;

                                // Footer (default on)
                                case S_PLACEHOLDER_MASTER_FOOTER:
                                if (curslide->headersfooters.get() ? curslide->headersfooters->flags & S_HEADERFOOTER_FOOTER : true)
                                    RenderShape(masterslide, it->first, canvas, curslide, extracted_texts);
                                break;
                                }
                        }
                        // Only render non standard objects when this is selected
                        else if (it->first != masterslide->background_shape_id)
                            RenderShape(masterslide, it->first, canvas, curslide, extracted_texts);
                }

        // And finally render all items from the current slide
        for (std::vector<std::pair<int32_t, ShapeInfoPtr> >::const_iterator it = curslide->shapes.begin();
                it != curslide->shapes.end(); ++it)
            if (it->first != curslide->background_shape_id)
                RenderShape(curslide, it->first, canvas, curslide, extracted_texts);
}

// FIXME: This function was not yet tested, this is where I stopped with the Powerpoint project
void Powerpointfile::RenderNotes(int32_t slideid, DrawLib::BitmapInterface *canvas, std::vector<Text> *extracted_texts)
{
        // Open the notes (via the slide)
        int32_t parentrefnr = GetSlideRefById(slideid);
        if (parentrefnr == -1)
                throw std::runtime_error("Slide not found in file");
        SlidePtr parentslide = slides[parentrefnr];
        int32_t refnr = GetNotesRefById(parentslide->slideatom.notesid);
        if (refnr == -1)
                throw std::runtime_error("Notes page not found in file");
        SlidePtr curslide = notesslides[refnr];

        // Open the masterslide
        int32_t masterref = GetMasterRefById(parentslide->slideatom.masterid);
        if (masterref == -1)
                throw std::runtime_error("Corrupt powerpoint document, referenced master does not exist");
        SlidePtr masterslide = masterslides[masterref];

        // Render the background
        if (curslide->notesatom.flags & S_FOLLOW_MASTER_BACKGROUND)
                RenderShape(masterslide, masterslide->background_shape_id, canvas, curslide, extracted_texts);
        else
                RenderShape(curslide, curslide->background_shape_id, canvas, curslide, extracted_texts);

        // Now start rendering items from the master slide
        if (curslide->notesatom.flags & S_FOLLOW_MASTER_OBJECTS)
                for (std::vector<std::pair<int32_t, ShapeInfoPtr> >::const_iterator it = masterslide->shapes.begin();
                        it != masterslide->shapes.end(); ++it)
                {
                        // Check the type of this shape
                        if (it->second->oeplaceholderatom.get())
                        {
                                DEBUGPRINT("Found placeholder " << (int)it->second->oeplaceholderatom->placeholderid << " in masterslide");
                                switch (it->second->oeplaceholderatom->placeholderid)
                                {

                                // Slide Nr (default off)
                                case S_PLACEHOLDER_MASTER_SLIDENR:
                                if (curslide->headersfooters.get() && curslide->headersfooters->flags & S_HEADERFOOTER_SLIDENUMBER)
                                    RenderShape(masterslide, it->first, canvas, curslide, extracted_texts);
                                break;

                                // Date (default on)
                                case S_PLACEHOLDER_MASTER_DATE:
                                if (curslide->headersfooters.get() ? curslide->headersfooters->flags & S_HEADERFOOTER_DATE : true)
                                    RenderShape(masterslide, it->first, canvas, curslide, extracted_texts);
                                break;

                                // Footer (default on)
                                case S_PLACEHOLDER_MASTER_FOOTER:
                                if (curslide->headersfooters.get() ? curslide->headersfooters->flags & S_HEADERFOOTER_FOOTER : true)
                                    RenderShape(masterslide, it->first, canvas, curslide, extracted_texts);
                                break;
                                }
                        }
                        // Only render non standard objects when this is selected
                        else if (it->first != masterslide->background_shape_id)
                            RenderShape(masterslide, it->first, canvas, curslide, extracted_texts);
                }

        // And finally render all items from the current slide
        for (std::vector<std::pair<int32_t, ShapeInfoPtr> >::const_iterator it = curslide->shapes.begin();
                it != curslide->shapes.end(); ++it)
            if (it->first != curslide->background_shape_id)
                RenderShape(curslide, it->first, canvas, curslide, extracted_texts);
}

void Powerpointfile::GetText(DrawLib::TextFormatter *textformatter, int32_t shapeid, SlidePtr curslide, SlidePtr dataslide, std::vector<Text> *extracted_texts)
{
        std::vector<uint8_t> const &client_textbox = escherinterface.GetClientTextbox(shapeid);
        std::vector<uint8_t> const &client_data = escherinterface.GetClientData(shapeid);

        // Open a streams
        Blex::MemoryReadStream client_textbox_stream(&client_textbox[0], client_textbox.size());
        Blex::MemoryReadStream client_data_stream(&client_data[0], client_data.size());

        // Store the text in this variable
        Text currenttext(0);

        ReadContainer(client_textbox_stream,
                       std::bind(&Powerpointfile::HandleClientTextbox, this, std::placeholders::_1, curslide, dataslide, &currenttext));
        ReadContainer(client_data_stream,
                       std::bind(&Powerpointfile::HandleClientDataExtPar, this, std::placeholders::_1, &currenttext));

        if(extracted_texts)
            extracted_texts->push_back(currenttext);

        if (!textformatter)
            return;

        Blex::MemoryReadStream style_stream(&currenttext.style[0], currenttext.style.size());
        Blex::MemoryReadStream ruler_stream(&currenttext.ruler[0], currenttext.ruler.size());
        Blex::MemoryReadStream ext_par_stream(&ext_par_settings[dataslide->slideid][currenttext.type][0], ext_par_settings[dataslide->slideid][currenttext.type].size());
        Blex::MemoryReadStream master_ext_par_stream(&ext_par_settings[0][currenttext.type][0], ext_par_settings[0][currenttext.type].size());

        // Load the correct scheme colors
        Escher::SchemeColors *scheme_colors;
        if (curslide->slideatom.flags & S_FOLLOW_MASTER_SCHEME)
        {
                int32_t refnr = GetMasterRefById(curslide->slideatom.masterid);
                if (refnr == -1)
                {
                        DEBUGPRINT("Corrupt powerpoint file, cannot find master slide " << curslide->slideatom.masterid);
                        scheme_colors = &curslide->schemecolors;
                }
                else
                {
                        scheme_colors = &masterslides[refnr]->schemecolors;
                }
        }
        else
                scheme_colors = &curslide->schemecolors;

        // Set text formatter in correct mode
        textformatter->SetMode(1);

        // Look up the txtype, for a TextStyle template
        if (master_text_styles.find(currenttext.type) != master_text_styles.end())
                RenderText(master_text_styles[currenttext.type], scheme_colors, style_stream, ruler_stream, ext_par_stream, master_ext_par_stream, currenttext.data, textformatter, currenttext.text_extensions, currenttext.special_infos);
        else
        {
                // No master style, use an empty one
                ParSettings parsettings;
                for (unsigned i=0; i<5; ++i)
                        parsettings.push_back(ParSetting());

                RenderText(parsettings, scheme_colors, style_stream, ruler_stream, ext_par_stream, master_ext_par_stream, currenttext.data, textformatter, currenttext.text_extensions, currenttext.special_infos);
        }
}

void Powerpointfile::HandleClientTextbox(RecordData &record_data, SlidePtr curslide, SlidePtr dataslide, Text *text)
{
        uint8_t buffer[4];

        switch (record_data.type)
        {
        case PST_OutlineTextRefAtom:
        {
                uint32_t text_index = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                if (text_index >= curslide->texts.size())
                        throw std::runtime_error("Text referenced in Escher stream was not found in slide");

                text->data = curslide->texts[text_index].data;
                text->style = curslide->texts[text_index].style;
                text->ruler = curslide->texts[text_index].ruler;
                text->type = curslide->texts[text_index].type;
        }
        break;
        case PST_TextHeaderAtom:

                text->type = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));

        break;
        case PST_StyleTextPropAtom:
        {
                // Read the style text atom (which is just a stream of bytes)
                std::vector<uint8_t> tmpbuffer;
                tmpbuffer.resize((unsigned)record_data.data.GetFileLength());
                ReadStream(&tmpbuffer[0], record_data.data, (unsigned)record_data.data.GetFileLength());
                text->style = tmpbuffer;
        }
        break;
        case PST_TextCharsAtom:
        {
                // Read the text bytes atom (which is a stream of bytes with unicode data)
                std::vector<uint8_t> tmpbuffer;
                tmpbuffer.resize((unsigned)record_data.data.GetFileLength());
                ReadStream(&tmpbuffer[0], record_data.data, (unsigned)record_data.data.GetFileLength());
                ReadUTF16Str(text->data, tmpbuffer);
        }
        break;
        case PST_TextBytesAtom:
        {
                // Read the text bytes atom (which is just a stream of bytes)
                std::vector<uint8_t> tmpbuffer;
                tmpbuffer.resize((unsigned)record_data.data.GetFileLength());
                ReadStream(&tmpbuffer[0], record_data.data, (unsigned)record_data.data.GetFileLength());
                text->data.assign(tmpbuffer.begin(), tmpbuffer.end());
        }
        break;
        case PST_TextSpecInfoAtom:
                // Decode special info like background spelling and language id
                DecodeSpecialInfoRun(&text->special_infos, record_data.data);
        break;
        case PST_TextRulerAtom:

                text->ruler.resize((unsigned)record_data.data.GetFileLength());
                ReadStream(&text->ruler[0], record_data.data, (unsigned)record_data.data.GetFileLength());

        break;
        case PST_DateTimeMCAtom:
        {
                int32_t date_pos = Blex::gets32lsb(ReadStream(buffer, record_data.data, 4));
                uint8_t formatid = *ReadStream(buffer, record_data.data, 1);

                text->text_extensions[date_pos].calculate_date = true;
                text->text_extensions[date_pos].formatid = formatid;
        }
        break;
        case PST_GenericDateMCAtom:
        {
                // Read position of the date string
                int32_t date_pos = Blex::gets32lsb(ReadStream(buffer, record_data.data, 4));

                if (dataslide->headersfooters.get() && dataslide->headersfooters->flags & S_HEADERFOOTER_TODAYDATE)
                {
                        text->text_extensions[date_pos].calculate_date = true;
                        text->text_extensions[date_pos].formatid = dataslide->headersfooters->formatid;
                }
                else if (dataslide->headersfooters.get() && dataslide->headersfooters->flags & S_HEADERFOOTER_USERDATE)
                        text->text_extensions[date_pos].text = dataslide->userdatetext;
                else
                        text->text_extensions[date_pos].text = Blex::UTF16String();
        }
        break;
        case PST_SlideNumberMCAtom:
        {
                // Read position of the slide number
                int32_t slide_nr_pos = Blex::gets32lsb(ReadStream(buffer, record_data.data, 4));

                std::string slidenr = Blex::AnyToString(dataslide->slidenr);
                for (unsigned pos=0; pos<slidenr.size(); ++pos)
                        text->text_extensions[slide_nr_pos].text.push_back(slidenr[pos]);
        }
        break;
        case PST_FooterMCAtom:
        {
                // Read position of the footer
                int32_t footer_pos = Blex::gets32lsb(ReadStream(buffer, record_data.data, 4));

                text->text_extensions[footer_pos].text = dataslide->footertext;
        }
        break;
        case PST_BaseTextPropAtom:
                // Style in a master slide, not used

        break;
        default:
                DEBUGPRINT("Unhandled in ClientTextbox Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleClientData(RecordData &record_data, ShapeInfoPtr shape)
{
        uint8_t buffer[4];

        switch (record_data.type)
        {
        case PST_OEPlaceholderAtom:
                shape->oeplaceholderatom.reset(new OEPlaceholderAtom);
                shape->oeplaceholderatom->placementid = Blex::getu32lsb(ReadStream(buffer, record_data.data, 4));
                shape->oeplaceholderatom->placeholderid = *ReadStream(buffer, record_data.data, 1);
                shape->oeplaceholderatom->size = *ReadStream(buffer, record_data.data, 1);
                shape->oeplaceholderatom->undefined = Blex::getu16lsb(ReadStream(buffer, record_data.data, 2));
        break;
        case PST_InteractiveInfo:
                shape->interactiveinfoatom.reset(new InteractiveInfoAtom);
                ReadContainer(record_data.data,
                        std::bind(&Powerpointfile::HandleInteractiveInfo, this, std::placeholders::_1, std::ref(*shape->interactiveinfoatom)));
        break;
        default:
                DEBUGPRINT("Unhandled in ClientData Container" << record_data);
        break;
        }
}

void Powerpointfile::HandleClientDataExtPar(RecordData &record_data, Text *text)
{
        std::vector<uint8_t> buffer;

        switch (record_data.type)
        {
        case PST_ExtendedParagraphAtom:

                // Read the style text atom (which is just a stream of bytes)
                text->extpar.resize((unsigned)record_data.data.GetFileLength());
                ReadStream(&text->extpar[0], record_data.data, (unsigned)record_data.data.GetFileLength());

        break;
        default:
                DEBUGPRINT("Unhandled in ClientDataExtPar Container" << record_data);
        break;
        }

}

void Powerpointfile::LoadEscherInterface(SlidePtr slide, Blex::RandomStream &dgContainerStream)
{
#ifdef DEBUG
        {
                ReadContainer(dgContainerStream, std::bind(&DebugContainerReader, std::placeholders::_1, (Blex::RandomStream*)NULL, &std::clog, 0));
                std::clog.flush();
        }
#endif
        // Let escher parse the dgContainer belonging to this slide
        slide->drawing_container_id = escherinterface.ReadDgContainer(dgContainerStream, delaystream.get());

        // Now cache all root shapes
        std::vector<int32_t> shape_ids = escherinterface.GetShapeIds(slide->drawing_container_id);
        for (std::vector<int32_t>::const_iterator it = shape_ids.begin(); it != shape_ids.end(); ++it)
            AddShape(slide, *it);

        // And cache the background shape
        slide->background_shape_id = escherinterface.GetBackgroundShapeId(slide->drawing_container_id);
        AddShape(slide, slide->background_shape_id);
}

void Powerpointfile::AddShape(SlidePtr slide, int32_t shapeid)
{
        // Add a new ShapeInfo object, and add it to the correct slide
        ShapeInfoPtr newshape(new ShapeInfo);
        slide->shapes.push_back(std::make_pair(shapeid, newshape));

        // Get the ClientAnchor (coordinates)
        std::vector<uint8_t> client_anchor = escherinterface.GetClientAnchor(shapeid);
        if (client_anchor.size())
        {
                newshape->position.x1 = Blex::gets16lsb(&client_anchor[2]);
                newshape->position.y1 = Blex::gets16lsb(&client_anchor[0]);
                newshape->position.x2 = Blex::gets16lsb(&client_anchor[4]);
                newshape->position.y2 = Blex::gets16lsb(&client_anchor[6]);
        }
        else
        {
                // When we have no information about the position of this object, assume it's background
                newshape->position.x1 = 0;
                newshape->position.y1 = 0;
                newshape->position.x2 = (int16_t)documentAtom.slideWidth;
                newshape->position.y2 = (int16_t)documentAtom.slideHeight;
        }

        // Get the ClienData
        std::vector<uint8_t> client_data = escherinterface.GetClientData(shapeid);

        // Process the client data
        Blex::MemoryReadStream client_data_stream(&client_data[0], client_data.size());
        ReadContainer(client_data_stream,
               std::bind(&Powerpointfile::HandleClientData, this, std::placeholders::_1, newshape));

}

void Powerpointfile::RenderShape(SlidePtr slide, int32_t shapeid, DrawLib::BitmapInterface *canvas, SlidePtr dataslide, std::vector<Text> *extracted_texts)
{
        // Lookup the shape
        ShapeInfoPtr shape;
        std::vector<std::pair<int32_t, ShapeInfoPtr> >::const_iterator it;
        for (it = slide->shapes.begin();
                it != slide->shapes.end(); ++it)
                if (it->first == shapeid)
                {
                        shape = it->second;
                        break;
                }

        if (it == slide->shapes.end())
                throw std::runtime_error("Corrupt powerpoint file, shape with id=" + Blex::AnyToString(shapeid) + " not found in slide with id=" + Blex::AnyToString(slide->slideid));

        float x_size = (1.0*(shape->position.x2 - shape->position.x1)) * point_to_pixel;
        float y_size = (1.0*(shape->position.y2 - shape->position.y1)) * point_to_pixel;

        // Default canvas sizes for if we aren't rendering (only extracting texts)
        int32_t canvas_width = 1024;
        int32_t canvas_height = 768;

        if (canvas)
        {
                canvas_width = canvas->GetWidth();
                canvas_height = canvas->GetHeight();
        }

        DrawLib::FPSize shape_size(x_size,y_size);

        float scale_x = (1.0*canvas_width) / (documentAtom.slideWidth * point_to_pixel);
        float scale_y = (1.0*canvas_height) / (documentAtom.slideHeight * point_to_pixel);

        DrawLib::FPPoint translation = DrawLib::FPPoint((1.0*shape->position.x1) * point_to_pixel *scale_x
                                                       ,(1.0*shape->position.y1) * point_to_pixel *scale_y);
        DrawLib::XForm2D final_transform = DrawLib::XForm2D(scale_x,0,0,scale_y,translation);

        escherinterface.PaintShape(canvas, shape_size, final_transform,
                shapeid, std::bind(&Powerpointfile::GetText, this, std::placeholders::_1, std::placeholders::_2, slide, dataslide, extracted_texts), &dataslide->schemecolors);
}

void Powerpointfile::DecodeMasterStyle(uint32_t txtype, Blex::RandomStream &master_style_stream)
{
        uint8_t buffer[8];

        // Read the number of indentation levels
        uint16_t levels = Blex::getu16lsb(ReadStream(buffer, master_style_stream, 2));

        DEBUGPRINT("# of indentation levels = " << levels);

        // TODO: Figure out what this this
        if (txtype >= 5)
            ReadStream(buffer, master_style_stream, 2);

        // Read each level
        for (uint16_t level = 0; level < levels; ++level)
        {
                DEBUGPRINT("Reading level " << level);
                ParSetting parsetting;
                bool first = !level && txtype < 5;
                if (!first)
                {
                        // Inherit values
                        switch (txtype)
                        {
                        case TYP_Title:
                        case TYP_Body:
                        case TYP_Notes:
                                parsetting = master_text_styles[txtype][level ? level-1 : 0];
                        break;
                        case TYP_CenterBody:
                                parsetting = master_text_styles[TYP_Body][level ? level-1 : 0];
                        break;
                        case TYP_CenterTitle:
                                parsetting = master_text_styles[TYP_Title][level ? level-1 : 0];
                        break;
                        case TYP_HalfBody:
                                parsetting = master_text_styles[TYP_Body][level ? level-1 : 0];
                        break;
                        case TYP_QuarterBody:
                                parsetting = master_text_styles[TYP_Body][level ? level-1 : 0];
                        break;
                        }
                }

                // First the paragraph properties
                DecodeParagraphProps(&parsetting, master_style_stream, first);

                // Now the character properties
                DecodeCharacterProps(&parsetting, master_style_stream);

                // And save it to the list
                master_text_styles[txtype].push_back(parsetting);
        }
}

void Powerpointfile::RenderText(ParSettings master_text_style, Escher::SchemeColors const *scheme_colors, Blex::RandomStream &text_style_stream, Blex::RandomStream &ruler_stream, Blex::RandomStream &ext_par_stream, Blex::RandomStream &master_ext_par_stream, Blex::UTF16String text, DrawLib::TextFormatter *textformatter, std::map<uint32_t, TextExtension> const &text_extensions, std::vector<std::pair<uint32_t, SpecialInfo> > const &special_infos)
{
        uint8_t buffer[8];
        std::vector< std::pair<uint32_t, ParSetting> > current_pars;
        bool is_first_line = true;

        // When there is a custom ruler, read it
        if (!ruler_stream.EndOfStream())
                DecodeRuler(&master_text_style, ruler_stream);

        // Do the extension only when there is a custom stream
        if (text_style_stream.EndOfStream())
        {
                bool par_initialized = false;
                ApplyTextFormattingText(master_text_style[0], text, textformatter, par_initialized, is_first_line, scheme_colors);
                return;
        }

        // Decode the master extended paragraph properties per indentation level
        ParSetting master_ext_par[5];
        if (!master_ext_par_stream.EndOfStream())
        {
                uint16_t max_levels = Blex::getu16lsb(ReadStream(buffer, master_ext_par_stream, 2));
                if (max_levels > 5)
                        throw std::runtime_error("Corrupt PowerPoint file, more than five levels exist");
                for (uint16_t level=0; level < max_levels; ++level)
                        DecodeMasterExtendedParagraphProps(&master_ext_par[level], master_ext_par_stream);
        }

        // Read all paragraph properties and cache them
        uint32_t position = 0;
        unsigned text_len = text.size();
        while (position <= text_len)
        {
                position += Blex::getu32lsb(ReadStream(buffer, text_style_stream, 4));
                uint16_t indentation = Blex::getu16lsb(ReadStream(buffer, text_style_stream, 2));

                // Create a new ParSetting, based upon the default settings
                ParSetting parsetting = master_text_style[indentation];

                // Add paragraph properties to this ParSetting
                DecodeParagraphProps(&parsetting, text_style_stream, false);

                // When there is an extended paragraph prop, read it (did never exist before Powerpoint 2000)
                if (!ext_par_stream.EndOfStream() && parsetting.bullet_flags & BULLET_ACTIVATED)
                        DecodeExtendedParagraphProps(&parsetting, ext_par_stream);

                // Combine the master extended paragraph info when necessary
                if (parsetting.bullet_instance == 0xFFFF)
                        parsetting.bullet_instance = master_ext_par[indentation].bullet_instance;
                if (parsetting.numbering_type == 0xFFFFFFFF)
                        parsetting.numbering_type = master_ext_par[indentation].numbering_type;
                if (parsetting.numbering_start == 0xFFFF)
                        parsetting.numbering_start = master_ext_par[indentation].numbering_start;

                // Store the enriched ParSetting
                current_pars.push_back(std::make_pair(position, parsetting));
        }

        // Save the last offset in the stream
        Blex::FileOffset stream_offset = text_style_stream.GetOffset();

        // Now loop through all paragraphs
        uint32_t switch_point = 0;
        uint32_t old_switch_point = 0;
        bool par_initialized = false;

        uint32_t char_position = 0;
        for (std::vector< std::pair<uint32_t, ParSetting> >::const_iterator par_it = current_pars.begin();
                par_it != current_pars.end(); ++par_it)
        {
                // Jump to the correct character property
                text_style_stream.SetOffset(stream_offset);

                // Get the length of this character property
                uint32_t current_length = Blex::getu32lsb(ReadStream(buffer, text_style_stream, 4));

                // Render all character properties within this paragraph
                while ((char_position+current_length) <= par_it->first)
                {
                        char_position += current_length;
                        switch_point = char_position;

                        // Get the base paragraph ParSetting
                        ParSetting parsetting = par_it->second;

                        // Get the text we are processing
                        Blex::UTF16String cur_text = ExtractUTF16Text(text, old_switch_point, switch_point-old_switch_point, text_extensions, special_infos);

                        // Start decoding the character properties, enriching the base parsetting
                        DecodeCharacterProps(&parsetting, text_style_stream);

                        // Apply the textformatting
                        ApplyTextFormattingText(parsetting, cur_text, textformatter, par_initialized, is_first_line, scheme_colors);

                        // When this is the end of the stream, quit
                        if (text_style_stream.EndOfStream())
                        {
                                current_length = 0;
                                break;
                        }

                        // Point to the correct stream_offset
                        stream_offset = text_style_stream.GetOffset();

                        // Get the length (when another one exists)
                        current_length = Blex::getu32lsb(ReadStream(buffer, text_style_stream, 4));

                        // Save switch points
                        old_switch_point = switch_point;
                }

                // Check if this character property runs over more than one paragraph
                if ((char_position+current_length) > par_it->first)
                {
                        // Determine the new switch_point
                        switch_point = par_it->first;

                        // Get the base paragraph ParSetting
                        ParSetting parsetting = par_it->second;

                        // Get the text we are processing
                        Blex::UTF16String cur_text = ExtractUTF16Text(text, old_switch_point, switch_point-old_switch_point, text_extensions, special_infos);

                        // Start decoding the character properties, enriching the base parsetting
                        DecodeCharacterProps(&parsetting, text_style_stream);

                        // Apply the textformatting
                        ApplyTextFormattingText(parsetting, cur_text, textformatter, par_initialized, is_first_line, scheme_colors);

                        // Save switch points
                        old_switch_point = switch_point;
                }
        }

}

void Powerpointfile::InitTextParagraph(ParSetting &parsetting, DrawLib::TextFormatter *textformatter, bool &is_first_line, Escher::SchemeColors const *scheme_colors)
{
        // Reset font settings
        textformatter->ResetFontSettings();
        textformatter->ResetParagraphSettings();

        // Set the alignment
        textformatter->SetAlignment(parsetting.alignment);

        // Set the linespacing
        if (parsetting.line_feed>0)
                textformatter->SetLineSpacingFactor(parsetting.line_feed/100.0);
        else if (parsetting.line_feed<0)
                textformatter->SetLineSpacingAbsolute(-parsetting.line_feed*point_to_pixel);
        else
            DEBUGPRINT("Skipping zero parsetting.line_feed");

        // Set the spacing before
        if (!is_first_line)
        {
                if (parsetting.space_before>0)
                        textformatter->SetSpacingBeforeFactor(parsetting.space_before/100.0);
                else
                        textformatter->SetSpacingBeforeAbsolute(-parsetting.space_before*point_to_pixel);
        }
        else
                is_first_line = false;

        // Set the spacing after
        if (parsetting.space_after>0)
                textformatter->SetSpacingAfterFactor(parsetting.space_after/100.0);
        else
                textformatter->SetSpacingAfterAbsolute(-parsetting.space_after*point_to_pixel);

        // Set the indentation (check the position of bullet_indent relative to indent)
        if (parsetting.bullet_indent > parsetting.indent)
        {
                textformatter->SetFirstLineIndent(parsetting.indent*point_to_pixel);
                textformatter->SetFirstLineTabStop(parsetting.bullet_indent*point_to_pixel);
                textformatter->SetLeftIndent(parsetting.indent*point_to_pixel);
        }
        else
        {
                textformatter->SetFirstLineIndent(parsetting.bullet_indent*point_to_pixel);
                textformatter->AddTabStop(parsetting.indent*point_to_pixel);
                textformatter->SetLeftIndent(parsetting.indent*point_to_pixel);
        }

        if(parsetting.default_tab*point_to_pixel>0)
            textformatter->SetDefaultTab(parsetting.default_tab*point_to_pixel);
        else
            DEBUGPRINT("Confused by tab settings: default_tab " << parsetting.default_tab);

        // Add all tab stops
        for (std::vector< std::pair<uint16_t,uint16_t> >::const_iterator it = parsetting.tab_entries.begin();
                it != parsetting.tab_entries.end(); ++it)
                textformatter->AddTabStop(it->second*point_to_pixel);

        // Output bullets
        if (parsetting.bullet_flags & BULLET_ACTIVATED)
        {
                textformatter->SetFontSize(DrawLib::FPSize(parsetting.size*float(parsetting.bullet_height)/100.0*font_scale, parsetting.size*float(parsetting.bullet_height)/100.0*font_scale));
                std::string bullet;
                if (parsetting.bullet_instance != 0xFFFF)
                {
                        if (graphical_bullet_blips.find(parsetting.bullet_instance) == graphical_bullet_blips.end())
                                throw std::runtime_error("Corrupt powerpoint file, graphical bullet blip not found");

                        Parsers::Office::Escher::msoBlip const *blip = graphical_bullet_blips[parsetting.bullet_instance]->GetBlip();
                        DrawLib::BitmapInterface *bitmap = blip->GetUnprocessedBitmap();
                        textformatter->AddBitmap(bitmap);
                }
                else
                {
                        int32_t bullet_number = parsetting.numbering_start++;
                        switch (parsetting.numbering_type)
                        {
                        case BULLET_TYPE_1: // a.
                                Blex::EncodeNumberAlpha(bullet_number,false,std::back_inserter(bullet));
                                bullet += ".";
                        break;
                        case BULLET_TYPE_2: // A.
                                Blex::EncodeNumberAlpha(bullet_number,true,std::back_inserter(bullet));
                                bullet += ".";
                        break;
                        case BULLET_TYPE_3: // 1)
                                bullet = Blex::AnyToString(bullet_number) + ")";
                        break;
                        case BULLET_TYPE_4: // 1.
                                bullet = Blex::AnyToString(bullet_number) + ".";
                        break;
                        case BULLET_TYPE_5: // i.
                                Blex::EncodeNumberRoman(bullet_number,false,std::back_inserter(bullet));
                                bullet += + ".";
                        break;
                        case BULLET_TYPE_6: // I.
                                Blex::EncodeNumberRoman(bullet_number,true,std::back_inserter(bullet));
                                bullet += + ".";
                        break;
                        case BULLET_TYPE_7: // a)
                                Blex::EncodeNumberAlpha(bullet_number,false,std::back_inserter(bullet));
                                bullet += ")";
                        break;
                        default:
                                Blex::UTF8Encoder<std::back_insert_iterator<std::string> > data_utf8_encoder(std::back_inserter(bullet));
                                data_utf8_encoder(parsetting.bullet_char);
                        break;
                        }
                }

                // Apparently the bullet_font is not used to render the bullet, so we use the normal font
                if (!parsetting.bullet_font)
                {
                        if (parsetting.font >= (uint16_t)fontnames.size())
                                throw std::runtime_error("Corrupt powerpoint file, font does not exist");
                        textformatter->SetFontFace(fontnames[parsetting.font]);
                }
                else
                {
                        if (parsetting.bullet_font >= (uint16_t)fontnames.size())
                                throw std::runtime_error("Corrupt powerpoint file, font does not exist");
                        textformatter->SetFontFace(fontnames[parsetting.bullet_font]);
                }
                textformatter->ParseText(&bullet[0], &bullet[bullet.size()]);
                textformatter->AddFixedTab(1);
        }

        ActivateFontSettings(parsetting, textformatter, scheme_colors);
}

void Powerpointfile::ActivateFontSettings(ParSetting parsetting, DrawLib::TextFormatter *textformatter, Escher::SchemeColors const *scheme_colors)
{
        // Apply settings defined in ParSetting
        textformatter->SetBold(parsetting.bold);
        textformatter->SetItalics(parsetting.italic);
        textformatter->SetUnderline(parsetting.underline);
        textformatter->SetShadow(parsetting.shadow);
        textformatter->SetEmboss(parsetting.relief);
        if (parsetting.font >= (uint16_t)fontnames.size())
                throw std::runtime_error("Corrupt powerpoint file, font does not exist");
        textformatter->SetFontFace(fontnames[parsetting.font]);
        textformatter->SetFontSize(DrawLib::FPSize(parsetting.size*font_scale, parsetting.size*font_scale));
        if (parsetting.scheme_color == 0xFE)
                textformatter->SetFontColor(parsetting.color);
        else
                textformatter->SetFontColor(scheme_colors->GetColor(parsetting.scheme_color));
        textformatter->SetOffset(parsetting.offset);

}

void Powerpointfile::ApplyTextFormattingText(ParSetting &parsetting, Blex::UTF16String text, DrawLib::TextFormatter *textformatter, bool &par_initialized, bool &is_first_line, Escher::SchemeColors const *scheme_colors)
{
        // Initialize it when necessary
        if (!par_initialized && text.size())
        {
                InitTextParagraph(parsetting, textformatter, is_first_line, scheme_colors);
                par_initialized = true;
        }
        else
                ActivateFontSettings(parsetting, textformatter, scheme_colors);

        // Render the text, split it up into paragraphs when necessary
        for (Blex::UTF16String::const_iterator it = text.begin();
                it != text.end(); ++it)
        {
                // When there is a newline, we start a new paragraph.
                if (*it == '\r')
                {
                        textformatter->EndParagraph();
                        par_initialized = false;
                }
                else
                {
                        // When not initialized, do this now, since we will render a character
                        if (!par_initialized)
                        {
                                InitTextParagraph(parsetting, textformatter, is_first_line, scheme_colors);
                                par_initialized = true;
                        }

                        // Check each character (symbols need a special font)
                        if (*it >= 0xF000 && *it < 0xF100)
                        {
                                // Setup the symbol font
                                if (parsetting.symbol >= (uint16_t)fontnames.size())
                                        throw std::runtime_error("Corrupt powerpoint file, font does not exist");
                                textformatter->SetFontFace(fontnames[parsetting.symbol]);

                                // Parse the symbol
                                textformatter->ParseText(*it - 0xF000);

                                // Reset the old font
                                if (parsetting.font >= (uint16_t)fontnames.size())
                                        throw std::runtime_error("Corrupt powerpoint file, font does not exist");
                                textformatter->SetFontFace(fontnames[parsetting.font]);
                        }
                        else
                                // Normal character
                                textformatter->ParseText(*it);
                }
        }
}

void Powerpointfile::DecodeParagraphProps(ParSetting *parsetting, Blex::RandomStream &style_stream, bool first)
{
        uint8_t buffer[8];
        uint32_t fields = Blex::getu32lsb(ReadStream(buffer, style_stream, 4));

        if (CheckField(fields, PAR_BULLET_FLAGS))
                parsetting->bullet_flags = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, PAR_BULLET_CHARACTER))
                parsetting->bullet_char = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, PAR_BULLET_FAMILY))
                parsetting->bullet_font = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, PAR_BULLET_SIZE))
                parsetting->bullet_height = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, PAR_BULLET_COLOR))
        {
                // FIXME: Add support for scheme colors
                ReadStream(buffer, style_stream, 4);
                parsetting->bullet_color = DrawLib::Pixel32(buffer[0], buffer[1], buffer[2]);
        }
        if (first ? CheckField(fields, 0x0F00) : CheckField(fields, PAR_ALIGNMENT))
                parsetting->alignment = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, PAR_LINE_FEED))
                parsetting->line_feed = Blex::gets16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, PAR_SPACING_ABOVE))
                parsetting->space_before = Blex::gets16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, PAR_SPACING_BELOW))
                parsetting->space_after = Blex::gets16lsb(ReadStream(buffer, style_stream, 2));

        // The first item is handled differently
        if (first)
        {
                if (CheckField(fields, PAR_TEXT_OFFSET))
                        parsetting->indent = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
                if (CheckField(fields, PAR_BULLET_OFFSET))
                        parsetting->bullet_indent = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
                if (CheckField(fields, PAR_DEFAULT_TAB))
                        parsetting->default_tab = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
                if (CheckField(fields, PAR_TABS))
                {
                        parsetting->tab_count = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
                        for (uint16_t i=0; i<parsetting->tab_count; ++i)
                                parsetting->tab_entries.push_back(
                                        std::make_pair(Blex::getu16lsb(ReadStream(buffer, style_stream, 2)),
                                                       Blex::getu16lsb(ReadStream(buffer, style_stream, 2))));
                }
                // TODO: What's this
                if (CheckField(fields, 0x40000))
                        ReadStream(buffer, style_stream, 2);
                if (CheckField(fields, PAR_ASIAN_LINE_BREAK))
                        parsetting->asian_line_break = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
                // TODO: What's this (bidi)
                if (CheckField(fields, PAR_BIDI))
                        ReadStream(buffer, style_stream, 2);
        }
        else
        {
                // TODO: What's this? (text_offset?)
                if (CheckField(fields, 0x8000))
                        ReadStream(buffer, style_stream, 2);
                if (CheckField(fields, PAR2_TEXT_OFFSET))
                        parsetting->indent = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
                // TODO: What's this
                if (CheckField(fields, 0x0200))
                        ReadStream(buffer, style_stream, 2);
                if (CheckField(fields, PAR2_BULLET_OFFSET))
                        parsetting->bullet_indent = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
                // TODO: What's this
                if (CheckField(fields, 0x00010000))
                        ReadStream(buffer, style_stream, 2);
                // TODO: What's this
                if (CheckField(fields, 0x000e0000))
                        ReadStream(buffer, style_stream, 2);
                if (CheckField(fields, PAR2_TABS))
                {
                        parsetting->tab_count = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
                        for (uint16_t i=0; i<parsetting->tab_count; ++i)
                                parsetting->tab_entries.push_back(
                                        std::make_pair(Blex::getu16lsb(ReadStream(buffer, style_stream, 2)),
                                                       Blex::getu16lsb(ReadStream(buffer, style_stream, 2))));
                }
                if (CheckField(fields, PAR2_BIDI))
                        ReadStream(buffer, style_stream, 2);
        }
}

void Powerpointfile::DecodeExtendedParagraphProps(ParSetting *parsetting, Blex::RandomStream &style_stream)
{
        uint8_t buffer[8];
        uint32_t fields = Blex::getu32lsb(ReadStream(buffer, style_stream, 4));

        if (CheckField(fields, EXT_PAR_BU_INSTANCE))
                 parsetting->bullet_instance = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, EXT_PAR_BU_NUMBERING_TYPE))
                 parsetting->numbering_type = Blex::getu32lsb(ReadStream(buffer, style_stream, 4));
        if (CheckField(fields, EXT_PAR_BU_START))
                 parsetting->numbering_start = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));

        // Read the last 8 bytes (contains no information apparently)
        ReadStream(buffer, style_stream, 8);
}

void Powerpointfile::DecodeMasterExtendedParagraphProps(ParSetting *parsetting, Blex::RandomStream &style_stream)
{
        uint8_t buffer[8];
        uint32_t fields = Blex::getu32lsb(ReadStream(buffer, style_stream, 4));

        if (CheckField(fields, EXT_PAR_BU_INSTANCE))
                 parsetting->bullet_instance = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, EXT_PAR_BU_NUMBERING_TYPE))
                 parsetting->numbering_type = Blex::getu32lsb(ReadStream(buffer, style_stream, 4));
        if (CheckField(fields, EXT_PAR_BU_START))
                 parsetting->numbering_start = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));

        // Read the last 4 bytes (contains no information apparently)
        ReadStream(buffer, style_stream, 4);
}

void Powerpointfile::DecodeCharacterProps(ParSetting *parsetting, Blex::RandomStream &style_stream)
{
        uint8_t buffer[8];
        uint32_t fields = Blex::getu32lsb(ReadStream(buffer, style_stream, 4));

        if (fields & FONT_FLAGS)
        {
                uint16_t text_fields = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));

                if (CheckField(fields, FONT_BOLD))
                        parsetting->bold = CheckField(text_fields, FONT_BOLD);
                if (CheckField(fields, FONT_UNDERLINE))
                        parsetting->underline = CheckField(text_fields, FONT_UNDERLINE);
                if (CheckField(fields, FONT_ITALIC))
                        parsetting->italic = CheckField(text_fields, FONT_ITALIC);
                if (CheckField(fields, FONT_SHADOW))
                        parsetting->shadow = CheckField(text_fields, FONT_SHADOW);
                if (CheckField(fields, FONT_RELIEF))
                        parsetting->relief = CheckField(text_fields, FONT_RELIEF);
        }
        if (CheckField(fields, FONT_FONT))
                parsetting->font = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, FONT_ASIAN_OR_COMPLEX))
                parsetting->asian_complex_font = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, FONT_UNKNOWN2))
                ReadStream(buffer, style_stream, 2);
        if (CheckField(fields, FONT_SYMBOL))
                parsetting->symbol = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, FONT_FONT_SIZE))
                parsetting->size = Blex::getu16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, FONT_COLOR))
        {
                ReadStream(buffer, style_stream, 4);
                parsetting->scheme_color = buffer[3];
                parsetting->color = DrawLib::Pixel32(buffer[0], buffer[1], buffer[2]);
        }
        if (CheckField(fields, FONT_OFFSET))
                parsetting->offset = Blex::gets16lsb(ReadStream(buffer, style_stream, 2));
        if (CheckField(fields, FONT_UNKNOWN1))
                ReadStream(buffer, style_stream, 2);
        if (CheckField(fields, FONT_UNKNOWN3))
                ReadStream(buffer, style_stream, 2);
        if (CheckField(fields, FONT_UNKNOWN4))
                ReadStream(buffer, style_stream, 2);
        if (CheckField(fields, FONT_UNKNOWN5))
                ReadStream(buffer, style_stream, 2);
        if (CheckField(fields, FONT_UNKNOWN6))
                ReadStream(buffer, style_stream, 2);
        if (CheckField(fields, FONT_UNKNOWN7))
                ReadStream(buffer, style_stream, 2);
        if (CheckField(fields, FONT_UNKNOWN8))
                ReadStream(buffer, style_stream, 2);
        if (CheckField(fields, FONT_UNKNOWN9))
                ReadStream(buffer, style_stream, 2);
        if (CheckField(fields, FONT_UNKNOWN10))
                ReadStream(buffer, style_stream, 2);
}

void Powerpointfile::DecodeSpecialInfoRun(std::vector<std::pair<uint32_t, SpecialInfo> > *special_info, Blex::RandomStream &special_info_stream)
{
        uint8_t buffer[8];
        uint32_t char_pos = 0;

        while (!special_info_stream.EndOfStream())
        {
                uint32_t char_len = Blex::getu32lsb(ReadStream(buffer, special_info_stream, 4));

                // Inherit the default special info
                SpecialInfo this_special_info = this->special_info;
                // And fill it in
                DecodeSpecialInfo(&this_special_info, special_info_stream);

                special_info->push_back(std::make_pair(char_pos, this_special_info));
                char_pos += char_len;
        }
}

void Powerpointfile::DecodeSpecialInfo(SpecialInfo *special_info, Blex::RandomStream &special_info_stream)
{
        uint8_t buffer[8];
        uint32_t fields = Blex::getu32lsb(ReadStream(buffer, special_info_stream, 4));

        // TODO: What's this
        if (CheckField(fields, SPECIAL_INFO_UNKNOWN1))
                ReadStream(buffer, special_info_stream, 2);
        if (CheckField(fields, SPECIAL_INFO_LANGUAGE))
                special_info->language = Blex::gets16lsb(ReadStream(buffer, special_info_stream, 2));
        // TODO: What's this
        if (CheckField(fields, SPECIAL_INFO_UNKNOWN2))
                ReadStream(buffer, special_info_stream, 2);

        if (fields)
                throw std::runtime_error("DecodeSpecialInfo found an unkown tag, investigate it");
}

void Powerpointfile::DecodeRuler(ParSettings *parsettings, Blex::RandomStream &ruler_stream)
{
        uint8_t buffer[8];
        uint32_t fields = Blex::getu32lsb(ReadStream(buffer, ruler_stream, 4));

        int32_t default_tab = -1;
        int32_t tab_count = -1;
        int32_t text_offsets[5] = {-1, -1, -1, -1, -1};
        int32_t bullet_offsets[5] = {-1, -1, -1, -1, -1};
        std::vector< std::pair<uint16_t, uint16_t> > tab_entries;

        // We have to override all existing levels
        if (CheckField(fields, RULER_DEFAULT_TAB))
                default_tab = Blex::getu16lsb(ReadStream(buffer, ruler_stream, 2));
        if (CheckField(fields, RULER_TAB_COUNT))
        {
                tab_count = Blex::getu16lsb(ReadStream(buffer, ruler_stream, 2));
                for (int32_t i=0; i<tab_count; ++i)
                        tab_entries.push_back(
                                std::make_pair(Blex::getu16lsb(ReadStream(buffer, ruler_stream, 2)),
                                               Blex::getu16lsb(ReadStream(buffer, ruler_stream, 2))));
        }
        for (unsigned i=0; i<5; ++i)
        {
                if (CheckField(fields, RULER_TEXT_OFFSET << i))
                        text_offsets[i] = Blex::getu16lsb(ReadStream(buffer, ruler_stream, 2));
                if (CheckField(fields, RULER_BULLET_OFFSET << i))
                        bullet_offsets[i] = Blex::getu16lsb(ReadStream(buffer, ruler_stream, 2));
        }

        // Now apply these settings to all levels
        unsigned level=0;
        for (ParSettings::iterator it = parsettings->begin();
                it != parsettings->end(); ++it, ++level)
        {
                if (default_tab != -1)
                        it->default_tab = (uint16_t)default_tab;
                if (tab_count != -1)
                {
                        it->tab_count = (uint16_t)tab_count;
                        it->tab_entries = tab_entries;
                }
                if (text_offsets[level]!=-1)
                        it->indent = (uint16_t)text_offsets[level];
                if (bullet_offsets[level]!=-1)
                        it->bullet_indent = (uint16_t)bullet_offsets[level];
        }
}

}

}

}
