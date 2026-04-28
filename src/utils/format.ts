export function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

  if (dateDay.getTime() === today.getTime()) return `今天 ${time}`;
  if (dateDay.getTime() === yesterday.getTime()) return `昨天 ${time}`;

  const diffDays = Math.floor((today.getTime() - dateDay.getTime()) / 86400000);
  if (diffDays > 0 && diffDays <= 7) return `${diffDays}天前 ${time}`;

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  if (date.getFullYear() === now.getFullYear()) {
    return `${month}-${day} ${time}`;
  }
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatFullDate(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function shortenHash(hash: string): string {
  return hash.substring(0, 7);
}

export function getFileExtension(path: string): string {
  const parts = path.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

export function getFileName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1];
}

export function getFileDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.substring(0, lastSlash) : "";
}
