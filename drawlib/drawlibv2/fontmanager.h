#ifndef fontmanager_h
#define fontmanager_h

#include "drawlib_v2_types.h"
#include <blex/path.h>
#include <blex/threads.h>

namespace DrawLib
{

class TextRenderer;

extern Blex::Mutex freetype_use_lock;

/** Font - a font container class */
class BLEXLIB_PUBLIC Font
{
//friend class DrawLib::TextRenderer;
public:
        ~Font();

        /** CreateFont - create a font from a file */
        static Font* CreateFontFromFile(const std::string &fullpath, const std::string &metricsfullpath,
                unsigned long faceindex);

        /** CreateFontFromMemory - create a font form memory */
        static Font* CreateFontFromMemory(uint8_t *fontmemptr, uint32_t fontmemsize, unsigned long faceindex);
        //static Font* CreateInternalFont();

        /** SetSize - set the font size in points (72 DPI is assumed)
            returns true if size is available.*/
        bool SetSize(FPSize size);

        /** SetISize - set the font size in pixels
            returns true if size is available. */
        bool SetISize(ISize size);

        /** SetColor - set the font color */
        void SetColor(Pixel32 color);

        /** CharMap - the character map */
        enum CharMap {UNICODEMAP, SYMBOLMAP};

        /** SelectCharacterMap - selects Unicode or Symbol charactermap */
        void SelectCharacterMap(CharMap mymap);

        double GetCurrentAscender() const;
        double GetCurrentDescender() const;
        double GetCurrentHeight() const;

        struct Data;
        Data * data;

private:
        Font(const std::string &fullpath);
};

/** FontManager - a class that manages fonts */
class BLEXLIB_PUBLIC FontManager
{
public:
        class FontItem
        {
        public:
                std::string     fontfamily;
                std::string     fontstyle;
                std::string     fullpath;
                std::string     metricpath;
                long            faceindex;              // face index within ttf file!as
                bool            isTrueType;
                bool            bold;
                bool            italic;

                unsigned char   IBMfontclass;           //sFamilyClass field of a font's OS/2 table.
                unsigned char   IBMfontsubclass;        //sFamilyClass field of a font's OS/2 table.
        };

        FontManager();
        ~FontManager();

        /** Add a directory to our font search path
            @param fontdir Directory to add. If empty, no directory will be added */
        void AddFontDirectory(std::string const &fontdir);

        /** CreateFont - creates a Font object that can be used to draw text on a canvas
            If the fontname and fontstyle are not available, this returns a dummy Font object! */
        Font* CreateFontFromFile(const std::string &fontname, const std::string &fontstyle);

        /* CreateInternalFont - creates an internal font (non truetype, non scalable!)
            for now, it only creates helvetical Regular 10 points!
        */

        //Font* CreateInternalFont();

        void GetFontList(std::vector<FontItem> *fonts);

        /// Force a rescan of the font cache on the next request for fonts
        void ForceRescan();

private:
        // Add a true type font to the font table
        void AddTTFont(std::string const &fontpath);

        struct MgrData
        {
                void Rescan();
                void AddFont(std::string const &fontpath, bool is_ttf, bool is_pcb, bool is_pfb, bool is_otf);
                void ScanDirectory(const std::string &path);    // scan a directory for .TTF and .PFM files!

                const FontItem* FindFontExact(const std::string &fontfamily, const std::string &fontstyle);

                //Do we need to rescan our fontlist?
                bool must_rescan;
                //The current list of font directories
                std::vector<std::string> fontdirs;
                //The current font list
                std::vector<FontItem>   fontlist;

                void ScanDirectoryRecursive(const std::string &path, unsigned maxdepth);    // scan a directory for .TTF and .PFM files!
        };

        typedef Blex::InterlockedData<MgrData, Blex::Mutex> LockedMgrData;

        LockedMgrData mgrdata;

};

/** Return a reference to the global font manager. Drawlib always builds one
    global font manager, which can be used by any function that needs access
    to one or more fonts. The global font manager object is thread-safe */
BLEXLIB_PUBLIC FontManager& GetGlobalFontManager();

} //end namespace DrawLib

#endif
