import type { components } from "@cartouche/api-client";

export type UserStatus = components["schemas"]["UserStatus"];

export const USER_STATUSES: readonly UserStatus[] = ["pending", "approved", "rejected", "suspended"];

const TRANSITIONS: Record<UserStatus, readonly UserStatus[]> = {
  pending: ["approved", "rejected"],
  rejected: ["approved"],
  approved: ["suspended"],
  suspended: ["approved"],
};

/**
 * spec: ADM-003. Client-side mirror of the server's status transitions, used to decide which
 * buttons to show. The server stays the reference and answers 409 invalid_transition otherwise.
 */
export function allowedTargets(status: UserStatus): UserStatus[] {
  return [...TRANSITIONS[status]];
}
