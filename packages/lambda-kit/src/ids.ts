import { ulid } from "ulid";

/** Sortable unique id used for every entity key. */
export function newId(): string {
  return ulid();
}

export function nowIso(): string {
  return new Date().toISOString();
}
