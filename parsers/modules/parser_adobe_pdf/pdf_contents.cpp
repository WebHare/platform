#include <ap/libwebhare/allincludes.h>


#include "pdf_lexer.h"
#include "pdf_contents.h"
#include "pdf.h"

namespace Parsers
{

namespace Adobe
{

namespace PDF
{


Contents::Operator Contents::operators[] = {
  {"\"",  3, {type_numeric, type_numeric, type_string}, &Contents::opMoveSetShowText},
  {"'",   1, {type_string}, &Contents::opMoveShowText},
  {"Tj",  1, {type_string}, &Contents::opShowText},
  {"TJ",  1, {type_array}, &Contents::opShowSpaceText},
  {"Tf",  2, {type_name, type_numeric}, &Contents::opSetFont},
  {"BI",  0, {type_null}, &Contents::opBeginImage},
  {"",    0, {type_null}, NULL}
};

Contents::Contents(Page const &page, Object const &_object)
: page(page)
, object(_object)
{
}

Contents::CommandLine Contents::ReadCommandLine(Lexer &lexer) const
{
        CommandLine result;

        ObjectPtr object = lexer.GetNextObject(0,0);
        while(object->GetType() != type_keyword && object->GetType() != type_null)
        {
                result.arguments.push_back(object);
                object = lexer.GetNextObject(0,0);

        }

        result.keyword = object;
        return result;
}

#define CALL_MEMBER_FN(object,ptrToMember)  ((object).*(ptrToMember))

void Contents::Render(Renderer *renderer) const
{
        Blex::MemoryRWStream stream;

        if (object.GetType() == type_array)
        {
                ArrayObject const &contents_array = object.GetArray();
                for (unsigned i = 0; i < contents_array.GetLength(); ++i)
                    contents_array[i].GetStream().GetUncompressedData()->SendAllTo(stream);

                stream.SetOffset(0);
        }
        else if (object.GetType() == type_stream)
        {
                object.GetStream().GetUncompressedData()->SendAllTo(stream);
                stream.SetOffset(0);
        } else
                throw std::runtime_error("Unknown type of content object");

        Lexer lexer(stream);
        lexer.SetVersion(page.GetFile().GetVersion());

        RenderState render_state(renderer);

        while(true)
        {
                CommandLine line = ReadCommandLine(lexer);
                if(line.keyword->GetType() == type_null)
                        break;

                int operator_index = 0;
                while(operators[operator_index].func != NULL)
                {
                        if(operators[operator_index].name == line.keyword->GetKeyword())
                                break;

                        ++operator_index;
                }

                if(operators[operator_index].func == NULL)
                        continue;
                if(operators[operator_index].arg_count != line.arguments.size())
                        continue;

                bool arguments_valid = true;
                for(size_t i = 0; i < operators[operator_index].arg_count; ++i)
                        arguments_valid &= (line.arguments[i]->GetType() == operators[operator_index].arguments[i]);

                if(!arguments_valid)
                        continue;

                CALL_MEMBER_FN(*this, operators[operator_index].func)(render_state, line.arguments);
        }
}

void Contents::opMoveSetShowText(RenderState &render_state, std::vector<ObjectPtr> const &arguments) const
{
        // Move to start of next line and show text
        // Also set char_space and word_space
        Renderer *renderer = render_state.renderer;
        std::string text = render_state.font.get() ? render_state.font->ConvertText(arguments[0]->GetString()) : arguments[0]->GetString();
        renderer->OutputText(0.0f, 0.0f, arguments[0]->GetString());
}

void Contents::opMoveShowText(RenderState &render_state, std::vector<ObjectPtr> const &arguments) const
{
        //Show text and move to next line
        Renderer *renderer = render_state.renderer;
        std::string text = render_state.font.get() ? render_state.font->ConvertText(arguments[0]->GetString()) : arguments[0]->GetString();
        renderer->OutputText(0.0f, 0.0f, arguments[0]->GetString());
}

void Contents::opShowText(RenderState &render_state, std::vector<ObjectPtr> const &arguments) const
{
        //Show text
        Renderer *renderer = render_state.renderer;
        std::string text = render_state.font.get() ? render_state.font->ConvertText(arguments[0]->GetString()) : arguments[0]->GetString();
        renderer->OutputText(0.0f, 0.0f, text);
}

void Contents::opShowSpaceText(RenderState &render_state, std::vector<ObjectPtr> const &arguments) const
{
        Renderer *renderer = render_state.renderer;

        ArrayObject const &array = arguments[0]->GetArray();
        for (unsigned i = 0; i < array.GetLength(); ++i)
        {
                if (array[i].GetType() == type_string)
                {
                        std::string text = render_state.font.get() ? render_state.font->ConvertText(array[i].GetString()) : array[i].GetString();
                        renderer->OutputText(0.0f, 0.0f, text);
                }
                else if (array[i].GetType() == type_numeric)
                {

                }
        }
}

void Contents::opBeginImage(RenderState &/*render_state*/, std::vector<ObjectPtr> const &/*arguments*/) const
{
        throw std::runtime_error("Internal error: BI EI (inline images) Not implemented");
}

void Contents::opSetFont(RenderState &render_state, std::vector<ObjectPtr> const &arguments) const
{
        //Set Font
        render_state.font = page.GetFont(arguments[0]->GetName());
        if(render_state.font.get() == NULL)
                DEBUGPRINT("Corrupt PDF File: Font does not exist (" << arguments[0]->GetName() << ")");

        render_state.font_size = arguments[1]->GetNumericInt();
}

XObject::~XObject()
{
}
//ADDME: Die XOBjects worden door heel veel lagen heen enweer gestuiterd zonder nut ?
XObject_Form::XObject_Form(PDFfile *file, Page const &page, ObjectPtr object, Lexer &/*lexer*/)
        : contents(page, *object)
{
        Object const &resources_object = object->GetDictionary()["Resources"];
        DictObject const& resource_dict = resources_object.GetDictionary();

        // Read External Objects
        if (resource_dict.KeyExists("XObject"))
                file->ParseXObjects(page,resource_dict.GetDictionary()["XObject"]);

        DEBUGPRINT(*object);

        // Now decode the contents off this form

}

XObject *XObject::LoadXObject(PDFfile *file, Page const &page, ObjectPtr object, Lexer &lexer)
{
        std::string subtype = object->GetDictionary()["Subtype"].GetName();

        if(subtype == "Form")
                return new XObject_Form(file, page, object, lexer);
        else
                DEBUGPRINT("Currently unsupported XForm subtype: " << subtype);

        return NULL;
}

