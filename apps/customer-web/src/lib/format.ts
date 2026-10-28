/** Formatting helpers ported from the artifact. */

export const eur = (n: number | null | undefined): string =>
  new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(n ?? 0);

export const hm = (min: number): string => {
  const m = Math.round(min || 0);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};

export const fmtViewing = (iso: string): string =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });

export const fmtDay = (date: string): string =>
  new Date(`${date}T12:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric"
  });

export const fmtMonth = (month: string): string =>
  month === "Undated"
    ? month
    : new Date(`${month}-01T12:00`).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric"
      });

export const fmtWhen = (iso: string): string =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
