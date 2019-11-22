#ifndef blex_consilio_document_document
#define blex_consilio_document_document

#include "field.h"

namespace Lucene
{

/** A list of Document Field%s. */
typedef std::vector<Field> DocumentFieldList;

/** A single Document.
    A Document contains zero or more Field%s. */
class Document
{
    public:
        Document();
        ~Document();

        /** Set the boost factor for this Document.
            @param boost The new boost factor */
        void SetBoost(float boost);
        /** Get the current boost factor for this Document.
            @return The current boost factor */
        float GetBoost() const;

        /** Add a Field to this Document. A Document can contain Field%s with the
            same name. These will all be indexed under the same name in the index.
            @param field The Field to add */
        void Add(const Field & field);
        /** Get the first Field with a given name.
            @param name The name of the Field to retrieve
            @return A pointer to the Field, or NULL if no Field with the given
                    name exists */
        const Field * GetField(const std::string & name) const;
        /** Get the value of a Field with a given name.
            @param name The name of the Field to retrieve
            @return The value of the Field, or an empty string if no Field with
                    the given name exists */
        const std::string & Get(const std::string & name) const;

        /** Get all Field%s.
            @return A list of Field%s */
        const DocumentFieldList & Fields() const;
        /** Get all Field%s with a given name.
            @param name The name of the Field%s to retrieve
            @return A list of Field%s */
        DocumentFieldList GetFields(const std::string & name) const;
        /** Get all Field values of Field%s with a given name.
            @param name The name of the Field%s to retrieve
            @return A list of Field values */
        std::vector<std::string> GetValues(const std::string & name) const;

        /** Get a string representation of this Document. The is a list of all
            Field%s with their names and values.
            @return A string representing the Document */
        std::string ToString() const;

    private:
        /// The Field%s in this Document.
        DocumentFieldList fieldlist;
        /// This Document's boost factor
        float boost;
};

} // namespace Lucene

#endif

