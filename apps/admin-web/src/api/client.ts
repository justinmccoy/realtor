import type {
  ActivityRecord,
  Brief,
  Comment,
  CommentCreateInput,
  HoursCreateInput,
  HoursEntry,
  HoursUpdateInput,
  InviteInput,
  Listing,
  ListingCreateInput,
  ListingEngagement,
  ListingStatus,
  ListingUpdateInput,
  Member,
  Photo,
  PhotoKind,
  PresignResponse,
  Rating,
  Remodel,
  Search,
  SearchCreateInput,
  SearchUpdateInput,
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

export const api = {
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

  /* listings */
  listings: (
    sid: string,
    params: {
      status?: ListingStatus;
      q?: string;
      published?: boolean;
      sort?: "new" | "price" | "sqm";
    } = {}
  ) =>
    call<{ items: Listing[]; nextCursor: string | null }>(
      `/admin/searches/${sid}/listings${qs({ limit: 100, ...params })}`
    ),
  createListing: (sid: string, body: ListingCreateInput) =>
    call<Listing>(`/admin/searches/${sid}/listings`, { method: "POST", body }),
  updateListing: (sid: string, lid: string, body: ListingUpdateInput) =>
    call<Listing>(`/admin/searches/${sid}/listings/${lid}`, {
      method: "PUT",
      body
    }),
  patchListing: (
    sid: string,
    lid: string,
    what: "status" | "contact" | "rank" | "remodel" | "publish",
    body:
      | { status: ListingStatus }
      | { contact: string }
      | { topRank: number }
      | { remodel: Remodel | null }
      | { published: boolean }
  ) =>
    call<Listing>(`/admin/searches/${sid}/listings/${lid}/${what}`, {
      method: "PATCH",
      body
    }),
  deleteListing: (sid: string, lid: string) =>
    call<void>(`/admin/searches/${sid}/listings/${lid}`, { method: "DELETE" }),
  bulkListings: (
    sid: string,
    body: {
      ids: string[];
      op: "publish" | "unpublish" | "status" | "delete";
      status?: ListingStatus;
    }
  ) =>
    call<{ items: Listing[] }>(`/admin/searches/${sid}/listings/bulk`, {
      method: "POST",
      body
    }),
  viewings: (days = 14) =>
    call<{ items: Listing[] }>(`/admin/viewings${qs({ days })}`),

  /* inbox */
  inbox: (sid: string) => call<{ items: Source[] }>(`/admin/searches/${sid}/inbox`),
  addInbox: (sid: string, urls: string[]) =>
    call<{ items: Source[] }>(`/admin/searches/${sid}/inbox`, {
      method: "POST",
      body: { urls }
    }),
  patchInbox: (
    sid: string,
    sourceId: string,
    body: { status?: string; listingId?: string | null }
  ) =>
    call<Source>(`/admin/searches/${sid}/inbox/${sourceId}`, {
      method: "PATCH",
      body
    }),
  deleteInbox: (sid: string, sourceId: string) =>
    call<void>(`/admin/searches/${sid}/inbox/${sourceId}`, { method: "DELETE" }),

  /* media */
  photos: (sid: string) =>
    call<{ items: PhotoWithUrl[] }>(`/admin/searches/${sid}/photos`),
  presign: (sid: string, lid: string, kind: PhotoKind, contentType: string) =>
    call<PresignResponse>(
      `/admin/searches/${sid}/listings/${lid}/photos/presign`,
      { method: "POST", body: { kind, contentType } }
    ),
  confirmPhoto: (sid: string, lid: string, photoId: string) =>
    call<PhotoWithUrl>(
      `/admin/searches/${sid}/listings/${lid}/photos/${photoId}/confirm`,
      { method: "POST" }
    ),
  reorderPhotos: (sid: string, lid: string, kind: PhotoKind, orderedIds: string[]) =>
    call<{ items: Photo[] }>(
      `/admin/searches/${sid}/listings/${lid}/photos/order`,
      { method: "PATCH", body: { kind, orderedIds } }
    ),
  deletePhoto: (sid: string, lid: string, photoId: string) =>
    call<void>(`/admin/searches/${sid}/listings/${lid}/photos/${photoId}`, {
      method: "DELETE"
    }),

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
