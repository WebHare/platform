#ifndef blex_webhare_compiler_visitors
#define blex_webhare_compiler_visitors

#include <map>
#include <iostream>

/** Visitors

    Before defining of visitors to specific structs, declare them
    (eg by using FORWARD).

    A visitor can only visit functons that derive from a specific
    base object (the base-visited-node)

    After that, build the basevisitors. These must have the following
    form:
    struct BaseXXXVisitor
    {
        NODEBASEACCEPTER(visitednode1)
        NODEBASEACCEPTER(visitednode2)
        NODEBASEACCEPTER(visitednode3)
        ...
    };
    The name must be BaseXXXVisitor, with XXX being the identity of the
    visitor.

    The visitor itself is defined by:

    template <class ReturnType, class ParameterType>
     struct XXXVisitor : public BaseXXXVisitor
    {
        typedef SQLSourceVisitor<ReturnType, ParameterType> VisitorType;
        VISITOR_VISITORFUNC(SQLSource, VisitorType)

        VISITOR_PERCLASSDEFS(VisitorType, visitednode1)
        VISITOR_PERCLASSDEFS(VisitorType, visitednode2)
        VISITOR_PERCLASSDEFS(VisitorType, visitednode3)
        ...
    }

    The visited node structures itself must have a
     DEFINE_NODE_FUNCTIONS1/DEFINE_NODE_FUNCTIONS2/...
    macro used in them, with the list of all visitors that can
    access them eg:

    struct visitednode1
    {
        DEFINE_NODE_FUNCTIONS1(base-visited-node, XXX)
    };

    To use a visitor, inherit from the XXXVisitor<ReturnType, ParameterType> class,
    and put for every visited node YYY the following function in the class:
     virtual ReturnType V_YYY(YYY *, ParameterType);

    Further description: (to build)
     visitor functors
     ReplacePtr
    */

