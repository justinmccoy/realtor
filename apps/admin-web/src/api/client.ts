import type {
  ActivityRecord,
  Brief,
  Comment,
  CommentCreateInput,
  HoursCreateInput,
  HoursEntry,
  HoursUpdateInput,
  ImportRequest,
  ImportResult,
  InviteInput,
  Listing,
  ListingCreateInput,
  ListingEngagement,
  ListingStatus,
  ListingUpdateInput,
  Member,
  Photo,
  PhotoImportItem,
  PhotoKind,
  PresignResponse,
  Rating,
  Remodel,
  Search,
  SearchCreateInput,
  SearchUpdateInput,
  ShareMode,
  Source,
  Timer
} from "@jj/shared";
import { currentAccessToken } from "../auth/cognito";
import { API_BASE } from "../config";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const token = await currentAccessToken();
  if (!token) throw new ApiClientError(401, "unauthorized", "Not signed in");
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {})
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined
  });
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (res.ok && !contentType.includes("application/json")) {
    throw new ApiClientError(
      res.status,
      "bad_gateway",
      `API returned ${contentType || "no content type"} instead of JSON — is the backend deploy up to date?`
    );
  }
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } }).error;
    throw new ApiClientError(
      res.status,
      err?.code ?? "unknown",
      err?.message ?? `Request failed (${res.status})`
    );
  }
  return data as T;
}

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
};

export type PhotoWithUrl = Photo & { url: string };
export interface SearchDetail {
  search: Search;
  brief: Brief;
  members: Member[];
}
export interface AuditItem {
  id: string;
  at: string;
  adminId: string;
  adminName: string;
  action: string;
  entity: string;
  entityId: string;
  searchId: string | null;
  summary: string;
  before: string | null;
  after: string | null;
}

export interface CustomerAccount {
  userId: string;
  email: string;
  name: string;
  status: string;
  enabled: boolean;
  createdAt: string | null;
}

