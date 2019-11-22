#include <ap/libwebhare/allincludes.h>

#include <sstream>
#include "properties.h"
#include "shapes.h"
#include "internal.h"

///////////////////////////////////////////////////////////////////////////////

namespace Parsers {
namespace Office {
namespace Escher {

// Note: This table is a duplicate of the palette table in word.cpp,
// in the 'publishing' project.
// ADDME: Cleanup.  FIXME These are probably not quite correct!
const DrawLib::Pixel32 windows_palette[16] = {
        DrawLib::Pixel32(  0,  0,  0,255), //black
        DrawLib::Pixel32(  0,  0,255,255), //blue
        DrawLib::Pixel32(  0,255,255,255), //turquoise
        DrawLib::Pixel32(  0,255,  0,255), //bright green
        DrawLib::Pixel32(255,  0,255,255), //pink
        DrawLib::Pixel32(255,  0,  0,255), //red
        DrawLib::Pixel32(255,255,  0,255), //yellow
        DrawLib::Pixel32(255,255,255,255), //white
        DrawLib::Pixel32(  0,  0,132,255), //dark blue
        DrawLib::Pixel32(  0,130,132,255), //teal
        DrawLib::Pixel32(  0,130,  0,255), //green
        DrawLib::Pixel32(132,  0,132,255), //violet
        DrawLib::Pixel32(132,  0,  0,255), //darkred
        DrawLib::Pixel32(132,130,  0,255), //darkyellow
        DrawLib::Pixel32(132,130,132,255), //darkgray
        DrawLib::Pixel32(198,195,198,255), //lightgray
};

///////////////////////////////////////////////////////////////////////////////
// First here the implementation of some member functions of some
// property soecific classes follow:

uint16_t RawDataReader::ReadU16()
{
        if(data.size() < index+2)
                throw std::runtime_error("RawDataReader::ReadU16 Reading after and of data.");

        uint16_t val = Blex::getu16lsb(&data[index]);
        index += 2;
        return val;
}

float RawDataReader::Read16_16()
{
        uint32_t u32 = ReadU32();
        return u32/(float)(1<<16);
}

uint32_t RawDataReader::ReadU32()
{
        if(data.size() < index+4)
                throw std::runtime_error("RawDataReader::Read16_16 Reading after and of data.");

        uint32_t val = Blex::getu32lsb(&data[index]);
        index += 4;
        return val;
}

DrawLib::Pixel32 RawDataReader::ReadColor()
{
        if(data.size() < index+4)
                throw std::runtime_error("RawDataReader::ReadColor Reading after and of data.");

        uint8_t r = data[index++];
        uint8_t g = data[index++];
        uint8_t b = data[index++];
        index++; // fourth byte is ignored and expected to be 0
        return DrawLib::Pixel32(r, g, b);
}

IMsoColorsArray::IMsoColorsArray(std::vector<uint8_t> const &data)
{
        RawDataReader reader(data);

        length   = reader.ReadU16();
        if(length == 0)
                throw std::runtime_error("IMsoColorsArray::IMsoColorsArray No points found.");

        unknown1 = reader.ReadU16();
        unknown2 = reader.ReadU16();

        float last_position = -1.0;

        for(unsigned i = 0; i<length; i++)
        {
                ColorAndPosition cap(reader);
                color_and_positions.push_back(cap);

                // Also check each position is strictly greater than the previous one:
                if(cap.position <= last_position)
                        throw std::runtime_error("IMsoColorsArray::IMsoColorsArray Pointpositions not stickly ascending.");

                last_position = cap.position;
        }
}

IMsoColorsArray::ColorAndPosition::ColorAndPosition(RawDataReader &reader)
{
        color    = reader.ReadColor();
        position = reader.Read16_16();
}

DrawLib::Pixel32 IMsoColorsArray::GetShadedColor(float i) const
{
        // Position before position of the first point ?:
        if(i < color_and_positions[0].position)
                return color_and_positions[0].color;

        // Position after position of the last point ?:
        if(i >= color_and_positions[color_and_positions.size()-1].position)
                return color_and_positions[color_and_positions.size()-1].color;

        // Find out between which points the given position is:
        uint32_t p_i = 1;
        for(;p_i < color_and_positions.size(); p_i++)
                if(color_and_positions[p_i].position > i)
                        break;

        // Now get the data of the two:
        DrawLib::Pixel32 color1 = color_and_positions[p_i - 1].color;
        DrawLib::Pixel32 color2 = color_and_positions[p_i    ].color;
        float position1         = color_and_positions[p_i - 1].position;
        float position2         = color_and_positions[p_i    ].position;

        // Get the position relative between those two points:
        i = (i - position1) / (position2-position1);
        float i_n = 1.0 - i;

        // Now get the final color:
        uint8_t r = (uint8_t)(i_n*color1.GetR() + i*color2.GetR());
        uint8_t g = (uint8_t)(i_n*color1.GetG() + i*color2.GetG());
        uint8_t b = (uint8_t)(i_n*color1.GetB() + i*color2.GetB());
        return DrawLib::Pixel32(r, g, b);
}

IMsoVerticesArray::IMsoVerticesArray(std::vector<uint8_t> const &data)
{
        RawDataReader reader(data);

        while(reader.GetBytesLeft() >= 4)
        {
                DrawLib::FPPoint p;
                p.x = (float)reader.ReadU16();
                p.y = (float)reader.ReadU16();
                vertices.push_back(p);
        }
}

void IMsoVerticesArray::MakeRelativeToBox(
        float left, float top, float right, float bottom)
{
        float width  = right - left;
        float height = bottom - top;

        // get the points relative to the form size from the center,
        // so in ([-1.0, 1.0], [-1.0, 1.0]):
        std::vector<DrawLib::FPPoint>::iterator vertice_itr = vertices.begin();
        while(vertice_itr != vertices.end())
        {
                vertice_itr->x = 2.0*((vertice_itr->x - left)/width ) - 1.0;
                vertice_itr->y = 2.0*((vertice_itr->y - top )/height) - 1.0;

                ++vertice_itr;
        }
}

IMsoArray::IMsoArray(std::vector<uint8_t> const &data)
{
        RawDataReader reader(data);

        while(reader.GetBytesLeft() >= 4)
        {
                DrawLib::IPoint p;
                p.x = reader.ReadU16();
                p.y = reader.ReadU16();
                points.push_back(p);
        }
}

////////////////////////////////////////////////////////////////////////////////////////////




/**
 * Contains the data for the use of boolean properties and
 * their hardcoded defaults.
 */
struct Properties::ShapeContainerBooleanPropertySetData
{
        PropertyID startPID;
        PropertyID endPID;