namespace HareScript
{
namespace Compiler
{

/// Empty structure, can be used as low-cost parameter alternative for a parameter
struct Empty {};

/// Name of a visitor function, based on the class that calls it
#define VISITOR_FUNCTION_NAME(classname) V_##classname

#define VISITOR_ACCEPTER_NAME(classname) A_##classname

/// Name of a visitor class, based on the type of nodes it visits
#define BASE_VISITOR_NAME(classtype) Base##classtype##Visitor
#define VISITOR_NAME(classtype) classtype##Visitor

/// Defines all functions within a node that do not depend on a visitor
#define DEFINE_NODE_BASIC_FUNCTIONS(classname) \
 static const char * GetStaticName() { return #classname; } \
 virtual const char * GetName() { return #classname; }

/// Defines functions within a node that every node needs (now only Accept, and GetName)
#define NODE_ACCEPTER(classname, classtype) \
 virtual void XAccept(BASE_VISITOR_NAME(classtype) &visitor) { visitor.VISITOR_ACCEPTER_NAME(classname)(this); } \

#define DEFINE_NODE_FUNCTIONS1(classname, visitor1) \
 DEFINE_NODE_BASIC_FUNCTIONS(classname) \
 NODE_ACCEPTER(classname, visitor1)
#define DEFINE_NODE_FUNCTIONS2(classname, visitor1, visitor2) \
 DEFINE_NODE_BASIC_FUNCTIONS(classname) \
 NODE_ACCEPTER(classname, visitor1) \
 NODE_ACCEPTER(classname, visitor2)
#define DEFINE_NODE_FUNCTIONS3(classname, visitor1, visitor2, visitor3) \
 DEFINE_NODE_BASIC_FUNCTIONS(classname) \
 NODE_ACCEPTER(classname, visitor1) \
 NODE_ACCEPTER(classname, visitor2) \
 NODE_ACCEPTER(classname, visitor3)
#define DEFINE_NODE_FUNCTIONS4(classname, visitor1, visitor2, visitor3, visitor4) \
 DEFINE_NODE_BASIC_FUNCTIONS(classname) \
 NODE_ACCEPTER(classname, visitor1) \
 NODE_ACCEPTER(classname, visitor2) \
 NODE_ACCEPTER(classname, visitor3) \
 NODE_ACCEPTER(classname, visitor4)
#define DEFINE_NODE_FUNCTIONS5(classname, visitor1, visitor2, visitor3, visitor4, visitor5) \
 DEFINE_NODE_BASIC_FUNCTIONS(classname) \
 NODE_ACCEPTER(classname, visitor1) \
 NODE_ACCEPTER(classname, visitor2) \
 NODE_ACCEPTER(classname, visitor3) \
 NODE_ACCEPTER(classname, visitor4) \
 NODE_ACCEPTER(classname, visitor5)

#define FORWARD(name) struct name

#define NODEBASEACCEPTER(classname) \
 virtual void VISITOR_ACCEPTER_NAME(classname)(classname *obj) = 0;

#define VISITOR_V_FUNCTIONDEF(visitorname, classname) \
 virtual ReturnType VISITOR_FUNCTION_NAME(classname) (classname *obj, ParameterType param) = 0;

#define VISITOR_PERCLASSDEFS(visitorname, classname) \
 virtual void VISITOR_ACCEPTER_NAME(classname) (classname *) \
 { \
        current = reinterpret_cast<TV_CallType>(&visitorname::VISITOR_FUNCTION_NAME(classname)) ; \
 } \
 VISITOR_V_FUNCTIONDEF(visitorname, classname)

void ThrowReplaceTypeError(const char *currenttype_name, const char *newtype_name, const char *ptrtype_name);

template <class Visitor, class ReturnType, class Parameter> struct BaseVisitorFunctor
{
        Visitor *visitor;
        BaseVisitorFunctor(Visitor *visitor) : visitor(visitor) {}
        template <class Node>
         ReturnType operator ()(Node*& node, Parameter parameter);
};

template <class Visitor, class ReturnType, class Parameter> template <class Node>
 ReturnType BaseVisitorFunctor<Visitor, ReturnType, Parameter>::operator ()(Node*& node, Parameter parameter)
{
        typename Visitor::BaseNode *oldreplace = visitor->replace_by;
        visitor->replace_by = 0;
        node->XAccept(*visitor);
        ReturnType retval = (visitor->*(visitor->current))(node, parameter);
        if (visitor->replace_by)
        {
                Node* casted_replace_by = dynamic_cast<Node*>(visitor->replace_by);
                if (!casted_replace_by)
                    ThrowReplaceTypeError(node->GetName(), visitor->replace_by->GetName(), Node::GetStaticName());
                visitor->replace_by = 0;
                node = casted_replace_by;
        }
        visitor->replace_by = oldreplace;
        return retval;
}

template <class Visitor, class Parameter> struct BaseVisitorFunctor<Visitor, void, Parameter>
{
        Visitor *visitor;
        BaseVisitorFunctor<Visitor, void, Parameter>(Visitor *visitor) : visitor(visitor) {}
        template <class Node>
         void operator ()(Node*& node, Parameter parameter);
};

template <class Visitor, class Parameter> template <class Node>
 void BaseVisitorFunctor<Visitor, void, Parameter>::operator ()(Node*& node, Parameter parameter)
{
        typename Visitor::BaseNode *oldreplace = visitor->replace_by;
        visitor->replace_by = 0;
        node->XAccept(*visitor);
        (visitor->*(visitor->current))(node, parameter);
        if (visitor->replace_by)
        {
                Node* casted_replace_by = dynamic_cast<Node*>(visitor->replace_by);
                if (!casted_replace_by)
                    ThrowReplaceTypeError(node->GetName(), visitor->replace_by->GetName(), Node::GetStaticName());
                node = casted_replace_by;
        }
        visitor->replace_by = oldreplace;
}

/* Defines basic visitor functions
   @param basenodeclasstype Base class of nodes that can be visited
   @param visitorclassname Name of visitor. If templated, only the classname itself
   @param qualifiedvisitorclassname Name of visitor, with templates parameters explicitly stated (as in Visitor<param1, param2>) */
#define VISITOR_VISITORFUNC(basenodeclasstype, visitorclassname, qualifiedvisitorclassname) \
    private: \
        typedef ReturnType (visitorclassname::*TV_CallType)(basenodeclasstype*, ParameterType); \
        TV_CallType current; \
        basenodeclasstype* replace_by; \
    public: \
        typedef ReturnType returntype; \
        typedef ParameterType parametertype; \
        typedef basenodeclasstype BaseNode; \
        BaseVisitorFunctor<visitorclassname, ReturnType, ParameterType> Visit; \
        friend struct BaseVisitorFunctor<qualifiedvisitorclassname, ReturnType, ParameterType>; \
        visitorclassname() : replace_by(0), Visit(this) {} \
        virtual ~visitorclassname() {} \
        void ReplacePtr(BaseNode* node) { replace_by = node; }

// -----------------------------------------------------------------------------
//
//      Attribute storage
//
template <class BaseType, class StoredDataType>
 class AttributeStorage
{
    protected:
        std::map<BaseType *, StoredDataType> data;

    public:
        const StoredDataType & operator [](BaseType const *key) const
        {
                typename std::map<BaseType *, StoredDataType>::iterator it = data.find(key);
                if (it == data.end())
                    throw std::runtime_error("non existing attribute accessed");
                return *it;
        };
        StoredDataType & operator [](BaseType *key)
        {
                return data[key];
        }
        void Clear() { data.clear(); }

        bool Exists(BaseType *key)
        {
                typename std::map<BaseType *, StoredDataType>::iterator it = data.find(key);
                return (it != data.end());
        }
};

/** Class for usage in for_each algorithm. Stores the parameter internally. */
template <class Visitor>
 class VisitorFunctorBase
{
    protected:
        Visitor* visitor;
        typename Visitor::parametertype parameter;
        VisitorFunctorBase(Visitor* visitor, typename Visitor::parametertype parameter) : visitor(visitor), parameter(parameter) {}
};

template <class Visitor, bool IgnoreNullPtrs>
 class VisitorFunctor;
template <class Visitor>
 class VisitorFunctor<Visitor, false>: public VisitorFunctorBase<Visitor>
{
    public:
        VisitorFunctor(Visitor* visitor, typename Visitor::parametertype parameter) : VisitorFunctorBase<Visitor>(visitor, parameter) {}
        template <class Node> typename Visitor::returntype operator() (Node *& node)
        {
                return this->visitor->Visit(node, this->parameter);
        }
};

template <class Visitor>
 class VisitorFunctor<Visitor, true>: public VisitorFunctorBase<Visitor>
{
    public:
        VisitorFunctor(Visitor* visitor, typename Visitor::parametertype parameter) : VisitorFunctorBase<Visitor>(visitor, parameter) {}
        template <class Node> typename Visitor::returntype operator() (Node *& node)
        {
                if (node)
                    return this->visitor->Visit(node, this->parameter);
                return typename Visitor::returntype();
        }
};

/** Automatic creater functions for building visitorfunctors inline */
template <class Visitor>
 VisitorFunctor<Visitor, false> GetVisitorFunctor(Visitor* visitor, typename Visitor::parametertype parameter)
{
        return VisitorFunctor<Visitor, false>(visitor, parameter);
}

template <class Visitor>
 VisitorFunctor<Visitor, true> GetSafeVisitorFunctor(Visitor* visitor, typename Visitor::parametertype parameter)
{
        return VisitorFunctor<Visitor, true>(visitor, parameter);
}


} // end of namespace Compiler
} // end of namespace HareScript

#endif




