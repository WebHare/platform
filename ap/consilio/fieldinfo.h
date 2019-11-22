#ifndef blex_consilio_index_fieldinfo
#define blex_consilio_index_fieldinfo

#include "document.h"

namespace Lucene
{

/** Information about a Field. */
struct FieldInfo
{
        /** Create a new Field information structure.
            @param name The Field name
            @param isindexed This is an indexed Field
            @param number The Field number */
        FieldInfo(const std::string & name, bool isindexed, uint32_t number);

        /// The Field's name
        std::string name;
        /// Is this Field indexed?
        bool isindexed;
        /// The Field's number
        uint32_t number;
};

/** Read or write Field information. */
class FieldInfos
{
    public:
        /** Create a new, empty FieldInfos reader/writer. */
        FieldInfos();
        /** Create a FieldInfos reader/writer for an existing index segment.
            @param d A Blex::ComplexFileSystem to read the information from
            @param name The name of the segment field infos files (.fnm) to read
                        from */
        FieldInfos(Blex::ComplexFileSystem &d, const std::string & name);

        /** Add all Field%s from a Document. The fields are numbered according
            to the order they appear in in the Document.
            @param doc The Document to add the Field%s from */
        void Add(const Document & doc);
        /** Add a list of Field%s. The fields are numbered according to the order
            they have in the list.
            @param names The list of Field names to add
            @param isindexed The Field%s are indexed */
        void Add(const std::vector<std::string> & names, bool isindexed);
        /** Add a list of Field%s. The fields are numbered according to the order
            they have in the list.
            @param names The list of Field names to add
            @param isindexed The Field%s are indexed */
        void Add(const std::set<std::string> & names, bool isindexed);
        /** Add a single Field. If a Field with the given @c name already exists,
            the @c isindexed information is updated.
            @param name The Field name
            @param isindexed The Field is indexed */
        void Add(const std::string & name, bool isindexed);

        /** Get the number of a Field.
            @param fieldname The Field name to look for
            @return The number of the Field, or -1 if @c fieldname could not be
                    found */
        int32_t FieldNumber(const std::string & fieldname) const;
        /** Get the name of a Field.
            @param fieldnumber The Field number
            @return The Field's name */
        const std::string & FieldName(uint32_t fieldnumber) const;
        /** Get the FieldInfo for a field.
            @param fieldname The Field name to look for
            @return A pointer to the FieldInfo, or NULL if @c fieldname could not
                    be found */
        const FieldInfo * GetFieldInfo(const std::string & fieldname) const;
        /** Get the FieldInfo for a field.
            @param fieldnumber The Field number
            @return A pointer to the FieldInfo, or NULL if @c fieldname could not
                    be found */
        const FieldInfo * GetFieldInfo(uint32_t fieldnumber) const;
        /** Get the number of Field%s.
            @return The number of Field%s */
        uint32_t Size() const;

        /** Write the Field information to a Blex::ComplexFileSystem.
            @param d The Blex::ComplexFileSystem to write the information to
            @param name The name of the segment field infos files (.fnm) to write
                        to */
        void Write(Blex::ComplexFileSystem &d, const std::string & name);
        /** Write the Field information to a Blex::ComplexFileStream.
            @param output The Blex::ComplexFileStream file to write the information
                          to */
        void Write(Blex::ComplexFileStream &output);
        /** Read the Field informtion from a Blex::ComplexFileStream.
            @param input The Blex::ComplexFileStream file to read the information
                         from */
        void Read(Blex::ComplexFileStream &input);

    private:
        /** Add a Field with a given name to the FieldInfos.
            @param name The name of the new Field
            @param isindexed If the Field is indexed */
        void AddInternal(const std::string & name, bool isindexed);

        /** The list of Field%s.
            The position within this list is the Field number. */
        std::vector<FieldInfo> bynumber;
        /// A map to of Field names to numbers.
        std::map<std::string, uint32_t> byname;
};

} // namespace Lucene

#endif

