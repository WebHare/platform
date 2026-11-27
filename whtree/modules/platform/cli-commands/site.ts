// @webhare/cli: Manage WebHare sites (WHFS)

import { CLISyntaxError, enumOption, runCli, type CLIArgumentType } from "@webhare/cli";
import type { PlatformDB } from '@mod-platform/generated/db/platform';
import { beginWork, db } from '@webhare/whdb';
import { commonFlags } from '@mod-platform/js/cli/cli-tools';
import { loadlib } from '@webhare/harescript';
import { getBestMatch } from "@webhare/js-api-tools";
import { listSites, listWHFSObjects, openSite, whfsType } from "@webhare/whfs";
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import type { WebFeature } from "@mod-system/js/internal/generation/webdesigns";
import { compareProperties, pick, regExpFromWildcards } from "@webhare/std";
import { getTid } from "@webhare/gettid";
import { YAML } from "@webhare/deps";
import { z } from 'zod';


const siteOption: CLIArgumentType<{ id: number; name: string }> = {
  async parseValue(input: string) {
    const allSites = await db<PlatformDB>()
      .selectFrom("system.sites")
      .select(["id", "name"])
      .execute();

    const matches = allSites.filter(site => site.name.toLowerCase() === input.toLowerCase() || site.id.toString() === input);
    if (matches.length > 1)
      throw new CLISyntaxError(`Multiple sites found matching "${input}": ${matches.map(site => JSON.stringify(site.name)).join(", ")}`);
    if (matches.length === 1)
      return matches[0];

    const bestMatch = getBestMatch(input, allSites.map(site => site.name));
    throw new CLISyntaxError(`No site found matching "${input}"${bestMatch ? `, did you mean "${bestMatch}"?` : ""}`);
  },
  async autoComplete(startsWith: string): Promise<readonly string[]> {
    const allSites = await db<PlatformDB>()
      .selectFrom("system.sites")
      .select(["id", "name"])
      .execute();
    return allSites.filter(n => n.name.startsWith(startsWith)).map(n => n.name);
  },
  description: "WebHare site, by ID or name (matched case-insensitively)",
};

const webRootOption: CLIArgumentType<{ webserver: number; path: string }> = {
  async parseValue(input: string) {
    const webservers = await db<PlatformDB>()
      .selectFrom("system.webservers")
      .select(["id", "baseurl"])
      .execute();

    const url = new URL(input);
    const webserver = webservers.find(ws => url.origin === new URL(ws.baseurl).origin);
    if (!webserver) {
      const bestMatch = getBestMatch(url.origin, webservers.map(ws => ws.baseurl));
      throw new CLISyntaxError(`No webserver found matching the URL origin "${url.origin}"${bestMatch ? `, did you mean "${bestMatch}"?` : ""}`);
    }

    return { webserver: webserver.id, path: url.pathname };
  },
  async autoComplete(startsWith: string): Promise<readonly string[]> {
    const webservers = await db<PlatformDB>()
      .selectFrom("system.webservers")
      .select(["id", "baseurl"])
      .execute();
    return webservers.filter(ws => ws.baseurl.startsWith(startsWith)).map(ws => ws.baseurl + "*");
  },
  description: "WebHare site output url",
};

const webdesignOption: CLIArgumentType<string> = {
  async parseValue(input: string) {
    const config = getExtractedConfig("webdesigns");
    if (!config.webDesigns.find(w => w.name === input)) {
      const didyoumean = getBestMatch(input, config.webDesigns.map(w => w.name));
      throw new CLISyntaxError(`Invalid webdesign "${input}". Available webdesigns are: ${config.webDesigns.map(w => w.name).join(", ")}${didyoumean ? `, did you mean "${didyoumean}"?` : ""}`);
    }
    return input;
  },
  async autoComplete(startsWith: string): Promise<readonly string[]> {
    return getExtractedConfig("webdesigns").webDesigns.map(w => w.name).filter(name => name.startsWith(startsWith));
  },
  description: "WebHare webdesign",
};

const webFeatureOption: CLIArgumentType<WebFeature> = {
  async parseValue(input: string) {
    const config = getExtractedConfig("webdesigns");
    const webFeature = config.webFeatures.find(w => w.name === input);
    if (!webFeature) {
      const didyoumean = getBestMatch(input, config.webFeatures.map(w => w.name));
      throw new CLISyntaxError(`Invalid web feature "${input}". Available web features are: ${config.webFeatures.map(w => w.name).join(", ")}${didyoumean ? `, did you mean "${didyoumean}"?` : ""}`);
    }
    return webFeature;
  },
  async autoComplete(startsWith: string): Promise<readonly string[]> {
    return getExtractedConfig("webdesigns").webFeatures.map(w => w.name).filter(name => name.startsWith(startsWith));
  },
  description: "WebHare web feature",
};

