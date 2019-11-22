#include <ap/libwebhare/allincludes.h>


#include <drawlib/drawlibv2/bitmapio.h>
#include <drawlib/drawlibv2/drawobject.h>
#include <drawlib/drawlibv2/wmfrenderer.h>
#include "vmlrender.h"

namespace Parsers {
namespace Office {
namespace VML {

Blex::XML::Namespace xmlns_vml("v","urn:schemas-microsoft-com:vml");

float TwipsToPixels(int32_t twips_in)
{
        return ((twips_in / 20) / 4) * 3; //not really verified yet..
}

class VMLRenderer
{
        public:
        VMLRenderer(Blex::XML::Node node, Parsers::Office::OOXML::OOXMLPackageRef const &packageref);

        void PaintVMLPicture(DrawLib::BitmapInterface *bitmap, int32_t startx, int32_t starty, int32_t lenx, int32_t leny);

        private:
        void RenderImage(DrawLib::BitmapInterface *bitmap, int32_t startx, int32_t starty, int32_t lenx, int32_t leny, std::string const &src);

        Blex::XML::Node node;
        Parsers::Office::OOXML::OOXMLPackageRef packageref;
};

//ADDME Follow correct CSS parsing rules (consider () url escapes)
typedef std::map<std::string, std::string> CSSStyle;

void QuickCSSParse(CSSStyle *out, std::string const &style)
{
        for (Blex::TokenIterator<std::string> itr(style.begin(), style.end(), ';');itr;++itr)
        {
                std::string::const_iterator beginprop = itr.begin();
                std::string::const_iterator endvalue = itr.end();
                std::string::const_iterator beginvalue = std::find(beginprop, endvalue, ':');
                if(beginvalue == beginprop || beginvalue == endvalue)
                    continue; //corrupted

                std::string::const_iterator endprop = beginvalue;
                ++beginvalue;

                //Trim whitespaces
                while(beginprop != endprop && Blex::IsWhitespace(*beginprop))
                    ++beginprop;
                while(beginprop != endprop && Blex::IsWhitespace(endprop[-1]))
                    --endprop;
                while(beginvalue != endvalue && Blex::IsWhitespace(*beginvalue))
                    ++beginvalue;
                while(beginvalue != endvalue && Blex::IsWhitespace(endvalue[-1]))
                    --endvalue;

                (*out)[std::string(beginprop,endprop)] = std::string(beginvalue,endvalue);
        }
}

int StyleUnitToTwips(std::string const &in)
{
        if(in.empty())
            return 0;
        if(in=="0")
            return 0;

        if(Blex::StrCaseLike(in,"*pt"))
        {
                return int(std::atof(std::string(in.begin(),in.end()-2).c_str()) * 20);
        }
        if(Blex::StrCaseLike(in,"*in")) //2 inch = 144 pt = 2880 twips
        {
                return int(std::atof(std::string(in.begin(),in.end()-2).c_str()) * 72*20);
        }
        DEBUGPRINT("Cannot figure out StyleUnit [" << in << "]");
        return 0;
}

int ParseStyleUnit_ToPX(std::string const &in, bool round_up)
{
        int twips = StyleUnitToTwips(in);
        return (twips + (round_up?14:7)) / 15;
}

VMLRenderer::VMLRenderer(Blex::XML::Node node, Parsers::Office::OOXML::OOXMLPackageRef const &packageref)
: node(node)
, packageref(packageref)
{
}

void VMLRenderer::RenderImage(DrawLib::BitmapInterface *bitmap, int32_t startx, int32_t starty, int32_t lenx, int32_t leny, std::string const &src)
{
        std::unique_ptr<Blex::Stream> image;
        Blex::XML::Node node = packageref.GetRelNodeById(src);
        image.reset(packageref.OpenFileByRelation(src));
        if(!image.get())
                return;

        DrawLib::Canvas32 blitcanvas(bitmap);
        blitcanvas.SetAlphaMode(DrawLib::Canvas32::BLEND255);
        DrawLib::XForm2D bitmap_to_store(0, DrawLib::FPPoint(1,1), DrawLib::FPPoint(startx,starty));

        std::string filename = node.GetAttr(NULL, "Target");
        if(Blex::StrCaseLike(filename,"*.emf"))
        {
                std::vector<uint8_t> emfdata;
                Blex::ReadStreamIntoVector(*image, &emfdata);

                DrawLib::RenderWmfEmf(*bitmap, DrawLib::FPBoundingBox(startx, starty, startx+lenx, starty+leny), &emfdata[0], emfdata.size(), DrawLib::XForm2D());
        }
        else
        {
                //ADDME Get mimetype or something... Avoid extracting if not needed
                Blex::MemoryRWStream image_in_memory;
                image->SendAllTo(image_in_memory);

                image_in_memory.SetOffset(0);
                std::unique_ptr<DrawLib::BitmapInterface> inbitmap;

                inbitmap.reset(DrawLib::CreateBitmap32Magic(&image_in_memory, DrawLib::ISize(lenx,leny)));

                if(inbitmap.get())
                {
                        //ADDME: remerge/ Copied from void msoBlip::PaintYourself(ShapeDrawParameters const &pars, const BlipRenderProperties &props) const


                        /* Create a translation that moves bitmap coordinates (0..width, 0..height) into the -1,-1,1,1 space
                        DrawLib::XForm2D bitmap_to_store(2.0/width,0,0,2.0/height,DrawLib::FPPoint(-1,-1));

                        DrawLib::DrawObject(&blitcanvas).DrawBitmap(*cropped_resized_bitmap, bitmap_to_store * realtransform.GetRotation());
                        */
                        DrawLib::DrawObject(&blitcanvas).DrawBitmap(*inbitmap, bitmap_to_store);
                }
        }
}

void VMLRenderer::PaintVMLPicture(DrawLib::BitmapInterface *bitmap, int32_t startx, int32_t starty, int32_t lenx, int32_t leny)
{
        //ADDME Could roll startx etc into a transformation matrix..?

        for (Blex::XML::NodeIterator itr = node.GetChildNodeIterator(&xmlns_vml); itr; ++itr)
        {
                if(itr->LocalNameIs("imagedata"))
                {
                        std::string id  = itr->GetAttr(&Parsers::Office::OOXML::xmlns_officedoc_relationships, "id");
                        if(!id.empty())
                            RenderImage(bitmap, startx, starty, lenx, leny, id);
                }
        }
}

void RenderVMLPicture(Parsers::FormattedOutput &output, Blex::XML::Node node, Parsers::Office::OOXML::OOXMLPackageRef const &packageref)
{
        if (!output.AreImagesAccepted()) //if live was only this easy
            return;

        ImageInfo img;
        Parsers::Hyperlink link;
        if(output.AreHyperlinksAccepted())
        {
                link.data = node.GetAttr(NULL, "href");
                link.target = node.GetAttr(NULL, "target");
        }
/*
        std::string shapetype = node.getAttr(NULL,"type");
        if(!shapetype.empty())
        {
              if(shapetype[0]!='#')
              {
                      DEBUGPRINT("Didn't understand shapetype " << shapetype);
              }
              else
              {
                      std::string findshape(shapetype.begin()+1, shapetype.end());

                      for (Blex::XML::NodeIterator cur = node.GetParentNode().GetChildNodeIterator(NULL); cur; ++cur)
                      {
                              if(cur->LocalNameIs("shapetype") && cur->IsInNamespace(Parsers::Office::VML::xmlns_vml) && cur->GetAttr(NULL,"id") == findshape)
                              {
                                      DEBUGPRINT("Found shapetype [" << shapetype << "]");

                              }

        }
*/
        CSSStyle shapestyle;
        QuickCSSParse(&shapestyle, node.GetAttr(NULL, "style"));

        int width = ParseStyleUnit_ToPX(shapestyle["width"],true);
        int height = ParseStyleUnit_ToPX(shapestyle["height"],true);
        int marginleft = ParseStyleUnit_ToPX(shapestyle["margin-left"],false);

        if(width<1 || height<1)
        {
                DEBUGPRINT("Skipping image, dimensions " << width << "x" << height << " too small");
                return;
        }

        //ADDME Discover page size to be able to interpret position_h_offset
        //      assuming 12240 width for now (is in twips)
        if(shapestyle["position"]=="absolute")
        {
                int32_t pagecenter = TwipsToPixels(12240) / 2;
                int32_t imagecenter = marginleft + width/2;
                img.align = imagecenter < pagecenter ? 1 : 2;

                //set defaults on floaters.
                if(!shapestyle.count("mso-wrap-distance-left"))
                        shapestyle["mso-wrap-distance-left"]="9pt";
                if(!shapestyle.count("mso-wrap-distance-right"))
                        shapestyle["mso-wrap-distance-right"]="9pt";
        }

        //ADDME: wrappings probably shouldn't be applied on their relevant edge (eg, no margin-left on float:left, etc)

        //ADDME: Detect photos/jpegs
        VMLRenderer renderer(node, packageref);

        img.lenx = unsigned(width);
        img.leny = unsigned(height);
        img.painter = std::bind(&VMLRenderer::PaintVMLPicture, &renderer, std::placeholders::_2, std::placeholders::_3, std::placeholders::_4, std::placeholders::_5, std::placeholders::_6);
        img.alttag = node.GetAttr(NULL, "alt");
        img.wrapping.top = StyleUnitToTwips(shapestyle["mso-wrap-distance-top"]);
        img.wrapping.left = StyleUnitToTwips(shapestyle["mso-wrap-distance-left"]);
        img.wrapping.right = StyleUnitToTwips(shapestyle["mso-wrap-distance-right"]);
        img.wrapping.bottom = StyleUnitToTwips(shapestyle["mso-wrap-distance-bottom"]);

        if(!link.data.empty())
            output.StartHyperlink(link);
        output.InsertImage(img);

        //Close any hyperlink we locally opened (ADDME: Restore original hyperlink? Add push/pop link suppport to output?)
        if(!link.data.empty())
            output.EndHyperlink();
}

} // End of namespace VML
} // End of namespace Office
} // End of namespace Parsers
