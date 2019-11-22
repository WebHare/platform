#ifndef blex_consilio_index_term
#define blex_consilio_index_term

namespace Lucene
{

/** A single, searchable term.
    A Term consists of a field and a value. The term value is the smallest unit
    of text that is indexed. */
class Term
{
    public:
        /** Create an unitialized (invalid) Term. */
        Term();
        /** Create an initialized Term.
            @param fld The Term field
            @param txt The Term text */
        Term(const std::string & fld, const std::string & txt);

        /** Is this a valid (initialized) Term? */
        inline bool Valid() const
        {
                return valid;
        }

        /** Get this Term's field value.
            @return The Term field */
        inline const std::string & Field() const
        {
                return field;
        }

        /** Get this Term's text value.
            @return The Term text */
        const std::string & Text() const
        {
                return text;
        }

        /** Is this Term equal to an @c other Term?
            @param other The Term to compare to
            @return If the two Term%s are equal */
        bool Equals(const Term & other) const;

        /** Compare this Term to an @c other Term.
            A Term comes before another Term if the ::field value is less than
            the @c other field value, or if the fields are equal and the ::text
            value is less than the @c other text value.
            @param other The Term to compare to
            @return <0 if this Term comes before the @c other Term, 0 if the two
                    Term%s are equal, or >0 if this Term comes after the @c other
                    Term */
        int CompareTo(const Term & other) const;

        /** Does this Term starts with an @c other Term?
            A Term starts with another Term if the ::field values are equal and
            the ::text value starts with the other text value.
            @param other The Term to compare to
            @return If this Term starts with the other Term */
        bool StartsWith(const Term &other) const;

        /** Set this Term's ::field and ::text value.
            @param fld The new field value
            @param txt The new text value
        */
        void Set(const std::string & fld, const std::string & txt);

        /** Set this Term's ::field and ::text value.
            @param fld The new field value
            @param txt_begin Pointer to begin of new text value
            @param txt_end Pointer to end of new text value
        */
        void Set(const std::string & fld, const char *txt_begin, const char *txt_end);

        /** Set this Term's ::field and ::text value to another Term's values.
            @param src The source Term to copy the field and text values from */
        void Set(const Term & src);

        /** Get a "field:text" string representation of this Term.
            @return A string representing this Term */
        std::string ToString() const;

        /** Swaps the contents of this term with another term
            @param other Term to swap values with */
        void Swap(Term & other)
        {
                std::swap(valid, other.valid);
                std::swap(field, other.field);
                std::swap(text, other.text);
        }

    private:
        /// Is this Term initialized?
        bool valid;

        /// This Term's field value
        std::string field;
        /// This Term's text value
        std::string text;
};

bool operator== (const Term & x, const Term & y);
bool operator< (const Term & x, const Term & y);

} // namespace Lucene

#endif