async function updateSiteWebRoot(site: Awaited<ReturnType<typeof siteOption.parseValue>>, webRoot: Awaited<ReturnType<typeof webRootOption.parseValue>>) {
  const analyze_new_location = await loadlib("mod::publisher/lib/siteapi.whlib").TestSiteOutputAvailability(site.id, webRoot.webserver, webRoot.path) as {
    success: boolean;
    siteonlocation: number;
    sitecontaininglocation: number;
    neededfolders: Array<{ site: number; parent: number; name: string }>;
  };
  if (!analyze_new_location.success) {
    if (analyze_new_location.siteonlocation) {
      const conflict = await db<PlatformDB>()
        .selectFrom("system.sites")
        .where("system.sites.id", "=", analyze_new_location.siteonlocation)
        .select(["system.sites.id", "system.sites.name"])
        .executeTakeFirstOrThrow();
      console.error(`Site ${conflict.name} already exists on the specified output location`);
    }
    if (analyze_new_location.sitecontaininglocation) {
      const conflict = await db<PlatformDB>()
        .selectFrom("system.sites")
        .where("system.sites.id", "=", analyze_new_location.sitecontaininglocation)
        .select(["system.sites.id", "system.sites.name"])
        .executeTakeFirstOrThrow();
      console.error(`Site ${conflict.name} contains the specified output location`);
    }
    for (const conflict of analyze_new_location.neededfolders) {
      console.error(`Needed folder conflict: site ${conflict.site}, parent ${conflict.parent}, name ${conflict.name}`);
    }
    return 1;
  }
  await (await loadlib("mod::publisher/lib/siteapi.whlib").OpenSite(site.id)).UpdateSiteMetadata({ outputweb: webRoot.webserver, outputfolder: webRoot.path });
}

