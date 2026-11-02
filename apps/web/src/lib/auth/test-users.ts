/** Users of the `base` seed scenario (apps/api seed tool), usable for one-click test logins. */
export interface TestUser {
  subject: string;
  name: string;
  email: string;
}

export const BASE_TEST_USERS: readonly TestUser[] = [
  { subject: "seed-admin", name: "Ada Admin", email: "ada@example.test" },
  { subject: "seed-alice", name: "Alice Durand", email: "alice@example.test" },
  { subject: "seed-bob", name: "Bob Martin", email: "bob@example.test" },
  { subject: "seed-carol", name: "Carole Lefèvre", email: "carole@example.test" },
  { subject: "seed-dan", name: "Dan Moreau", email: "dan@example.test" },
  { subject: "seed-erin", name: "Érin D'Aubigné-Müller", email: "erin@example.test" },
];

export function findBaseTestUser(subject: string): TestUser | undefined {
  return BASE_TEST_USERS.find((user) => user.subject === subject);
}
