import { useCallback, useEffect, useState } from "react";
import type {
  Brief,
  Comment,
  CustomerListing,
  HoursEntry,
  MemberRole,
  Photo,
  Rating,
  Settings
} from "@jj/shared";
import { api } from "./api/client";

export interface SearchData {
  clientName: string;
  settings: Settings;
  brief: Brief;
  role: MemberRole;
  listings: CustomerListing[];
  photos: (Photo & { url: string })[];
  ratings: Rating[];
  comments: Comment[];
  hours: HoursEntry[];
}

export function useSearchData(searchId: string | null) {
  const [data, setData] = useState<SearchData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!searchId) return;
    try {
      const [detail, listings, ratings, comments, hours] = await Promise.all([
        api.searchDetail(searchId),
        api.listings(searchId),
        api.ratings(searchId),
        api.comments(searchId),
        api.hours(searchId)
      ]);
      // Photos are requested for the visible listings (global pool model).
      const photos = await api.photos(
        searchId,
        listings.items.map((l) => l.id)
      );
      setData({
        clientName: detail.search.clientName,
        settings: detail.search.settings,
        brief: detail.brief,
        role: detail.role,
        listings: listings.items,
        photos: photos.items,
        ratings: ratings.items,
        comments: comments.items,
        hours: hours.items
      });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the search");
    }
  }, [searchId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const refreshRatings = useCallback(async () => {
    if (!searchId) return;
    const r = await api.ratings(searchId);
    setData((d) => (d ? { ...d, ratings: r.items } : d));
  }, [searchId]);

  const refreshComments = useCallback(async () => {
    if (!searchId) return;
    const c = await api.comments(searchId);
    setData((d) => (d ? { ...d, comments: c.items } : d));
  }, [searchId]);

  return { data, error, reload: load, refreshRatings, refreshComments };
}
