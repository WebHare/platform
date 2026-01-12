import type { Document, Element } from "@xmldom/xmldom";
import { getApplicabilityError, readApplicableToWebHareNode, type GenerateContext } from "./shared";
import { getAttr } from "./xmlhelpers";
import { whconstant_default_failreschedule } from "../webhareconstants";
import { resolveResource } from "@webhare/services";
import { addModule } from "@webhare/services/src/naming";
import type { ModDefYML } from "@webhare/services/src/moduledefparser";
import { typedEntries } from "@webhare/std";

export type TaskCluster = {
  harescriptworkers: number;
  harescriptworkerthreads: number;
};

export type TaskType = {
  /** Name of the HS object that runs this task */
  objectname: string;
  /** Name of the TS function that runs this task */
  taskrunner: string;
  /** Apply error (task may only run if this is unset) */
  applyError: string;
  /** Name of the taskcluster this task should run in */
  cluster: string;
  priority: number;
  maxfailures: number;
  failreschedule: number;
  linenum: number;
  timeout: number;
  allowifrestore: boolean;
  ephemeral: boolean;
  /** Source is moduledefinition.yml */
  yaml: boolean;
};

export type TasksExtract = {
  clusters: Record<string, TaskCluster>;
  tasktypes: Record<string, TaskType>;
};

function parseXMLTask(context: GenerateContext, resourcename: string, tasknode: Element, mod: string, ephemeral: boolean): TaskType {
  const task: TaskType = {
    applyError: getApplicabilityError(context.versionInfo, readApplicableToWebHareNode(tasknode, '')) || '',
    // type: getAttr(tasknode, "type", ""),
    objectname: resolveResource(resourcename, getAttr(tasknode, "objectname", "")),
    taskrunner: resolveResource(resourcename, getAttr(tasknode, "taskrunner", "")),
    cluster: addModule(mod, getAttr(tasknode, "cluster", "")),
    timeout: getAttr(tasknode, "timeout", 0),
    maxfailures: getAttr(tasknode, "maxfailures", -1),
    failreschedule: getAttr(tasknode, "failreschedule", whconstant_default_failreschedule),
    allowifrestore: getAttr(tasknode, "allowifrestore", false),
    priority: getAttr(tasknode, "priority", 0),
    linenum: tasknode.lineNumber || 0,
    yaml: false,
    ephemeral: ephemeral
  };
  return task;
}

function parseXMLTasks(context: GenerateContext, mod: string, resourceBase: string, modXml: Document, out: TasksExtract): void {
  for (const tasknode of modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "managedtask")) {
    const type = getAttr(tasknode, "type", "");
    if (type)
      out.tasktypes[`${mod}:${type}`] = parseXMLTask(context, resourceBase, tasknode, mod, false);
  }

  for (const tasknode of modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "ephemeraltask")) {
    const type = getAttr(tasknode, "type", "");
    if (type)
      out.tasktypes[`${mod}:${type}`] = parseXMLTask(context, resourceBase, tasknode, mod, true);
  }

  for (const cluster of modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "taskcluster")) {
    const tag = getAttr(cluster, "tag", "");
    if (tag)
      out.clusters[addModule(mod, tag)] = {
        harescriptworkers: getAttr(cluster, "harescriptworkers", 1),
        harescriptworkerthreads: getAttr(cluster, "harescriptworkerthreads", 1),
      };
  }
}

function parseYMLTasks(context: GenerateContext, mod: string, resourceBase: string, modYml: ModDefYML, out: TasksExtract): void {
  for (const [tag, task] of typedEntries(modYml.tasks || {})) {
    const name = `${mod}:${tag}`;
    out.tasktypes[name] = {
      applyError: task.ifWebHare ? getApplicabilityError(context.versionInfo, task.ifWebHare) || '' : '',
      allowifrestore: task.allowIfRestore ?? false,
      taskrunner: resolveResource(resourceBase, task.runner),
      objectname: "",
      yaml: true,
      ephemeral: false,
      //FIXME implement these attributes too
      cluster: "",
      linenum: 0,
      failreschedule: whconstant_default_failreschedule,
      maxfailures: -1,
      priority: 0,
      timeout: 0,
    };
  }
}

export async function generateTasks(context: GenerateContext): Promise<string> {
  const retval: TasksExtract = {
    clusters: {},
    tasktypes: {},
  };

  for (const mod of context.moduledefs) {
    if (mod.modXml)
      parseXMLTasks(context, mod.name, mod.resourceBase, mod.modXml, retval);

    if (mod.modYml)
      parseYMLTasks(context, mod.name, mod.resourceBase, mod.modYml, retval);
  }
  return JSON.stringify(retval, null, 2) + "\n";
}
