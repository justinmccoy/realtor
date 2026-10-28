import {
  customerListingSchema,
  paginateOffset,
  pricePerSqm,
  type CustomerListing,
  type Listing,
  type ListingCreateInput,
  type ListingListQuery,
  type ListingUpdateInput
} from "@jj/shared";

export { paginateOffset };

/* Pure domain logic, unit-tested without DynamoDB. */

export function buildListing(
  searchId: string,
  input: ListingCreateInput,
  id: string,
  now: string
): Listing {
  return { id, searchId, ...input, createdAt: now, updatedAt: now };
}

export function mergeListing(
  existing: Listing,
  input: ListingUpdateInput,
  now: string
): Listing {
  const merged: Listing = { ...existing, ...input, updatedAt: now };
  return merged;
}

export function toCustomerListing(l: Listing): CustomerListing {
  return customerListingSchema.parse(l);
}

export function applyFilters(
  listings: Listing[],
  query: Pick<ListingListQuery, "status" | "bezirk" | "published" | "q">
): Listing[] {
  let out = listings;
  if (query.status) out = out.filter((l) => l.status === query.status);
  if (query.bezirk) out = out.filter((l) => l.bezirk === query.bezirk);
  if (query.published !== undefined) {
    out = out.filter((l) => l.published === query.published);
  }
  if (query.q) {
    const q = query.q.toLowerCase();
    out = out.filter((l) =>
      [l.title, l.kiez ?? "", l.ortsteil ?? "", l.notes]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }
  return out;
}

const BIG = Number.MAX_SAFE_INTEGER;

export function sortListings(
  listings: Listing[],
  sort: ListingListQuery["sort"]
): Listing[] {
  const copy = [...listings];
  switch (sort) {
    case "price":
      copy.sort((a, b) => (a.price ?? BIG) - (b.price ?? BIG));
      break;
    case "sqm":
      copy.sort(
        (a, b) =>
          (pricePerSqm(a.price, a.sqm) ?? BIG) -
          (pricePerSqm(b.price, b.sqm) ?? BIG)
      );
      break;
    case "new":
      copy.sort((a, b) => b.id.localeCompare(a.id)); // ULIDs sort by creation
      break;
  }
  // Stable overlays, as in the artifact: benchmark first, passed last.
  copy.sort((a, b) => Number(a.status === "passed") - Number(b.status === "passed"));
  copy.sort((a, b) => Number(b.benchmark) - Number(a.benchmark));
  return copy;
}