        uint16_t hardcoded_defaults;

// Correction on documentation here: fillShape (445, "register pattern on shape") false by default
} static const property_sets_booleans[NUM_PROPERTY_SETS] = {
        {Properties::fLockRotation        , Properties::fLockAgainstGrouping   , 0x001C}, // Protection
        {Properties::fSelectText          , Properties::fFitTextToShape        , 0x0010}, // Text
        {Properties::gtextFReverseRows    , Properties::gtextFStrikethrough    , 0x0000}, // GeoText
        {Properties::fNoHitTestPicture    , Properties::pictureActive          , 0x0000}, // Blip
        {Properties::fShadowOK            , Properties::fFillOK                , 0x0039}, // Geometry
        {Properties::fFilled              , Properties::fNoFillHitTest         , 0x001C}, // Fill Style
        {Properties::fArrowheadsOK        , Properties::fNoLineDrawDash        , 0x000E}, // Line Style
        {Properties::fShadow              , Properties::fshadowObscured        , 0x0000}, // Shadow Style
        {Properties::fPerspective         , Properties::fPerspective           , 0x0000}, // Perspective Style
        {Properties::f3D                  , Properties::fc3DLightFace          , 0x0001}, // 3D Object
        {Properties::fc3DConstrainRotation, Properties::fc3DFillHarsh          , 0x001C}, // 3D Style
        {Properties::fDeleteAttachedObject, Properties::fBackground            , 0x0000}, // Shape
        {Properties::fCallout             , Properties::fCalloutLengthSpecified, 0x0010}, // Callout
        {Properties::fEditedWrap          , Properties::fPrint                 , 0x0000}, // Group Shape
};


// Constructor creating a properties object containing pure default properties.
Properties::Properties(EscherDocument const* _document)
: document(_document)
{
        // Takeover the default property values for the boolean properties
        // (per property set):
        for(unsigned u=0; u<NUM_PROPERTY_SETS; u++)
                boolean_property_set_values[u] = property_sets_booleans[u].hardcoded_defaults;

        //////////////////////
        // Set the hardcoded default property values here:

        // Text:
        InsertNormalDefault(dxTextLeft     , 95250);
        InsertNormalDefault(dyTextTop      , 47625);
        InsertNormalDefault(dxTextRight    , 95250);
        InsertNormalDefault(dyTextBottom   , 47625);

        // Blip:
        InsertNormalDefault(cropFromTop    , 0);
        InsertNormalDefault(cropFromBottom , 0);
        InsertNormalDefault(cropFromRight  , 0);
        InsertNormalDefault(cropFromLeft   , 0);

        // Geometry:
        InsertNormalDefault(geoLeft        , 0);
        InsertNormalDefault(geoTop         , 0);
        InsertNormalDefault(geoRight       , 21600);
        InsertNormalDefault(geoBottom      , 21600);

        // Fill style:
        InsertNormalDefault(fillType       , (MSOFILLTYPE)msofillSolid);
        InsertNormalDefault(fillColor      , 0x00FFFFFF);
        InsertNormalDefault(fillOpacity    , 1<<16);
        InsertNormalDefault(fillBackColor  , 0x00FFFFFF);
        InsertNormalDefault(fillBackOpacity, 1<<16);
        InsertNormalDefault(fillShadeType  , 0x40000003);

        // Line style:
        InsertNormalDefault(lineColor      , 0x00000000);
        InsertNormalDefault(lineBackColor  , 0x00FFFFFF);
        InsertNormalDefault(lineType       , (MSOLINETYPE)msolineSolidType);
        InsertNormalDefault(lineWidth      , 9525);
        InsertNormalDefault(lineDashing    , 0/*solid*/);

        InsertNormalDefault(lineMiterLimit , 8<<16);

        InsertNormalDefault(lineStartArrowhead   , (MSOLINEEND)msolineNoEnd);
        InsertNormalDefault(lineEndArrowhead     , (MSOLINEEND)msolineNoEnd);
        InsertNormalDefault(lineStartArrowWidth  , (MSOLINEENDWIDTH)msolineMediumWidthArrow);
        InsertNormalDefault(lineStartArrowLength , (MSOLINEENDLENGTH)msolineMediumLenArrow);
        InsertNormalDefault(lineEndArrowWidth    , (MSOLINEENDWIDTH)msolineMediumWidthArrow);
        InsertNormalDefault(lineEndArrowLength   , (MSOLINEENDLENGTH)msolineMediumLenArrow);

        InsertNormalDefault(lineJoinStyle        , (MSOLINEJOIN)msolineJoinRound);
        InsertNormalDefault(lineEndCapStyle      , (MSOLINECAP)msolineEndCapFlat);
}

Properties::~Properties()
{
}

void Properties::ProcessData(Blex::RandomStream &props)
{
        /* reading properties is tricky: first we get all the properties, and
           then complex data. complex data is associated with complex properties.
           we don't know how many properties we'll get, so we'll just try to
           guess by counting how much data we already head */

        ///This property (of 'second' length bytes) will still have to appear
        typedef std::pair<PropertyID,unsigned> DelayedProperty;
        ///Current read location
        unsigned readptr=0;
        ///Current size of complex data
        unsigned complexsize=0;
        ///Complex properties still expected
        std::vector<DelayedProperty> delays;
        //Property data
        std::vector<uint8_t> data;
        ReadStreamIntoVector(props,&data);

        for (;readptr+6+complexsize<=data.size();readptr += 6) //read the proprs
        {
                Property newprop;
                newprop.value = Blex::getu32lsb(&data[readptr + 2]);
                PropertyID propid = static_cast<Properties::PropertyID>
                        (Blex::getu16lsb(&data[readptr])&0x3FFF);

                if (data[readptr + 1]&0x80) //complex property
                {
                        //This property is delayed, so cache it..
                        delays.push_back( DelayedProperty(propid, newprop.value) );
                        complexsize += newprop.value;

                        newprop.type = Property::Complex;
                }
                else
                {
                        newprop.type = data[readptr + 1]&0x40 ? Property::Blip : Property::Normal;
                }
                properties[propid] = newprop;
        }

        //handle delayed props
        for (std::vector<DelayedProperty>::iterator prop = delays.begin(); prop != delays.end(); ++prop)
        {
                unsigned tocopy = std::min<unsigned>(prop->second,data.size()-readptr);
                if (tocopy != prop->second)
                    DEBUGPRINT("Truncated complex Escher property " << prop->first);

                properties[prop->first].complex.assign(&data[readptr],&data[readptr+tocopy]);
                readptr+=tocopy;
        }

        if (readptr != data.size())
            DEBUGPRINT("Spare bytes after Escher properties: " << (data.size()-readptr));

        // Now start reading properties from the master (identified by hspMaster, optionally)
        int32_t master_shape_id = Get(hspMaster, NULL);
        if (master_shape_id && document)
        {
                ShapeContainer const *root_shape = document->FindShape(master_shape_id);
                if (root_shape)
                        for (PropertyMap::const_iterator it = root_shape->GetProperties().GetProperties().begin();
                             it != root_shape->GetProperties().GetProperties().end(); ++it)
                             {
                                if (properties.find(it->first)!=properties.end() && properties[it->first].is_default)
                                        properties[it->first] = it->second;
                             }
        }

//        EvaluateColors  ();
        EvaluateBooleans();
}


Properties::Property const * Properties::GetAsProperty(PropertyID PID) const
{
        // Now try to find the property in the 'ShapeProperties' record, which should
        // contain the default properties:
        PropertyMap::const_iterator i = properties.find(PID);
        if(i == properties.end())
        {
                return NULL;
        }

        return &i->second;
}

uint32_t Properties::Get(PropertyID PID, bool *is_default_value) const
{
        Property const *property = GetAsProperty(PID);

        if(!property)
        {
                if(is_default_value) *is_default_value = true;
                return 0;
        }

        if(is_default_value) *is_default_value = false;
        return property->value;
}

float Properties::GetAsPixelsFromEMUs(PropertyID PID, float defaultvalue) const
{
        Property const *property = GetAsProperty(PID);

        if(!property)
            return defaultvalue;

        return (static_cast<float>(property->value)/12700.0) / 0.75;
}

float Properties::GetAsFloatFrom16_16(PropertyID PID, float defaultvalue) const
{
        Property const *property = GetAsProperty(PID);

        if(!property)
            return defaultvalue;

        return (int32_t)property->value / (float)(1<<16);
}

std::vector<uint8_t> Properties::GetComplex(PropertyID PID) const
{
        Property const *property = GetAsProperty(PID);

        if(!property)
            return std::vector<uint8_t>();

        return property->complex;
}

void Properties::EvaluateBooleans()
{
        ShapeContainerBooleanPropertySetData const *property_sets_booleans_ptr = property_sets_booleans;

        // Read the root shape (to inherit non-set values)
        ShapeContainer const *root_shape = NULL;
        int32_t master_shape_id = Get(hspMaster, NULL);
        if (master_shape_id && document)
                root_shape = document->FindShape(master_shape_id);

        // Iterate all property sets:
        for(unsigned i=0; i<NUM_PROPERTY_SETS; i++)
        {
                uint32_t value = Get(property_sets_booleans_ptr->endPID);
                uint16_t mask =       uint16_t(value >> 16   );
                uint16_t new_values = uint16_t(value & 0xFFFF);

                // When we have a master shape to inherit from, initialize values that
                // are not set here but are defined there
                if (root_shape)
                {
                        uint32_t root_value = root_shape->GetProperties().Get(property_sets_booleans_ptr->endPID);
                        uint16_t root_mask =       uint16_t(root_value >> 16   );
                        uint16_t root_new_values = uint16_t(root_value & 0xFFFF);

                        mask |= root_mask;
                        new_values |= mask & root_new_values;
                }

                // What bits are overridden here ?:
                boolean_property_set_set[i] = mask;

                // Reset all bits that should get their value overwritten:
                boolean_property_set_values[i] &= (uint16_t)(~mask);

                // Overwrite (set which are 1) all new bits:
                boolean_property_set_values[i] |= new_values;

                property_sets_booleans_ptr++;
        }
}

bool Properties::GetAsBoolean(PropertyID PID, bool *is_default_value) const
{
        ShapeContainerBooleanPropertySetData const *property_sets_booleans_ptr = property_sets_booleans;

        // Iterate all property sets:
        for(int i=0; i<NUM_PROPERTY_SETS; i++)
        {
                // Requested property in the current set ?:
                if(PID >= property_sets_booleans_ptr->startPID &&
                   PID <= property_sets_booleans_ptr->endPID)
                {
                        // First get all boolean properties (in 1 property) of this set:
                        //uint32_t value = GetProperty(property_sets_booleans_ptr->endPID, document);
                        uint32_t value = boolean_property_set_values[i];
                        uint32_t index = property_sets_booleans_ptr->endPID-PID;

                        if(is_default_value != NULL)
                        {
                                *is_default_value =
                                        ((boolean_property_set_set[i] & (1<<index)) == 0);
                        }

                        return (value & (1<<index)) > 0;
                }

                property_sets_booleans_ptr++;
        }

        throw std::runtime_error("Properties::GetBoolean: Property with given id is not a boolean property.");
}

DrawLib::Pixel32 Properties::GetColor(PropertyID pid, SchemeColors const *scheme_colors) const
{
        assert(pid==fillColor || pid==fillBackColor || pid==lineColor || pid==lineBackColor || pid==shadowColor);
        uint32_t value = Get(pid);

        // The new to find / evaluate color:
        DrawLib::Pixel32 color;

        uint8_t color_index = (uint8_t)(value >> 24);

        // Is it just a normal RGB colorref or a system RGB ?:
        if(color_index == 0x00 || color_index == (1<<msocolorFlagSystemRGB))
        {
                color = DrawLib::Pixel32((uint8_t)(value&0xff), (uint8_t)((value>>8)&0xff), (uint8_t)((value>>16)&0xff));
        }

        // Is the color a palette index ?:
        else if(color_index == (1<<msocolorFlagPaletteIndex))
        {
                uint32_t index = value & 0x00FFFFFF;

                if(color_index > 16)
                {
                        std::ostringstream str;
                        str << "Properties::EvaluateColors: Palette index out of bounds: ";
                        str << std::hex << index;
                        throw std::runtime_error(str.str());
                }

                color = windows_palette[index];
        }

        // Is the color a palette RGB ?:
        else if(color_index == (1<<msocolorFlagPaletteRGB))
        {
                uint32_t index = value & 0x00FFFFFF;

                std::ostringstream str;
                str << "Properties::EvaluateColors: Expected palette RGB " << index;
                throw std::runtime_error(str.str());
        }

        // Is the color a scheme index ?:
        else if(color_index == (1<<msocolorFlagSchemeIndex))
        {
                uint32_t index = value & 0x00FFFFFF;

                if (scheme_colors)
                        color = scheme_colors->GetColor(index);
                else
                        color = DrawLib::Pixel32(0, 0, 0);
        }

        // Is the color a 'SysIndex' ?:
        else if(color_index == (1<<msocolorFlagSysIndex))
        {
                // The in windows build in colors are taken over from the default windows
                // color sheme and hardcoded here. See also the file
                // 'WindowsDefaultShemeSystemColors.txt' for these hardcoded values.
                uint8_t escher_color_index = (uint8_t)(value & msocolorIndexMask);
                switch(escher_color_index)
                {
                // Windows build-in colors:
                case msosyscolorButtonFace:          // COLOR_BTNFACE
                        color = DrawLib::Pixel32(212,208,200);
                        break;
                case msosyscolorWindowText:          // COLOR_WINDOWTEXT
                        color = DrawLib::Pixel32(  0,  0,  0);
                        break;
                case msosyscolorMenu:                // COLOR_MENU
                        color = DrawLib::Pixel32(212,208,200);
                        break;
                case msosyscolorHighlight:           // COLOR_HIGHLIGHT
                        color = DrawLib::Pixel32( 10, 36,106);
                        break;
                case msosyscolorHighlightText:       // COLOR_HIGHLIGHTTEXT
                        color = DrawLib::Pixel32(255,255,255);
                        break;
                case msosyscolorCaptionText:         // COLOR_CAPTIONTEXT
                        color = DrawLib::Pixel32(255,255,255);
                        break;
                case msosyscolorActiveCaption:       // COLOR_ACTIVECAPTION
                        color = DrawLib::Pixel32( 10, 36,106);
                        break;
                case msosyscolorButtonHighlight:     // COLOR_BTNHIGHLIGHT
                        color = DrawLib::Pixel32(255,255,255);
                        break;
                case msosyscolorButtonShadow:        // COLOR_BTNSHADOW
                        color = DrawLib::Pixel32(128,128,128);
                        break;
                case msosyscolorButtonText:          // COLOR_BTNTEXT
                        color = DrawLib::Pixel32(  0,  0,  0);
                        break;
                case msosyscolorGrayText:            // COLOR_GRAYTEXT
                        color = DrawLib::Pixel32(128,128,128);
                        break;
                case msosyscolorInactiveCaption:     // COLOR_INACTIVECAPTION
                        color = DrawLib::Pixel32(128,128,128);
                        break;
                case msosyscolorInactiveCaptionText: // COLOR_INACTIVECAPTIONTEXT
                        color = DrawLib::Pixel32(212,208,200);
                        break;
                case msosyscolorInfoBackground:      // COLOR_INFOBK
                        color = DrawLib::Pixel32(255,255,255);
                        break;
                case msosyscolorInfoText:            // COLOR_INFOTEXT
                        color = DrawLib::Pixel32(  0,  0,  0);
                        break;
                case msosyscolorMenuText:            // COLOR_MENUTEXT
                        color = DrawLib::Pixel32(  0,  0,  0);
                        break;
                case msosyscolorScrollbar:           // COLOR_SCROLLBAR
                        color = DrawLib::Pixel32(212,208,200);
                        break;
                case msosyscolorWindow:              // COLOR_WINDOW
                        color = DrawLib::Pixel32(255,255,255);
                        break;
                case msosyscolorWindowFrame:         // COLOR_WINDOWFRAME
                        color = DrawLib::Pixel32(212,208,200);
                        break;
                case msosyscolor3DLight:             // COLOR_3DLIGHT
                        color = DrawLib::Pixel32(212,208,200);
                        break;

                // Color depends on other colors:
                case msocolorFillColor:// Use the fillColor property
                        color = GetColor(fillColor, scheme_colors);
                        break;
                case msocolorLineOrFillColor:// Use the line color only if there is a line
                        //if(colors.line)
                                color = GetColor(lineColor, scheme_colors);
                        break;
                case msocolorLineColor:// Use the lineColor property
                        color = GetColor(lineColor, scheme_colors);
                        break;
                case msocolorShadowColor:// Use the shadow color
                        color = GetColor(shadowColor, scheme_colors);
                        break;
                case msocolorThis:// Use this color (only valid as described below)
                        throw std::runtime_error("Properties::EvaluateColors: 'This' color not implemented.");
                        //break;
                case msocolorFillBackColor:// Use the fillBackColor property
                        color = GetColor(fillBackColor, scheme_colors);
                        break;
                case msocolorLineBackColor:// Use the lineBackColor property
                        color = GetColor(lineBackColor, scheme_colors);
                        break;
                case msocolorFillThenLine:// Use the fillColor unless no fill and line (?)
                        //if(colors.fill)
                                color = GetColor(fillColor, scheme_colors);
                        //else if(colors.line)
                        //        color = colors.line;
                        break;
                default:
                        std::ostringstream str;
                        str << "Properties::EvaluateColors: Unknown escher color index: " << std::hex << escher_color_index;
                        throw std::runtime_error(str.str());
                }

                // Get the (byte) parameter, possibly needed for the modification function:
                uint8_t parameter = (uint8_t)((value & msocolorBParamMask) >> msocolorBParamShift);

                // Get the 16 process bits:
                uint32_t process_value = (value & msocolorProcessMask) >> msocolorProcessShift;

                // Get the modification flags:
                uint8_t modification_flags = (uint8_t)(process_value & msocolorModFlagMask);

                // Need to make the color gray ?:
                // NOTE: This must be done before applying the modification function.
                if(modification_flags & msocolorGray)
                {
                        uint8_t u8 = (uint8_t)((color.GetR() + color.GetG() + color.GetB()) / 3);
                        color.SetRGBA(u8, u8, u8, 255);
                }


                // Determine the correct modification function and apply it to the color:
                uint16_t modification_function_index = (uint16_t)(value & msocolorModificationMask);
                switch(modification_function_index)
                {
                case msocolorDarken:// Darken color by parameter/255
                {
                        uint8_t r = (uint8_t)(color.GetR()*parameter / 255);
                        uint8_t g = (uint8_t)(color.GetG()*parameter / 255);
                        uint8_t b = (uint8_t)(color.GetB()*parameter / 255);
                        color.SetRGBA(r, g, b, 255);
                        break;
                }
                case msocolorLighten:// Lighten color by parameter/255
                {
                        uint8_t r = (uint8_t)(255 - ((255 - color.GetR())*parameter/255));
                        uint8_t g = (uint8_t)(255 - ((255 - color.GetG())*parameter/255));
                        uint8_t b = (uint8_t)(255 - ((255 - color.GetB())*parameter/255));
                        color.SetRGBA(r, g, b, 255);
                        break;
                }
                case msocolorAdd:// Add grey level RGB(parameter,parameter,parameter)
                        throw std::runtime_error("Properties::EvaluateColors: Unimplemented modification function: 0x3");
                        //break;
                case msocolorSubtract:// Subtract grey level RGB(parameter,parameter,parameter)
                        throw std::runtime_error("Properties::EvaluateColors: Unimplemented modification function: 0x4");
                        //break;
                case msocolorReverseSubtract:// Subtract from grey level RGB(parameter,parameter,parameter)
                        throw std::runtime_error("Properties::EvaluateColors: Unimplemented modification function: 0x5");
                        //break;
                case msocolorBlackWhite:// Black if < parameter, else white (>=)
                        throw std::runtime_error("Properties::EvaluateColors: Unimplemented modification function: 0x6");
                        //break;
                /*default:
                        std::ostringstream str;
                        str << "Properties::EvaluateColors: Unknown modification function index: " << modification_function_index;
                        throw std::runtime_error(str.str());*/
                }

                // Need to invert the color ?:
                if(modification_flags & msocolorInvert)
                        color.SetRGBA(
                                (uint8_t)(255 - color.GetR()),
                                (uint8_t)(255 - color.GetG()),
                                (uint8_t)(255 - color.GetB()),
                                255);

                // Need to invert the color, changing only the upmost bit ?:
                if(modification_flags & msocolorInvert128)
                        color.SetRGBA(
                                (uint8_t)(color.GetR() ^ 0x80),
                                (uint8_t)(color.GetG() ^ 0x80),
                                (uint8_t)(color.GetB() ^ 0x80),
                                255);
        }

        else
        {
                std::ostringstream str;
                str << "Properties::EvaluateColors: Unrecognized color-index for color with value 0x";
                str << std::hex << value;
                throw std::runtime_error(str.str());
        }
        return color;
}

msoBlip const * Properties::GetPropertyAsBlip(int PID) const
{
        if (PID==0)
            return NULL; //This is a 'just in case' request to see if a blip is available, just return a NULL

        if(!document)
                throw std::runtime_error("Properties::GetPropertyAsBlip: This function cannot be used for this instance: document=NULL");

        // Get the BLIP id:
        uint32_t blip_id = Get((Properties::PropertyID)PID);
        if (!blip_id)
            return NULL;

        DEBUGPRINT("Find blip with id " << blip_id);

        //Find the blip for this shape
        //Is there a central blipstore?
        BlipStoreEntry const *blip_store_entry = NULL;

        DrawingGroupContainer const *dgc = document->GetDrawingGroupContainer();
        // If a DrawingGroupContainer is found, try to get a blip store from
        // it to retrieve the blip store entry from:
        if(dgc)
        {
                BlipStore const *blipstore = NULL;
                if(dgc)
                        blipstore = dgc->GetBlipStore();

                if(blipstore)
                    blip_store_entry = blipstore->GetBlipBySeq(blip_id);
        }

        // Has the blip store entry still not been found?
        // This is for example the case if the shape is a global shape.
        // Try to get a global blip store entry:
        if(!blip_store_entry)
        {
                blip_store_entry = document->GetGlobalBlipStoreEntry();
        }

        // A blip store entry should have been found now:
        if (!blip_store_entry)
        {
                DEBUGPRINT("Unable to find the blip store entry!");
                return NULL;
        }


        msoBlip const *blip = blip_store_entry->GetBlip();
        if(!blip)
            DEBUGPRINT("Unable to find the blip IN the blip store entry!");
        return blip;
}

} //end namespace Escher
} //end namespace Office
} //end namespace Parsers


