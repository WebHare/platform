import { checkModuleScopedName } from "@webhare/services/src/naming";
import { generateRandomId } from "@webhare/std";
import { openFile, openFolder } from "./objects.ts";

export interface Tag {
  id: number;
  uuid: string;
  title: string;
}

class TagManager {
  private module;
  private name;

  constructor(module: string, name: string) {
    this.module = module;
    this.name = name;
  }

  private _getTagFolderPath() {
    return `/webhare-private/system/whfs-tags/${this.module}/${this.name}/`; //NOTE trailing slash is important for delete's check
  }

  private async _getTagFolder() {
    return await openFolder(this._getTagFolderPath(), { allowMissing: true });
  }

  private async _ensureTagFolder() {
    let folder = await openFolder("/webhare-private/system");
    for (const tok of ["whfs-tags", this.module, this.name])
      folder = await folder.ensureFolder(tok);

    return folder;
  }

  async create(title: string): Promise<Tag> {
    //TODO optimize
    //FIXME check if the tag exists
    if (await this.get(title, { allowMissing: true }))
      throw new Error(`Tag '${title}' already exists`);

    const uuid = generateRandomId("uuidv4");
    const tagfolder = await this._ensureTagFolder();
    const tag = await tagfolder.createFile(uuid, { title });

    return { id: tag.id, uuid, title };
  }

  async get(title: string, options: { allowMissing: true }): Promise<Tag | null>;
  async get(title: string, options?: { allowMissing?: boolean }): Promise<Tag>;

  async get(title: string, options?: { allowMissing?: boolean }): Promise<Tag | null> {
    //TODO optimize... but we need a WHFS list that can search ?
    title = title.toUpperCase();
    const tag = (await this.list()).find(_ => _.title.toUpperCase() === title);
    if (tag)
      return tag;

    if (options?.allowMissing)
      return null;

    throw new Error(`Tag '${title}' not found`);
  }

  async list(): Promise<Tag[]> {
    const tagfolder = await this._getTagFolder();
    if (!tagfolder)
      return [];
    return (await tagfolder.list(["id", "name", "title"])).map(e => ({ id: e.id, uuid: e.name, title: e.title }));
  }

  async delete(tag: number): Promise<void> {
    let tagfile;
    try {
      tagfile = await openFile(tag);
    } catch (ignore) { } //cant use allowMisisng, it'll unconditionally fail if id is a folder

    if (!tagfile || !tagfile.whfsPath.toLowerCase().startsWith(this._getTagFolderPath().toLowerCase()))
      throw new Error(`Tag #${tag} not found`);

    //FIXME recycle it!
    await tagfile.delete();
  }
}

export function openTagManager(tagSet: string) {
  const [module, name] = checkModuleScopedName(tagSet);
  return new TagManager(module, name);
}

export { type TagManager };
