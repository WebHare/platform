#include <drawlib/drawlibv2/allincludes.h>


#include "helperfuncs.h"
#include <blex/testing.h>
#include "../drawlibv2/textrenderer.h"
#include "../drawlibv2/drawobject.h"

void AddText(DrawLib::TextFormatter & text_renderer, const char *text)
{
        text_renderer.ParseText(text,text+strlen(text));
}

void FillWithTestText(DrawLib::TextFormatter & text_renderer)
{

        // Font face testing:
        text_renderer.SetFontSize(DrawLib::FPSize(20, 20));
        AddText(text_renderer, " Test test ");
        text_renderer.SetBold(true);
        AddText(text_renderer, "bold ");
        text_renderer.SetBold(false);
        text_renderer.SetItalics(true);
        AddText(text_renderer, "ita");
        text_renderer.SetUnderline(true);
        AddText(text_renderer, "lic ");
        text_renderer.SetBold(true);
        AddText(text_renderer, "bolditalic ");
        text_renderer.SetFontFace("Arial");
        AddText(text_renderer, "arial ARIAL.");
        text_renderer.ResetFontSettings();

        // Line end testing:
        text_renderer.SetFontSize(DrawLib::FPSize(15, 15));
        text_renderer.EndParagraph();
        AddText(text_renderer, "New row. Empty row below.");
        text_renderer.EndParagraph();
        text_renderer.EndParagraph();
        text_renderer.SetFontSize(DrawLib::FPSize(25, 25));
        AddText(text_renderer, "Another empty row below, with greater textsize.");
        text_renderer.EndParagraph();
        text_renderer.EndParagraph();
        text_renderer.ResetFontSettings();


        // Line justifying testing:
        text_renderer.SetFontSize(DrawLib::FPSize(17, 17));
        text_renderer.SetAlignment(1); // '0'=Left, '1'=Center, '2'=Right, '3'=Justified
        AddText(text_renderer, "Centered row here! Test test test test test test test test test.");
        text_renderer.EndParagraph();
        text_renderer.EndParagraph();
        text_renderer.SetAlignment(2);
        AddText(text_renderer, "Right aligned row here! Test test test test test test test test test.");
        text_renderer.EndParagraph();
        text_renderer.EndParagraph();
        text_renderer.SetAlignment(3);
        AddText(text_renderer, " Justified row here! Testtesttesttest testtesttesttesttest.");
        text_renderer.EndParagraph();
        text_renderer.EndParagraph();
}

BLEX_TEST_FUNCTION(TextRendererTest)
{
        DrawLib::Bitmap32 mybitmap(510,610);
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        // Draw a white background:
        drobj.SetFillColor(DrawLib::Pixel32(0xff, 0xff, 0xff));
        drobj.DrawRectangle(DrawLib::FPPoint(0, 0), DrawLib::FPPoint(510,610));

        DrawLib::FPBoundingBox bb[3] = {
                DrawLib::FPBoundingBox( 15,   5, 370, 340),
                DrawLib::FPBoundingBox( 15, 345, 250, 600),
                DrawLib::FPBoundingBox(265, 345, 500, 600),
        };

        // Testing 3 text directions:
        for(int i=0; i<3; ++i)
        {
                // Draw a red textbox:
                drobj.SetOutlineColor(DrawLib::Pixel32(0xff, 0, 0));
                drobj.SetOutlineWidth(1);
                drobj.DrawRectangleOutline(
                        DrawLib::FPPoint(bb[i].upper_left .x-1,
                                         bb[i].upper_left .y-1) ,
                        DrawLib::FPPoint(bb[i].lower_right.x,
                                         bb[i].lower_right.y) );

                // Create a text renderer/formatter:
                DrawLib::XForm2D null_transform;
                DrawLib::TextFormatter text_renderer(null_transform, DrawLib::Pixel32(0xff, 0xff, 0xff));
                text_renderer.SetMode(0);

                // ... and give it some text:
                FillWithTestText(text_renderer);

                // About the text direction,
                // 0: Horizontal, left to right (default)
                // 1: Vert, top to bottom
                // 2: Vert, bottom to top
                text_renderer.RenderText(mycanvas,
                        bb[i] /*bounding box, witin canvas*/,
                        i     /*text direction*/,
                        false /*is last box*/,
                        0
                       );
        }
        BLEX_TEST_CHECK(DoErrorCompare ("ref-textrenderer.png", mybitmap, 9000, true)); //FIXME restore to 31 once we have FT 2.7 on fedora
}

