import type { Document, Element } from "@xmldom/xmldom";
import { getApplicabilityError, getMyApplicabilityInfo, readApplicableToWebHareNode, type GenerateContext } from "./shared";
import { getAttr } from "./xmlhelpers";
import { whconstant_default_failreschedule } from "../webhareconstants";
import { resolveResource } from "@webhare/services";
import { addModule } from "@webhare/services/src/naming";

export type TaskCluster = {
  harescriptworkers: number;
  harescriptworkerthreads: number;
};

export type TaskType = {
  /** Name of the HS object that runs this task */
  objectname: string;
  /** Name of the TS function that runs this task */
  taskrunner: string;
  /** Apply error (task may only run if this is null) */
  applyError: string | null;
  /** Name of the taskcluster this task should run in */
  cluster: string;
  priority: number;
  maxfailures: number;
  failreschedule: number;
  linenum: number;
  timeout: number;
  allowifrestore: boolean;
};

export type TasksExtract = {
  clusters: Record<string, TaskCluster>;
  tasktypes: Record<string, TaskType>;
};

function parseXMLTask(resourcename: string, tasknode: Element, mod: string, ephemeral: boolean): TaskType {
  const task: TaskType = {
    applyError: getApplicabilityError(getMyApplicabilityInfo({ unsafeEnv: true }), readApplicableToWebHareNode(tasknode, '')),
    // type: getAttr(tasknode, "type", ""),
    objectname: resolveResource(resourcename, getAttr(tasknode, "objectname", "")),
    taskrunner: resolveResource(resourcename, getAttr(tasknode, "taskrunner", "")),
    cluster: addModule(mod, getAttr(tasknode, "cluster", "")),
    timeout: getAttr(tasknode, "timeout", 0),
    maxfailures: getAttr(tasknode, "maxfailures", -1),
    failreschedule: getAttr(tasknode, "failreschedule", whconstant_default_failreschedule),
    allowifrestore: getAttr(tasknode, "allowifrestore", false),
    priority: getAttr(tasknode, "priority", 0),
    linenum: tasknode.lineNumber || 0
  };
  return task;
}

function parseXMLTasks(mod: string, resourceBase: string, modXml: Document, out: TasksExtract): void {
  //NOTE: not caring about ephemeraltasks (yet) - they may have alternatives in managed (unique() tasks or just managing a local queue
  for (const tasknode of modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "managedtask")) {
    const type = getAttr(tasknode, "type", "");
    if (type)
      out.tasktypes[`${mod}:${type}`] = parseXMLTask(resourceBase, tasknode, mod, false);
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

export async function generateTasks(context: GenerateContext): Promise<string> {
  const retval: TasksExtract = {
    clusters: {},
    tasktypes: {},
  };

  for (const mod of context.moduledefs) {
    if (mod.modXml)
      parseXMLTasks(mod.name, mod.resourceBase, mod.modXml, retval);

    // if (mod.modYml)
    // parseYMLTasks  - YET TO BE BUILT
  }
  return JSON.stringify(retval, null, 2) + "\n";
}
