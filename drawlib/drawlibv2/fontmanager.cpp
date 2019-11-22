#include <drawlib/drawlibv2/allincludes.h>


#include "fontmanager.h"
#include "fontdata_internal.h"
//#include <freetype.h>
#include FT_TRUETYPE_TABLES_H
#include <iostream>

namespace DrawLib
{

Blex::Mutex freetype_use_lock;

namespace
{
FontManager globalfontmanager;
}

/** FreeTypeInstance - a class that creates an instance of the freetype library! */
class FreeTypeInstance
{
public:
        FreeTypeInstance();
        ~FreeTypeInstance();

        FT_Library& getft();
private:
        FT_Library library;
};

/******************************************************************************/

static FreeTypeInstance freetype;

FreeTypeInstance::FreeTypeInstance()
{
        FT_Init_FreeType(&library);
}

FreeTypeInstance::~FreeTypeInstance()
{
        FT_Done_FreeType(library);
        //std::cerr << "KILLED FREETYPE!\n";
}
FT_Library& FreeTypeInstance::getft()
{
        return library;
}

/******************************************************************************/

Font* Font::CreateFontFromFile(const std::string &fontfullpath,
        const std::string &metricsfullpath,
        unsigned long faceindex)
{
        Font *myfont;
        {
        Blex::Mutex::AutoLock freetype_use(freetype_use_lock);

        FT_Open_Args    args;
        FT_Error        error;

        args.pathname = const_cast<char*>(fontfullpath.c_str());
        args.driver   = 0;
        args.num_params = 0;
        args.flags = ft_open_pathname;
        myfont = new Font(fontfullpath);
        error = FT_Open_Face(freetype.getft(),    // library instance
                &args,                          // arguments
                faceindex,                      // face index
                &(myfont->data->face));               // face ptr

        if (error!=0)
        {
                if(myfont->data->face) //manually do this, to avoid recursive lock
                {
                        FT_Done_Face(myfont->data->face);
                        myfont->data->face = NULL;
                }
                delete myfont;
                return NULL;                    // there was an error opening the font!
        }

        if (!metricsfullpath.empty())
        {
                // load extra files..
                if (FT_Attach_File(myfont->data->face, metricsfullpath.c_str())!=0)
                        DEBUGPRINT("CreateFontFromFile: error attaching metrics file!");
        }

        FT_Encoding_ encoding;
        if (myfont->data->face->charmap == NULL)
                encoding = myfont->data->face->charmaps[0]->encoding;
        else
                encoding = myfont->data->face->charmap->encoding;

        myfont->data->use_private_area = encoding == ft_encoding_symbol;

        FT_Select_Charmap(myfont->data->face, encoding);

        } //end freetype lock
        myfont->SetSize(FPSize(12.0,12.0));
        return myfont;
}

void Font::SetColor(Pixel32 color)
{
        data->fontcolor = color;
}

double Font::GetCurrentAscender() const
{
        return ((double)data->face->ascender / data->face->units_per_EM) * data->EMSize;
}
double Font::GetCurrentDescender() const
{
        return ((double)data->face->descender / data->face->units_per_EM) * data->EMSize;
}
double Font::GetCurrentHeight() const
{
        return ((double)data->face->height / data->face->units_per_EM) * data->EMSize;
}

Font* Font::CreateFontFromMemory(uint8_t *fontmemptr, uint32_t fontmemsize, unsigned long faceindex)
{
        Font *myfont;
        {
        Blex::Mutex::AutoLock freetype_use(freetype_use_lock);
        FT_Open_Args    args;
        FT_Error        error;

        args.pathname = const_cast<char*>("");
        args.driver   = 0;
        args.num_params = 0;
        args.memory_base = fontmemptr;
        args.memory_size = fontmemsize;
        args.flags = ft_open_memory;
        myfont = new Font("");
        error = FT_Open_Face(freetype.getft(),    // library instance
                &args,                          // arguments
                faceindex,                      // face index
                &(myfont->data->face));         // face ptr
        if (error!=0)
        {
                delete myfont;
                return NULL;                    // there was an error opening the font!
        }

        FT_Encoding_ encoding;
        if (myfont->data->face->charmap == NULL)
                encoding = myfont->data->face->charmaps[0]->encoding;
        else
                encoding = myfont->data->face->charmap->encoding;

        myfont->data->use_private_area = encoding == ft_encoding_symbol;

        FT_Select_Charmap(myfont->data->face, encoding);
        } // End of freetype lock

//        myfont->SelectCharacterMap(UNICODEMAP);
        myfont->SetSize(FPSize(12.0,12.0));
        return myfont;
}

Font::~Font()
{
        if(data->face)
        {
                Blex::Mutex::AutoLock freetype_use(freetype_use_lock);
                FT_Done_Face(data->face);
        }
        delete data;
}

Font::Font(const std::string &fontfullpath)
{
        std::unique_ptr<Data> newdata(new Data);
        newdata->fontfullpath = fontfullpath;

        // you actually can't do anything usefull here
        // because the fontmanager creates the font object
        // before the 'face' in opened!
        // so all the FreeType II functions will fail!


        data = newdata.release(); //can't throw - must be the last statement
}

void Font::SelectCharacterMap(CharMap mymap)
{
        Blex::Mutex::AutoLock freetype_use(freetype_use_lock);
        //FT_Error error;
        switch(mymap)
        {
        case SYMBOLMAP:
                /*error = */FT_Select_Charmap(data->face, ft_encoding_symbol);
                data->use_private_area = true;
                break;
        case UNICODEMAP:           // intentional fallthrough.
        default:
                /*error = */FT_Select_Charmap(data->face, ft_encoding_unicode);
                data->use_private_area = false;
                break;
        }
//        if (error!=0)              // FIXME: problem.. no charactermap!
//                throw("Invalid Charmap!");             //FIXME:
}

bool Font::SetSize(FPSize size)
{
        Blex::Mutex::AutoLock freetype_use(freetype_use_lock);
        FT_Error error = FT_Set_Char_Size(data->face,
                RoundFloat(size.width*64.0),
                RoundFloat(size.height*64.0),
                72, 72);

        data->EMSize = size.height;
        //if (error!=0)
        //{
        //        throw("Size not available!");
        //}
        return (error==0);
}

bool Font::SetISize(ISize size)
{
        Blex::Mutex::AutoLock freetype_use(freetype_use_lock);
        FT_Error error = FT_Set_Pixel_Sizes(data->face, size.width, size.height);
        data->EMSize = size.height;
        return (error==0);
}

FontManager::FontManager()
{
        LockedMgrData::WriteRef lock(mgrdata);
        lock->must_rescan=true;
}

FontManager::~FontManager()
{
}

void FontManager::ForceRescan()
{
        LockedMgrData::WriteRef lock(mgrdata);
        lock->must_rescan = true;
}

void FontManager::GetFontList(std::vector<FontItem> *fonts)
{
        LockedMgrData::WriteRef lock(mgrdata);
        if (lock->must_rescan)
            lock->Rescan();
        *fonts = lock->fontlist;
}

void FontManager::AddFontDirectory(std::string const &fontdir)
{
        if (fontdir.empty())
            return;

        LockedMgrData::WriteRef lock(mgrdata);

        // Skip duplicate fontdirs
        for (unsigned i=0;i<lock->fontdirs.size();++i)
            if (lock->fontdirs[i] == fontdir)
                return;

        lock->must_rescan=true;
        lock->fontdirs.push_back(fontdir);
}

void FontManager::MgrData::Rescan()
{
        must_rescan=false;
        fontlist.clear();

        for (unsigned i=0;i<fontdirs.size();++i)
            ScanDirectory(fontdirs[i]);
}

Font* FontManager::CreateFontFromFile(const std::string &fontname, const std::string &fontstyle)
{
        LockedMgrData::WriteRef lock(mgrdata);
        if (lock->must_rescan)
            lock->Rescan();

        // search for the fontname and the fontstyle in the current fontlist..
        const FontItem *fontitem = lock->FindFontExact(fontname, fontstyle);
        if (fontitem==NULL)
            fontitem = lock->FindFontExact(fontname, "Regular");

        // ADDME: find a similar font!
        if (fontitem==NULL)
                return NULL;    // error, font not found!

        //Create the font!
        Font *myfont = Font::CreateFontFromFile(fontitem->fullpath, fontitem->metricpath, fontitem->faceindex);
        return myfont;
}

const FontManager::FontItem* FontManager::MgrData::FindFontExact(const std::string &fontfamily, const std::string &fontstyle)
{
        //std::cout << "Match '" << fontfamily << "' '" << fontstyle << "' (" << fontlist.size() << " fonts cached)\n";
        for(unsigned int i=0; i<fontlist.size(); i++)
        {
                if ((Blex::StrCaseCompare(fontfamily, fontlist[i].fontfamily)==0) &&
                    (Blex::StrCaseCompare(fontstyle, fontlist[i].fontstyle)==0))
                    return &(fontlist[i]);
        }
        return NULL;
}

void FontManager::AddTTFont(std::string const &fontpath)
{
        LockedMgrData::WriteRef lock(mgrdata);
        lock->AddFont(fontpath, true, false, false, false);
}

void FontManager::MgrData::AddFont(std::string const &fontpath, bool is_ttf, bool /*is_pcb*/, bool /*is_pfb*/, bool is_otf)
{
        Blex::Mutex::AutoLock freetype_use(freetype_use_lock);
        FT_Open_Args    args;
        FT_Face         face;
        FT_Error        error;

        args.pathname = const_cast<char*>(fontpath.c_str());
        args.driver   = 0;
        args.num_params = 0;
        args.flags = ft_open_pathname;
        error = FT_Open_Face(freetype.getft(),   // library instance
                     &args,     // arguments
                     0,         // face index
                     &face);    // face ptr

        if (error || !face)
            return;

        // ADDME: check the face->num_faces to see if there is more than one face!
        // if so.. add them too! I have never seen a TTF with more than one face!
        // I think there aren't any -> may not be supported by TTF files ??
        FontItem item;

        TT_OS2 *os2 = (is_ttf || is_otf) ? reinterpret_cast<TT_OS2*>(FT_Get_Sfnt_Table(face, ft_sfnt_os2)) : NULL;

        // ADDME: Actually, use the PANOSE field to compare fonts!!
        if (os2!=NULL)
        {
                uint8_t* ptr = reinterpret_cast<uint8_t*>(&(os2->sFamilyClass));
                item.IBMfontclass = Blex::getu8(ptr+1);
                item.IBMfontsubclass = Blex::getu8(ptr);

                uint8_t* ptr2 = reinterpret_cast<uint8_t*>(&(os2->fsSelection));
                uint8_t flags = *(ptr2);
                if ((flags & 0x01)>0)
                        item.italic = true;
                else
                        item.italic = false;
                if ((flags & 0x20)>0)
                        item.bold = true;
                else
                        item.bold = false;
        }
        else
        {
                item.IBMfontclass = 0;
                item.IBMfontsubclass = 0;
                item.bold = false;
                item.italic = false;
        }

        //std::cout<<face->family_name<<" " <<face->style_name << "\n";

        if(face->family_name)
            item.fontfamily = std::string(face->family_name);
        if(face->style_name)
            item.fontstyle  = std::string(face->style_name);
        item.metricpath = "";
        item.isTrueType = true;
        item.fullpath  = fontpath;
        item.faceindex = 0;
        fontlist.push_back(item);

        FT_Done_Face(face);
}

void FontManager::MgrData::ScanDirectory(const std::string &path)
{
        ScanDirectoryRecursive(path, 2);
}

void FontManager::MgrData::ScanDirectoryRecursive(const std::string &path, unsigned maxdepth)
{
        for(Blex::Directory fontdir(path, "*");fontdir.FilesLeft()==true; ++fontdir)
        {
                if (!fontdir.GetStatus().IsFile())
                {
                        if(maxdepth>0)
                                ScanDirectoryRecursive(fontdir.CurrentPath(), maxdepth-1);
                        continue;
                }

                bool is_ttf = Blex::StrCaseLike(fontdir.CurrentFile(),"*.ttf");
                bool is_pfb = Blex::StrCaseLike(fontdir.CurrentFile(),"*.pfb");
                bool is_pcf = Blex::StrCaseLike(fontdir.CurrentFile(),"*.pcf");
                bool is_otf = Blex::StrCaseLike(fontdir.CurrentFile(),"*.otf");
                if(!is_ttf && !is_pfb && !is_pcf && !is_otf)
                    continue;

                AddFont(fontdir.CurrentPath(), is_ttf, is_pfb, is_pcf, is_otf);
        }
}

FontManager& GetGlobalFontManager()
{
        return globalfontmanager;
}

} //end namespace Drawlib
