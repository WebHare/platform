import * as test from "@webhare/test";
import { IsGenerated, IsNonUpdatable, IsRequired, WRDBaseAttributeType, WRDAttributeType, recordizeOutputMap, combineRecordOutputMaps, OutputMap, RecordizeOutputMap, MapRecordOutputMap, Insertable, WRDGender, TypeDefinition } from "@mod-wrd/js/internal/types";

type MapOutput<T extends TypeDefinition, O extends OutputMap<T>> = MapRecordOutputMap<T, RecordizeOutputMap<T, O>>;

function testTypes() {

  type System_Usermgmt_WRDPerson = {
    wrd_id: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrd_guid: WRDBaseAttributeType.Base_Guid;
    wrd_type: IsGenerated<WRDBaseAttributeType.Base_Integer>;
    wrd_tag: WRDBaseAttributeType.Base_Tag;
    wrd_creationdate: WRDBaseAttributeType.Base_CreationLimitDate;
    wrd_limitdate: WRDBaseAttributeType.Base_CreationLimitDate;
    wrd_modificationdate: WRDBaseAttributeType.Base_ModificationDate;
    wrd_gender: WRDBaseAttributeType.Base_Gender;
    wrd_salute_formal: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    wrd_address_formal: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    wrd_fullname: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    wrd_titles: WRDBaseAttributeType.Base_NameString;
    wrd_initials: WRDBaseAttributeType.Base_NameString;
    wrd_firstname: WRDBaseAttributeType.Base_NameString;
    wrd_firstnames: WRDBaseAttributeType.Base_NameString;
    wrd_infix: WRDBaseAttributeType.Base_NameString;
    wrd_lastname: WRDBaseAttributeType.Base_NameString;
    wrd_titles_suffix: WRDBaseAttributeType.Base_NameString;
    wrd_dateofbirth: WRDBaseAttributeType.Base_Date;
    wrd_dateofdeath: WRDBaseAttributeType.Base_Date;
    wrd_title: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
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

  const stringselect = ["wrd_id", "wrd_title", "whuser_disabled", "whuser_comment", "whuser_unit", "invented_domain", "whuser_hiddenannouncements"] as const;

  test.typeAssert<test.Equals<{
    wrd_id: number;
    wrd_title: string;
    whuser_disabled: boolean;
    whuser_comment: string;
    invented_domain: number | null;
    whuser_unit: number;
    whuser_hiddenannouncements: number[];
  }, MapOutput<System_Usermgmt_WRDPerson, typeof stringselect>>>();


  const recordselect = { wrd_id: "wrd_id", rec: { wrd_title: "wrd_title" }, arr: ["whuser_disabled", "whuser_comment", "whuser_unit", "invented_domain", "whuser_hiddenannouncements"] } as const;

  test.typeAssert<test.Equals<{
    wrd_id: number;
    rec: {
      wrd_title: string;
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

  /* This fails, don't know why
  test.typeAssert<test.Equals<{
    invented_domain?: number | null;
    whuser_comment?: string;
    whuser_disabled?: boolean;
    whuser_disablereason?: string;
    whuser_hiddenannouncements?: number[];
    whuser_lastlogin?: Date;
    whuser_unit: number;
    wrd_creationdate?: Date;
    wrd_dateofbirth?: Date;
    wrd_dateofdeath?: Date;
    wrd_firstname?: string;
    wrd_firstnames?: string;
    wrd_gender?: WRDGender;
    wrd_guid?: string;
    wrd_id?: number;
    wrd_infix?: string;
    wrd_initials?: string;
    wrd_lastname?: string;
    wrd_limitdate?: Date;
    wrd_modificationdate?: Date;
    wrd_tag?: string;
    wrd_titles_suffix?: string;
    wrd_titles?: string;
  }, Insertable<System_Usermgmt_WRDPerson>>>();
*/
  // FIXME: this only works when using Required, don't know why yet. It seems to look ok, though
  test.typeAssert<test.Equals<Required<{
    invented_domain?: number | null;
    whuser_comment?: string;
    whuser_disabled?: boolean;
    whuser_disablereason?: string;
    whuser_hiddenannouncements?: number[];
    whuser_lastlogin?: Date | null;
    whuser_unit: number;
    wrd_creationdate?: Date | null;
    wrd_dateofbirth?: Date | null;
    wrd_dateofdeath?: Date | null;
    wrd_firstname?: string;
    wrd_firstnames?: string;
    wrd_gender?: WRDGender;
    wrd_guid?: string;
    wrd_id?: number;
    wrd_infix?: string;
    wrd_initials?: string;
    wrd_lastname?: string;
    wrd_limitdate?: Date | null;
    wrd_modificationdate?: Date;
    wrd_tag?: string;
    wrd_titles_suffix?: string;
    wrd_titles?: string;
  }>, Required<Insertable<System_Usermgmt_WRDPerson>>>>();
}

test.run([testTypes], { wrdauth: false });
