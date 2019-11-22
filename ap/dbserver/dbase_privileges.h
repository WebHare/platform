#ifndef blex_webhare_shared_dbase_privileges
#define blex_webhare_shared_dbase_privileges

#include "dbase_types.h"

namespace Database
{

class BackendTransaction;
class SchemaDef;
class ObjectDef;

namespace Privilege
{
enum _type
{
Table_Delete                    = 0,
Column_Insert                   = 1,
Column_References               = 2,
Column_Select                   = 3,
Column_Update                   = 4
};
/** Cycle through privileges (used in privilege information_schema views). */
inline _type GetNextPrivilege(_type curpriv)
{
        if (curpriv == Column_Update)
            return Table_Delete;
        else
            return (_type)(curpriv+1);
}
} // End of namespace Privilege

/** A privilege descriptor is the C++ keeper of privileges. */
struct PrivilegeDescriptor
{
        static const unsigned NumPrivileges = 5;

        /// Constructor, builds descriptor without any privileges
        PrivilegeDescriptor();

        /// Clears all privileges
        void Clear();

        /// Gives all privileges
        void GiveAllPrivileges(MetaObjectType::_type object_type, bool with_grant_option);

        /// Add a privilege to this descriptor
        void AddPrivilege(Privilege::_type priv, bool with_grant_option);

        /// Adds grant options to all privileges in this descriptor
        void AddGrantOptions();

        /// Read a privilege descriptor from a database cell
        void ReadFromCell(Cell const &db_cell);

        /// Returns if this descriptor contains a certain privilege
        bool HasPrivilege(Privilege::_type priv) const;

        /// Returns if this descriptor has enough privileges to grant a certain privilege
        bool CanGrant(Privilege::_type priv) const;

        /// Set a database cell with the contents of this descriptor
        void SetCell(WritableRecord &rec, ColumnId col_id) const;

        /// Merge this descriptor with another one
        void Merge(PrivilegeDescriptor const &rhs);

        /// Erase privileges from a descriptor from this one
        void Erase(PrivilegeDescriptor const &rhs, bool remove_only_grant_option);

        /// Returns whether this descriptor have enought privileges for other privileges, ignores grant options
        bool HasPrivileges(PrivilegeDescriptor const &grants) const;

        /// Returns whether this descriptor have enough privileges to grant other for other privileges
        bool CanGrant(PrivilegeDescriptor const &grants) const;

        /// Returns whether this descriptor contains no privilges at all
        bool IsEmpty() const;

        /// Keeps all grantable privileges (sets them non-grantable),a nd erases non-grantable privileges
        void BuildGrantablePrivileges();

        /// Checks if all privileges in this descriptor apply to the object_type
        bool CheckForApplicability(MetaObjectType::_type object_type);

        std::string GetRawDescriptorCode() const { return std::string(descriptor, descriptor + NumPrivileges); }

    private:
        /** Internal string containing data
            Current format: descriptor[Privilege::_type] == ' ' | 'B' | 'C':
            ' ': no privs, 'B': has priv, 'C': has priv with grant opt */
        char descriptor[NumPrivileges];
};

/** Definition of a role */
struct RoleDef
{
    public:
        inline RoleDef() : cache_cr_gen(0), cache_ar_gen(0) {}

        /// Id of this role
        int32_t role_id;

        /// Name of this role
        std::string name;

        /// Schema this role resides in
        SchemaDef *schema;

    private:
        typedef std::map< RoleDef *, bool > RoleAdminMap;

        /// Map of all valid grants with this role as grantee, together with a flag indicating of admin rights were given
        RoleAdminMap direct_valid_grants;

        /// Generation counter of cached_contained_roles cache
        unsigned cache_cr_gen;

        /// Map of all contained roles (does not include self)
        RoleAdminMap cached_contained_roles;

        /// Generation counter of cached_applicable_roles cache
        unsigned cache_ar_gen;

        /// Map of all applicable roles (does not include self)
        RoleAdminMap cached_applicable_roles;

        //friend class HotMetadata;
        //friend class MetadataManager;
        friend class PrivilegeChecker;
};

/** Definition of a role grant */
struct RoleGrantDef
{
    public:
        /// Id of this role grant
        unsigned id;

        /// Role describing grantor
        RoleDef *grantor;

