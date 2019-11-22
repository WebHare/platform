#ifndef blex_harescript_modules_pdf_contents
#define blex_harescript_modules_pdf_contents

#include <drawlib/drawlibv2/drawlib_v2_types.h>
#include "pdf_font.h"

namespace Parsers
{

namespace Adobe
{

namespace PDF
{

class Page;
class PDFfile;

/**
 * Interface for a content renderer
 */
class Renderer
{
public:
        virtual ~Renderer() { }
        virtual void OutputText(float x, float y, std::string const &text) = 0;
};

/**
 * Simple plain text renderer
 */
class PlainTextRenderer
        : public Renderer
{
        std::string output;

public:
        virtual void OutputText(float /*x*/, float /*y*/, std::string const &text)
        {
                output += text;
        }

        std::string const &GetText() const { return output; }
};

// Contains all data of a contents object
class Contents
{
        struct RenderState
        {
                Renderer *renderer;

                RenderState(Renderer *_renderer)
                        : renderer(_renderer)
                { }

                FontPtr font;
                int font_size;

                // Mapping from document to output device
                DrawLib::XForm2D current_transformation_matrix;

                // Current state of the text rendering
                DrawLib::XForm2D text_matrix;
                DrawLib::XForm2D text_line_matrix;
        };

        struct CommandLine
        {
                std::vector<ObjectPtr> arguments;
                ObjectPtr keyword;
        };

        CommandLine ReadCommandLine(Lexer &lexer) const;

        #define MAX_ARGS 8

        struct Operator
        {

                char name[4];
                size_t arg_count;
                object_type arguments[MAX_ARGS];
                void (Contents::*func)(RenderState &render_state, std::vector<ObjectPtr> const &arguments) const;
        };

        static Operator operators[];

        void opMoveSetShowText(RenderState &render_state, std::vector<ObjectPtr> const &arguments) const;
        void opMoveShowText(RenderState &render_state, std::vector<ObjectPtr> const &arguments) const;
        void opShowText(RenderState &render_state, std::vector<ObjectPtr> const &arguments) const;
        void opShowSpaceText(RenderState &render_state, std::vector<ObjectPtr> const &arguments) const;

        void opBeginImage(RenderState &render_state, std::vector<ObjectPtr> const &arguments) const;

        void opSetFont(RenderState &render_state, std::vector<ObjectPtr> const &arguments) const;

        Page const &page;
        Object const &object;

public:
        Contents(Page const &page, Object const &_object);

        void Render(Renderer *renderer) const;
};

class XObject
{
public:
        FontRefs fontrefs;
        static XObject *LoadXObject(PDFfile *file, Page const &page, ObjectPtr object, Lexer &lexer);
        virtual ~XObject();
        virtual std::string GetSubType() const = 0;
};

class XObject_Form : public XObject
{
        Contents contents;
public:
        XObject_Form(PDFfile *file, Page const &page, ObjectPtr object, Lexer &lexer);
        std::string GetSubType() const { return "Form"; }
};


}

}

}

#endif

