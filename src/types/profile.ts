export interface HelloGroup {
  name: string;
  color: string;
}

export interface Member {
  name: string;
  group: string;
  color: string;
  nicks?: string[];
}

export interface OshiMember {
  name: string;
  callName: string;
  percent: number;
  color: string;
  confirmed: boolean;
}

export interface FreeItem {
  label: string;
  values: string[];
  ranked: boolean;
  confirmed: boolean;
}

export interface ProfileData {
  name: string;
  greeting: string;
  pronoun: string;
  oshiMembers: OshiMember[];
  groups: string[];
  freeItems: FreeItem[];
}