runCli({
  description: '',
  flags: {
    ...commonFlags.json
  },
  subCommands: {
    "list": {
      description: "List all sites",
      main: async ({ opts, args }) => {
        const sites = (await listSites(["name", "id"])).sort(compareProperties("name"));
        const whfsPaths = await listWHFSObjects(["id", "whfsPath"], { ids: sites.map(s => s.id) });
        const sitesWithWhfsPaths = sites.map(site => {
          const whfsPath = whfsPaths.find(w => w.id === site.id)?.whfsPath || null;
          return { name: site.name, id: site.id, whfsPath };
        });
        if (opts.json)
          console.log(JSON.stringify(sitesWithWhfsPaths));
        else
          console.table(sitesWithWhfsPaths);
      }
    },
    "get": {
      description: "Get site properties",
      arguments: [{ name: "<site>", description: "Site", type: siteOption }],
      options: {
        field: { description: "Field to update", type: enumOption(["webRoot", "cdnBaseURL", "webDesign", "webFeatures"]) }
      },
      main: async ({ opts, args }) => {
        const siteId = args.site;
        const site = await openSite(args.site.id, { allowMissing: true });

        if (!site) {
          console.error(`Site ${siteId} not found`);
          return 1;
        } else if (!site.webRoot) {
          console.error(`Site ${siteId} does not have an output web server configured`);
          return 1;
        }
        const toPrint = {
          ...pick(site, ["id", "name", "webRoot", "cdnBaseURL"]),
          webDesign: await site.getWebDesign(),
          webFeatures: await site.getWebFeatures() || [],
        };
        if (opts.field) {
          if (opts.json)
            console.log(JSON.stringify(toPrint[opts.field]));
          else switch (opts.field) {
            case "webFeatures": console.log(toPrint.webFeatures?.join("\n") || ""); break;
            default: console.log(toPrint[opts.field] || ""); break;
          }
        } else {
          if (opts.json)
            console.log(JSON.stringify(toPrint));
          else
            console.log(YAML.stringify(toPrint));
        }
      }
    },
    "update": {
      description: "Update site properties",
      options: {
        field: { description: "Field to update", type: enumOption(["name", "description", "webRoot", "cdnBaseURL", "webDesign", "webFeatures"]) }
      },
      arguments: [
        { name: "<site>", description: "Site", type: siteOption },
        { name: "<value>", description: "New field value or JSON/YAML record when updating whole site (use - to read from stdin then)" },
      ],
      async main({ args, opts }) {
        const updateSchema = z.object({
          name: z.string().optional(),
          description: z.string().optional(),
          cdnBaseURL: z.string().optional(),
          webDesign: z.string().optional(),
          webFeatures: z.array(z.string()).optional(),
          webRoot: z.string().optional(),
        });

        const site = await openSite(args.site.id);

        let value: z.infer<typeof updateSchema>;
        switch (opts.field) {
          case undefined: {
            if (args.value === "-") {
              const chunks: Buffer[] = [];
              for await (const chunk of process.stdin)
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
              args.value = Buffer.concat(chunks).toString();
            }
            value = updateSchema.parse(YAML.parse(args.value));
          } break;
          case "name": {
            value = { name: args.value };
          } break;
          case "description": {
            value = { description: args.value };
          } break;
          case "webDesign": {
            value = { webDesign: args.value };
          } break;
          case "webFeatures": {
            value = { webFeatures: args.value.split(",") };
          } break;
          case "cdnBaseURL": {
            value = { cdnBaseURL: args.value };
          } break;
          case "webRoot": {
            value = { webRoot: args.value };
          } break;
          default: {
            throw new CLISyntaxError(`Unknown field: ${opts.field satisfies never as string}`);
          }
        }

        if (value.webDesign !== undefined) {
          value.webDesign = await webdesignOption.parseValue(value.webDesign, { argName: "value" });
        }
        if (value.webFeatures !== undefined) {
          const webDesign = value.webDesign ?? await site.getWebDesign();
          const webFeatures = await Promise.all(value.webFeatures.map(f => webFeatureOption.parseValue(f, { argName: "value" })));
          for (const wf of webFeatures) {
            if (wf.webDesignMasks.length && !regExpFromWildcards(wf.webDesignMasks).test(webDesign)) {
              throw new Error(`Web feature "${wf.name}" is not compatible with the current web design "${webDesign}"`);
            }
          }
          value.webFeatures = webFeatures.map(wf => wf.name);
        }
        let newWebRoot: Awaited<ReturnType<typeof webRootOption.parseValue>> | null = null;
        if (value.webRoot !== undefined) {
          newWebRoot = await webRootOption.parseValue(value.webRoot, { argName: "value" });
        }

        await using work = await beginWork();
        const directUpdatable = pick(value, ["name", "description", "cdnBaseURL", "webDesign", "webFeatures"]);
        if (Object.keys(directUpdatable).length)
          await site.update(directUpdatable);
        if (newWebRoot) {
          const retval = await updateSiteWebRoot(args.site, newWebRoot);
          if (retval)
            return retval;
        }
        await work.commit();
      },
    },
    "list-webdesigns": {
      description: "List all webdesigns",
      main: async ({ opts, args }) => {
        const config = getExtractedConfig("webdesigns");
        const toShow = pick(config.webDesigns, ["name", "title"]).map(wd => ({ ...wd, title: getTid(wd.title) })).sort(compareProperties("name"));
        if (opts.json)
          console.log(JSON.stringify(toShow));
        else
          console.table(toShow);
      },
    },
    "list-webfeatures": {
      description: "List all web features",
      arguments: [
        { name: "[site]", description: "Site", type: siteOption }
      ],
      main: async ({ opts, args }) => {
        const config = getExtractedConfig("webdesigns");
        let toShow = pick(config.webFeatures, ["name", "title", "webDesignMasks"]).map(wf => ({ ...wf, title: getTid(wf.title) })).sort(compareProperties("name"));
        if (args.site) {
          const webDesign = await (await openSite(args.site.id)).getWebDesign();
          toShow = toShow.filter(wf => !wf.webDesignMasks.length || regExpFromWildcards(wf.webDesignMasks).test(webDesign));
        }
        if (opts.json)
          console.log(JSON.stringify(toShow));
        else
          console.table(toShow);
      }
    },
    "add-webfeature": {
      description: "Add a web feature to a site",
      arguments: [
        { name: "<site>", description: "Site", type: siteOption },
        { name: "<webfeature>", description: "Web feature", type: webFeatureOption }
      ],
      main: async ({ opts, args }) => {
        const siteSettings = await whfsType("platform:web.sitesettings").get(args.site.id);
        if (args.webfeature.webDesignMasks.length) {
          const regex = regExpFromWildcards(args.webfeature.webDesignMasks);
          if (!regex.test(siteSettings.sitedesign)) {
            console.error(`Web feature "${args.webfeature.name}" is not compatible with webdesign ${siteSettings.sitedesign}`);
            return 1;
          }
        }
        if (!siteSettings.webfeatures.includes(args.webfeature.name)) {
          await using work = await beginWork();
          await (await openSite(args.site.id)).update({ webFeatures: [...siteSettings.webfeatures, args.webfeature.name] });
          await work.commit();
        }
      }
    },
    "remove-webfeature": {
      description: "Remove a web feature from a site",
      arguments: [
        { name: "<site>", description: "Site", type: siteOption },
        { name: "<webfeature>", description: "Web feature", type: webFeatureOption }
      ],
      main: async ({ opts, args }) => {
        const siteSettings = await whfsType("platform:web.sitesettings").get(args.site.id);
        if (siteSettings.webfeatures.includes(args.webfeature.name)) {
          await using work = await beginWork();
          await (await openSite(args.site.id)).update({ webFeatures: siteSettings.webfeatures.filter(wf => wf !== args.webfeature.name) });
          await work.commit();
        }
      }
    }
  }
});
