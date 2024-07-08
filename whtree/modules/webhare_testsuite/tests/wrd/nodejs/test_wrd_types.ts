import * as test from "@webhare/test";
import { IsGenerated, IsNonUpdatable, IsRequired, WRDBaseAttributeTypeId, WRDAttributeTypeId, recordizeOutputMap, combineRecordOutputMaps, OutputMap, RecordizeOutputMap, MapRecordOutputMap, Insertable, WRDGender, TypeDefinition } from "@mod-wrd/js/internal/types";

type MapOutput<T extends TypeDefinition, O extends OutputMap<T>> = MapRecordOutputMap<T, RecordizeOutputMap<T, O>>;

function testTypes() {

  type System_Usermgmt_WRDPerson = {
    wrd_id: IsNonUpdatable<WRDBaseAttributeTypeId.Base_Integer>;
    wrd_guid: WRDBaseAttributeTypeId.Base_Guid;
    wrd_type: IsGenerated<WRDBaseAttributeTypeId.Base_Integer>;
    wrdTag: WRDBaseAttributeTypeId.Base_Tag;
    wrdCreationDate: WRDBaseAttributeTypeId.Base_CreationLimitDate;
    wrdLimitDate: WRDBaseAttributeTypeId.Base_CreationLimitDate;
    wrdModificationDate: WRDBaseAttributeTypeId.Base_ModificationDate;
    wrd_gender: WRDBaseAttributeTypeId.Base_Gender;
    wrdSaluteFormal: IsGenerated<WRDBaseAttributeTypeId.Base_GeneratedString>;
    wrdAddressFormal: IsGenerated<WRDBaseAttributeTypeId.Base_GeneratedString>;
    wrdFullName: IsGenerated<WRDBaseAttributeTypeId.Base_GeneratedString>;
    wrd_titles: WRDBaseAttributeTypeId.Base_NameString;
    wrd_initials: WRDBaseAttributeTypeId.Base_NameString;
    wrdFirstName: WRDBaseAttributeTypeId.Base_NameString;
    wrdFirstNames: WRDBaseAttributeTypeId.Base_NameString;
    wrd_infix: WRDBaseAttributeTypeId.Base_NameString;
    wrdLastName: WRDBaseAttributeTypeId.Base_NameString;
    wrdTitlesSuffix: WRDBaseAttributeTypeId.Base_NameString;
    wrdDateOfBirth: WRDBaseAttributeTypeId.Base_Date;
    wrdDateOfDeath: WRDBaseAttributeTypeId.Base_Date;
    wrdTitle: IsGenerated<WRDBaseAttributeTypeId.Base_GeneratedString>;
    whuser_disabled: WRDAttributeTypeId.Boolean;
    whuser_disablereason: WRDAttributeTypeId.String;
    whuser_comment: WRDAttributeTypeId.String;
    whuser_lastlogin: WRDAttributeTypeId.DateTime;
    whuser_unit: IsRequired<WRDAttributeTypeId.Domain>;
    whuser_hiddenannouncements: WRDAttributeTypeId.DomainArray;
    invented_domain: WRDAttributeTypeId.Domain;
  };



  const sel1a = ["a"] as const;
  const sel1b: Array<"a"> = ["a"];

  test.eq({ a: "a" }, recordizeOutputMap(sel1a));
  test.eq({ a: "a" }, recordizeOutputMap(sel1b));


  test.eq("a", combineRecordOutputMaps(null, "a"));
  test.eq({ a: "a" }, combineRecordOutputMaps(null, { a: "a" }));
  test.throws(/Cannot combine selects, trying to combine a single field with another single field/, () => combineRecordOutputMaps("a", "a"));
  test.throws(/Cannot combine selects, trying to combine a single field with a map/, () => combineRecordOutputMaps("a", { a: "a" }));
  test.throws(/Cannot combine selects, trying to combine a map with another single field/, () => combineRecordOutputMaps({ a: "a" }, "a"));

  const stringselect = ["wrd_id", "wrdTitle", "whuser_disabled", "whuser_comment", "whuser_unit", "invented_domain", "whuser_hiddenannouncements"] as const;

  test.typeAssert<test.Equals<{
    wrd_id: number;
    wrdTitle: string;
    whuser_disabled: boolean;
    whuser_comment: string;
    invented_domain: number | null;
    whuser_unit: number;
    whuser_hiddenannouncements: number[];
  }, MapOutput<System_Usermgmt_WRDPerson, typeof stringselect>>>();


  const recordselect = { wrd_id: "wrd_id", rec: { wrdTitle: "wrdTitle" }, arr: ["whuser_disabled", "whuser_comment", "whuser_unit", "invented_domain", "whuser_hiddenannouncements"] } as const;

  test.typeAssert<test.Equals<{
    wrd_id: number;
    rec: {
      wrdTitle: string;
    };
    arr: {
      whuser_disabled: boolean;
      whuser_comment: string;
      whuser_unit: number;
      invented_domain: number | null;
      whuser_hiddenannouncements: number[];
    };
  }, MapOutput<System_Usermgmt_WRDPerson, typeof recordselect>>>();

  type GenericWRDTypeDef = Record<string, WRDAttributeTypeId.Integer>;

  test.typeAssert<test.Equals<{
    a: "a";
    b: { c: "c" };
    d: {
      e: "e";
    };
  }, RecordizeOutputMap<GenericWRDTypeDef, { a: "a"; b: { c: "c" }; d: ["e"] }>>>();

  test.typeAssert<test.Equals<{
    a: number;
    b: { c: number };
    d: {
      e: number;
    };
  }, MapRecordOutputMap<GenericWRDTypeDef, { a: "a"; b: { c: "c" }; d: { e: "e" } }>>>();

  test.typeAssert<test.Assignable<{
    inventedDomain?: number | null | undefined;
    whuserComment?: string | undefined;
    whuserDisabled?: boolean | undefined;
    whuserDisablereason?: string | undefined;
    whuserHiddenannouncements?: number[] | undefined;
    whuserLastlogin?: Date | null | undefined;
    whuserUnit?: number | null;
    wrdCreationDate?: Date | null | undefined;
    wrdDateOfBirth?: Date | null | undefined;
    wrdDateOfDeath?: Date | null | undefined;
    wrdFirstName?: string | undefined;
    wrdFirstNames?: string | undefined;
    wrdGender?: WRDGender | undefined;
    wrdGuid?: string | undefined;
    wrdId?: number | undefined;
    wrdInfix?: string | undefined;
    wrdInitials?: string | undefined;
    wrdLastName?: string | undefined;
    wrdLimitDate?: Date | null | undefined;
    wrdModificationDate?: Date | undefined;
    wrdTag?: string | undefined;
    wrdTitlesSuffix?: string | undefined;
    wrdTitles?: string | undefined;
  }, Insertable<System_Usermgmt_WRDPerson>>>();
}

test.run([testTypes], { wrdauth: false });
