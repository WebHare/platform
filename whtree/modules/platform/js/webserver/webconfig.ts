export interface Error {
  error: string;
  source: string;
}

export interface Host {
  baseurl: string;
  defaultpages: string[];
  diskfolder: string;
  forcehttps: boolean;
  forcehttpsport: number;
  hostname: string;
  id: number;
  is_interface_webserver: boolean;
  listenhosts: string[];
  lowercasemode: boolean;
  outputfolder: string;
  port: number;
  stricttransportsecurity: number;
  type: number;
}

export interface Port {
  certificatechain: string;
  ciphersuite: string;
  id: number;
  ip: string;
  istrustedport: boolean;
  keypair: number;
  port: number;
  privatekey: string;
  virtualhost: boolean;
}

export interface Account {
  password: string;
  username: string;
}

export interface Addheader {
  name: string;
  value: string;
}

export interface Check {
  type: string;
  value: string;
}

export interface Accesscheck {
  checks: Check[];
  combine: string;
  type: string;
}

export interface Checkandvm {
  accesscheck: Accesscheck;
  // errors: any[]; TODO what's the type?
}

export interface Csp {
  policy: string;
}

export interface Account2 {
  password: string;
  username: string;
}

export interface Check2 {
  type: string;
  value: string;
}

export interface Accesscheck2 {
  checks: Check2[];
  combine: string;
  type: string;
}

export interface Checkandvm2 {
  accesscheck: Accesscheck2;
  // errors: any[]; //TODO whats the type?
}

export interface Datastorage {
  isfolder: boolean;
  method: string;
  resource: string;
  tag: string;
}

export interface RuleData {
  accounts?: Account2[];
  apispec?: string;
  authlist?: boolean;
  authtype?: number;
  checkandvm?: Checkandvm2;
  datastorage?: Datastorage[];
  path?: string;
  ruledata?: {
    id: number;
    type: string;
  };
  ruleset?: string;
  wrdschema?: string;
}

export interface Datastorage2 {
  isfolder: boolean;
  method: string;
  resource: string;
  tag?: string;
}

export interface Iplist {
  is_allow: boolean;
  mask: string;
}

export interface Vars {
  modulename: string;
}

export interface Rule {
  accounts?: Account[];
  addheaders: Addheader[];
  allowallmethods: boolean;
  apispec: string;
  applyruleset: string;
  authrequired: boolean;
  cachecontrol: string;
  checkandvm: Checkandvm | null;
  csps: Csp[];
  data: RuleData | null;
  datastorage: Datastorage2[];
  errorpath: string;
  extauthscript: string;
  finalerrorpath: boolean;
  fixcase: boolean;
  forcecontenttype: string;
  id: number;
  iplist: Iplist[];
  limitservers: number[];
  matchassubdir: boolean;
  matchmethods: string[];
  matchtype: number;
  path: string;
  priority: number;
  realm: string;
  redirect: boolean;
  redirectcode: number;
  redirecttarget: string;
  redirecttarget_is_folder: boolean;
  ruledata: {
    id?: number;
    type?: string;
    router?: string;
  } | null;
  source: string;
  vars: Vars;
  wrdschema: string;
}

export interface Type {
  extension: string;
  forcedispositionattachment: boolean;
  mimetype: string;
  parsetype: number;
}

export interface Configuration {
  accesslog: number;
  debugurltag: string;
  errorlog: number;
  errors: Error[];
  hosts: Host[];
  ports: Port[];
  pxllog: number;
  rules: Rule[];
  stripextensions: string[];
  trust_xforwardedfor: string[];
  types: Type[];
  version: number;
}

export const initialconfig: Configuration = {
  accesslog: 9999,
  debugurltag: "",
  errorlog: 9999,
  errors: [],
  hosts: [],
  ports: [],
  pxllog: 9999,
  rules: [],
  stripextensions: [],
  trust_xforwardedfor: [],
  types: [],
  version: 1
};