        /// Role describing grantee
        RoleDef *grantee;

        /// Role describing role that has been granted
        RoleDef *role;

        /// Flag indicating whether the grant was with admin option
        bool with_admin_option;

    private:
        /// Flag indicating whether this grant  has already been validated
        bool is_valid;

        //friend class HotMetadata;
        //friend class MetadataManager;
        friend class PrivilegeChecker;
};

/** Definition of a grant */
struct GrantDef
{
        /// Id of this grant
        unsigned id;

        /// Role describing grantor
        RoleDef const *grantor;

        /// Role describing grantee
        RoleDef const *grantee;

        /// Id of object this grant pertains to
        ObjectDef const *object;

        /// Privileges given by this grant
        PrivilegeDescriptor privs;

    private:
        /// Flag indicating that this grant has been validated.
        bool is_valid;

        //friend class HotMetadata;
        //friend class MetadataManager;
        friend class PrivilegeChecker;
};

/** This class contains all code to deal with checking of privilege grants and role grants.
    It is flexible enough to function as checker of metadata changes themselves and as metadata
    readin time checks. Not MT-safe. */
class PrivilegeChecker
{
public:
        /// Map for storing roles (quick access only, no references)
        typedef std::map< RoleId, RoleDef > Roles;
        /// Map for storing role grants (quick access only, no references)
        typedef std::multimap< std::pair< RoleDef const *, RoleDef const * >, RoleGrantDef > RoleGrants;
        /// Map for storing grants (quick access only, no references)
        typedef std::multimap< std::pair< RoleDef const *, ObjectDef const * >, GrantDef > Grants;
        /// Constant iterator for role container
        typedef Roles::const_iterator RoleCItr;
        /// Constant iterator for role grant container
        typedef RoleGrants::const_iterator RoleGrantCItr;
        /// Constant iterator for grant container
        typedef Grants::const_iterator GrantCItr;

        inline PrivilegeChecker()
        {
        }

        RoleDef const * GetRoleDef(RoleId role) const
        {
                Roles::const_iterator bound = roles.find(role);
                return bound != roles.end() ? &bound->second : NULL;
        }
        RoleDef * GetRoleDef(RoleId role)
        {
                return const_cast<RoleDef*>(const_cast<PrivilegeChecker const*>(this)->GetRoleDef(role));
        }

        /** Add a grant to our metadata */
        bool AddGrant(GrantDef const &newgrant);
        /** Add a role to our metadata */
        bool AddRole(RoleDef const &newgrant);
        /** Add a role grant to our metadata */
        bool AddRoleGrant(RoleGrantDef const &newgrant);

        /** Checks (and marks as valid) all of the grant data, and fills caches. Validity checking is always done,
            and is usable whether this function throws or not.
            Detected are: abandoned role grants, role grant cycles and abandoned grants.
            Non-unique records (only differing in with_admin or mask) are not picked up.
            @param allow_grant_inconsistencies If true, no exception is thrown on error.
            @returns Whether all grants and role grants are not abandoned */
        void ProcessAndValidateGrantData(bool allow_grant_inconsistencies);

        /** Merges all privileges that have directly been granted to a role on a object or its parents
            @param role Role grants have been directly applied to
            @param object Object to check
            @param privs Privilege descriptor to which the privileges are merged */
        void MergeDirectPrivilegesForObject(RoleDef const *role, ObjectDef const &object, PrivilegeDescriptor *privs) const;

        /** Merges all privileges that have directly been granted to a role on a object (excluding parents)
            @param role Role grants have been directly applied to
            @param object Object to check
            @param privs Privilege descriptor to which the privileges are merged */
        void MergeDirectPrivilegesForSingleObject(RoleDef const *role, ObjectDef const &object, PrivilegeDescriptor *privs) const;

        /** Calculates all contained roles based on a set of source roles. source_roles and contained_roles must point to different variables.
            @param source_roles Roles to start with
            @param need_admin Return only those roles on which admin right are available
            @param contained_roles Receives list of roles that are (recursively) contained in source_roles */
        void GetContainedRoles(std::vector< RoleDef const * > const &source_roles, bool need_admin, std::vector< RoleDef const * > *contained_roles) const;

