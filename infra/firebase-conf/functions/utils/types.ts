// This file is a compilation of Firebase collections' data schemas.

import { Timestamp } from "@google-cloud/firestore";

export interface FriendInviteData {
  sender: string;
  term: string;
  versions: string[];
  created: Timestamp;
  link: boolean; // is this invite a link ?
  validFor?: number; // in seconds
  friend?: string;
}

export interface FriendEmailInviteData extends FriendInviteData {
  friend: string;
}

export type CreateInviteRequestData = {
  IDToken: string;
  term: string;
  versions: string[];
  redirectURL: string;
  friendEmail?: string;
  validFor?: number;
};

// This type should automatically accept any schedule data
export type AnyScheduleData = Version2ScheduleData | Version3ScheduleData;
export type AnyScheduleVersion =
  | Version2ScheduleVersion
  | Version3ScheduleVersion;

// The following types are directly imported from https://github.com/gt-scheduler/website/blob/main/src/data/types.ts

// Version 2 schedule data (2021-10-26)
// ===================================
//  - addition of unique keys for schedule versions
//  - addition of createdAt fields for schedule versions
//    to provide natural, reconcilable, sort order
//  - removal of all `currentIndex` and `currentTerm` fields
//    (instead stored in separate ui state)

export interface Version2ScheduleData {
  terms: Record<string, Version2TermScheduleData>;
  version: 2;
}

export interface Version2TermScheduleData {
  versions: Record<string, Version2ScheduleVersion>;
}

export interface Version2ScheduleVersion {
  name: string;
  createdAt: string;
  schedule: Version2Schedule;
}

export interface Version2Schedule {
  desiredCourses: string[];
  pinnedCrns: string[];
  excludedCrns: string[];
  colorMap: Record<string, string>;
  sortingOptionIndex: number;
}

// Version 3 schedule data (2023-01-22)
// ===================================
// - addition of custom events

export interface Version3ScheduleData {
  terms: Record<string, Version3TermScheduleData>;
  version: 3;
}

export interface Version3TermScheduleData {
  versions: Record<string, Version3ScheduleVersion>;
}

export interface Version3ScheduleVersion {
  name: string;
  createdAt: string;
  schedule: Version3Schedule;
  friends: Record<string, FriendShareData>;
}

export interface FriendShareData {
  status: "Pending" | "Accepted";
  email: string;
}

export interface Version3Schedule {
  desiredCourses: string[];
  pinnedCrns: string[];
  excludedCrns: string[];
  events: Event[];
  colorMap: Record<string, string>;
  sortingOptionIndex: number;
}

export interface FriendData {
  terms: Record<string, FriendTermData>;
  info: FriendInfo;
}

export interface FriendTermData {
  accessibleSchedules: Record<string, string[]>;
}

export type FriendInfo = Record<
  string,
  {
    name: string;
    email: string;
  }
>;

export type ScheduleDeletionRequest = {
  /**
   * token of account that requested the schedule deletion
   */
  IDToken: string | void;
  /**
   * ID of the INVITEE if the deletion requester is the INVITER
   * ID of the INVITER if the deletion requester is the INVITEE
   */
  peerUserId: string;
  /**
   * term that schedule version(s) belong to
   */
  term: string;
  /**
   * shared schedule version(s) for deletion
   */
  versions: string[];
  /**
   * whether the schedule version belongs to the requester
   */
  owner: boolean;
};
