#include <ap/libwebhare/allincludes.h>



///////////////////////////////////////////////////////////////////////////////
#include <blex/zstream.h>
#include <iostream>
#include <iomanip>

#include "internal.h"
#include "shapes.h"
#include "properties.h"

namespace Parsers {
namespace Office {
namespace Escher {

using Blex::getu8;
using Blex::getu16lsb;
using Blex::getu32lsb;
using Blex::gets32lsb;

void ShapeTypeToText(std::ostream &output, unsigned shapetype)
{
        output << "(";
        switch(shapetype)
        {
        case    0: output << "Not A Primitive"; break;

        case    1: output << "Rectangle"; break;
        case    2: output << "RoundRectangle"; break;
        case    3: output << "Ellipse"; break;
        case    4: output << "Diamond"; break;
        case    5: output << "IsocelesTriangle"; break;
        case    6: output << "RightTriangle"; break;
        case    7: output << "Parallelogram"; break;
        case    8: output << "Trapezoid"; break;
        case    9: output << "Hexagon"; break;
        case   10: output << "Octagon"; break;
        case   11: output << "Plus"; break;
        case   12: output << "Star"; break;
        case   13: output << "RightArrow"; break;
        case   14: output << "ThickArrow"; break;
        case   15: output << "HomePlate"; break;
        case   16: output << "Cube"; break;
        case   17: output << "Balloon"; break;
        case   18: output << "Seal"; break;
        case   19: output << "Arc"; break;
        case   20: output << "Line"; break;
        case   21: output << "Plaque"; break;
        case   22: output << "Can"; break;
        case   23: output << "Donut"; break;

        case   24: output << "TextSimple"; break;
        case   25: output << "TextOctagon"; break;
        case   26: output << "TextHexagon"; break;
        case   27: output << "TextCurve"; break;
        case   28: output << "TextWave"; break;
        case   29: output << "TextRing"; break;
        case   30: output << "TextOnCurve"; break;
        case   31: output << "TextOnRing"; break;

        case   32: output << "StraightConnector1"; break;
        case   33: output << "BentConnector2"; break;
        case   34: output << "BentConnector3"; break;
        case   35: output << "BentConnector4"; break;
        case   36: output << "BentConnector5"; break;
        case   37: output << "CurvedConnector2"; break;
        case   38: output << "CurvedConnector3"; break;
        case   39: output << "CurvedConnector4"; break;
        case   40: output << "CurvedConnector5"; break;

        case   41: output << "Callout1"; break;
        case   42: output << "Callout2"; break;
        case   43: output << "Callout3"; break;
        case   44: output << "AccentCallout1"; break;
        case   45: output << "AccentCallout2"; break;
        case   46: output << "AccentCallout3"; break;
        case   47: output << "BorderCallout1"; break;
        case   48: output << "BorderCallout2"; break;
        case   49: output << "BorderCallout3"; break;
        case   50: output << "AccentBorderCallout1"; break;
        case   51: output << "AccentBorderCallout2"; break;
        case   52: output << "AccentBorderCallout3"; break;

        case   53: output << "Ribbon"; break;
        case   54: output << "Ribbon2"; break;
        case   55: output << "Chevron"; break;
        case   56: output << "Pentagon"; break;
        case   57: output << "NoSmoking"; break;
        case   58: output << "Seal8"; break;
        case   59: output << "Seal16"; break;
        case   60: output << "Seal32"; break;
        case   61: output << "WedgeRectCallout"; break;
        case   62: output << "WedgeRRectCallout"; break;
        case   63: output << "WedgeEllipseCallout"; break;
        case   64: output << "Wave"; break;
        case   65: output << "FoldedCorner"; break;

        case   66: output << "LeftArrow"; break;
        case   67: output << "DownArrow"; break;
        case   68: output << "UpArrow"; break;

        case   69: output << "LeftRightArrow"; break;
        case   70: output << "UpDownArrow"; break;

        case   71: output << "IrregularSeal1"; break;
        case   72: output << "IrregularSeal2"; break;

        case   73: output << "LightningBolt"; break;
        case   74: output << "Heart"; break;
        case   75: output << "PictureFrame"; break;
        case   76: output << "QuadArrow"; break;

        case   77: output << "LeftArrowCallout"; break;
        case   78: output << "RightArrowCallout"; break;
        case   79: output << "UpArrowCallout"; break;
        case   80: output << "DownArrowCallout"; break;

        case   81: output << "LeftRightArrowCallout"; break;
        case   82: output << "UpDownArrowCallout"; break;

        case   83: output << "QuadArrowCallout"; break;


        case   84: output << "Bevel"; break;

        case   85: output << "LeftBracket"; break;
        case   86: output << "RightBracket"; break;

        case   87: output << "LeftBrace"; break;
        case   88: output << "RightBrace"; break;

        case   89: output << "LeftUpArrow"; break;
        case   90: output << "BentUpArrow"; break;
        case   91: output << "BentArrow"; break;

        case   92: output << "Seal24"; break;

        case   93: output << "StripedRightArrow"; break;
        case   94: output << "NotchedRightArrow"; break;
        case   95: output << "BlockArc"; break;
        case   96: output << "SmileyFace"; break;

        case   97: output << "VerticalScroll"; break;
        case   98: output << "HorizontalScroll"; break;

        case   99: output << "CircularArrow"; break;

        case  101: output << "UturnArrow"; break;

        case  102: output << "CurvedRightArrow"; break;
        case  103: output << "CurvedLeftArrow"; break;
        case  104: output << "CurvedUpArrow"; break;
        case  105: output << "CurvedDownArrow"; break;

        case  106: output << "CloudCallout"; break;

        case  107: output << "EllipseRibbon"; break;
        case  108: output << "EllipseRibbon2"; break;

        case  109: output << "FlowChartProcess"; break;
        case  110: output << "FlowChartDecision"; break;
        case  111: output << "FlowChartInputOutput"; break;
        case  112: output << "FlowChartPredefinedProcess"; break;
        case  113: output << "FlowChartInternalStorage"; break;
        case  114: output << "FlowChartDocument"; break;
        case  115: output << "FlowChartMultidocument"; break;
        case  116: output << "FlowChartTerminator"; break;
        case  117: output << "FlowChartPreparation"; break;
        case  118: output << "FlowChartManualInput"; break;
        case  119: output << "FlowChartManualOperation"; break;
        case  120: output << "FlowChartConnector"; break;
        case  121: output << "FlowChartPunchedCard"; break;
        case  122: output << "FlowChartPunchedTape"; break;
        case  123: output << "FlowChartSummingJunction"; break;
        case  124: output << "FlowChartOr"; break;
        case  125: output << "FlowChartCollate"; break;
        case  126: output << "FlowChartSort"; break;
        case  127: output << "FlowChartExtract"; break;
        case  128: output << "FlowChartMerge"; break;
        case  129: output << "FlowChartOfflineStorage"; break;
        case  130: output << "FlowChartOnlineStorage"; break;
        case  131: output << "FlowChartMagneticTape"; break;
        case  132: output << "FlowChartMagneticDisk"; break;
        case  133: output << "FlowChartMagneticDrum"; break;
        case  134: output << "FlowChartDisplay"; break;
        case  135: output << "FlowChartDelay"; break;
        case  176: output << "FlowChartAlternateProcess"; break;
        case  177: output << "FlowChartOffpageConnector"; break;

        case  178: output << "Callout90"; break;
        case  179: output << "AccentCallout90"; break;
        case  180: output << "BorderCallout90"; break;
        case  181: output << "AccentBorderCallout90"; break;

        case  182: output << "LeftRightUpArrow"; break;

        case  183: output << "Sun"; break;
        case  184: output << "Moon"; break;
        case  185: output << "BracketPair"; break;
        case  186: output << "BracePair"; break;
        case  187: output << "Seal4"; break;
        case  188: output << "DoubleWave"; break;

        case  189: output << "ActionButtonBlank"; break;
        case  190: output << "ActionButtonHome"; break;
        case  191: output << "ActionButtonHelp"; break;
        case  192: output << "ActionButtonInformation"; break;
        case  193: output << "ActionButtonForwardNext"; break;
        case  194: output << "ActionButtonBackPrevious"; break;
        case  195: output << "ActionButtonEnd"; break;
        case  196: output << "ActionButtonBeginning"; break;
        case  197: output << "ActionButtonReturn"; break;
        case  198: output << "ActionButtonDocument"; break;
        case  199: output << "ActionButtonSound"; break;
        case  200: output << "ActionButtonMovie"; break;

        case  202: output << "TextBox"; break;

        default:  output << "Unknown"; break;
        }
        output << ") ";
        /*
        NotchedCircularArrow = 100,

        TextPlainText = 136,
        TextStop = 137,
        TextTriangle = 138,
        TextTriangleInverted = 139,
        TextChevron = 140,
        TextChevronInverted = 141,
        TextRingInside = 142,
        TextRingOutside = 143,
        TextArchUpCurve = 144,
        TextArchDownCurve = 145,
        TextCircleCurve = 146,
        TextButtonCurve = 147,
        TextArchUpPour = 148,
        TextArchDownPour = 149,
        TextCirclePour = 150,
        TextButtonPour = 151,
        TextCurveUp = 152,
        TextCurveDown = 153,
        TextCascadeUp = 154,
        TextCascadeDown = 155,
        TextWave1 = 156,
        TextWave2 = 157,
        TextWave3 = 158,
        TextWave4 = 159,
        TextInflate = 160,
        TextDeflate = 161,
        TextInflateBottom = 162,
        TextDeflateBottom = 163,
        TextInflateTop = 164,
        TextDeflateTop = 165,
        TextDeflateInflate = 166,
        TextDeflateInflateDeflate = 167,
        TextFadeRight = 168,
        TextFadeLeft = 169,
        TextFadeUp = 170,
        TextFadeDown = 171,
        TextSlantUp = 172,
        TextSlantDown = 173,
        TextCanUp = 174,
        TextCanDown = 175,

        HostControl = 201,
        */
}

const char * BlipTypeName(Escher::BlipStoreEntry::BlipType b)
{
        switch(b)
        {
                case Escher::BlipStoreEntry::blipERROR:     return "error";
                case Escher::BlipStoreEntry::blipUNKNOWN:   return "unknown";
                case Escher::BlipStoreEntry::blipEMF:       return "EMF";
                case Escher::BlipStoreEntry::blipWMF:       return "WMF";
                case Escher::BlipStoreEntry::blipPICT:      return "PICT";
                case Escher::BlipStoreEntry::blipJPEG:      return "JPEG";
                case Escher::BlipStoreEntry::blipPNG:       return "PNG";
                case Escher::BlipStoreEntry::blipDIB:       return "DIB";
                default:            return "???";
        }
}

const char * BlipUsageName(Escher::BlipStoreEntry::BlipUsage u)
{
        switch(u)
        {
                case Escher::BlipStoreEntry::blipDefault: return "default";
                case Escher::BlipStoreEntry::blipTexture: return "texture";
                default:          return "???";
        }
}

std::string Indent(unsigned level)
{
        std::string s;
        for(unsigned i=0;i<level;++i)
            s += "  ";
        return s;
}

void DumpRawData(std::ostream &output, Blex::LimitedStream & limited_stream)
{
        unsigned length = (unsigned)limited_stream.GetFileLength();

        output << ' ' << std::hex;
        for (unsigned i=0;i<30 && i<length;++i)
        {
                uint8_t data;
                limited_stream.Read(&data, 1);
                output << std::setw(2) << int(data) << ' ';
        }
        output << std::dec << " (" << length << " bytes)";
}

//ADDME: The decoding here is just duplication of what we already have elsewhere, reintegrate it with the existing readers!
bool DumpEscherDataRecord(
        std::ostream &output,
        RecordData & record_data,
        Blex::RandomStream */*delay*/,
        int indent_level)
{
        switch (record_data.type)
        {
        //**** ADD NEW RECORD TYPES HERE ****

        case ESCHER_DGGCONTAINER: //F000
                output <<  Indent(indent_level) <<  "DrawingGroupContainer(0xF000)\n";
                break;

        case ESCHER_BSTORECONTAINER: //F001
                output <<  Indent(indent_level) <<  "BlipStore(F001)\n";
                break;

        case ESCHER_DGCONTAINER: //F002
                output <<  Indent(indent_level) <<  "DrawingContainer(0xF002)\n";
                break;

        case ESCHER_SPGRCONTAINER: //F003
                output <<  Indent(indent_level) <<  "ShapeGroupContainer(0xF003)\n";
                break;

        case ESCHER_SPCONTAINER: //F004
                output <<  Indent(indent_level) <<  "ShapeContainer(0xF004)\n";
                break;

        case ESCHER_SOLVERCONTAINER: //F005
                output <<  Indent(indent_level) <<  "msofbtSolverContainer(0xF005)\n";
                break;

        case ESCHER_DGG: //F006
                {

                output <<  Indent(indent_level) <<  "Drawinggroup";

                //length-16 should be dividable by 8!
                uint8_t data[16];
                if(record_data.data.Read(data, sizeof data)<sizeof data)
                {
                        output << "Undefined: length is too small\n";
                        break;
                }
                if(((record_data.data.GetFileLength()-16)%8)!=0)
                {
                        output << "Undefined: length is not dividable by 8\n";
                        break;
                }

                uint32_t maxspid       = Blex::getu32lsb(data);    //current maximum shape ID
                uint32_t shapes_saved  = Blex::getu32lsb(data+8);  //number of shapes saved
                uint32_t drawings_saved= Blex::getu32lsb(data+12); //number of drawings saved


                output << " maxspid="  << maxspid;
                output << " clusters=" << (record_data.data.GetFileLength()-16)/8 << ":";

                if(!(record_data.data.GetFileLength()-16)/8)
                {
                        output << "No clusters!";
                }
                else
                {
                        for(unsigned i=0;i<(record_data.data.GetFileLength()-16)/8;++i)
                        {
                                uint8_t subdata[8];
                                record_data.data.Read(subdata,8);
                                output << "(" << Blex::getu32lsb(subdata);
                                output << ',' << Blex::getu32lsb(subdata+4);
                                output << ')';
                        }
                }

                output << " shapes="   << shapes_saved;
                output << " drawings=" << drawings_saved << "\n";
                break;
                }

        case ESCHER_BLIP: //F007
                {
                output <<  Indent(indent_level) <<  "BlipStoreEntry(F007) ";

                if(record_data.data.GetFileLength()<36)
                {
                        output << "Undefined / Broken\n";
                        break;
                }

                uint8_t subdata[36];
                record_data.data.Read(subdata, 36);

                output << " Win32=" << BlipTypeName((Escher::BlipStoreEntry::BlipType)subdata[0]);
                output << " MacOS=" << BlipTypeName((Escher::BlipStoreEntry::BlipType)subdata[1]);

                //uint8_t uid[16];             //blip ID
                //memcpy(uid,data+2,sizeof(uid));

                output << " tag="      << getu16lsb(subdata+18);
                output << " size="     << getu32lsb(subdata+20);
                uint32_t refcount = getu32lsb(subdata+24);
                output << " refcount=" << refcount;
                output << " offset="   << getu32lsb(subdata+28);
                output << " usage="    << BlipUsageName((Escher::BlipStoreEntry::BlipUsage)subdata[32]);

                output << " Blipname=\"";

                if(record_data.data.GetFileLength() >= 36u+subdata[33])
                {
                        uint8_t name_data[256];
                        record_data.data.Read(name_data, subdata[33]);

                        for(int i=0;i < subdata[33]/2 ;++i)
                            output << getu16lsb(name_data+i*2);
                        output << "\"";
                }

                //if refcount is 0, we're not a real blip. don't try to interpret
                //delay streams or following data, because they are bogus!

                output << "\n";

                }
                break;

        case ESCHER_DG: //F008
                output <<  Indent(indent_level) <<  "msofbtDg(0xF008)\n";
                break;

        case ESCHER_SPGR: //F009
                output <<  Indent(indent_level) <<  "msofbtSpgr(0xF009) ";
                if(record_data.data.GetFileLength() >= 16)
                {
                        uint8_t subdata[16];
                        record_data.data.Read(subdata, 16);
                        float left   = Blex::getu32lsb(subdata +  0);
                        float top    = Blex::getu32lsb(subdata +  4);
                        float right  = Blex::getu32lsb(subdata +  8);
                        float bottom = Blex::getu32lsb(subdata + 12);
                        output << "RECT=[" << left << "," << top << " - " << right << "," << bottom <<"] height=" << (bottom-top) << " width=" << (right-left);
                        if (bottom!=top)
                           output << " aspect=" << ((right-left)/(bottom-top));
                }
                else
                {
                        output << "[Undefined / Broken!]";
                }
                output << "\n";
                break;

        case ESCHER_SP: //F00A
                {
                output <<  Indent(indent_level) <<  "msofbtSP";

                uint8_t subdata[8];

                if(record_data.data.Read(subdata,8)<8)
                {
                        output << " Undefined by too less data";
                        break;
                }

                unsigned spid       = Blex::getu32lsb(subdata);
                unsigned shapetype  = record_data.instance;
                bool     groupshape = subdata[4]&1;
                bool     child      = subdata[4]&2;
                bool     patriarch  = subdata[4]&4;
                bool     deleted    = subdata[4]&8;
                bool     ole        = subdata[4]&16;
                bool     fliph      = subdata[4]&64;
                bool     flipv      = subdata[4]&128;
                bool     connector  = subdata[5]&1;
                bool     haveanchor = subdata[5]&2;
                bool     background = subdata[5]&4;

                output << " spid=" << spid;

                output << " ShapeType=" << shapetype;
                ShapeTypeToText(output, shapetype);

                if(groupshape)
                    output << " GroupShape";
                if(child)
                    output << " Child";
                if(patriarch)
                    output << " Patriarch";
                if(deleted)
                    output << " Deleted";
                if(ole)
                    output << " OLE";
                if(fliph)
                    output << " H-flip";
                if(flipv)
                    output << " V-flip";
                if(connector)
                    output << " Connector";
                if(haveanchor)
                    output << " Haveanchor";
                if(background)
                    output << " Background";

                output << "\n";
                break;
                }

        case ESCHER_OPT: //F00B
                {
                std::string indent_string = Indent(indent_level);
                output << indent_string <<  "Shape properties(0xF00B)\n";

                Escher::Properties properties(NULL);
                properties.ProcessData(record_data.data);
                properties.Dump(indent_string, output);
                output << "\n";
                }
                break;

        case ESCHER_TEXTBOX: //F00C
                output <<  Indent(indent_level) <<  "msofbtTextbox(0xF00C)";
                output << "\n";
                break;

        case ESCHER_CLIENTTEXTBOX: //F00D
                output <<  Indent(indent_level) <<  "Escher_ClientTextBox(0xF00D)";
                DumpRawData(output, record_data.data);
                output << "\n";
                break;

        case ESCHER_ANCHOR: //F00E
                output <<  Indent(indent_level) <<  "msofbtAnchor(0xF00E)";
                output << "\n";
                break;

        case ESCHER_CHILDANCHOR: //F00F
                output <<  Indent(indent_level) <<  "msofbtChildAnchor(0xF00F) ";
                // data is a 64 bit RECT structure...
                if (record_data.data.GetFileLength()<16)
                {
                        output << "[Undefined / Broken!]\n";
                        break;
                }
                else
                {
                        uint8_t subdata[16];
                        record_data.data.Read(subdata, 16);

                        float left   = gets32lsb(subdata   );
                        float top    = gets32lsb(subdata+ 4);
                        float right  = gets32lsb(subdata+ 8);
                        float bottom = gets32lsb(subdata+12);
                        output << "RECT=[" << left << "," << top << " - " << right << "," << bottom <<"] height=" << (bottom-top) << " width=" << (right-left) ;
                        if (bottom!=top)
                           output << " aspect=" << ((right-left)/(bottom-top));
                        output << "\n";
                }
                break;

        case ESCHER_CLIENTANCHOR: //F010
                output <<  Indent(indent_level) <<  "ClientAnchorRecord(0xF010)";
                DumpRawData(output, record_data.data);
                output << "\n";
                break;

        case ESCHER_CLIENTDATA: //F011
                output <<  Indent(indent_level) <<  "ClientDataRecord(0xF011)";
                DumpRawData(output, record_data.data);
                output << "\n";
                break;

        case ESCHER_CONNECTORRULE: //F012
                output <<  Indent(indent_level) <<  "msofbtConnectorRule(0xF012)";
                output << "\n";
                break;

        case ESCHER_ALIGNRULE: //F013
                output <<  Indent(indent_level) <<  "msofbtAlignRule(0xF013)";
                output << "\n";
                break;

        case ESCHER_ARCRULE: //F014
                output <<  Indent(indent_level) <<  "msofbtArcRule(0xF014)";
                output << "\n";
                break;

        case ESCHER_CLIENTRULE: //F015
                output <<  Indent(indent_level) <<  "msofbtClientRule(0xF015)";
                output << "\n";
                break;

        case ESCHER_CLSID: //F016
                output <<  Indent(indent_level) <<  "msofbtCLSID(0xF016)";
                output << "\n";
                break;

        case ESCHER_CALLOUTRULE: //F017
                output <<  Indent(indent_level) <<  "msofbtCalloutRule(0xF017)";
                output << "\n";
                break;

        /*
        case 0xF01A:
        case 0xF01B:
        case 0xF01C:
        case 0xF01D:
        case 0xF01E:
        case 0xF01F:
                break;
        */

        /* All raw-data containing types should go here */
        case ESCHER_POSITIONINGDATA:
                output <<  Indent(indent_level) <<  "Positioning data (0xF122)";
                output << " " << std::hex << record_data.type << std::dec << " (";
                for(unsigned i=0;i<record_data.data.GetFileLength();++i)
                {
                        uint8_t subdata;
                        record_data.data.Read(&subdata,1);
                        if (i>0)
                           output << ",";
                        output << std::hex << (int)subdata << std::dec;
                }
                output << ")\n";
                break;

        /* And all unknown types go here */
        default:
                output <<  Indent(indent_level) <<  "UnimplementedEscher";
                output << " " << std::hex << record_data.type << std::dec << "\n";
                return false;
        }

        return true;
}

void DebugContainerReader(
        RecordData &record,
        Blex::RandomStream *delay,
        std::ostream *output,
        int indent_level)
{
        DumpEscherDataRecord(*output, record, delay, indent_level);

        // Is this recor a containe ?:
        if(record.version == 0xF)
        {
                ReadContainer(record.data, std::bind(&DebugContainerReader,
                        std::placeholders::_1, delay, output, indent_level + 1));
        }
}

void Properties::Dump(std::string indent_string, std::ostream &output) const
{
        bool first = true;

        for(PropertyMap::const_iterator ptr (properties.begin());
             ptr != properties.end();
             ++ptr)
        {
                if(ptr->second.is_default)
                        continue;

                output << indent_string;
                if(first)
                        output << '[';
                else
                        //comma-seperate all entries
                        // and each entry on a new line
                        output << ' ';

                int number_of_booleans_in_property = PropertyToText(output, ptr->first);
                output << ':';

                std::string hexValue = "0x";
                Blex::EncodeNumber(ptr->second.value, 16, std::back_inserter(hexValue));

                // Dealing with a property with multiple booleans?:
                if(number_of_booleans_in_property > 0) {
                   int mask_bit  = 0x10000 << (number_of_booleans_in_property-1);
                   int value_bit =     0x1 << (number_of_booleans_in_property-1);

                   output << "values(";
                   for(int i=0; i<number_of_booleans_in_property; i++) {
                        if(ptr->second.value & mask_bit) {
                                output << ((ptr->second.value & value_bit)?'T':'F');
                        } else
                                output << 'D';

                        if(i < number_of_booleans_in_property-1)
                                output << ',';

                        mask_bit  >>= 1;
                        value_bit >>= 1;
                   }
                   output << ' ' << '(' << hexValue << ')' << ')';

                } else {

                  switch(ptr->second.type)
                  {
                  case Property::Normal:
                          output << "normal(" << hexValue
                                 << " | " << (unsigned int)ptr->second.value
                                 << " | " << (int)ptr->second.value
                                 << " | " << ((double)(int)ptr->second.value/(double)65536) << ")";
                          break;
                  case Property::Blip:
                          output << "blip(" << hexValue << ")";
                          break;
                  case Property::Complex:
                          output << "complex(" << ptr->second.complex.size() << " bytes";

                          if(ptr->second.complex.size() < 100)
                          {
                                  output << ": ";

                                  for(unsigned i=0; i<ptr->second.complex.size()/2; i++)
                                  {
                                          output << ((uint32_t)(ptr->second.complex[2*i  ] +
                                                          (ptr->second.complex[2*i+1]<<8)));
                                          if(i < ptr->second.complex.size()/2-1)
                                                  output << ", ";
                                  }
                          }

                          output << ")";

                          break;
                  default:
                          output << "BROKEN"; //there shouldn't be any other types
                          break;
                  }
                }


                PropertyMap::const_iterator ptr2 = ptr;
                ++ptr2;
                if(ptr2 != properties.end())
                        output << ",\n";
                first = false;
        }
        output << " ]";
}

int Properties::PropertyToText(std::ostream &output, PropertyID id) const
{
        int number_of_booleans_in_property = 0;

        output << id << " ";
        switch(id)
        {
        // Transform
        case   rotation: output << "rotation"; break;
        // Protection
        case fLockRotation: output << "fLockRotation"; break;
        /*case fLockAspectRation: output << "fLockAspectRation"; break;
        case fLockPosition: output << "fLockPosition"; break;
        case fLockAgainstSelect: output << "fLockAgainstSelect"; break;
        case 12fLockCropping3: output << "fLockCropping"; break;
        case fLockVertices: output << "fLockVertices"; break;
        case fLockText: output << "fLockText"; break;
        case fLockAdjustHandles: output << "fLockAdjustHandles"; break;
        case fLockAgainstGrouping: output << "fLockAgainstGrouping"; break;*/
        case 127: output << "Protection Booleans"; number_of_booleans_in_property=9; break;

        // Text
        case lTxid: output << "lTxid"; break;
        case dxTextLeft: output << "dxTextLeft"; break;
        case dyTextTop: output << "dyTextTop"; break;
        case dxTextRight: output << "dxTextRight"; break;
        case dyTextBottom: output << "dyTextBottom"; break;
        case WrapText: output << "WrapText"; break;
        case scaleText: output << "scaleText"; break;
        case anchorText: output << "anchorText"; break;
        case txflTextFlow: output << "txflTextFlow"; break;
        case cdirFont: output << "cdirFont"; break;
        case hspNext: output << "hspNext"; break;
        case txdir: output << "txdir"; break;
        /*case 187: output << "fSelectText"; break;
        case 188: output << "fAutoTextMargin"; break;
        case 189: output << "fRotateText"; break;
        case 190: output << "fFitShapeToText"; break;
        case 191: output << "fFitTextToShape"; break;*/
        case 191: output << "Text Booleans"; number_of_booleans_in_property=5; break;

        // GeoText
        case gtextUNICODE: output << "gtextUNICODE"; break;
        case gtextRTF: output << "gtextRTF"; break;
        case gtextAlign: output << "gtextAlign"; break;
        case gtextSize: output << "gtextSize"; break;
        case gtextSpacing: output << "gtextSpacing"; break;
        case gtextFont: output << "gtextFont"; break;
        /*case 240: output << "gtextFReverseRows"; break;
        case 241: output << "fGtext"; break;
        case 242: output << "gtextFVertical"; break;
        case 243: output << "gtextFKern"; break;
        case 244: output << "gtextFTight"; break;
        case 245: output << "gtextFStretch"; break;
        case 246: output << "gtextFShrinkFit"; break;
        case 247: output << "gtextFBestFit"; break;
        case 248: output << "gtextFNormalize"; break;
        case 249: output << "gtextFDxMeasure"; break;
        case 250: output << "gtextFBold"; break;
        case 251: output << "gtextFItalic"; break;
        case 252: output << "gtextFUnderline"; break;
        case 253: output << "gtextFShadow"; break;
        case 254: output << "gtextFSmallcaps"; break;
        case 255: output << "gtextFStrikethrough"; break;*/
        case 255: output << "GeoText Booleans"; number_of_booleans_in_property=16; break;

        // Blip
        case cropFromTop: output << "cropFromTop"; break;
        case cropFromBottom: output << "cropFromBottom"; break;
        case cropFromLeft: output << "cropFromLeft"; break;
        case cropFromRight: output << "cropFromRight"; break;
        case pib: output << "pib"; break;
        case pibName: output << "pibName"; break;
        case pibFlags: output << "pibFlags"; break;
        case pictureTransparent: output << "pictureTransparent"; break;
        case pictureContrast: output << "pictureContrast"; break;
        case pictureBrightness: output << "pictureBrightness"; break;
        case pictureGamma: output << "pictureGamma"; break;
        case pictureId: output << "pictureId"; break;
        case pictureDblCrMod: output << "pictureDblCrMod"; break;
        case pictureFillCrMod: output << "pictureFillCrMod"; break;
        case pictureLineCrMod: output << "pictureLineCrMod"; break;
        case pibPrint: output << "pibPrint"; break;
        case pibPrintName: output << "pibPrintName"; break;
        case pibPrintFlags: output << "pibPrintFlags"; break;
        /*case 316: output << "fNoHitTestPicture"; break;
        case 317: output << "pictureGray"; break;
        case 318: output << "pictureBiLevel"; break;
        case 319: output << "pictureActive"; break;*/
        case 319: output << "Blip Booleans"; number_of_booleans_in_property=4; break;

        // Geometry
        case geoLeft: output << "geoLeft"; break;
        case geoTop: output << "geoTop"; break;
        case geoRight: output << "geoRight"; break;
        case geoBottom: output << "geoBottom"; break;
        case shapePath: output << "shapePath"; break;
        case pVertices: output << "pVertices"; break;
        case pSegmentInfo: output << "pSegmentInfo"; break;
        case adjustValue: output << "adjustValue"; break;
        case adjust2Value: output << "adjust2Value"; break;
        case adjust3Value: output << "adjust3Value"; break;
        case adjust4Value: output << "adjust4Value"; break;
        case adjust5Value: output << "adjust5Value"; break;
        case adjust6Value: output << "adjust6Value"; break;
        case adjust7Value: output << "adjust7Value"; break;
        case adjust8Value: output << "adjust8Value"; break;
        case adjust9Value: output << "adjust9Value"; break;
        case adjust10Value: output << "adjust10Value"; break;
        /*case 378: output << "fShadowOK"; break;
        case 379: output << "f3DOK"; break;
        case 380: output << "fLineOK"; break;
        case 381: output << "fGtextOK"; break;
        case 382: output << "fFillShadeShapeOK"; break;
        case 383: output << "fFillOK"; break;*/
        case 383: output << "Geometry Booleans"; number_of_booleans_in_property=6; break;

        // Fill Style
        case fillType: output << "fillType"; break;
        case fillColor: output << "fillColor"; break;
        case fillOpacity: output << "fillOpacity"; break;
        case fillBackColor: output << "fillBackColor"; break;
        case fillBackOpacity: output << "fillBackOpacity"; break;
        case fillCrMod: output << "fillCrMod"; break;
        case fillBlip: output << "fillBlip"; break;
        case fillBlipName: output << "fillBlipName"; break;
        case fillBlipFlags: output << "fillBlipFlags"; break;
        case fillWidth: output << "fillWidth"; break;
        case fillHeight: output << "fillHeight"; break;
        case fillAngle: output << "fillAngle"; break;
        case fillFocus: output << "fillFocus"; break;
        case fillToLeft: output << "fillToLeft"; break;
        case fillToTop: output << "fillToTop"; break;
        case fillToRight: output << "fillToRight"; break;
        case fillToBottom: output << "fillToBottom"; break;
        case fillRectLeft: output << "fillRectLeft"; break;
        case fillRectTop: output << "fillRectTop"; break;
        case fillRectRight: output << "fillRectRight"; break;
        case fillRectBottom: output << "fillRectBottom"; break;
        case fillDztype: output << "fillDztype"; break;
        case fillShadePreset: output << "fillShadePreset"; break;
        case fillShadeColors: output << "fillShadeColors"; break;
        case fillOriginX: output << "fillOriginX"; break;
        case fillOriginY: output << "fillOriginY"; break;
        case fillShapeOriginX: output << "fillShapeOriginX"; break;
        case fillShapeOriginY: output << "fillShapeOriginY"; break;
        case fillShadeType: output << "fillShadeType"; break;
        /*case 443: output << "fFilled"; break;
        case 444: output << "fHitTestFill"; break;
        case 445: output << "fillShape"; break;
        case 446: output << "fillUseRect"; break;
        case 447: output << "fNoFillHitTest"; break;*/
        case 447: output << "Fill Booleans"; number_of_booleans_in_property=5; break;

        // Line Style
        case lineColor: output << "lineColor"; break;         // colors are RBG values!
        case lineOpacity: output << "lineOpacity"; break;
        case lineBackColor: output << "lineBackColor"; break;
        case lineCrMod: output << "lineCrMod"; break;
        case lineType: output << "lineType"; break;
        case lineFillBlip: output << "lineFillBlip"; break;
        case lineFillBlipName: output << "lineFillBlipName"; break;
        case lineFillBlipFlags: output << "lineFillBlipFlags"; break;
        case lineFillWidth: output << "lineFillWidth"; break;
        case lineFillHeight: output << "lineFillHeight"; break;
        case lineFillDztype: output << "lineFillDztype"; break;
        case lineWidth: output << "lineWidth"; break;
        case lineMiterLimit: output << "lineMiterLimit"; break;
        case lineStyle: output << "lineStyle"; break;
        case lineDashing: output << "lineDashing"; break;
        case lineDashStyle: output << "lineDashStyle"; break;
        case lineStartArrowhead: output << "lineStartArrowhead"; break;
        case lineEndArrowhead: output << "lineEndArrowhead"; break;
        case lineStartArrowWidth: output << "lineStartArrowWidth"; break;
        case lineStartArrowLength: output << "lineStartArrowLength"; break;
        case lineEndArrowWidth: output << "lineEndArrowWidth"; break;
        case lineEndArrowLength: output << "lineEndArrowLength"; break;
        case lineJoinStyle: output << "lineJoinStyle"; break;
        case lineEndCapStyle: output << "lineEndCapStyle"; break;
        /*case 507: output << "fArrowheadsOK"; break;
        case 508: output << "fLine"; break;
        case 509: output << "fHitTestLine"; break;
        case 510: output << "lineFillShape"; break;
        case 511: output << "fNoLineDrawDash"; break;*/
        case 511: output << "Line Booleans"; number_of_booleans_in_property=5; break;

        // Shadow Style
        case shadowType: output << "shadowType"; break;
        case shadowColor: output << "shadowColor"; break;
        case shadowHighlight: output << "shadowHighlight"; break;
        case shadowCrMod: output << "shadowCrMod"; break;
        case shadowOpacity: output << "shadowOpacity"; break;
        case shadowOffsetX: output << "shadowOffsetX"; break;
        case shadowOffsetY: output << "shadowOffsetY"; break;
        case shadowSecondOffsetX: output << "shadowSecondOffsetX"; break;
        case shadowSecondOffsetY: output << "shadowSecondOffsetY"; break;
        case shadowScaleXToX: output << "shadowScaleXToX"; break;
        case shadowScaleYToX: output << "shadowScaleYToX"; break;
        case shadowScaleXToY: output << "shadowScaleXToY"; break;
        case shadowScaleYToY: output << "shadowScaleYToY"; break;
        case shadowPerspectiveX: output << "shadowPerspectiveX"; break;
        case shadowPerspectiveY: output << "shadowPerspectiveY"; break;
        case shadowWeight: output << "shadowWeight"; break;
        case shadowOriginX: output << "shadowOriginX"; break;
        case shadowOriginY: output << "shadowOriginY"; break;
        /*case 574: output << "fShadow"; break;
        case 575: output << "fshadowObscured"; break;*/
        case 575: output << "Shadow Booleans"; number_of_booleans_in_property=2; break;

        // Perspective Style
        case perspectiveType: output << "perspectiveType"; break;
        case perspectiveOffsetX: output << "perspectiveOffsetX"; break;
        case perspectiveOffsetY: output << "perspectiveOffsetY"; break;
        case perspectiveScaleXToX: output << "perspectiveScaleXToX"; break;
        case perspectiveScaleYToX: output << "perspectiveScaleYToX"; break;
        case perspectiveScaleXToY: output << "perspectiveScaleXToY"; break;
        case perspectiveScaleYToY: output << "perspectiveScaleYToY"; break;
        case perspectivePerspectiveX: output << "perspectivePerspectiveX"; break;
        case perspectivePerspectiveY: output << "perspectivePerspectiveY"; break;
        case perspectiveWeight: output << "perspectiveWeight"; break;
        case perspectiveOriginX: output << "perspectiveOriginX"; break;
        case perspectiveOriginY: output << "perspectiveOriginY"; break;
        /*case 639: output << "fPerspective"; break;*/
        case 639: output << "Perspective Booleans"; number_of_booleans_in_property=1; break;

        // 3D Object
        case c3DSpecularAmt: output << "c3DSpecularAmt"; break;
        case c3DDiffuseAmt: output << "c3DDiffuseAmt"; break;
        case c3DShininess: output << "c3DShininess"; break;
        case c3DEdgeThickness: output << "c3DEdgeThickness"; break;
        case c3DExtrudeForward: output << "c3DExtrudeForward"; break;
        case c3DExtrudeBackward: output << "c3DExtrudeBackward"; break;
        case c3DExtrudePlane: output << "c3DExtrudePlane"; break;
        case c3DExtrusionColor: output << "c3DExtrusionColor"; break;
        case c3DCrMod: output << "c3DCrMod"; break;
        /*case 700: output << "f3D"; break;
        case 701: output << "fc3DMetallic"; break;
        case 702: output << "fc3DUseExtrusionColor"; break;
        case 703: output << "fc3DLightFace"; break;*/
        case 703: output << "3D Object Booleans"; number_of_booleans_in_property=4; break;

        // 3D Style
        case c3DYRotationAngle: output << "c3DYRotationAngle"; break;
        case c3DXRotationAngle: output << "c3DXRotationAngle"; break;
        case c3DRotationAxisX: output << "c3DRotationAxisX"; break;
        case c3DRotationAxisY: output << "c3DRotationAxisY"; break;
        case c3DRotationAxisZ: output << "c3DRotationAxisZ"; break;
        case c3DRotationAngle: output << "c3DRotationAngle"; break;
        case c3DRotationCenterX: output << "c3DRotationCenterX"; break;
        case c3DRotationCenterY: output << "c3DRotationCenterY"; break;
        case c3DRotationCenterZ: output << "c3DRotationCenterZ"; break;
        case c3DRenderMode: output << "c3DRenderMode"; break;
        case c3DTolerance: output << "c3DTolerance"; break;
        case c3DXViewpoint: output << "c3DXViewpoint"; break;
        case c3DYViewpoint: output << "c3DYViewpoint"; break;
        case c3DZViewpoint: output << "c3DZViewpoint"; break;
        case c3DOriginX: output << "c3DOriginX"; break;
        case c3DOriginY: output << "c3DOriginY"; break;
        case c3DSkewAngle: output << "c3DSkewAngle"; break;
        case c3DSkewAmount: output << "c3DSkewAmount"; break;
        case c3DAmbientIntensity: output << "c3DAmbientIntensity"; break;
        case c3DKeyX: output << "c3DKeyX"; break;
        case c3DKeyY: output << "c3DKeyY"; break;
        case c3DKeyZ: output << "c3DKeyZ"; break;
        case c3DKeyIntensity: output << "c3DKeyIntensity"; break;
        case c3DFillX: output << "c3DFillX"; break;
        case c3DFillY: output << "c3DFillY"; break;
        case c3DFillZ: output << "c3DFillZ"; break;
        case c3DFillIntensity: output << "c3DFillIntensity"; break;
        /*case 763: output << "fc3DConstrainRotation"; break;
        case 764: output << "fc3DRotationCenterAuto"; break;
        case 765: output << "fc3DParallel"; break;
        case 766: output << "fc3DKeyHarsh"; break;
        case 767: output << "fc3DFillHarsh"; break;*/
        case 767: output << "3D Style Booleans"; number_of_booleans_in_property=5; break;

        // Shape
        case hspMaster: output << "hspMaster"; break;
        case cxstyle: output << "cxstyle"; break;
        case bWMode: output << "bWMode"; break;
        case bWModePureBW: output << "bWModePureBW"; break;
        case bWModeBW: output << "bWModeBW"; break;
        /*case 826: output << "fOleIcon"; break;
        case 827: output << "fPreferRelativeResize"; break;
        case 828: output << "fLockShapeType"; break;
        case 830: output << "fDeleteAttachedObject"; break;
        case 831: output << "fBackground"; break;*/
        case 831: output << "Shape Booleans"; number_of_booleans_in_property=5; break;

        // Callout
        case spcot: output << "spcot"; break;
        case dxyCalloutGap: output << "dxyCalloutGap"; break;
        case spcoa: output << "spcoa"; break;
        case spcod: output << "spcod"; break;
        case dxyCalloutDropSpecified: output << "dxyCalloutDropSpecified"; break;
        case dxyCalloutLengthSpecified: output << "dxyCalloutLengthSpecified"; break;
        /*case 889: output << "fCallout"; break;
        case 890: output << "fCalloutAccentBar"; break;
        case 891: output << "fCalloutTextBorder"; break;
        case 892: output << "fCalloutMinusX"; break;
        case 893: output << "fCalloutMinusY"; break;
        case 894: output << "fCalloutDropAuto"; break;
        case 895: output << "fCalloutLengthSpecified"; break;*/
        case 895: output << "Callout Booleans"; number_of_booleans_in_property=7; break;

        // Group Shape
        case wzName: output << "wzName"; break;
        case wzDescription: output << "wzDescription"; break;
        case pihlShape: output << "pihlShape"; break;
        case pWrapPolygonVertices: output << "pWrapPolygonVertices"; break;
        case dxWrapDistLeft: output << "dxWrapDistLeft"; break;
        case dyWrapDistTop: output << "dyWrapDistTop"; break;
        case dxWrapDistRight: output << "dxWrapDistRight"; break;
        case dyWrapDistBottom: output << "dyWrapDistBottom"; break;
        case lidRegroup: output << "lidRegroup"; break;
        /*case 953: output << "fEditedWrap"; break;
        case 954: output << "fBehindDocument"; break;
        case 955: output << "fOnDblClickNotify"; break;
        case 956: output << "fIsButton"; break;
        case 957: output << "fOneD"; break;
        case 958: output << "fHidden"; break;
        case 959: output << "fPrint"; break;*/
        case 959: output << "Group Shape Booleans"; number_of_booleans_in_property=7; break;
        default:
                output << "UNKNOWN";
                break;
        }

        return number_of_booleans_in_property;
}

void msoBlipVector::DumpVectorData(std::ostream &output, unsigned level) const
{
        for (unsigned i=0;i<level;++i)
            output << "  ";

        output //<< "len= " << datastream->GetFileLength()
             << " compress=" << compression << ',' << filter
             << " cachesize=" << cachesize << " bounds="
             << boundsleft << ',' << boundstop << ',' << boundsright
             << ',' << boundsbottom
             << " size=" << sizeh
             << '(' << ((sizeh*4)/(3*12700)) << ')'
             << ',' << sizev
             << '(' << ((sizev*4)/(3*12700)) << ')';
}

void msoBlipEMF::Dump(std::ostream &output, unsigned level) const
{
        for (unsigned i=0;i<level;++i)
            output << "  ";

        output << "BLIP EMF\n";
        DumpVectorData(output,level);
        output << "\n";
}

void msoBlipWMF::Dump(std::ostream &output, unsigned level) const
{
        for (unsigned i=0;i<level;++i)
            output << "  ";

        output << "BLIP WMF\n";
        DumpVectorData(output,level+1);
        output << "\n";
}

void msoBlipPICT::Dump(std::ostream &output, unsigned level) const
{
        for (unsigned i=0;i<level;++i)
            output << "  ";

        output << "BLIP PICT\n";
        DumpVectorData(output,level+1);
        output << "\n";
}

void msoBlipJPEG::Dump(std::ostream &output, unsigned level) const
{
        for (unsigned i=0;i<level;++i)
            output << "  ";

        output << "BLIP JPEG\n";
}
void msoBlipPNG::Dump(std::ostream &output, unsigned level) const
{
        for (unsigned i=0;i<level;++i)
            output << "  ";

        output << "BLIP PNG\n";
}
void msoBlipDIB::Dump(std::ostream &output, unsigned level) const
{
        for (unsigned i=0;i<level;++i)
            output << "  ";
        output << "BLIP DIB\n";
}

} //end namespace Escher
} //end namespace Office
} //end namespace Parsers