void FillWithAdditionalTestText(DrawLib::TextFormatter & text_renderer)
{
        // Test colors
        text_renderer.ResetFontSettings();
        text_renderer.SetFontSize(DrawLib::FPSize(20, 20));
        text_renderer.SetFontColor(DrawLib::Pixel32(0xff,0,0));
        AddText(text_renderer, "Red ");
        text_renderer.SetFontColor(DrawLib::Pixel32(0,0,0xff));
        AddText(text_renderer, "blue ");
        // Color of the underline
        text_renderer.SetUnderline(true);
        AddText(text_renderer, "underlined");
        text_renderer.EndParagraph();

        // Test tabbing
        text_renderer.ResetFontSettings();
        text_renderer.SetFontSize(DrawLib::FPSize(20, 20));

        // Normal tabs
        text_renderer.ResetParagraphSettings();
        AddText(text_renderer, "Normal Tab\tTab1\tTab2\tTab3\tTab4\tTab5\tTab6");
        text_renderer.EndParagraph();

        // Tabstop
        text_renderer.ResetParagraphSettings();
        text_renderer.AddTabStop(315);
        text_renderer.AddTabStop(480);
        AddText(text_renderer, "First words\t");
        AddText(text_renderer, "Second words\t");
        AddText(text_renderer, "third words, second line");
        text_renderer.EndParagraph();

        // Tab extends line (inherit paragraph settings)
        AddText(text_renderer, "First words\t");
        AddText(text_renderer, "SecondWordsGetsCutInHalfAndEndsUpAtSecondAndThirdLine");
        text_renderer.EndParagraph();

        // Test indenting
        text_renderer.ResetParagraphSettings();
        text_renderer.SetFirstLineIndent(25);
        text_renderer.SetLeftIndent(50);
        text_renderer.SetRightIndent(50);
        AddText(text_renderer, "fdjasf dsaf sda fdsa fjdskl jfskdl jfsla jflsa jfkdls fklsd klfds kflsj fkdls jfksdl fkls ajfklsj klfs");
        text_renderer.EndParagraph();

        // Now indenting with justified alignment
        text_renderer.SetAlignment(3);
        AddText(text_renderer, "fdjasf dsaf sda fdsa fjdskl jfskdl jfsla jflsa jfkdls fklsd klfds kflsj fkdls jfksdl fkls ajfklsj klfs");
        text_renderer.EndParagraph();

        // Test a soft-return
        AddText(text_renderer, "fdjasf dsaf sda\vfdsa fjdskl jfskdl jfsla\vjflsa jfkdls fklsd klfds kflsj fkdls jfksdl fkls ajfklsj klfs");
}


/* Test the additional textrenderer settings (added to render Powerpoint Slides) */
BLEX_TEST_FUNCTION(TextRendererAdditionTest)
{
        DrawLib::Bitmap32 mybitmap(500,400);
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        // Draw a white background:
        drobj.SetFillColor(DrawLib::Pixel32(0xff, 0xff, 0xff));
        drobj.DrawRectangle(DrawLib::FPPoint(0, 0), DrawLib::FPPoint(500,400));

        DrawLib::FPBoundingBox bb = DrawLib::FPBoundingBox( 5,   5,  495, 395);

        DrawLib::XForm2D null_transform;
        DrawLib::TextFormatter text_renderer(null_transform, DrawLib::Pixel32(0xff, 0xff, 0xff));
        text_renderer.SetMode(0);

        // ... and give it some text:
        FillWithAdditionalTestText(text_renderer);

        text_renderer.RenderText(mycanvas,
                bb /*bounding box, witin canvas*/,
                0     /*text direction*/,
                false /*is last box*/,0

                );

        BLEX_TEST_CHECK(DoErrorCompare ("ref-textrendereraddition.png", mybitmap, 15000, true)); //FIXME restore to 9 once we have FT 2.7 on fedora
}

void FillWithEffectsTestText(DrawLib::TextFormatter & text_renderer)
{
        // Test bold
        text_renderer.ResetFontSettings();
        text_renderer.SetFontSize(DrawLib::FPSize(35, 35));
        text_renderer.SetBold(true);
        AddText(text_renderer, "Bold");
        text_renderer.EndParagraph();

        // Test italic
        text_renderer.ResetFontSettings();
        text_renderer.SetFontSize(DrawLib::FPSize(35, 35));
        text_renderer.SetItalics(true);
        AddText(text_renderer, "Italic");
        text_renderer.EndParagraph();

        // Test underline
        text_renderer.ResetFontSettings();
        text_renderer.SetFontSize(DrawLib::FPSize(35, 35));
        text_renderer.SetUnderline(true);
        AddText(text_renderer, "Underline");
        text_renderer.EndParagraph();

        // Test shadow
        text_renderer.ResetFontSettings();
        text_renderer.SetFontSize(DrawLib::FPSize(35, 35));
        text_renderer.SetShadow(true);
        AddText(text_renderer, "Shadow");
        text_renderer.EndParagraph();

        // Test emboss
        text_renderer.ResetFontSettings();
        text_renderer.SetFontSize(DrawLib::FPSize(35, 35));
        text_renderer.SetEmboss(true);
        AddText(text_renderer, "Emboss");
        text_renderer.EndParagraph();

        // Test color
        text_renderer.ResetFontSettings();
        text_renderer.SetFontSize(DrawLib::FPSize(35, 35));
        text_renderer.SetFontColor(DrawLib::Pixel32(0xff, 0x00, 0x00));
        AddText(text_renderer, "Red");
        text_renderer.EndParagraph();

        // Superscript
        text_renderer.ResetFontSettings();
        text_renderer.SetFontSize(DrawLib::FPSize(35, 35));
        text_renderer.SetOffset(30.0);
        AddText(text_renderer, "Superscript");
        text_renderer.EndParagraph();

        // Subscript
        text_renderer.ResetFontSettings();
        text_renderer.SetFontSize(DrawLib::FPSize(35, 35));
        text_renderer.SetOffset(30.0);
        AddText(text_renderer, "Subscript");
        text_renderer.EndParagraph();
}