export const api = {
  /* customer accounts (whole pool: self-registered + invited) */
  users: () => call<{ items: CustomerAccount[] }>("/admin/users"),

  /* searches */
  searches: (cursor?: string) =>
    call<{ items: Search[]; nextCursor: string | null }>(
      `/admin/searches${qs({ limit: 100, cursor })}`
    ),
  createSearch: (body: SearchCreateInput) =>
    call<Search>("/admin/searches", { method: "POST", body }),
  searchDetail: (sid: string) => call<SearchDetail>(`/admin/searches/${sid}`),
  updateSearch: (sid: string, body: SearchUpdateInput) =>
    call<Search>(`/admin/searches/${sid}`, { method: "PUT", body }),
  deleteSearch: (sid: string) =>
    call<void>(`/admin/searches/${sid}`, { method: "DELETE" }),
  putBrief: (sid: string, body: Brief) =>
    call<Brief>(`/admin/searches/${sid}/brief`, { method: "PUT", body }),
  invite: (sid: string, body: InviteInput) =>
    call<Member>(`/admin/searches/${sid}/members`, { method: "POST", body }),
  removeMember: (sid: string, userId: string) =>
    call<void>(`/admin/searches/${sid}/members/${userId}`, { method: "DELETE" }),

  /* listings (global pool) */
  listings: (
    params: {
      status?: ListingStatus;
      q?: string;
      published?: boolean;
      sort?: "new" | "price" | "sqm";
    } = {}
  ) =>
    call<{ items: Listing[]; nextCursor: string | null }>(
      `/admin/listings${qs({ limit: 200, ...params })}`
    ),
  createListing: (body: ListingCreateInput) =>
    call<Listing>("/admin/listings", { method: "POST", body }),
  updateListing: (lid: string, body: ListingUpdateInput) =>
    call<Listing>(`/admin/listings/${lid}`, { method: "PUT", body }),
  patchListing: (
    lid: string,
    what: "status" | "contact" | "rank" | "remodel" | "publish",
    body:
      | { status: ListingStatus }
      | { contact: string }
      | { topRank: number }
      | { remodel: Remodel | null }
      | { published: boolean }
  ) =>
    call<Listing>(`/admin/listings/${lid}/${what}`, { method: "PATCH", body }),
  deleteListing: (lid: string) =>
    call<void>(`/admin/listings/${lid}`, { method: "DELETE" }),
  bulkListings: (body: {
    ids: string[];
    op: "publish" | "unpublish" | "status" | "delete";
    status?: ListingStatus;
  }) => call<{ items: Listing[] }>("/admin/listings/bulk", { method: "POST", body }),
  viewings: (days = 14) =>
    call<{ items: Listing[] }>(`/admin/viewings${qs({ days })}`),

  /* per-search sharing */
  shares: (sid: string) =>
    call<{ items: { listingId: string; mode: ShareMode }[] }>(
      `/admin/searches/${sid}/shares`
    ),
  putShare: (sid: string, lid: string, mode: ShareMode) =>
    call<{ listingId: string; mode: ShareMode }>(
      `/admin/searches/${sid}/shares/${lid}`,
      { method: "PUT", body: { mode } }
    ),
  clearShare: (sid: string, lid: string) =>
    call<void>(`/admin/searches/${sid}/shares/${lid}`, { method: "DELETE" }),

  /* inbox (global) */
  inbox: () => call<{ items: Source[] }>("/admin/inbox"),
  addInbox: (urls: string[]) =>
    call<{ items: Source[] }>("/admin/inbox", { method: "POST", body: { urls } }),
  patchInbox: (
    sourceId: string,
    body: { status?: string; listingId?: string | null }
  ) => call<Source>(`/admin/inbox/${sourceId}`, { method: "PATCH", body }),
  deleteInbox: (sourceId: string) =>
    call<void>(`/admin/inbox/${sourceId}`, { method: "DELETE" }),

  /* link import → draft listing (+ photos downloaded by the media service) */
  importListing: (body: ImportRequest) =>
    call<ImportResult>("/admin/import", { method: "POST", body }),
  importPhotos: (lid: string, kind: PhotoKind, urls: string[]) =>
    call<{ items: PhotoImportItem[] }>(`/admin/listings/${lid}/photos/import`, {
      method: "POST",
      body: { kind, urls }
    }),

  /* media (per listing) */
  photos: (lid: string) =>
    call<{ items: PhotoWithUrl[] }>(`/admin/listings/${lid}/photos`),
  presign: (lid: string, kind: PhotoKind, contentType: string) =>
    call<PresignResponse>(`/admin/listings/${lid}/photos/presign`, {
      method: "POST",
      body: { kind, contentType }
    }),
  confirmPhoto: (lid: string, photoId: string) =>
    call<PhotoWithUrl>(`/admin/listings/${lid}/photos/${photoId}/confirm`, {
      method: "POST"
    }),
  reorderPhotos: (lid: string, kind: PhotoKind, orderedIds: string[]) =>
    call<{ items: Photo[] }>(`/admin/listings/${lid}/photos/order`, {
      method: "PATCH",
      body: { kind, orderedIds }
    }),
  deletePhoto: (lid: string, photoId: string) =>
    call<void>(`/admin/listings/${lid}/photos/${photoId}`, { method: "DELETE" }),

  /* engagement */
  ratings: (sid: string) => call<{ items: Rating[] }>(`/admin/searches/${sid}/ratings`),
  deleteRating: (sid: string, lid: string, userId: string) =>
    call<void>(`/admin/searches/${sid}/listings/${lid}/ratings/${userId}`, {
      method: "DELETE"
    }),
  comments: (sid: string) =>
    call<{ items: Comment[]; nextCursor: string | null }>(
      `/admin/searches/${sid}/comments${qs({ limit: 100 })}`
    ),
  postComment: (sid: string, body: CommentCreateInput) =>
    call<Comment>(`/admin/searches/${sid}/comments`, { method: "POST", body }),
  deleteComment: (sid: string, commentId: string) =>
    call<void>(`/admin/searches/${sid}/comments/${commentId}`, {
      method: "DELETE"
    }),

  /* timesheet */
  hours: (sid: string, params: { month?: string; paid?: boolean } = {}) =>
    call<{ items: HoursEntry[]; nextCursor: string | null }>(
      `/admin/searches/${sid}/hours${qs({ limit: 500, ...params })}`
    ),
  addHours: (sid: string, body: HoursCreateInput) =>
    call<HoursEntry>(`/admin/searches/${sid}/hours`, { method: "POST", body }),
  updateHours: (sid: string, id: string, body: HoursUpdateInput) =>
    call<HoursEntry>(`/admin/searches/${sid}/hours/${id}`, {
      method: "PUT",
      body
    }),
  deleteHours: (sid: string, id: string) =>
    call<void>(`/admin/searches/${sid}/hours/${id}`, { method: "DELETE" }),
  payMonth: (sid: string, month: string) =>
    call<{ items: HoursEntry[]; totalMinutes: number }>(
      `/admin/searches/${sid}/hours/pay-month`,
      { method: "POST", body: { month } }
    ),
  timer: (sid: string) => call<{ timer: Timer | null }>(`/admin/searches/${sid}/timer`),
  startTimer: (sid: string, category: string, note: string) =>
    call<{ timer: Timer }>(`/admin/searches/${sid}/timer`, {
      method: "PUT",
      body: { category, note }
    }),
  stopTimer: (sid: string) =>
    call<HoursEntry>(`/admin/searches/${sid}/timer/stop`, { method: "POST" }),
  discardTimer: (sid: string) =>
    call<void>(`/admin/searches/${sid}/timer`, { method: "DELETE" }),

  /* aggregates (one invocation regardless of search count) */
  hoursSummary: (searchIds: string[]) =>
    searchIds.length === 0
      ? Promise.resolve({ items: [] as { searchId: string; totalMinutes: number; openMinutes: number }[] })
      : call<{ items: { searchId: string; totalMinutes: number; openMinutes: number }[] }>(
          `/admin/hours-summary?searchIds=${searchIds.slice(0, 50).join(",")}`
        ),
  activitySummary: (params: { searchIds?: string[]; actorIds?: string[] }) => {
    const q = new URLSearchParams();
    if (params.searchIds?.length) q.set("searchIds", params.searchIds.slice(0, 50).join(","));
    if (params.actorIds?.length) q.set("actorIds", params.actorIds.slice(0, 100).join(","));
    if (!q.toString()) {
      return Promise.resolve({
        searches: [] as { searchId: string; lastActivityAt: string | null }[],
        actors: [] as { actorId: string; events30d: number }[]
      });
    }
    return call<{
      searches: { searchId: string; lastActivityAt: string | null }[];
      actors: { actorId: string; events30d: number }[];
    }>(`/admin/activity-summary?${q.toString()}`);
  },

  /* activity */
  activity: (params: { searchId?: string; actorId?: string; limit?: number } = {}) =>
    call<{ items: ActivityRecord[]; nextCursor: string | null }>(
      `/admin/activity${qs({ limit: 50, ...params })}`
    ),
  audit: (params: { limit?: number; cursor?: string } = {}) =>
    call<{ items: AuditItem[]; nextCursor: string | null }>(
      `/admin/audit${qs({ limit: 50, ...params })}`
    ),
  engagement: (sid: string) =>
    call<{ items: ListingEngagement[] }>(`/admin/searches/${sid}/engagement`)
};
