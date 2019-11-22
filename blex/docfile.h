#ifndef blex_docfile
#define blex_docfile

#ifndef blex_stream
#include "stream.h"
#endif
#ifndef blex_datetime
#include "datetime.h"
#endif
#include <stdexcept>
#include <map>
#include <deque>

namespace Blex
{

/** An exception thrown by the OLE system when it hits corrupted data, or is
    passed illegal arguments */
class BLEXLIB_PUBLIC DocfileException : public std::runtime_error
{
        public:
        DocfileException(std::string const & what_arg);
        ~DocfileException() throw();
};

/** OLE (compound document) archive */
class BLEXLIB_PUBLIC Docfile
{
        public:
        struct File;
        class Data;
        struct Directory;

        ///Verify if a signature belongs to an OLE file
        static bool IsDocfileSignature(const uint8_t sig[8]);

        /** Open OleArc with the specified filename
            throws OleArcException on failure */
        Docfile(Blex::RandomStream &infile);

        /** Destroy OleArc */
        virtual ~Docfile();

        /** Get the root directory of an OLE archive
            @return Pointer to the directory, never NULL */
        Directory const * GetRoot () const;

        /** Find a file in an OLE directory
            @param dir Directory to look in
            @param name File to look for, UTF8 encoded string
            @return A pointer to the OLE file, or NULL if the file was not found*/
        static File const * FindFile (Directory const *dir, std::string const &name);

        /** Find a directory in an OLE directory
            @param dir Directory to look in
            @param name Directory to look for, UTF8 encoded string
            @return A pointer to the directory, or NULL if the directory was not found */
        static Directory const * FindDirectory (Directory const *dir, std::string const &name);

        /** Get a vector with all Files in a directory */
        static std::vector<std::string> GetFiles(Directory const *dir);

        /** Get a vector with all Directories in a directory */
        static std::vector<std::string> GetDirectories(Directory const *dir);

        /** Get a directorie's CLSID */
        static uint8_t const * GetCLSID(Directory const *Dir);

        /** Open a file contained in an OLE archive
            @param file File to open. May not be NULL
            @return A stream containing the file. Never NULL*/
        RandomStream* OpenOleFile(const File *file);

        private:
        ///Insulated OLE internal data
        Data *data;

        Docfile(Docfile const&); //not implemented
        Docfile& operator=(Docfile const &); //not implemented
        friend std::ostream& operator<<(std::ostream &str, Blex::Docfile const &arc);
};

/** OLE (compound document) archive that takes ownership of the stream passed
    to it*/
class BLEXLIB_PUBLIC StreamOwningDocfile : public Docfile
{
        public:
        /** Create the docfile with the specified file
            @param adopt_infile Source for the Word document, will be destroyed when the Docfile is closed */
        StreamOwningDocfile(Blex::RandomStream *adopt_infile);

        ~StreamOwningDocfile();

        private:
        std::unique_ptr<Blex::RandomStream> adoptedfile;
};

/** An OLE propery set */
class BLEXLIB_PUBLIC OlePropertySet
{
        public:
        OlePropertySet();

        ~OlePropertySet();

        enum Type
        {
                V_SignedInteger,
                V_UnsignedInteger,
                V_Float,
                V_DateTime,
                V_String,
                V_Array
        };

        /** A section inside the property set (old PPS (eg Word95) can contain
            more than one section, this OlePropertySet class doesn't support
            it yet */
        struct Section
        {
                typedef std::map<uint32_t, unsigned> PropertyMap;
                typedef std::map<uint32_t, std::string> Dictionary;

                ///CLSID containing the format id
                uint8_t format_id[16];
                ///Start offset of this section inside properties file
                unsigned startoffset;
                ///Map property ids to memory storage ids (to work with arrays etc)
                PropertyMap props;
                ///Property id->name mapping
                Dictionary dictionary;
                /** Find a property by ID
                    @param id Property ID to retrieve
                    @return Store id of the property, or 0 if it is not found */
                unsigned FindProperty(unsigned id) const;
                /** Find a property by name
                    @param name Name of property to find
                    @return Store id of the property, or 0 if it is not found */
                unsigned FindPropertyByName(std::string const &name) const;
        };

        /** Get the type for a specific storage */
        Type GetType(unsigned storeid) const;

        /** Get the int64_t value of a store */
        int64_t GetSigInteger(unsigned storeid) const;

        /** Get the uint64_t value of a store */
        uint64_t GetUnsInteger(unsigned storeid) const;

        /** Get the floating point value of a store */
        F64 GetFloat(unsigned storeid) const;

        /** Get the datetime value of a store */
        Blex::DateTime GetDateTime(unsigned storeid) const;

        /** Get the string value of a store */
        std::string GetString(unsigned storeid) const;

        /** Get the length of an array */
        unsigned GetArrayLength(unsigned storeid) const;

        /** Get an element of an array
            @param storeid Storage to read
            @param which Element number to obtain (0-based)
            @return The storeid of the contained element*/
        unsigned GetArrayElement(unsigned storeid, unsigned which) const;

        /** Parse a file as an OLE property set and store the properties into this object
            @param str Stream to parse
            @return True if the properties were succesfully parsed */
        bool ParseProperties(Blex::Stream &str);

        /** Get number of sections */
        unsigned GetNumSections() const
        {
                return sections.size();
        }

        /** Get section number by format id
            @return -1 if section not found */
        int FindSectionByFormatId(uint8_t const *format_id) const;

        /** Get section by sequence number */
        Section const & GetSection(unsigned secnum) const
        {
                return sections[secnum];
        }

        private:
        /** An OLE variant storage */
        struct Variant
        {
                Type type;

                union Data
                {
                        ///pointer to data in extra store or array
                        struct StorePointer
                        {
                                unsigned pos;
                                unsigned len;
                        } sptr;
                        uint64_t val_integer;
                        F64 val_float;
                } data;
                Blex::DateTime data_time;
        };

        template<class WhichType> WhichType MyGet(const void *location) const
        {
                if (is_little_endian)
                    return GetLsb<WhichType>(location);
                else
                    return GetMsb<WhichType>(location);
        }

        std::pair<unsigned, unsigned> ParseSingleProperty(uint16_t codepage, uint32_t proptype, uint8_t const *data, unsigned len);
        unsigned ParseProperty(uint16_t codepage, uint8_t const *data, unsigned len);
        void ParseDictionary(uint16_t codepage, Section *sect, uint8_t const *data, unsigned len);

        bool ParseSection(Section *sect, uint8_t const *data, unsigned len);

        unsigned AddUnsInteger(uint64_t value);
        unsigned AddSigInteger(int64_t value);
        unsigned AddFloat(F64 value);
        unsigned AddDateTime(Blex::DateTime value);
        unsigned AddString(uint16_t codepage,void const *firstbyte, unsigned len);
        unsigned AddUCS16String(void const *firstbyte, unsigned len);
        unsigned AddFileTime(void const *filetime);
        unsigned AddRawData(void const *firstbyte, unsigned len);
        unsigned AddArray(std::vector<unsigned> const &propids);

        std::deque<Variant> variants;
        std::vector<char> extrastore;
        std::vector<unsigned> arraystore;

        std::vector<Section> sections;
        bool is_little_endian;
};

}

#endif