/* Test the textrenderer text effects settings (added to render Powerpoint Slides) */
BLEX_TEST_FUNCTION(TextRendererEffectsTest)
{
        DrawLib::Bitmap32 mybitmap(500,400);
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        // Draw a white background:
        drobj.SetFillColor(DrawLib::Pixel32(0xcc, 0xcc, 0xcc));
        drobj.DrawRectangle(DrawLib::FPPoint(0, 0), DrawLib::FPPoint(500,400));

        DrawLib::FPBoundingBox bb = DrawLib::FPBoundingBox( 5,   5,  495, 395);

        DrawLib::XForm2D null_transform;
        DrawLib::TextFormatter text_renderer(null_transform, DrawLib::Pixel32(0xcc, 0xcc, 0xcc));
        text_renderer.SetMode(0);

        // ... and give it some text:
        FillWithEffectsTestText(text_renderer);

        text_renderer.RenderText(mycanvas,
                bb /*bounding box, witin canvas*/,
                0     /*text direction*/,
                false /*is last box*/,0);

        BLEX_TEST_CHECK(DoErrorCompare ("ref-textrenderereffects.png", mybitmap, 8000, true)); //FIXME restore to 8 once we have FT 2.7 on fedora
}

void FillWithSpacingTestText(DrawLib::TextFormatter & text_renderer)
{
        // Test relative line spacing
        text_renderer.ResetFontSettings();
        text_renderer.ResetParagraphSettings();
        text_renderer.SetLineSpacingFactor(1.5);
        AddText(text_renderer, "Line 1a");
        text_renderer.EndParagraph();
        AddText(text_renderer, "Line 1b");
        text_renderer.EndParagraph();

        // Test absolute line spacing
        text_renderer.ResetParagraphSettings();
        text_renderer.SetLineSpacingAbsolute(35);
        AddText(text_renderer, "Line 2a");
        text_renderer.EndParagraph();
        AddText(text_renderer, "Line 2b");
        text_renderer.EndParagraph();

        // Test relative spacing before
        text_renderer.ResetParagraphSettings();
        text_renderer.SetSpacingBeforeFactor(0.5);
        AddText(text_renderer, "Line 3a");
        text_renderer.EndParagraph();
        AddText(text_renderer, "Line 3b");
        text_renderer.EndParagraph();

        // Test absolute spacing before
        text_renderer.ResetParagraphSettings();
        text_renderer.SetSpacingBeforeAbsolute(20);
        AddText(text_renderer, "Line 4a");
        text_renderer.EndParagraph();
        AddText(text_renderer, "Line 4b");
        text_renderer.EndParagraph();

        // Test relative spacing after
        text_renderer.ResetParagraphSettings();
        text_renderer.SetSpacingAfterFactor(0.5);
        AddText(text_renderer, "Line 5a");
        text_renderer.EndParagraph();
        AddText(text_renderer, "Line 5b");
        text_renderer.EndParagraph();

        // Test absolute spacing after
        text_renderer.ResetParagraphSettings();
        text_renderer.SetSpacingAfterAbsolute(20);
        AddText(text_renderer, "Line 6a");
        text_renderer.EndParagraph();
        AddText(text_renderer, "Line 6b");
        text_renderer.EndParagraph();
}


/* Test the textrenderer text effects settings (added to render Powerpoint Slides) */
BLEX_TEST_FUNCTION(TextRendererSpacingTest)
{
        DrawLib::Bitmap32 mybitmap(500,400);
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        // Draw a white background:
        drobj.SetFillColor(DrawLib::Pixel32(0xff, 0xff, 0xff));
        drobj.DrawRectangle(DrawLib::FPPoint(0, 0), DrawLib::FPPoint(500,400));

        DrawLib::FPBoundingBox bb = DrawLib::FPBoundingBox( 5,   5,  495, 395);

        DrawLib::XForm2D null_transform;
        DrawLib::TextFormatter text_renderer(null_transform, DrawLib::Pixel32(0xff, 0xff, 0xff));
        text_renderer.SetMode(0);

        // ... and give it some text:
        FillWithSpacingTestText(text_renderer);

        text_renderer.RenderText(mycanvas,
                bb /*bounding box, witin canvas*/,
                0     /*text direction*/,
                false /*is last box*/,0
);

        BLEX_TEST_CHECK(DoErrorCompare ("ref-textrendererspacing.png", mybitmap, 70,true));
}
