import { db, type Updateable } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { WRDSchemaType, WRDType, type SchemaUpdates, type WRDAttributeCreateConfiguration, type WRDLinkTypeMetadata, type WRDTypeMetadata } from "./schema";
import type { AnySchemaType, SchemaTypeDefinition } from "./types";
import { WRDMetaTypes } from "./types";
import { isValidWRDAttributeTag, isValidWRDTypeTag, tagToHS, type WRDAttributeConfiguration } from "./wrdsupport";
import { wrdFinishHandler } from "./finishhandler";

/** A WRD schema opened for metadata changes (creating types, updating attributes etc).
 *  Obtain one using `wrd(tag, { writeMetadata: true })`. These objects are never shared with other wrd() callers
 */
export class WRDWritableSchema<S extends SchemaTypeDefinition = AnySchemaType> extends WRDSchemaType<S> {
  getType<T extends keyof S & string>(type: T): WRDWritableType<S, T> {
    return new WRDWritableType<S, T>(this, type, false);
  }

  async createType(tag: string, config: Partial<WRDTypeMetadata> & Pick<WRDTypeMetadata, "metaType">): Promise<WRDWritableType<S, string>> {
    if (!isValidWRDTypeTag(tag))
      throw new Error(`Invalid type tag ${JSON.stringify(tag)}`);

    const hstag = tagToHS(tag);
    const schemaobj = await this.__getWRDSchema();
    const left = await this.__toWRDTypeId((config as WRDLinkTypeMetadata)?.left);
    const right = await this.__toWRDTypeId((config as WRDLinkTypeMetadata)?.right);
    const parent = config.parent ? await this.__toWRDTypeId(config.parent) : null;

    if (config.id) //TODO I want to Omit<... "id"|"tag"> but then it won't accept left/right etc anymore...
      throw new Error("Cannot specify an id when creating a new type");
    if (config.tag) //TODO I want to Omit<... "id"|"tag"> but then it won't accept left/right etc anymore...
      throw new Error("Cannot specify tag in the configuration object when creating a new type");

    const createrequest = {
      title: "",
      description: "",
      tag: hstag,
      requiretype_left: left,
      requiretype_right: right,
      metatype: WRDMetaTypes.indexOf(config.metaType) + 1,
      parenttype: parent || 0,
      //TODO parenttype, abstract, hasperonaldata defaulting to TRUE for WRD_PERSON (but shouldn't the base schema do that?)
      deleteclosedafter: config.deleteClosedAfter || 0,
      keephistorydays: config.keepHistoryDays || 0,
      haspersonaldata: config.hasPersonalData || false
    };

    await schemaobj.__DoCreateType(createrequest);
    const type = this.getType(tag as keyof S & string);

    //TODO schedule broadcast post commit to flush other listeners
    await this.__reloadAfterMetadataChange();

    return type;
  }

  async updateSchema(updates: SchemaUpdates) {
    let dbUpdate: Updateable<PlatformDB["wrd.schemas"]> | undefined;
    if (updates.accountType) {
      const typeid = (await this.describeType(updates.accountType))?.id;
      dbUpdate = { ...dbUpdate, accounttype: typeid };
    } else if (updates.accountType === null) {
      dbUpdate = { ...dbUpdate, accounttype: null };
    }

    if (dbUpdate) {
      const updated = await db<PlatformDB>().
        updateTable("wrd.schemas").
        set(dbUpdate).
        where("name", "=", this.tag).
        returning("id").
        executeTakeFirstOrThrow();

      wrdFinishHandler().schemaMetadataChanged(updated.id);
      await this.__reloadAfterMetadataChange();
    }
  }
}

/** A WRD type obtained from a WRDWritableSchema, which allows its metadata and attributes to be modified */
export class WRDWritableType<S extends SchemaTypeDefinition, T extends keyof S & string> extends WRDType<S, T> {
  constructor(schema: WRDWritableSchema<S>, tag: T, legacySchema: boolean) {
    super(schema, tag, legacySchema);
  }

  async updateMetadata(newmetadata: Partial<Omit<WRDTypeMetadata, "id" | "metaType">>) {
    if (newmetadata.tag !== undefined && !isValidWRDTypeTag(newmetadata.tag))
      throw new Error(`Invalid type tag ${JSON.stringify(newmetadata.tag)}`);

    await (await this._getType()).updateMetadata(newmetadata);
  }

  async createAttribute(tag: string, configuration: WRDAttributeCreateConfiguration) {
    if (!isValidWRDAttributeTag(tag, { allowMultiLevel: true }))
      throw new Error(`Invalid attribute tag ${JSON.stringify(tag)}`);

    const typeobj = await this._getType();
    const typetag = configuration.attributeType;

    const configclone: Omit<Partial<WRDAttributeConfiguration>, 'domain'> & { domain?: string | number | null } = configuration;
    delete configclone.attributeType;

    if (configuration.domain)
      configclone.domain = await this.schema.__toWRDTypeId(configuration.domain);

    await typeobj.CreateAttribute(tagToHS(tag), typetag, configclone);

    //TODO schedule broadcast post commit to flush other listeners
    await this.schema.__reloadAfterMetadataChange();
  }

  async updateAttribute(tag: string, configuration: Partial<WRDAttributeConfiguration>) {
    if (configuration.tag !== undefined && !isValidWRDAttributeTag(tag))
      throw new Error(`Invalid attribute tag ${JSON.stringify(tag)}`);

    const typeobj = await this._getType();
    await typeobj.UpdateAttribute(tagToHS(tag), configuration);
    await this.schema.__reloadAfterMetadataChange();
  }

  async deleteAttribute(tag: string) {
    const typeobj = await this._getType();
    await typeobj.DeleteAttribute(tagToHS(tag));
    await this.schema.__reloadAfterMetadataChange();
  }
}
