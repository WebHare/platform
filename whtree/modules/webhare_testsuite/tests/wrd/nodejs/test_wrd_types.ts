import * as test from "@webhare/test";
import { IsGenerated, IsNonUpdatable, IsRequired, WRDBaseAttributeType, WRDAttributeType, recordizeOutputMap, combineRecordOutputMaps, OutputMap, RecordizeOutputMap, MapRecordOutputMap, Insertable, WRDGender, TypeDefinition } from "@mod-wrd/js/internal/types";

type MapOutput<T extends TypeDefinition, O extends OutputMap<T>> = MapRecordOutputMap<T, RecordizeOutputMap<T, O>>;

function testTypes() {

  type System_Usermgmt_WRDPerson = {
    wrd_id: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrd_guid: WRDBaseAttributeType.Base_Guid;
    wrd_type: IsGenerated<WRDBaseAttributeType.Base_Integer>;
    wrdTag: WRDBaseAttributeType.Base_Tag;
    wrdCreationDate: WRDBaseAttributeType.Base_CreationLimitDate;
    wrdLimitDate: WRDBaseAttributeType.Base_CreationLimitDate;
    wrdModificationDate: WRDBaseAttributeType.Base_ModificationDate;
    wrd_gender: WRDBaseAttributeType.Base_Gender;
    wrdSaluteFormal: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    wrdAddressFormal: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    wrdFullName: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    wrd_titles: WRDBaseAttributeType.Base_NameString;
    wrd_initials: WRDBaseAttributeType.Base_NameString;
    wrdFirstName: WRDBaseAttributeType.Base_NameString;
    wrdFirstNames: WRDBaseAttributeType.Base_NameString;
    wrd_infix: WRDBaseAttributeType.Base_NameString;
    wrdLastName: WRDBaseAttributeType.Base_NameString;
    wrdTitlesSuffix: WRDBaseAttributeType.Base_NameString;
    wrdDateOfBirth: WRDBaseAttributeType.Base_Date;
    wrdDateOfDeath: WRDBaseAttributeType.Base_Date;
    wrdTitle: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    whuser_disabled: WRDAttributeType.Boolean;
    whuser_disablereason: WRDAttributeType.Free;
    whuser_comment: WRDAttributeType.Free;
    whuser_lastlogin: WRDAttributeType.DateTime;
    whuser_unit: IsRequired<WRDAttributeType.Domain>;
    whuser_hiddenannouncements: WRDAttributeType.DomainArray;
    invented_domain: WRDAttributeType.Domain;
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

  type GenericWRDTypeDef = Record<string, WRDAttributeType.Integer>;

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
    invented_domain?: number | null | undefined;
    whuser_comment?: string | undefined;
    whuser_disabled?: boolean | undefined;
    whuser_disablereason?: string | undefined;
    whuser_hiddenannouncements?: number[] | undefined;
    whuser_lastlogin?: Date | null | undefined;
    whuser_unit: number;
    wrdCreationDate?: Date | null | undefined;
    wrdDateOfBirth?: Date | null | undefined;
    wrdDateOfDeath?: Date | null | undefined;
    wrdFirstName?: string | undefined;
    wrdFirstNames?: string | undefined;
    wrd_gender?: WRDGender | undefined;
    wrd_guid?: string | undefined;
    wrd_id?: number | undefined;
    wrd_infix?: string | undefined;
    wrd_initials?: string | undefined;
    wrdLastName?: string | undefined;
    wrdLimitDate?: Date | null | undefined;
    wrdModificationDate?: Date | undefined;
    wrdTag?: string | undefined;
    wrdTitlesSuffix?: string | undefined;
    wrd_titles?: string | undefined;
  }, Insertable<System_Usermgmt_WRDPerson>>>();
}

test.run([testTypes], { wrdauth: false });
