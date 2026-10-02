export function formatChatTimestamp(createdAt) {
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;

  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return null;

  return {
    label: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date),
    dateTime: date.toISOString(),
  };
}