  /*
TextObject::TextObject(PDFfile *file, Lexer &lexer)
{
        // Start reading the text object
        CommandLine line = ReadCommandLine(lexer);
        while(line.keyword->GetType() != type_null)
        {
                std::string op = line.keyword->GetKeyword();
                DEBUGPRINT("Text operation: " << op);
                // For now, just try to filter out the text to get the
                // search engine running.
                if(op == "ET")
                {
                        // End of text object
                        break;
                } else if (op == "T*")
                {
                          // Move to start of next line
                          TextState old_text_state = text_state;
                          text_state.text_x_pos = text_state.start_x_pos;
                          text_state.text_y_pos =
                                  -text_state.leading * text_state.text_yy_scale +
                                  old_text_state.text_y_pos;

                          DetermineTextJump(old_text_state, text_state, pages[pagenr]);
                }
                else if (op == "Td")
                {
                        // Move to start of next line with some specified offset
                         TextState old_text_state = text_state;
                        text_state.text_x_pos = operands[0]->GetNumericFloat() + old_text_state.start_x_pos;
                        text_state.start_x_pos = text_state.text_x_pos;
                        text_state.text_y_pos = operands[1]->GetNumericFloat() + old_text_state.text_y_pos;

                        DetermineTextJump(old_text_state, text_state, pages[pagenr]);
                }
                else if (op == "TD")
                {
                        // Move to start of next line with some specified offset
                        // Also set leading
                        TextState old_text_state = text_state;
                        text_state.text_x_pos = old_text_state.start_x_pos + operands[0]->GetNumericFloat();
                        text_state.start_x_pos = text_state.text_x_pos;
                        text_state.text_y_pos = old_text_state.text_y_pos + operands[1]->GetNumericFloat();
                        text_state.leading = -operands[1]->GetNumericFloat();

                        DetermineTextJump(old_text_state, text_state, pages[pagenr]);
                }
                else if (op == "Tm")
                {
                       TextState old_text_state = text_state;

                        DrawLib::FPPoint translation(operands[4]->GetNumericFloat(), operands[5]->GetNumericFloat());
                        float eM11 = operands[0]->GetNumericFloat();
                        float eM12 = operands[1]->GetNumericFloat();
                        float eM21 = operands[2]->GetNumericFloat();
                        float eM22 = operands[3]->GetNumericFloat();

                        text_state.text_matrix = DrawLib::XForm2D(eM11, eM12, eM21, eM22, translation);
                        text_state.text_line_matrix = DrawLib::XForm2D(eM11, eM12, eM21, eM22, translation);


                        text_state.text_xx_scale = operands[0]->GetNumericFloat();
                        text_state.text_xy_scale = operands[1]->GetNumericFloat();
                        text_state.text_yx_scale = operands[2]->GetNumericFloat();
                        text_state.text_yy_scale = operands[3]->GetNumericFloat();
                        text_state.text_x_pos = operands[4]->GetNumericFloat();
                        text_state.start_x_pos = operands[4]->GetNumericFloat();
                        text_state.text_y_pos = operands[5]->GetNumericFloat();

                        DetermineTextJump(old_text_state, text_state, pages[pagenr]);
                } else if (op == "Tj")
                {
//                        if(font.get() == NULL)
//                                throw std::runtime_error("Pdf text without a selected font");

                        // Show text
                        TextItem item;
                        item.text = line.arguments[0]->GetString();
                        text_items.push_back(item);
//                        UpdateTextState(text_state, pages[pagenr], operands[0]->GetString());
                } else if (op == "'")
                {
                        // Move to start of next line and show text
                        TextState old_text_state = text_state;
                        text_state.text_x_pos = text_state.start_x_pos;
                        text_state.text_y_pos =
                                -text_state.leading * text_state.text_yy_scale +
                                old_text_state.text_y_pos;

                        DetermineTextJump(old_text_state, text_state, pages[pagenr]);
                        UpdateTextState(text_state, pages[pagenr], operands[0]->GetString());

                        TextItem item;
                        item.text = line.arguments[0]->GetString();
                        text_items.push_back(item);
                }
                else if (op == "\"")
                {
//                        if(font.get() == NULL)
  //                              throw std::runtime_error("Pdf text without a selected font");
                        // Move to start of next line and show text
                        // Also set char_space and word_space
                        TextState old_text_state = text_state;
                        text_state.text_x_pos = text_state.start_x_pos;
                        text_state.text_y_pos =
                                -text_state.leading * text_state.text_yy_scale +
                                old_text_state.text_y_pos;
                        text_state.char_space = operands[0]->GetNumericFloat();
                        text_state.word_space = operands[1]->GetNumericFloat();

                        DetermineTextJump(old_text_state, text_state, pages[pagenr]);
                        UpdateTextState(text_state, pages[pagenr], operands[0]->GetString());
                        // plain_text += line.arguments[0]->GetString();

                        TextItem item;
                        item.text = line.arguments[0]->GetString();
                        text_items.push_back(item);
                }
                else if (op == "TJ")
                {
//                        if(font.get() == NULL)
//                                throw std::runtime_error("Pdf text without a selected font");

                        ArrayObject const &array = line.arguments[0]->GetArray();
                        for (unsigned i = 0; i < array.GetLength(); ++i)
                                if (array[i].GetType() == type_string)
                                {
//                                        UpdateTextState(text_state, pages[pagenr], array[i].GetString());
                                        TextItem item;
                                        item.text = array[i].GetString();
                                        text_items.push_back(item);
                                } else if (array[i].GetType() == type_numeric)
                                {
                                        // Calculate the addition of a space in the string
                                        TextState old_text_state = text_state;

                                        float unscaled_new_x_pos = (-array[i].GetNumericFloat()/1000*text_state.size + text_state.char_space) * text_state.scale/100.0;
                                        text_state.text_x_pos =
                                                unscaled_new_x_pos * text_state.text_xx_scale +
                                                old_text_state.text_x_pos;

                                        DetermineTextJump(old_text_state, text_state, pages[pagenr]);
                                }
                }
                / * else if (op == "Tc")
            //            text_state.char_space = operands[0]->GetNumericFloat();
                else if (op == "Tw")
            //            text_state.word_space = operands[0]->GetNumericFloat();
                else if (op == "Tz")
            //            text_state.scale = operands[0]->GetNumericFloat();
                else if (op == "TL")
            //            text_state.leading = operands[0]->GetNumericFloat();
                else if (op == "Tf")
                {
                       / * font = file->FindFont(line.arguments[0]->GetName());
                        if (font.get() == NULL)
                                throw std::runtime_error("Corrupt PDF File: Font does not exist");

                        size = line.arguments[1]->GetNumericInt();
                }
                else if (op == "Tr")
          //              text_state.render = (unsigned)operands[0]->GetNumericInt();
                else if (op == "Ts")
//                        text_state.rise = operands[0]->GetNumericFloat();
                else
                {
          //              DEBUGPRINT("Error: Unhandeled text operation: " + op);
                }

                line = ReadCommandLine(lexer);
        }
}
*/

}

}

}