        /** Calculates all contained roles based on a set of source roles. source_roles and contained_roles may point to the same variable.
            @param source_roles Roles to start with
            @param need_admin Return only those roles on which admin right are available
            @param contained_roles Receives list of roles that are (recursively) contained in source_roles */
        void GetContainedRoles(std::vector< RoleId > const &source_roles, bool need_admin, std::vector< RoleId > *contained_roles) const;

        /** Retrieves id's of abandoned role grants, only returns valid results after execution of
            ReadAndCheckGrantData. Does NOT clear grants at start. */
        void GetAbandonedRoleGrants(std::vector< unsigned > *grant_ids) const;

        /** Retrieves id's of abandoned grants, only returns valid results after execution of
            ReadAndCheckGrantData. Does NOT clear grants at start. */
        void GetAbandonedGrants(std::vector< unsigned > *grant_ids) const;

        /// Swap contents with other privilege checker
        void Swap(PrivilegeChecker &rhs);

        /** Lookup the id of a role */
        RoleId GetRoleId(ObjectId schema, std::string const &name) const;

        /** Returns whether a role is grantable by another role (granted with admin option to role or one of its applicable roles)
            @param grantorid Role that will grant the other role
            @param roleid Role that will be granted
            @return Returns whether role is grantable by the specified grantor */
        bool IsRoleGrantableByRole(RoleId roleid, RoleId grantorid) const;

        /** Returns all privileges for an object calculated from the role privileges of a specific role, ignoring extra roles
            added in this transaction (for use in rights checking in sql statement execution)
            @param role Role to check
            @param id Object to get all privileges for
            @param privs Privilege descriptor that is filled with all rights that follow this role and its applicable roles for this specific object. */
        void GetObjectPrivilegesForSpecificRole(RoleId role, ObjectDef const &object, PrivilegeDescriptor *privs) const;

        /** Returns all grantable privileges for an object calculated from the role privileges of a specific role, ignoring extra roles
            added in this transaction (for use in rights checking in sql grant statement execution)
            @param role Role to check
            @param id Object to get all privileges for
            @param privs Privilege descriptor that is filled with all grantable rights that follow this role and its applicable roles for this specific object. */
        void GetAllGrantableObjectPrivilegesForRole(RoleId grantorid, ObjectDef const &object, PrivilegeDescriptor *privs) const;

        /** Returns all privileges pertaining an object in the role privileges of a certain role
            @param role Role which's role privileges are used
            @param object Object for which the privileges are to be determined
            @param desc Privilege descriptor that will contain all privileges that @a role has in its role privileges for object @object */
        void GetPrivilegesForObject(RoleDef const *role, ObjectDef const *object, PrivilegeDescriptor *desc) const;

        /** Get the roles list */
        const Roles& GetRoles() const { return roles; }
        /** Get the role grants list */
        const RoleGrants& GetRoleGrants() const { return role_grants; }
        /** Get the grants list */
        const Grants& GetGrants() const { return grants; }
    private:
        /// Calculates the contained roles for a role (updates its cache to current generation)
        void CalculateContainedRoles(RoleDef *role, unsigned gen, bool ignore_cycles);

        /// Calculates all applicable roles for a role (updates its cache to current generation)
        void CalculateApplicableRoles(RoleDef *role, unsigned gen, bool ignore_cycles);

        /** Validates all role grants. Also calculates cached_contained_roles for every role. Always throws
            when a grant cycle is detected, and optionally when grants without the needed rights are detected.
            @param throw_on_invalid If true, throws when a grant for which the grantor doesn't have the needed rights is detected
            @return Returns whether all role grants were validated */
        void ValidateAllRoleGrants(bool throw_on_invalid);

        /** Validates all grants. Role grants must have been validated, so call ValidateAllRoleGrants first!).
            cached_contained_roles must all be valid! Optionally throws on grants without needed rights
            @param throw_on_invalid If true, throws when a grant for which the grantor doesn't have the needed rights is detected
            @return Returns whether all grants were validated */
        void ValidateAllGrants(bool throw_on_invalid);

        /** Calculates all contained_roles caches (to generation 1), with the side-effect of
            detecting all cycles in role grants. All role grants must have been validated by
            calling ValidateAllRoleGrants! */
        void CheckAllRoleGrantsForCycles();

        // ADDME: Add read-only accessor functions!
        Roles roles;

        Grants grants;

        RoleGrants role_grants;
};


} //end namespace Database

#endif

